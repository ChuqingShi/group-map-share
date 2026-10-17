// Boils what somebody said into a short, passive thought bubble ("Eating at Joe's Tacos, join us!").
// Plain rules on the device: no network, no AI service, and the same words always give the same
// bubble. Only the gist survives; the one place their own words come back is the last-resort
// fallback, which echoes the first few so the bubble still says something.
import { BUBBLE_MAX, MOOD_EMOJI, MOOD_LABEL, type MoodId, type PlanKind } from '../shared/protocol.ts';

export interface Summary {
  emoji: string;
  /** At most BUBBLE_MAX characters, never cut mid-word. Empty means there was nothing to say: do not send it. */
  text: string;
  /** Set when the person is describing how they feel ("i'm starving"). */
  mood?: MoodId;
  /** Set when a place name was found and the intent maps to a plan kind. */
  plan?: { kind: PlanKind; place: string };
  /** How they seem to feel, judged from their words, so their mood and emoji follow what they say. Not set for the echo fallback. */
  feeling?: Feeling;
}

export interface Feeling {
  mood: MoodId | 'custom';
  emoji: string;
  text: string;
}

const preset = (id: MoodId): Feeling => ({ mood: id, emoji: MOOD_EMOJI[id], text: MOOD_LABEL[id] });
/** Which feeling goes with each bubble. Wanting food or coffee is being hungry or needing coffee; the rest are custom moods. */
const FEELING_OF: Record<string, Feeling | undefined> = {
  '🍔': preset('hungry'),
  '☕': preset('coffee'),
  '😴': preset('tired'),
  '🍻': { mood: 'custom', emoji: '🍻', text: 'Up for drinks' },
  '✋': { mood: 'custom', emoji: '✋', text: 'Hold on' },
  '📍': { mood: 'custom', emoji: '📍', text: 'Gathering' },
  '🚶': { mood: 'custom', emoji: '🚶', text: 'Heading out' },
  '🚻': { mood: 'custom', emoji: '🚻', text: 'Back soon' },
};

const ELLIPSIS = '…';
const THOUGHT = '💭';
const PLACE_CHARS = 30;
const INPUT_CHARS = 500;
const LETTERS = '\\p{L}\\p{N}';

// JS \b only knows ASCII, so "café" would never match. This is a whole-word match for any of `alts`
// (group 1 is the word). It avoids lookbehind on purpose: older iPhones would fail to load the app.
const word = (alts: string, flags = 'iu') => new RegExp(`(?:^|[^${LETTERS}])(${alts})(?![${LETTERS}])`, flags);

const HUNGRY = word('hungry|starving|famished');
const DINNER = word('dinner');
/** Words that turn a feeling into an invitation. */
const INVITE = word("let's|lets|we're|were going|come|join|everyone|everybody|meet|anyone");
const NEED_COFFEE = word('need (?:a |some )?coffee');
const TOGETHER = word("let's|lets|we|sit|rest together");

// --- cleaning ----------------------------------------------------------------------------------

function clean(raw: string): string {
  let s = raw
    .slice(0, INPUT_CHARS)
    .replace(/[\uD800-\uDFFF]/gu, ' ') // lone surrogates (in unicode mode this only matches unpaired ones)
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201B\u02BC`\u00B4]/g, "'") // curly apostrophes from phone keyboards
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF\uFE0F]/g, '') // zero-width, joiner and bidi control characters
    .replace(/\b(st|ave|dr|blvd|rd|mt|ft)\.(?=\s)/giu, '$1') // "St. Marks" is one name, not a sentence ending
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu, ' ') // emoji say nothing here
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // ALL CAPS (caps lock, or shouting) reads badly in a bubble, so flatten it.
  if (/\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s)) s = s.toLowerCase();
  return s;
}

/** "not hungry", "never tired", "isn't sleepy": a feeling the person said they do NOT have. */
const NEGATED_FEELING = /(?:\bnot\b|\bnever\b|n't\b|\bno\b)\s+(?:\p{L}+\s+){0,2}(?:hungry|starving|famished|tired|exhausted|sleepy)/giu;

const trimTail = (s: string) => s.replace(/[\s.,;:!?…"'“”()\-–—]+$/u, '');

/** Cut to BUBBLE_MAX at a word boundary, adding "…" only if something was dropped. '' if one word is too long. */
function fit(text: string): string {
  if (text.length <= BUBBLE_MAX) return text;
  const body = text.endsWith(ELLIPSIS) ? text.slice(0, -1) : text;
  const room = BUBBLE_MAX - ELLIPSIS.length;
  const end = body[room] === ' ' ? room : body.lastIndexOf(' ', room);
  const head = end > 0 ? trimTail(body.slice(0, end)) : '';
  return head ? head + ELLIPSIS : '';
}

// --- places ------------------------------------------------------------------------------------

const FILLER = new Set(
  ('lunch dinner breakfast brunch coffee drinks drink eat food the a an us me you it there here home work bed go get grab ' +
    'them this that something somewhere').split(' '),
);
/** "to eat tacos" is an errand, not a place: skip the phrase when "to" is followed by one of these. */
const ERRAND_VERBS = new Set(
  'eat get grab go try have see meet take find order sit rest hang leave head come join do make check pick buy stop walk catch drink share start be'.split(
    ' ',
  ),
);
/** Times and chit-chat that follow "at" and "by" but are not somewhere you can walk to. */
const NOT_A_PLACE = /^(?:\d[\d:.]*(?:\s*(?:am|pm|o'?clock))?|noon|midnight|tonight|tomorrow|today|the way|the moment)$/iu;

const PREP = word('over at|at|to|by', 'giu');
// A phrase ends at punctuation, a stop word, or the next preposition ("lunch at joe's by the beach").
const CUT = new RegExp(
  `[,;:!?()"“”…]|\\.(?:\\s|$)|(?:^|[^${LETTERS}])(?:and|but|for|right now|now|please|everyone|everybody|guys|anyone|because|so|over at|at|to|by)(?![${LETTERS}])`,
  'iu',
);

const title = (s: string) => s.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const end = s.lastIndexOf(' ', max);
  return end > 0 ? s.slice(0, end) : '';
}

function asPlace(prep: string, rest: string): string | undefined {
  const start = rest.replace(/^[\s"“”'(]+/, '');
  const end = start.search(CUT);
  const phrase = (end < 0 ? start : start.slice(0, end)).replace(/[\s'&.\-–—]+$/u, '');
  const ws = phrase.split(' ').map((w) => w.toLowerCase().replace(/^'+|'+$/g, ''));
  if (!phrase || ws.every((w) => FILLER.has(w))) return undefined;
  if (prep === 'to' && ERRAND_VERBS.has(ws[0])) return undefined;
  if (NOT_A_PLACE.test(phrase)) return undefined;
  return clip(title(phrase), PLACE_CHARS) || undefined;
}

/**
 * The place after "at", "over at", "to" or "by", Title Cased and at most 30 characters.
 * "at" beats "to"/"by", and later beats earlier, so "i'm at work lets eat at joe's tacos" finds Joe's Tacos.
 */
function findPlace(text: string): string | undefined {
  const found = [...text.matchAll(PREP)].map((m) => ({
    prep: m[1].toLowerCase(),
    rest: text.slice(m.index + m[0].length),
  }));
  for (const wanted of [['at', 'over at'], ['to', 'by']]) {
    for (const c of found.filter((f) => wanted.includes(f.prep)).reverse()) {
      const place = asPlace(c.prep, c.rest);
      if (place) return place;
    }
  }
  return undefined;
}

// --- intents -----------------------------------------------------------------------------------

function food(text: string): Summary {
  const emoji = '🍔';
  if (HUNGRY.test(text) && !INVITE.test(text)) return { emoji, text: 'Getting hungry…', mood: 'hungry' };
  const place = findPlace(text);
  if (!place) return { emoji, text: "Let's grab food, come this way!" };
  return { emoji, text: `Eating at ${place}, join us!`, plan: { kind: DINNER.test(text) ? 'dinner' : 'lunch', place } };
}

function coffee(text: string): Summary {
  const emoji = '☕';
  if (NEED_COFFEE.test(text) && !INVITE.test(text)) return { emoji, text: 'Need a coffee…', mood: 'coffee' };
  const place = findPlace(text);
  if (!place) return { emoji, text: 'Coffee run, come along!' };
  return { emoji, text: `Coffee at ${place}?`, plan: { kind: 'coffee', place } };
}

function drinks(text: string): Summary {
  const emoji = '🍻';
  const place = findPlace(text);
  if (!place) return { emoji, text: 'Drinks time! Come this way.' };
  return { emoji, text: `Drinks at ${place}?`, plan: { kind: 'drinks', place } };
}

const tired = (text: string): Summary => ({
  emoji: '😴',
  text: TOGETHER.test(text) ? 'Taking a break here' : 'Feeling tired…',
  mood: 'tired',
});

function regroup(text: string): Summary {
  const emoji = '📍';
  const place = findPlace(text);
  if (!place) return { emoji, text: 'Everyone, over this way!' };
  return { emoji, text: `Meet at ${place}`, plan: { kind: 'meetup', place } };
}

/** Nothing matched: echo the first six words so the bubble still says something. */
function echo(text: string): Summary {
  const words = text.replace(/^[\s.,;:!?…"'“”()\-–—]+/u, '').split(' ');
  const head = trimTail(words.slice(0, 6).join(' '));
  if (!head) return { emoji: THOUGHT, text: '' };
  return { emoji: THOUGHT, text: head[0].toUpperCase() + head.slice(1) + (words.length > 6 ? ELLIPSIS : '') };
}

// First match wins.
const RULES: [RegExp, (text: string) => Summary][] = [
  [word('lunch|dinner|breakfast|brunch|eat|eating|food|hungry|starving|famished|snack|pizza|burger|tacos?|sushi|restaurant|feed'), food],
  [word('coffee|latte|espresso|cafe|café'), coffee],
  [word('drinks?|beer|cocktails?|bar|wine|happy hour|pub'), drinks],
  [word("tired|exhausted|sleepy|need a break|need to rest|worn out|i'm beat|im beat|i am beat|so beat|dead beat"), tired],
  [word('wait up|wait for (?:me|us)|wait a (?:sec|second|minute|moment)|slow down|hold on|hang on|catch up'), () => ({ emoji: '✋', text: 'Hold up, wait for me!' })],
  [word('meet|regroup|gather|over here|come here|come over|this way|follow me|where are you|come to me'), regroup],
  [word('leaving|heading out|going home|head home|taking off|on my way'), () => ({ emoji: '🚶', text: 'Heading out' })],
  [word('bathroom|restroom|toilet'), () => ({ emoji: '🚻', text: 'Bathroom break' })],
];

/** Never throws. An empty `text` (silence, only emoji or punctuation) means the caller must not send it. */
export function summarize(transcript: string): Summary {
  const text = clean(String(transcript ?? ''));
  if (!text) return { emoji: THOUGHT, text: '' };
  // A feeling they said they do NOT have must not become a mood: match on the text without it.
  const probe = text.replace(NEGATED_FEELING, ' ').replace(/\s+/g, ' ').trim();
  const rule = RULES.find(([re]) => re.test(probe));
  const s = rule ? rule[1](probe) : echo(text);
  const out: Summary = { ...s, text: fit(s.text) };
  const feeling = s.mood ? preset(s.mood) : FEELING_OF[s.emoji];
  if (feeling && out.text) out.feeling = feeling;
  return out;
}
