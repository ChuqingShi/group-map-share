// Hardening for running on the public internet. Rooms are already protected by a 128-bit link,
// so what is left to defend is: who may start events, connection and message floods, and other
// websites trying to talk to a room. Everything is in memory, nothing is stored.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The caller's address. A reverse proxy reports the real one in X-Forwarded-For, and each proxy
 * APPENDS what it saw, so the entries on the left are whatever the client chose to send. We only
 * believe the header when we know a proxy sits in front (Render) or when the hop is loopback (a local
 * proxy such as Tailscale Funnel), and then we take the entry the last trusted proxy wrote:
 * `hops` from the right (1 for one proxy; raise GMS_TRUSTED_HOPS if there are more in front).
 */
export function callerIp(req: IncomingMessage, trustForwarded: boolean, hops = 1): string {
  const remote = req.socket.remoteAddress ?? '?';
  if (!trustForwarded && !LOOPBACK.has(remote)) return remote;
  const fwd = req.headers['x-forwarded-for'];
  const parts = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')).split(',').map((p) => p.trim()).filter(Boolean);
  return parts[Math.max(0, parts.length - hops)] ?? remote;
}

/** Host key check for starting events. With no key configured (local development) everyone may. */
export function hostKeyOk(required: string | undefined, given: unknown): boolean {
  if (!required) return true;
  const a = Buffer.from(required);
  const b = Buffer.from(typeof given === 'string' ? given : '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** host:port with default ports dropped, lower case: "X.ts.net:443" and "x.ts.net" are the same site. */
const siteOf = (h: string) => h.toLowerCase().replace(/:(443|80)$/, '');

/**
 * A WebSocket opened by a page on another site (or another port of this host) is refused. Non-browser
 * clients send no Origin and are not affected. `extraAllowed` takes hosts or full URLs.
 */
export function originOk(req: IncomingMessage, extraAllowed: readonly string[] = []): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let site: string;
  try {
    site = siteOf(new URL(origin).host);
  } catch {
    return false;
  }
  const fwdHost = req.headers['x-forwarded-host'];
  const extra = extraAllowed.map((e) => {
    try {
      return new URL(e).host;
    } catch {
      return e;
    }
  });
  return [req.headers.host, Array.isArray(fwdHost) ? fwdHost[0] : fwdHost, ...extra]
    .filter((h): h is string => typeof h === 'string')
    .some((h) => siteOf(h) === site);
}

/** Caps simultaneous sockets per address. */
export class ConnectionLimiter {
  private readonly counts = new Map<string, number>();
  private readonly max: number;
  constructor(max: number) {
    this.max = max;
  }
  acquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }
  release(ip: string) {
    const n = (this.counts.get(ip) ?? 1) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

/** At most `max` events per key within `windowMs` (for example new identities per address per room). */
export class RateWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly max: number;
  constructor(windowMs: number, max: number) {
    this.windowMs = windowMs;
    this.max = max;
  }
  allow(key: string, now = Date.now()): boolean {
    if (this.hits.size > 5_000) this.hits.clear(); // bounded memory under a flood of fake keys
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** Token bucket for one socket's messages: bursts are fine, a sustained flood is not. */
export class MessageBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perSecond: number;
  constructor(capacity = 40, perSecond = 20, now = Date.now()) {
    this.capacity = capacity;
    this.perSecond = perSecond;
    this.tokens = capacity;
    this.last = now;
  }
  allow(now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'permissions-policy': 'geolocation=(self), microphone=(self), camera=(), payment=()',
};
