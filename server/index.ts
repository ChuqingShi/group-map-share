// HTTP + WebSocket server. Serves the built client in production and relays
// live positions between members of in-memory rooms.
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomRegistry, type Conn, type Room } from './rooms.ts';
import { clientIp, serverConfig } from './config.ts';
import type { ClientMsg } from '../shared/protocol.ts';

const { port: PORT, host: HOST, serveStatic: SERVE_STATIC, behindProxy } = serverConfig(process.env);
const STATIC_DIR = resolve(import.meta.dirname, '..', 'dist');

export const registry = new RoomRegistry();
setInterval(() => registry.sweep(), 30_000).unref();

// --- tiny per-IP limiter for room creation -------------------------------
const createLog = new Map<string, number[]>();
function allowCreate(ip: string): boolean {
  const now = Date.now();
  const recent = (createLog.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 30) return false;
  recent.push(now);
  createLog.set(ip, recent);
  return true;
}
setInterval(() => createLog.clear(), 60 * 60_000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Parse a request target without ever throwing. A raw target like `//` is read as a
 * protocol-relative URL by `new URL(raw, base)` and throws, which in an async handler
 * becomes an unhandled rejection that kills the whole process (and every live room).
 * Prefixing the origin keeps it a plain path.
 */
function parseUrl(raw: string | undefined): URL | null {
  const target = raw ?? '/';
  try {
    return new URL(target.startsWith('/') ? `http://x${target}` : `http://x/${target}`);
  } catch {
    return null;
  }
}

async function serveStatic(url: URL, res: ServerResponse) {
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    // Malformed %-escapes (e.g. /%E0%A4%A) must not become an unhandled rejection that kills the process.
    return json(res, 400, { error: 'bad path' });
  }
  let file = normalize(join(STATIC_DIR, urlPath));
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) return json(res, 400, { error: 'bad path' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
  } catch {
    file = join(STATIC_DIR, 'index.html'); // SPA fallback (e.g. /r/<room>)
  }
  try {
    const body = await readFile(file);
    const immutable = file.includes(`${STATIC_DIR}/assets/`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'referrer-policy': 'no-referrer', // keep room ids out of Referer headers sent to tile servers
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = parseUrl(req.url);
  if (!url) return json(res, 400, { error: 'bad url' });
  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    const ip = clientIp(req, behindProxy);
    if (!allowCreate(ip)) return json(res, 429, { error: 'too many rooms, try again later' });
    const room = registry.create();
    return room ? json(res, 201, { id: room.id }) : json(res, 503, { error: 'server full' });
  }
  const m = url.pathname.match(/^\/api\/rooms\/([\w-]{1,64})$/);
  if (m && req.method === 'GET') {
    const room = registry.get(m[1]);
    return room ? json(res, 200, { id: room.id, players: room.members.size }) : json(res, 404, { error: 'no_room' });
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, rooms: registry.rooms.size });
  if (SERVE_STATIC && req.method === 'GET') return serveStatic(url, res);
  json(res, 404, { error: 'not found' });
});

// --- realtime ------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws: WebSocket, req) => {
  const roomId = parseUrl(req.url)?.searchParams.get('room') ?? '';
  const room: Room | undefined = registry.get(roomId);
  const conn: Conn = {
    send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
    close: () => ws.close(4000, 'replaced'),
  };
  if (!room) {
    conn.send({ t: 'error', code: 'no_room' });
    ws.close(4004, 'no_room');
    return;
  }

  let me: string | null = null;
  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return conn.send({ t: 'error', code: 'bad_message' });
    }
    if (msg.t === 'hello') {
      if (me) return;
      const r = registry.join(room, conn, msg);
      if ('error' in r) {
        conn.send({ t: 'error', code: r.error });
        return ws.close(4003, r.error);
      }
      me = r.id;
      return;
    }
    if (!me || !registry.owns(room, me, conn)) return;
    if (msg.t === 'pos') registry.updatePosition(room, me, msg.lat, msg.lng, msg.acc);
    else if (msg.t === 'sharing') registry.setSharing(room, me, msg.on === true);
    else if (msg.t === 'leave') {
      registry.leave(room, me);
      me = null;
      ws.close(1000, 'left');
    }
  });

  ws.on('close', () => {
    clearInterval(ping);
    if (me) registry.disconnect(room, me, conn);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`group-map-share server on http://${HOST}:${PORT}${SERVE_STATIC ? ' (serving dist/)' : ''}`);
});
