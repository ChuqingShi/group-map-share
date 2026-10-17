// Hardening for running on the public internet. Rooms are already protected by a 128-bit link,
// so what is left to defend is: who may start events, connection and message floods, and other
// websites trying to talk to a room. Everything is in memory, nothing is stored.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The caller's address. A reverse proxy reports the real one in X-Forwarded-For. We only believe
 * that header when we know a proxy sits in front (Render) or when the hop is loopback, i.e. a local
 * proxy such as Tailscale Funnel, where no remote client can have forged it.
 */
export function callerIp(req: IncomingMessage, trustForwarded: boolean): string {
  const remote = req.socket.remoteAddress ?? '?';
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first && (trustForwarded || LOOPBACK.has(remote)) ? first : remote;
}

/** Host key check for starting events. With no key configured (local development) everyone may. */
export function hostKeyOk(required: string | undefined, given: unknown): boolean {
  if (!required) return true;
  const a = Buffer.from(required);
  const b = Buffer.from(typeof given === 'string' ? given : '');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A WebSocket opened by a page on another website is refused. Non-browser clients send no Origin and are not affected. */
export function originOk(req: IncomingMessage, extraAllowed: readonly string[] = []): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const fwdHost = req.headers['x-forwarded-host'];
  const mine = [req.headers.host, Array.isArray(fwdHost) ? fwdHost[0] : fwdHost, ...extraAllowed]
    .filter((h): h is string => typeof h === 'string')
    .map((h) => h.toLowerCase());
  const bare = (h: string) => h.replace(/:\d+$/, '');
  return mine.some((h) => h === host || bare(h) === bare(host));
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
