// Server settings from the environment.
//
// On Render (which sets RENDER=true) we must listen on its PORT. Anywhere else
// PORT is ignored: dev machines often use it for something unrelated (this
// project's own cloud workspace does), so locally use GMS_PORT instead.
import type { IncomingMessage } from 'node:http';

export interface ServerConfig {
  port: number;
  host: string;
  serveStatic: boolean;
  /** Behind a TLS-terminating proxy, so X-Forwarded-For holds the real client IP. */
  behindProxy: boolean;
}

export function serverConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const onRender = !!env.RENDER;
  return {
    port: Number((onRender && env.PORT) || env.GMS_PORT || 8787),
    host: env.GMS_HOST ?? '0.0.0.0',
    serveStatic: env.NODE_ENV === 'production',
    behindProxy: onRender,
  };
}

export function clientIp(req: IncomingMessage, behindProxy: boolean): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  // Only trust the header when a proxy we know about sets it; otherwise it's spoofable.
  return (behindProxy && first) || req.socket.remoteAddress || '?';
}
