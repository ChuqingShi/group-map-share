// The "test mission": a short checklist shown once per new build so a tester knows what to try.
// Steps tick themselves off when the app sees them happen. Lives in localStorage, nothing is sent anywhere.

export const STEP_IDS = ['setup', 'profile', 'invite', 'talk', 'flag', 'imin', 'leave'] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface QuestStep {
  id: StepId;
  icon: string;
  title: string;
  hint: string;
}

export const STEPS: readonly QuestStep[] = [
  { id: 'setup', icon: '🎮', title: 'Set up', hint: 'Create a room, pick your name and avatar, and allow location access when the browser asks.' },
  { id: 'profile', icon: '⭐', title: 'Change your name and become an organizer', hint: 'Tap your own picture to change your name, then in Settings ⚙️ switch on I\'m an organizer.' },
  { id: 'invite', icon: '📲', title: 'Invite a friend', hint: 'Tap Invite and have a friend scan the QR code. They show up on your map.' },
  { id: 'talk', icon: '🎙', title: 'Tell the crew how you feel', hint: 'Tap Talk and say or type "I\'m starving, let\'s get tacos", then Send. Your mood changes and a bubble pops up.' },
  { id: 'flag', icon: '🚩', title: 'Drag a flag and ping the crew', hint: 'Press and hold Flags, slide onto the map, let go, then tap Plant. Your friend gets pinged.' },
  { id: 'imin', icon: '🔔', title: 'Get your friend to say "I\'m in"', hint: 'Your friend taps I\'m in on your flag\'s ping (or in their Flags list). A dotted trail leads them to it.' },
  { id: 'leave', icon: '🚪', title: 'Leave the event', hint: 'Settings ⚙️, then Leave this event, tapped twice. You vanish for everyone and the event leaves your list.' },
];

export interface QuestState {
  build: string;
  started: boolean;
  done: StepId[];
}

export type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'gms-quest';

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isStep = (v: unknown): v is StepId => (STEP_IDS as readonly unknown[]).includes(v);

export function loadQuest(s: Store | null = defaultStore()): QuestState | null {
  try {
    const q = JSON.parse(s?.getItem(KEY) ?? 'null') as Partial<QuestState> | null;
    if (!q || typeof q.build !== 'string') return null;
    return { build: q.build, started: q.started === true, done: Array.isArray(q.done) ? [...new Set(q.done.filter(isStep))] : [] };
  } catch {
    return null;
  }
}

export function saveQuest(q: QuestState, s: Store | null = defaultStore()) {
  try {
    s?.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage blocked: the mission just will not be remembered */
  }
}

/** Show the intro once per build. `?quest` forces it, `?noquest` hides it, and automated browsers never see it. */
export function shouldShowIntro(
  saved: QuestState | null,
  build: string,
  opts: { forced: boolean; suppressed: boolean; automated: boolean },
): boolean {
  if (opts.suppressed) return false;
  if (opts.forced) return true;
  if (opts.automated) return false;
  return saved?.build !== build;
}

export function markDone(q: QuestState, id: StepId): QuestState {
  return q.done.includes(id) ? q : { ...q, done: [...q.done, id] };
}

export function progress(q: QuestState | null) {
  const done = q ? q.done.length : 0;
  return { done, total: STEP_IDS.length, complete: done === STEP_IDS.length };
}

/** Plain-text results for the "send my results" email. */
export function resultsText(q: QuestState): string {
  const lines = STEPS.map((s) => `${q.done.includes(s.id) ? '[x]' : '[ ]'} ${s.title}`);
  return `Groupz test mission, build ${q.build}\n\n${lines.join('\n')}\n\nWhat felt great, what felt off:\n`;
}
