// Saving events to a file so a restart or a redeploy does not end them. Off unless the host sets GMS_DATA_DIR.
// The file holds names, moods, contact lines, flags and the resume tokens, but never anyone's location.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoomRegistry } from './rooms.ts';

export const SNAPSHOT_FILE = 'groupz-events.json';

export class Persister {
  readonly file: string;
  private readonly registry: RoomRegistry;
  private readonly maxAgeMs: number;
  /** What the file holds (rooms only). An empty registry counts as already saved. */
  private lastBody = '[]';
  private lastError = '';
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(registry: RoomRegistry, dir: string, maxAgeMs = registry.opts.idleMs) {
    this.registry = registry;
    this.file = join(dir, SNAPSHOT_FILE);
    this.maxAgeMs = maxAgeMs;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** Bring the saved events back. A missing, stale or damaged file just means starting empty. Returns how many events came back. */
  load(): number {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return 0; // nothing saved yet
    }
    try {
      const raw: unknown = JSON.parse(text);
      const savedAt = typeof raw === 'object' && raw !== null ? Number((raw as { savedAt?: unknown }).savedAt) : NaN;
      if (!Number.isFinite(savedAt) || this.registry.opts.now() - savedAt > this.maxAgeMs) {
        this.lastBody = ''; // events this old have expired anyway: let the next save replace the file
        return 0;
      }
      const n = this.registry.restore(raw);
      this.lastBody = JSON.stringify(this.registry.toSnapshot().rooms);
      return n;
    } catch (err) {
      console.error('saved events could not be read, starting empty:', (err as Error).message);
      try {
        renameSync(this.file, `${this.file}.bad`);
      } catch {
        /* nothing more to do */
      }
      return 0;
    }
  }

  /** Write the current events if anything changed since the last write. Never throws. */
  save(): boolean {
    try {
      const snap = this.registry.toSnapshot();
      const body = JSON.stringify(snap.rooms);
      if (body === this.lastBody) return false;
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(snap), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.file); // all or nothing: a crash mid-write never leaves half a file
      this.lastBody = body;
      this.lastError = '';
      return true;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== this.lastError) console.error('could not save events:', msg);
      this.lastError = msg;
      return false;
    }
  }

  /** Save every few seconds, so a hard kill loses almost nothing. */
  start(everyMs = 3_000) {
    this.timer = setInterval(() => this.save(), everyMs);
    this.timer.unref();
  }

  /** Stop the timer and save one last time. */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.save();
  }
}
