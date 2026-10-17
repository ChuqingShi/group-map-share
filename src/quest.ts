// The "test mission": a short checklist shown once per new build so a tester knows what to try.
// Steps tick themselves off when the app sees them happen. Lives in localStorage, nothing is sent anywhere.

export const STEP_IDS = ['mood', 'talk', 'flag', 'imin', 'reopen', 'leave'] as const;
export type StepId = (typeof STEP_IDS)[number];

export interface QuestStep {
  id: StepId;
  icon: string;
  title: string;
  hint: string;
}

export const STEPS: readonly QuestStep[] = [
  { id: 'mood', icon: '😋', title: 'Set your mood', hint: 'Mood in the toolbar, then tap one. Your crew sees a badge on your pic.' },
  { id: 'talk', icon: '🎙', title: 'Say something', hint: 'Talk in the toolbar. Speak or type "let\'s go eat at Joe\'s Tacos", then Send.' },
  { id: 'flag', icon: '🚩', title: 'Plant a flag and ping the crew', hint: 'Drag the flag onto the map (or Flags, then Plant a flag) and tap Plant. If the event has an organizer, only organizers can.' },
  { id: 'imin', icon: '🔔', title: 'Say "I\'m in" to a friend\'s flag', hint: 'Needs a second phone: a friend scans your QR and plants a flag. Tap I\'m in on their toast and watch your treasure trail appear.' },
  { id: 'reopen', icon: '🔁', title: 'Close the app, then reopen it', hint: 'You should land right back in the same event, no form.' },
  { id: 'leave', icon: '🚪', title: 'Leave the event', hint: 'Leave in the toolbar, tapped twice. You vanish for everyone, and the event leaves your list.' },
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
  return `Group Map Share test mission, build ${q.build}\n\n${lines.join('\n')}\n\nWhat felt great, what felt off:\n`;
}
