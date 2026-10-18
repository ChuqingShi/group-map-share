// Test harness for the browser end-to-end suite.
//
// - startServer(): the real production server (NODE_ENV=production node server/index.ts) on a free port, serving dist/.
// - launchBrowser(): the Google Chrome already installed on the machine (no browser download).
// - newPlayer(): one isolated phone-sized browser context per person, with deterministic GPS (?sim=),
//   a recording speechSynthesis and a scriptable speech recogniser.
// - scenario(): a node:test test that always closes its contexts and saves screenshots when it fails.
//
// Waits are on the DOM and on websocket messages only. Map tiles are never waited for, and by default
// every request to a non-local host is aborted so runs are offline-safe and fast (E2E_ALLOW_NET=1 lets them through).
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import type { ClientMsg, PlanKind, ServerMsg } from '../shared/protocol.ts';

/** Repo root. E2E_ROOT lets you point the suite at another checkout that has a built dist/. */
export const ROOT = process.env.E2E_ROOT ? resolve(process.env.E2E_ROOT) : resolve(import.meta.dirname, '..');
export const ARTIFACTS = resolve(import.meta.dirname, 'artifacts');

/** Default wait for something to show up in the DOM or on the wire. */
export const WAIT = 10_000;
/** Ports we must never bind (other dev servers on the same machine). */
const FORBIDDEN_PORTS = new Set([8787, 8790, 5173, 8443]);

export type Sim = readonly [lat: number, lng: number];
/** A few spots on Santa Monica beach, about 50 to 150 m apart. */
export const SPOTS = {
  ann: [34.0094, -118.4965],
  bob: [34.0099, -118.4958],
  cat: [34.0089, -118.497],
} as const satisfies Record<string, Sim>;

const log = (msg: string) => process.stderr.write(`[e2e] ${msg}\n`);

// --- polling -----------------------------------------------------------------

/** Retry `fn` (which should throw, e.g. via assert) until it passes or `timeout` ms pass. */
export async function eventually<T>(
  fn: () => Promise<T> | T,
  o: { timeout?: number; interval?: number; message?: string } = {},
): Promise<T> {
  const timeout = o.timeout ?? WAIT;
  const end = Date.now() + timeout;
  let last: unknown;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      last = e;
    }
    if (Date.now() >= end) break;
    await sleep(o.interval ?? 100);
  }
  const why = last instanceof Error ? last.message : String(last);
  throw new Error(`${o.message ?? 'condition not met'} (waited ${timeout} ms): ${why}`, { cause: last });
}

/** Assert that `fn` keeps passing for `ms` (used for "nothing happens" checks). */
export async function staysTrue(fn: () => Promise<void> | void, ms = 1200, every = 200): Promise<void> {
  const end = Date.now() + ms;
  do {
    await fn();
    await sleep(every);
  } while (Date.now() < end);
}

// --- the production server -----------------------------------------------------

export interface TestServer {
  baseUrl: string;
  port: number;
  /** Combined stdout and stderr of the server so far (all runs). */
  log(): string;
  /** False once the child process has exited. */
  alive(): boolean;
  healthy(): Promise<boolean>;
  /**
   * Stop the server and start a fresh one on the same port, like a redeploy. Without saved events every room is gone;
   * with them (setup({ persist: true })) the events come back. `hard` kills it without warning instead of asking it to stop.
   */
  restart(o?: { hard?: boolean }): Promise<void>;
  stop(): Promise<void>;
}

function canBind(port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = createNetServer();
    s.once('error', () => done(false));
    s.listen(port, '127.0.0.1', () => s.close(() => done(true)));
  });
}

async function pickPort(): Promise<number> {
  for (let i = 0; i < 60; i++) {
    const port = 18600 + Math.floor(Math.random() * 100);
    if (!FORBIDDEN_PORTS.has(port) && (await canBind(port))) return port;
  }
  // The preferred range is crowded: let the OS pick, but never one of the forbidden ports.
  for (let i = 0; i < 20; i++) {
    const port = await new Promise<number>((res, rej) => {
      const s = createNetServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => res(p));
      });
    });
    if (!FORBIDDEN_PORTS.has(port)) return port;
  }
  throw new Error('no free port');
}

interface Running {
  child: ChildProcess;
  exited(): boolean;
  kill(hard?: boolean): Promise<void>;
}

/** Spawn the production server on `port` and wait for /api/health. Returns null if it did not come up. */
async function spawnServer(port: number, sink: (chunk: string) => void, dataDir?: string): Promise<Running | null> {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', GMS_PORT: String(port), GMS_HOST: '127.0.0.1' };
  delete env.GMS_DATA_DIR; // a developer's shell must not make the tests write to their disk
  if (dataDir) env.GMS_DATA_DIR = dataDir;
  delete env.RENDER; // on Render the server would listen on PORT instead
  delete env.GMS_HOST_KEY; // a host key in the developer's shell would make room creation return 403
  const child = spawn(process.execPath, ['server/index.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (d) => sink(String(d)));
  child.stderr?.on('data', (d) => sink(String(d)));
  let exited = false;
  child.once('exit', () => (exited = true));
  const hardKill = () => {
    if (!exited) child.kill('SIGKILL');
  };
  process.once('exit', hardKill);
  const running: Running = {
    child,
    exited: () => exited,
    async kill(hard = false) {
      process.removeListener('exit', hardKill);
      if (exited) return;
      child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      const timer = setTimeout(hardKill, 3000);
      await once(child, 'exit');
      clearTimeout(timer);
    },
  };
  for (let i = 0; i < 100 && !exited; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok && !exited) return running;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  await running.kill();
  return null;
}

export async function startServer(o: { persist?: boolean } = {}): Promise<TestServer> {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error(`${join(ROOT, 'dist')} is missing: run "npm run build" first (npm run e2e does it for you)`);
  }
  let output = '';
  const sink = (chunk: string) => (output = (output + chunk).slice(-30_000));
  const dataDir = o.persist ? mkdtempSync(join(tmpdir(), 'groupz-e2e-')) : undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await pickPort();
    let running = await spawnServer(port, sink, dataDir);
    if (!running) continue; // most likely the port was taken in the meantime: try another
    const baseUrl = `http://127.0.0.1:${port}`;
    log(`server on ${baseUrl} (node ${process.version}, serving ${join(ROOT, 'dist')})`);
    let current: Running = running;
    return {
      baseUrl,
      port,
      log: () => output,
      alive: () => !current.exited(),
      async healthy() {
        try {
          return (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok;
        } catch {
          return false;
        }
      },
      async restart(opts = {}) {
        await current.kill(opts.hard);
        running = await spawnServer(port, sink, dataDir);
        if (!running) throw new Error(`server did not come back on port ${port}:\n${output}`);
        current = running;
      },
      async stop() {
        await current.kill();
        if (dataDir) rmSync(dataDir, { recursive: true, force: true });
      },
    };
  }
  throw new Error(`production server did not start:\n${output}`);
}

// --- the browser ----------------------------------------------------------------

/** Other Chromium-based browsers to try when Google Chrome is not installed. */
const FALLBACK_BROWSERS = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
];

/**
 * Launch headless Chrome that is already installed (no download). Override with
 * E2E_CHANNEL (chrome, chrome-beta, msedge, chromium) or E2E_EXECUTABLE_PATH. E2E_HEADED=1 shows the window.
 */
export async function launchBrowser(): Promise<Browser> {
  const base = {
    headless: process.env.E2E_HEADED !== '1',
    // Software WebGL, so MapLibre also works on machines and CI runners without a GPU.
    args: ['--enable-unsafe-swiftshader'],
  };
  const attempts: { label: string; opts: Parameters<typeof chromium.launch>[0] }[] = [];
  if (process.env.E2E_EXECUTABLE_PATH) {
    attempts.push({ label: process.env.E2E_EXECUTABLE_PATH, opts: { ...base, executablePath: process.env.E2E_EXECUTABLE_PATH } });
  } else if (process.env.E2E_CHANNEL) {
    attempts.push({ label: `channel ${process.env.E2E_CHANNEL}`, opts: { ...base, channel: process.env.E2E_CHANNEL } });
  } else {
    attempts.push({ label: 'channel chrome', opts: { ...base, channel: 'chrome' } });
    for (const p of FALLBACK_BROWSERS) if (existsSync(p)) attempts.push({ label: p, opts: { ...base, executablePath: p } });
  }
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      const browser = await chromium.launch(a.opts);
      log(`browser: ${a.label} ${browser.version()}${base.headless ? ' (headless)' : ''}`);
      return browser;
    } catch (e) {
      errors.push(`${a.label}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `Could not start a Chromium-based browser.\n${errors.join('\n')}\n` +
      'Install Google Chrome, or set E2E_EXECUTABLE_PATH, or run: npx playwright-core install chromium --with-deps and set E2E_CHANNEL=chromium',
  );
}

// --- browser-side stubs -----------------------------------------------------------

/**
 * Runs in every page before the app. Records what the app says out loud (window.__spoken), and replaces
 * speech recognition with one that answers with whatever string the test put in window.__transcript.
 * Written with `any` on purpose: it only ever executes in the page.
 */
function installStubs() {
  const w = window as any;
  w.__spoken = [] as string[];
  w.__spokenAll = [] as { text: string; volume: number }[];
  w.__transcript = '';
  w.__recognitionStarts = 0;

  const synth: any = {
    speaking: false,
    pending: false,
    paused: false,
    onvoiceschanged: null,
    speak(u: any) {
      w.__spokenAll.push({ text: String(u.text ?? ''), volume: u.volume });
      // The app primes speech with a silent utterance inside a tap; that is not "speaking".
      if (String(u.text ?? '').trim() && u.volume !== 0) w.__spoken.push(String(u.text));
      setTimeout(() => {
        u.onstart?.({ type: 'start' });
        u.onend?.({ type: 'end' });
      }, 0);
    },
    cancel() {},
    pause() {},
    resume() {},
    getVoices() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });

  class FakeRecognition {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    grammars: unknown = null;
    _listeners: Record<string, ((e: unknown) => void)[]> = {};
    _running = false;
    _timer: ReturnType<typeof setTimeout> | undefined;
    addEventListener(type: string, fn: (e: unknown) => void) {
      (this._listeners[type] ??= []).push(fn);
    }
    removeEventListener(type: string, fn: (e: unknown) => void) {
      this._listeners[type] = (this._listeners[type] ?? []).filter((f) => f !== fn);
    }
    dispatchEvent() {
      return true;
    }
    _emit(type: string, extra: object = {}) {
      const ev = { type, target: this, ...extra };
      const handler = (this as any)['on' + type];
      if (typeof handler === 'function') handler.call(this, ev);
      for (const f of this._listeners[type] ?? []) f.call(this, ev);
    }
    _deliver() {
      if (!this._running) return;
      this._running = false;
      clearTimeout(this._timer);
      const transcript = typeof w.__transcript === 'string' ? w.__transcript : '';
      this._emit('audiostart');
      this._emit('soundstart');
      this._emit('speechstart');
      if (transcript) {
        const alt = { transcript, confidence: 0.95 };
        const result: any = [alt];
        result.isFinal = true;
        result.item = (i: number) => result[i];
        const results: any = [result];
        results.item = (i: number) => results[i];
        this._emit('result', { resultIndex: 0, results });
      } else {
        this._emit('error', { error: 'no-speech', message: 'no speech' });
      }
      this._emit('speechend');
      this._emit('soundend');
      this._emit('audioend');
      this._emit('end');
    }
    start() {
      if (this._running) throw new DOMException('recognition has already started', 'InvalidStateError');
      this._running = true;
      w.__recognitionStarts += 1;
      this._emit('start');
      // Answer shortly after start, the way a real recogniser answers after the person stops talking.
      this._timer = setTimeout(() => this._deliver(), 60);
    }
    stop() {
      this._deliver();
    }
    abort() {
      if (!this._running) return;
      this._running = false;
      clearTimeout(this._timer);
      this._emit('end');
    }
  }
  w.webkitSpeechRecognition = FakeRecognition;
  w.SpeechRecognition = FakeRecognition;
}

// --- raw websocket clients ----------------------------------------------------------

export interface RawClient {
  readonly id: string | null;
  readonly messages: ServerMsg[];
  readonly closed: { code: number; reason: string } | null;
  /** Send a typed message. */
  send(msg: ClientMsg | Record<string, unknown>): void;
  /** Send exactly this text frame. */
  sendText(text: string): void;
  waitFor<T extends ServerMsg = ServerMsg>(pred: (m: ServerMsg) => boolean, timeout?: number): Promise<T>;
  /** Send hello (and a position) and wait for the welcome. */
  hello(name: string, sim?: Sim): Promise<string>;
  close(): void;
}

export async function rawClient(baseUrl: string, roomId: string): Promise<RawClient> {
  const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws?room=${encodeURIComponent(roomId)}`);
  const messages: ServerMsg[] = [];
  let id: string | null = null;
  let closed: { code: number; reason: string } | null = null;
  ws.on('message', (d) => {
    try {
      const m = JSON.parse(String(d)) as ServerMsg;
      messages.push(m);
      if (m.t === 'welcome') id = m.you;
    } catch {
      /* the server only ever sends JSON */
    }
  });
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason) }));
  ws.on('error', () => {});
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
    ws.once('close', () => rej(new Error('websocket closed before open'))); // a no-op once it has opened
  });
  const client: RawClient = {
    get id() {
      return id;
    },
    messages,
    get closed() {
      return closed;
    },
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendText: (text) => ws.send(text),
    waitFor: async <T extends ServerMsg>(pred: (m: ServerMsg) => boolean, timeout = WAIT) =>
      eventually(() => {
        const hit = messages.find(pred);
        assert.ok(hit, 'no matching message yet');
        return hit as T;
      }, { timeout, message: 'websocket message' }),
    async hello(name, sim) {
      client.send({ t: 'hello', name, avatar: '🐸', color: '#2fb8ff' });
      await client.waitFor((m) => m.t === 'welcome');
      if (sim) client.send({ t: 'pos', lat: sim[0], lng: sim[1], acc: 5 });
      return id!;
    },
    close: () => ws.terminate(),
  };
  return client;
}

// --- players (one isolated browser context each) -----------------------------------------

export interface PlayerOptions {
  /** Join this existing room link instead of creating a new room. */
  roomUrl?: string;
  viewport?: { width: number; height: number };
  /** Stop at the join form instead of filling it in. */
  join?: boolean;
  /** Let requests to external hosts (map tiles) through. Default: aborted. */
  allowNet?: boolean;
  /** Name for the event, typed into the optional field on the landing page when creating a room. */
  eventName?: string;
  /** Extra browser permissions for this person, e.g. ['notifications']. Geolocation is always granted. */
  permissions?: string[];
}

export interface Player {
  readonly name: string;
  readonly sim: Sim;
  readonly context: BrowserContext;
  readonly page: Page;
  /** The room this person created or joined first. */
  readonly roomId: string;
  readonly roomUrl: string;
  /** The event name typed on the landing page, if any. */
  readonly eventName: string | undefined;
  /** Counters for how the app behaved while getting this person into the room. */
  readonly stats: { joinFormsFilled: number };
  /** Player id from the latest websocket welcome. Throws if the tab has not joined. */
  readonly id: string;
  /** Every welcome this tab has received (a reload or reconnect adds one). */
  readonly welcomes: Extract<ServerMsg, { t: 'welcome' }>[];
  /** Everything the server sent this tab, across all of its sockets. */
  readonly received: ServerMsg[];
  /** Everything this tab sent. */
  readonly sent: ClientMsg[];
  /** Page errors and console errors, minus failed requests to external map hosts. */
  readonly errors: string[];
  /** All console output, for failure reports. */
  readonly consoleLog: string[];
  tid(id: string): Locator;
  assertNoErrors(): void;
  /** Wait for a websocket message from the server. */
  waitForMessage<T extends ServerMsg = ServerMsg>(pred: (m: ServerMsg) => boolean, timeout?: number): Promise<T>;
  spoken(): Promise<string[]>;
  setTranscript(text: string): Promise<void>;
  /** Reload and wait until the server has welcomed this tab again (fills the join form only if the app shows one). */
  reload(): Promise<void>;
  /** Run `action` (e.g. tap Create or an event card), then walk through gate, invite and join form until welcomed. */
  joinNext(action: () => Promise<void>): Promise<void>;
  /** The room id in the page's current URL, or '' when on the landing page. */
  currentRoomId(): string;
  close(): Promise<void>;
}

const isLocalHost = (host: string) => ['127.0.0.1', 'localhost', '[::1]', '::1', ''].includes(host);
const FETCH_FAILURE = /Failed to load resource|AJAXError|Failed to fetch|net::ERR_|NetworkError|Load failed/i;

/** True for console errors that are only a failed request to an external host (map tiles, terrain). */
export function isExternalNetworkNoise(text: string, locationUrl: string): boolean {
  if (!FETCH_FAILURE.test(text)) return false;
  const urls = [...(text.match(/https?:\/\/[^\s)'"]+/g) ?? []), locationUrl];
  return urls.some((u) => {
    try {
      return !isLocalHost(new URL(u).hostname);
    } catch {
      return false;
    }
  });
}

/** The one big button on the landing page that creates a room. Its label has changed before, so fall back to the class. */
export const landingCreateButton = (page: Page): Locator =>
  page.getByRole('button', { name: /Create a room/ }).or(page.locator('button.btn-big')).first();

const simQuery = (sim: Sim) => `sim=${sim[0]},${sim[1]}`;

/**
 * Open a phone-sized browser context for one person, load the app with simulated GPS, create or join a
 * room and fill in the join form. Resolves once the server has welcomed this tab.
 */
export async function newPlayer(browser: Browser, baseUrl: string, name: string, sim: Sim, opts: PlayerOptions = {}): Promise<Player> {
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    locale: 'en-US',
    permissions: ['geolocation', ...(opts.permissions ?? [])],
    geolocation: { latitude: sim[0], longitude: sim[1], accuracy: 5 },
    serviceWorkers: 'block',
  });
  context.setDefaultTimeout(WAIT);
  context.setDefaultNavigationTimeout(20_000);
  await context.addInitScript(installStubs);
  if (!(opts.allowNet ?? process.env.E2E_ALLOW_NET === '1')) {
    await context.route(
      (url) => !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) ? false : !isLocalHost(url.hostname),
      (route) => route.abort(),
    );
  }
  const page = await context.newPage();

  const welcomes: Player['welcomes'] = [];
  const received: ServerMsg[] = [];
  const sent: ClientMsg[] = [];
  const errors: string[] = [];
  const consoleLog: string[] = [];
  const stats = { joinFormsFilled: 0 };

  page.on('pageerror', (e) => {
    errors.push(`pageerror: ${e.message}`);
    consoleLog.push(`[pageerror] ${e.stack ?? e.message}`);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLog.push(`[${msg.type()}] ${text}`);
    if (msg.type() !== 'error') return;
    if (isExternalNetworkNoise(text, msg.location().url)) return;
    errors.push(`console.error: ${text} (${msg.location().url})`);
  });
  page.on('crash', () => errors.push('page crashed'));
  page.on('dialog', (d) => void d.accept().catch(() => {}));
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      try {
        const m = JSON.parse(String(payload)) as ServerMsg;
        received.push(m);
        if (m.t === 'welcome') welcomes.push(m);
      } catch {
        /* ignore non-JSON */
      }
    });
    ws.on('framesent', ({ payload }) => {
      try {
        sent.push(JSON.parse(String(payload)) as ClientMsg);
      } catch {
        /* ignore */
      }
    });
  });

  const tid = (id: string) => page.locator(`[data-testid="${id}"]`);
  const roomIdOf = () => new URL(page.url()).pathname.match(/^\/r\/([\w-]+)/)?.[1] ?? '';

  const nameInput = page.locator('input[placeholder="e.g. Sam"]');
  const scopedJoin = page.locator('form', { has: nameInput }).locator('button', { hasText: 'Join' });
  const doneButton = page.getByRole('button', { name: 'Done', exact: true });
  const createButton = landingCreateButton(page);
  const quick = { timeout: 3000 };
  const gateButton = page.getByRole('button', { name: /^[^A-Za-z]*Share my location\s*$/ });

  /**
   * Walk through whatever screens stand between here and `goal`. The screens race with the app's own
   * auto-advance (it asks for location by itself when permission is already granted), so every step is
   * short, tolerant of elements vanishing mid-click, and repeated until the goal is reached.
   */
  const advance = async (goal: 'room' | 'join-form' | 'joined', welcomesBefore = welcomes.length) => {
    const deadline = Date.now() + 25_000;
    let gateSince = 0;
    let lastError = '';
    while (Date.now() < deadline) {
      try {
        if (goal === 'joined' && welcomes.length > welcomesBefore) return;
        if (goal === 'room' && roomIdOf()) return;
        if (await doneButton.isVisible()) {
          await doneButton.click(quick); // the invite sheet covers the join form
          continue;
        }
        // Returning device: "Joining as Ann" has no name field, you just tap Join.
        if (!(await nameInput.isVisible()) && (await tid('join-form').isVisible())) {
          if (goal !== 'joined') return;
          stats.joinFormsFilled += 1;
          await tid('join-form').locator('button', { hasText: 'Join' }).first().click(quick);
          await sleep(200);
          continue;
        }
        if (await nameInput.isVisible()) {
          if (goal !== 'joined') return;
          await nameInput.fill(name, quick);
          stats.joinFormsFilled += 1;
          const button = (await scopedJoin.count()) > 0 ? scopedJoin.first() : page.locator('button', { hasText: 'Join' }).first();
          await button.click(quick);
          await sleep(200);
          continue;
        }
        if (await gateButton.isVisible()) {
          // Normally the app continues on its own (permission is granted); only tap if it is still waiting.
          gateSince ||= Date.now();
          if (Date.now() - gateSince > 1500) {
            await gateButton.click(quick);
            gateSince = 0;
          }
        } else {
          gateSince = 0;
        }
      } catch (e) {
        lastError = (e as Error).message.split('\n')[0];
      }
      await sleep(100);
    }
    throw new Error(`${name}: did not reach "${goal}" within 25 s (url ${page.url()}) ${lastError}`);
  };

  /** The invite sheet can open right after joining (for the host); it covers the whole screen, so close it. */
  const dismissInvite = async (waitMs: number) => {
    const end = Date.now() + waitMs;
    do {
      if (await doneButton.isVisible()) {
        await doneButton.click(quick).catch(() => {});
        await doneButton.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        return;
      }
      await sleep(100);
    } while (Date.now() < end);
  };

  let roomUrl: string;
  try {
    if (opts.roomUrl) {
      roomUrl = opts.roomUrl;
      await page.goto(`${roomUrl}?${simQuery(sim)}`, { waitUntil: 'domcontentloaded' });
    } else {
      await page.goto(`${baseUrl}/?${simQuery(sim)}`, { waitUntil: 'domcontentloaded' });
      if (opts.eventName !== undefined) await page.locator('[data-testid="event-name"]').fill(opts.eventName);
      await createButton.click();
      await advance('room');
      roomUrl = `${baseUrl}/r/${roomIdOf()}`;
    }
    await advance(opts.join === false ? 'join-form' : 'joined');
    if (opts.join !== false) await dismissInvite(opts.roomUrl ? 500 : 2500);
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }

  const player: Player = {
    name,
    sim,
    context,
    page,
    roomId: new URL(roomUrl).pathname.replace('/r/', ''),
    roomUrl,
    eventName: opts.eventName,
    stats,
    get id() {
      const w = welcomes.at(-1);
      if (!w) throw new Error(`${name} has not joined yet`);
      return w.you;
    },
    welcomes,
    received,
    sent,
    errors,
    consoleLog,
    tid,
    assertNoErrors() {
      assert.deepEqual(errors, [], `${name}: console/page errors`);
    },
    waitForMessage: async <T extends ServerMsg>(pred: (m: ServerMsg) => boolean, timeout = WAIT) =>
      eventually(() => {
        const hit = received.find(pred);
        assert.ok(hit, 'no matching message yet');
        return hit as T;
      }, { timeout, message: `${name}: websocket message` }),
    spoken: () => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken),
    setTranscript: (text) => page.evaluate((t) => void ((window as unknown as { __transcript: string }).__transcript = t), text),
    async reload() {
      const before = welcomes.length;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await advance('joined', before);
      await dismissInvite(500);
    },
    async joinNext(action) {
      const before = welcomes.length;
      await action();
      await advance('joined', before);
      await dismissInvite(500);
    },
    currentRoomId: roomIdOf,
    close: () => context.close().catch(() => {}),
  };
  return player;
}

// --- UI flows shared by the scenarios ------------------------------------------------------

/**
 * Number of people in the crew strip. Falls back to the original player list on builds
 * that do not have the crew strip yet, so the smoke scenarios also run against older UIs.
 */
export async function crewCount(p: Player): Promise<number> {
  if ((await p.tid('crew').count()) > 0) return p.tid('crew-avatar').count();
  return p.page.locator('ul.players > li.player').count();
}

export async function waitForCrew(p: Player, n: number, timeout = WAIT): Promise<void> {
  await eventually(async () => assert.equal(await crewCount(p), n), { timeout, message: `${p.name}: crew avatars` });
}

/** The ids shown in the crew strip. */
export async function crewIds(p: Player): Promise<string[]> {
  return p.tid('crew-avatar').evaluateAll((els) => els.map((e) => e.getAttribute('data-player-id') ?? ''));
}

/** Leave the room from the settings window. The first tap only arms the button ("Tap again to leave"), the second one leaves. */
export async function leaveRoom(p: Player): Promise<void> {
  await openSettings(p);
  const btn = (await p.tid('btn-leave').count()) > 0 ? p.tid('btn-leave') : p.page.locator('button', { hasText: 'Leave' }).first();
  await btn.click();
  await sleep(150);
  for (let i = 0; i < 2; i++) {
    if (!(await btn.isVisible())) return;
    const label = ((await btn.getAttribute('aria-label', { timeout: 1000 })) ?? '') + ((await btn.textContent({ timeout: 1000 })) ?? '');
    if (!/again|sure|confirm/i.test(label)) return;
    await btn.click();
    await sleep(150);
  }
}

/** Current state of a checkbox or aria-pressed / aria-checked toggle. */
export const toggleState = (loc: Locator): Promise<boolean> =>
  loc.evaluate((el) => {
    if (el instanceof HTMLInputElement) return el.checked;
    const v = el.getAttribute('aria-pressed') ?? el.getAttribute('aria-checked');
    return v === 'true';
  });

/** Set a checkbox or aria-pressed toggle to `on`. */
export async function setToggle(loc: Locator, on: boolean): Promise<void> {
  if ((await toggleState(loc)) !== on) await loc.click();
}

export async function openSheet(p: Player, button: string, sheet: string): Promise<void> {
  if (await p.tid(sheet).isVisible()) return;
  await p.tid(button).click();
  await p.tid(sheet).waitFor({ state: 'visible' });
}

export const openPlans = (p: Player) => openSheet(p, 'btn-plans', 'plans-panel');

/** Open the settings window from the gear in the top bar. */
export const openSettings = (p: Player) => openSheet(p, 'btn-settings', 'settings-sheet');

/** Close a sheet with its Close button (aria-label "Close"). */
export async function closeSheet(p: Player, sheet: string): Promise<void> {
  const root = p.tid(sheet);
  const scoped = root.locator('[aria-label="Close"]');
  const close = (await scoped.count()) > 0 ? scoped.first() : p.page.locator('[aria-label="Close"]').first();
  await close.click();
  await root.waitFor({ state: 'hidden' });
}

/** Remembered events on the landing page. */
export const eventCards = (p: Player) => p.tid('event-card');

export async function eventCardIds(p: Player): Promise<string[]> {
  return eventCards(p).evaluateAll((els) => els.map((e) => e.getAttribute('data-room-id') ?? ''));
}

/** True when this player's crew avatar is shown greyed out (offline). */
export async function avatarOffline(p: Player, playerId: string): Promise<boolean> {
  const avatar = p.page.locator(`[data-testid="crew-avatar"][data-player-id="${playerId}"]`);
  const flags = await avatar.evaluateAll((els) => els.map((e) => e.classList.contains('is-offline') || e.querySelector('.is-offline') !== null));
  return flags.length > 0 && flags[0];
}

/** True when this player's crew avatar carries a mood badge (a pin-mood element or the mood emoji). */
export async function avatarMood(p: Player, playerId: string, emoji: string): Promise<boolean> {
  const avatar = p.page.locator(`[data-testid="crew-avatar"][data-player-id="${playerId}"]`);
  const flags = await avatar.evaluateAll(
    (els, e) => els.map((el) => el.querySelector('[data-testid="pin-mood"]') !== null || (el.textContent ?? '').includes(e)),
    emoji,
  );
  return flags.length > 0 && flags[0];
}

export interface PlanInput {
  kind: PlanKind;
  place: string;
  note?: string;
  /** Default true, like the form. */
  ping?: boolean;
}

/** Drop a flag on my current position ("Use where I am"), fill in the plan form and create it. */
export async function createPlan(p: Player, plan: PlanInput): Promise<void> {
  await openPlans(p);
  await p.tid('btn-new-plan').click();
  const banner = p.tid('drop-banner');
  const form = p.tid('plan-form');
  await eventually(async () => assert.ok((await banner.isVisible()) || (await form.isVisible()), 'drop banner or plan form'), {
    message: `${p.name}: waiting for the flag-drop step`,
  });
  if (await banner.isVisible()) await p.tid('btn-drop-here').click();
  await form.waitFor({ state: 'visible' });
  await p.tid(`kind-${plan.kind}`).click();
  await p.tid('plan-place').fill(plan.place);
  if (plan.note !== undefined) await p.tid('plan-note').fill(plan.note);
  await setToggle(p.tid('plan-ping'), plan.ping ?? true);
  await p.tid('btn-plan-create').click();
  await form.waitFor({ state: 'hidden' });
}

/** Plan cards (opens the plans panel first), optionally only those mentioning `place`. */
export async function planCards(p: Player, place?: string): Promise<Locator> {
  await openPlans(p);
  const cards = p.tid('plan-card');
  return place ? cards.filter({ hasText: place }) : cards;
}

export function toast(p: Player, kind: 'ping' | 'bubble' | 'info'): Locator {
  return p.page.locator(`[data-testid="toast"][data-kind="${kind}"]`);
}

/** The number of trails drawn on the map (`.map[data-paths]`), or null when the attribute is absent. */
export async function mapPaths(p: Player): Promise<number | null> {
  const values = await p.page.locator('.map').evaluateAll((els) => els.map((e) => e.getAttribute('data-paths')));
  const v = values.find((x) => x !== null);
  return v === undefined ? null : Number(v);
}

export async function waitForPaths(p: Player, n: number): Promise<void> {
  await eventually(async () => assert.equal(await mapPaths(p), n), { message: `${p.name}: .map[data-paths]` });
}

export const pinFor = (p: Player, playerId: string) => p.page.locator(`.pin[data-player-id="${playerId}"]`);

// --- scenarios ----------------------------------------------------------------------------

export interface Scenario {
  readonly name: string;
  readonly baseUrl: string;
  readonly browser: Browser;
  readonly server: TestServer;
  readonly players: Player[];
  /** A new person in a new browser context. Pass `roomUrl` to join someone's room. */
  player(name: string, sim: Sim, opts?: PlayerOptions): Promise<Player>;
  /** A raw websocket client in a room (no browser). */
  raw(roomId: string): Promise<RawClient>;
  /** Create a room over the HTTP API. */
  createRoom(): Promise<string>;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export interface Harness {
  /** Register a test. Contexts are always closed, and screenshots are saved to e2e/artifacts/ on failure. */
  scenario(name: string, fn: (s: Scenario) => Promise<void>, o?: { timeout?: number }): void;
}

/** Call once per test file: starts the server and browser before the tests and stops both after, even on failure. */
export function setup(o: { persist?: boolean } = {}): Harness {
  let server: TestServer | undefined;
  let browser: Browser | undefined;
  before(async () => {
    server = await startServer(o);
    browser = await launchBrowser();
  });
  after(async () => {
    await browser?.close().catch(() => {});
    await server?.stop().catch(() => {});
  });

  return {
    scenario(name, fn, o = {}) {
      const limit = o.timeout ?? 60_000;
      test(name, { timeout: limit + 15_000 }, async () => {
        assert.ok(server && browser, 'server and browser must be running');
        const srv = server;
        const players: Player[] = [];
        const raws: RawClient[] = [];
        const s: Scenario = {
          name,
          baseUrl: srv.baseUrl,
          browser,
          server: srv,
          players,
          async player(pname, sim, popts) {
            const p = await newPlayer(browser!, srv.baseUrl, pname, sim, popts);
            players.push(p);
            return p;
          },
          async raw(roomId) {
            const c = await rawClient(srv.baseUrl, roomId);
            raws.push(c);
            return c;
          },
          async createRoom() {
            const res = await fetch(`${srv.baseUrl}/api/rooms`, { method: 'POST' });
            assert.equal(res.status, 201);
            return ((await res.json()) as { id: string }).id;
          },
        };
        const started = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            fn(s),
            new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`scenario timed out after ${limit} ms`)), limit))),
          ]);
        } catch (e) {
          await saveFailure(name, players, srv).catch((err) => log(`could not save artifacts: ${err}`));
          throw e;
        } finally {
          clearTimeout(timer);
          for (const r of raws) r.close();
          await Promise.all(players.map((p) => p.close()));
          log(`${name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
        }
      });
    },
  };
}

async function saveFailure(name: string, players: Player[], server: TestServer): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  const base = slug(name);
  for (const p of players) {
    const file = join(ARTIFACTS, `${base}__${slug(p.name)}`);
    await p.page.screenshot({ path: `${file}.png`, timeout: 5000 }).catch(() => {});
    const types = p.received.map((m) => m.t).join(' ');
    writeFileSync(
      `${file}.txt`,
      [`url: ${p.page.url()}`, `errors:\n${p.errors.join('\n')}`, `websocket received: ${types}`, `console:\n${p.consoleLog.slice(-80).join('\n')}`].join('\n\n'),
    );
  }
  writeFileSync(join(ARTIFACTS, `${base}__server.log`), server.log());
  log(`failure artifacts saved in ${ARTIFACTS} (${base}__*)`);
}
