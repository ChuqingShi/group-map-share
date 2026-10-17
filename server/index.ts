// HTTP + WebSocket server. Serves the built client in production and relays
// live positions between members of in-memory rooms.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomRegistry, type Conn, type Room } from './rooms.ts';
import { serverConfig } from './config.ts';
import { ConnectionLimiter, MessageBucket, RateWindow, SECURITY_HEADERS, callerIp, hostKeyOk, originOk } from './security.ts';
import type { ClientMsg } from '../shared/protocol.ts';

const { port: PORT, host: HOST, serveStatic: SERVE_STATIC, behindProxy } = serverConfig(process.env);
const STATIC_DIR = resolve(import.meta.dirname, '..', 'dist');
/** When set, only requests carrying this key may start an event (the host link stores it). Joining stays open to anyone with the room link. */
const HOST_KEY = process.env.GMS_HOST_KEY || undefined;
const EXTRA_ORIGINS = (process.env.GMS_ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
// Venue Wi-Fi puts a whole audience behind one public address, so this is generous; it only stops one address hoarding sockets.
const socketsPerIp = new ConnectionLimiter(200);
/** New identities (joins without a resume token) per address per room, so one invite holder cannot fill a room with ghosts. */
const newIdentities = new RateWindow(10 * 60_000, 60);
/** How many proxies sit in front of us and append to X-Forwarded-For. */
const TRUSTED_HOPS = Math.max(1, Number(process.env.GMS_TRUSTED_HOPS) || 1);
const MAX_SOCKETS = 2_000;
/** Identifies this deploy, so the app can show its test mission once per new build. */
const BUILD = process.env.GMS_BUILD || process.env.RENDER_GIT_COMMIT?.slice(0, 7) || Date.now().toString(36);
/** How long a socket may sit without joining. Overridable so tests do not wait ten seconds. */
const HELLO_TIMEOUT_MS = Number(process.env.GMS_HELLO_TIMEOUT_MS) || 10_000;

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

/** Read a tiny JSON object body (event name). Anything odd, oversized or missing is just null. */
function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null | 'too_big'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1024) {
        resolve('too_big');
        req.resume(); // drain, so we can still answer
        chunks.length = 0;
      } else if (size <= 1024) chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v: unknown = JSON.parse(Buffer.concat(chunks).toString() || 'null');
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

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
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = parseUrl(req.url);
  if (!url) return json(res, 400, { error: 'bad url' });
  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    if (!hostKeyOk(HOST_KEY, req.headers['x-host-key'])) return json(res, 403, { error: 'host_only' });
    const ip = callerIp(req, behindProxy, TRUSTED_HOPS);
    if (!allowCreate(ip)) return json(res, 429, { error: 'too many rooms, try again later' });
    const body = await readJson(req);
    if (body === 'too_big') return json(res, 413, { error: 'too big' });
    const room = registry.create(body?.name);
    return room ? json(res, 201, { id: room.id, name: room.name }) : json(res, 503, { error: 'server full' });
  }
  const m = url.pathname.match(/^\/api\/rooms\/([\w-]{1,64})$/);
  if (m && req.method === 'GET') {
    const room = registry.get(m[1]);
    return room ? json(res, 200, { id: room.id, name: room.name, players: room.members.size }) : json(res, 404, { error: 'no_room' });
  }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true });
  if (url.pathname === '/api/version') return json(res, 200, { build: BUILD });
  if (SERVE_STATIC && req.method === 'GET') return serveStatic(url, res);
  json(res, 404, { error: 'not found' });
});

// --- realtime ------------------------------------------------------------
// Slow or stalled clients must not hold sockets open forever.
server.headersTimeout = 15_000;
server.requestTimeout = 20_000;

const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 2048,
  verifyClient: ({ req }: { req: IncomingMessage }) => originOk(req, EXTRA_ORIGINS) && wss.clients.size < MAX_SOCKETS,
});

wss.on('error', (err) => console.error('websocket server error:', err));

wss.on('connection', (ws: WebSocket, req) => {
  // ws emits 'error' for protocol faults (oversize or malformed frames). Without a listener Node treats it as
  // uncaught and kills the process, taking every live event with it. ws closes the socket itself.
  ws.on('error', () => {});
  const ip = callerIp(req, behindProxy, TRUSTED_HOPS);
  if (!socketsPerIp.acquire(ip)) return void ws.close(4029, 'busy');

  const roomId = parseUrl(req.url)?.searchParams.get('room') ?? '';
  const room: Room | undefined = registry.get(roomId);
  const conn: Conn = {
    send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)),
    close: () => ws.close(4000, 'replaced'),
  };

  let me: string | null = null;
  let left = false;
  let ping: ReturnType<typeof setInterval> | undefined;
  // A socket that connects and never joins is dropped quickly.
  const helloTimer = setTimeout(() => {
    if (!me) ws.close(4008, 'hello timeout');
  }, HELLO_TIMEOUT_MS);
  // Registered before anything can return early, so every exit path frees the slot and the timers.
  ws.on('close', () => {
    clearTimeout(helloTimer);
    clearInterval(ping);
    socketsPerIp.release(ip);
    if (me && room) registry.disconnect(room, me, conn);
  });

  if (!room) {
    conn.send({ t: 'error', code: 'no_room' });
    ws.close(4004, 'no_room');
    return;
  }

  const bucket = new MessageBucket();
  let drops = 0;
  let alive = true;
  ws.on('pong', () => (alive = true));
  ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);

  ws.on('message', (data) => {
    if (left) return;
    // Sustained flooding gets the socket closed; short bursts are fine.
    if (!bucket.allow()) {
      if (++drops > 60) ws.close(4009, 'slow down');
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return conn.send({ t: 'error', code: 'bad_message' });
    }
    // Valid JSON is not necessarily an object: `null`, `7` and `"x"` would make `msg.t` throw and kill the process.
    if (typeof msg !== 'object' || msg === null) return conn.send({ t: 'error', code: 'bad_message' });
    if (msg.t === 'hello') {
      if (me) return;
      if (typeof msg.token !== 'string' && !newIdentities.allow(`${ip}|${room.id}`)) {
        conn.send({ t: 'error', code: 'slow_down' });
        return ws.close(4030, 'too many joins');
      }
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
    else if (msg.t === 'organizer') registry.setOrganizer(room, me, msg.on);
    else if (msg.t === 'contact') registry.setContact(room, me, msg.text);
    else if (msg.t === 'mood') registry.setMood(room, me, msg.mood, msg.note, msg.emoji, msg.text);
    else if (msg.t === 'plan') registry.createPlan(room, me, msg);
    else if (msg.t === 'plan_join') registry.joinPlan(room, me, msg.id);
    else if (msg.t === 'plan_leave') registry.leavePlan(room, me, msg.id);
    else if (msg.t === 'plan_decline') registry.declinePlan(room, me, msg.id);
    else if (msg.t === 'plan_suggest') registry.suggestPlan(room, me, msg.id, msg.place, msg.note);
    else if (msg.t === 'plan_cancel') registry.cancelPlan(room, me, msg.id);
    else if (msg.t === 'plan_ping') registry.pingPlan(room, me, msg.id);
    else if (msg.t === 'bubble') registry.say(room, me, msg.emoji, msg.text);
    else if (msg.t === 'leave') {
      registry.leave(room, me);
      me = null;
      left = true;
      ws.close(1000, 'left');
    }
  });
});

// Last line of defence: log and keep serving rather than dropping every live event over one bad request.
process.on('uncaughtException', (err) => console.error('uncaught exception (kept running):', err));
process.on('unhandledRejection', (err) => console.error('unhandled rejection (kept running):', err));

server.listen(PORT, HOST, () => {
  if (SERVE_STATIC && !HOST_KEY) console.log('GMS_HOST_KEY is not set: anyone who opens the site can start an event.');
  console.log(`group-map-share server on http://${HOST}:${PORT}${SERVE_STATIC ? ' (serving dist/)' : ''}`);
});
