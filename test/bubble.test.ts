import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../src/bubble.ts';
import { BUBBLE_MAX, MOODS, PLAN_KINDS } from '../shared/protocol.ts';

const place = (kind: string, p: string) => ({ kind, place: p });

test('the brief: each intent boils down to its emoji, text, mood and plan', () => {
  assert.deepEqual(summarize("let's go eat at joe's tacos"), {
    emoji: '🍔', text: "Eating at Joe's Tacos, join us!", plan: place('lunch', "Joe's Tacos"),
  });
  assert.deepEqual(summarize("i'm so hungry"), { emoji: '🍔', text: 'Getting hungry…', mood: 'hungry' });
  assert.deepEqual(summarize('everybody come over here'), { emoji: '📍', text: 'Everyone, over this way!' });
  assert.deepEqual(summarize('coffee at blue bottle anyone'), {
    emoji: '☕', text: 'Coffee at Blue Bottle?', plan: place('coffee', 'Blue Bottle'),
  });
  assert.deepEqual(summarize('i need a coffee'), { emoji: '☕', text: 'Need a coffee…', mood: 'coffee' });
  assert.deepEqual(summarize("i'm exhausted"), { emoji: '😴', text: 'Feeling tired…', mood: 'tired' });
  assert.deepEqual(summarize("wait up i'm coming"), { emoji: '✋', text: 'Hold up, wait for me!' });
  assert.deepEqual(summarize('heading out'), { emoji: '🚶', text: 'Heading out' });
  assert.deepEqual(summarize("where's the bathroom"), { emoji: '🚻', text: 'Bathroom break' });
  assert.deepEqual(summarize('drinks at the rooftop bar'), {
    emoji: '🍻', text: 'Drinks at The Rooftop Bar?', plan: place('drinks', 'The Rooftop Bar'),
  });
  assert.deepEqual(summarize("let's go to lunch"), { emoji: '🍔', text: "Let's grab food, come this way!" });
  assert.deepEqual(summarize('this is amazing'), { emoji: '💭', text: 'This is amazing' });
});

test('every intent has a fallback line when no place is named', () => {
  assert.equal(summarize('anyone want coffee').text, 'Coffee run, come along!');
  assert.equal(summarize('beer?').text, 'Drinks time! Come this way.');
  assert.equal(summarize('anyone else hungry').text, "Let's grab food, come this way!");
  assert.equal(summarize("let's sit down i'm tired").text, 'Taking a break here');
  assert.equal(summarize("let's sit down i'm tired").mood, 'tired');
  assert.equal(summarize('meet at the fountain').text, 'Meet at The Fountain');
  assert.equal(summarize('meet at the fountain').plan?.kind, 'meetup');
});

test('first matching intent wins', () => {
  assert.equal(summarize("i'm hungry, wait up").emoji, '🍔');
  assert.equal(summarize('hold on i am tired').emoji, '😴');
  assert.equal(summarize('coffee then drinks').emoji, '☕');
  assert.equal(summarize('beer at the bathroom').emoji, '🍻');
  assert.equal(summarize('leaving, meet you there').emoji, '📍');
});

test('feelings stay feelings unless somebody is inviting', () => {
  assert.deepEqual(summarize("i'm starving"), { emoji: '🍔', text: 'Getting hungry…', mood: 'hungry' });
  // Hungry plus an invitation and a place is a plan, not a mood.
  assert.deepEqual(summarize("i'm starving let's eat at joe's"), {
    emoji: '🍔', text: "Eating at Joe's, join us!", plan: place('lunch', "Joe's"),
  });
  assert.equal(summarize('need coffee').mood, 'coffee');
  assert.equal(summarize('need coffee anyone coming').mood, undefined);
  assert.equal(summarize('we need to rest').text, 'Taking a break here');
  assert.equal(summarize("i'm beat").mood, 'tired');
});

test('dinner makes a dinner plan', () => {
  const s = summarize('dinner at nobu everyone');
  assert.equal(s.text, 'Eating at Nobu, join us!');
  assert.deepEqual(s.plan, place('dinner', 'Nobu'));
  assert.equal(s.emoji, '🍔');
});

test('capitals and punctuation do not change the answer', () => {
  const plain = summarize("let's go eat at joe's tacos");
  assert.deepEqual(summarize("Let's go eat at Joe's Tacos, everyone!"), plain);
  assert.deepEqual(summarize("LET'S GO EAT AT JOE'S TACOS!!!"), plain);
  assert.deepEqual(summarize('  let\u2019s   go eat\nat joe\u2019s tacos.  '), plain);
  assert.deepEqual(summarize("Let's go eat at Joe's Tacos right now, please."), plain);
  assert.equal(summarize('I NEED A COFFEE').mood, 'coffee');
});

test('typed capitals inside a name survive; speech lowercase is Title Cased', () => {
  assert.equal(summarize("meet me at McDonald's").text, "Meet at McDonald's");
  assert.equal(summarize("meet me at mcdonald's").text, "Meet at Mcdonald's");
  assert.equal(summarize('lunch at in-n-out').plan?.place, 'In-N-Out');
  assert.equal(summarize('coffee at the café').plan?.place, 'The Café');
});

test('accented words match as whole words', () => {
  assert.equal(summarize('café?').emoji, '☕');
  assert.equal(summarize('what a great barn').emoji, '💭'); // "eat" and "bar" inside other words do not count
});

test('"at" twice: the real place beats "at work", "at home" and "at 5"', () => {
  assert.equal(summarize("i'm at work lets eat at joe's tacos").plan?.place, "Joe's Tacos");
  assert.equal(summarize("i'm at work, let's eat at joe's tacos").plan?.place, "Joe's Tacos");
  assert.equal(summarize("let's go to lunch at joe's tacos").plan?.place, "Joe's Tacos");
  assert.equal(summarize('meet at the fountain at 5pm').plan?.place, 'The Fountain');
  assert.equal(summarize('meet at 5pm at the fountain').plan?.place, 'The Fountain');
  assert.equal(summarize('by the way lets eat at joe').plan?.place, 'Joe');
  assert.equal(summarize("eat at joe's tacos by the beach").plan?.place, "Joe's Tacos");
  assert.equal(summarize('lunch over at sweetgreen').plan?.place, 'Sweetgreen');
});

test('filler after "at", "to" or "by" is not a place', () => {
  for (const t of ["let's go to lunch", 'lets get coffee at home', 'coffee to go', "i'm at work, hungry for lunch", 'meet at the', 'eat at now']) {
    const s = summarize(t);
    assert.equal(s.plan, undefined, t);
  }
  assert.equal(summarize('anyone want to get tacos').plan, undefined); // "to get tacos" is an errand
  assert.equal(summarize('i want to eat tacos at joes').plan?.place, 'Joes');
  assert.equal(summarize('meet at 5pm').text, 'Everyone, over this way!');
  assert.equal(summarize('lunch at 12:30').plan, undefined);
});

test('places stop at stop words and punctuation', () => {
  assert.equal(summarize('lunch at sweetgreen and then the park').plan?.place, 'Sweetgreen');
  assert.equal(summarize('lunch at sweetgreen, anyone?').plan?.place, 'Sweetgreen');
  assert.equal(summarize('eat at joes right now please').plan?.place, 'Joes');
  assert.equal(summarize('lunch at joes because its cheap').plan?.place, 'Joes');
  assert.equal(summarize('eat at joes guys').plan?.place, 'Joes');
  assert.equal(summarize('coffee at "blue bottle" please').plan?.place, 'Blue Bottle');
  assert.equal(summarize('lunch at st. marks place').plan?.place, 'St Marks Place');
});

test('very long place names are cut at a word boundary, at most 30 characters', () => {
  const s = summarize("let's eat at the extraordinarily long named restaurant of the century");
  assert.equal(s.plan?.place, 'The Extraordinarily Long Named');
  assert.ok(s.text.length <= BUBBLE_MAX);
  assert.equal(summarize('meet at ' + 'a'.repeat(50)).plan, undefined); // one word, nowhere to cut
  assert.equal(summarize('meet at ' + 'a'.repeat(50)).text, 'Everyone, over this way!');
});

test('unicode apostrophes, emoji and odd whitespace are handled', () => {
  const s = summarize('let\u2019s eat \u{1F355} at joe\u2019s tacos \u{1F32E}\u{1F44D}\u{1F3FD}');
  assert.deepEqual(s, summarize("let's eat at joe's tacos"));
  assert.equal(s.plan?.place, "Joe's Tacos");
  assert.deepEqual(summarize('\u{1F355}\u{1F355}\u{1F355}'), { emoji: '💭', text: '' });
  assert.equal(summarize('this is \u{1F44D} amazing').text, 'This is amazing');
  assert.equal(summarize('\u{1F1FA}\u{1F1F8} flags and \u200Dzwj\uFE0F').emoji, '💭');
});

test('silence and punctuation give an empty bubble the caller must not send', () => {
  for (const t of ['', '   ', '\n\t', '...', '?!', ' , ; ', '\u200B']) {
    const s = summarize(t);
    assert.equal(s.emoji, '💭', JSON.stringify(t));
    if (t !== '\u200B') assert.equal(s.text, '', JSON.stringify(t));
  }
  assert.deepEqual(summarize(''), { emoji: '💭', text: '' });
});

test('stop words alone and nonsense fall back to an echo, never a plan or mood', () => {
  for (const t of ['and', 'and but so', 'right now please', 'asdf qwer zxcv', 'at', 'to by at', 'zzz']) {
    const s = summarize(t);
    assert.equal(s.emoji, '💭', t);
    assert.equal(s.plan, undefined, t);
    assert.equal(s.mood, undefined, t);
    assert.ok(s.text.length > 0, t);
  }
  assert.equal(summarize('asdf qwer zxcv').text, 'Asdf qwer zxcv');
});

test('fallback keeps six words, trims trailing punctuation, and says so with an ellipsis', () => {
  assert.equal(summarize('this is amazing!!!').text, 'This is amazing');
  assert.equal(summarize('one two three four five six').text, 'One two three four five six');
  assert.equal(summarize('one two three four five six seven').text, 'One two three four five six…');
  assert.equal(summarize('wow this is really really amazing, truly').text, 'Wow this is really really amazing…');
  assert.equal(summarize('...hello there.').text, 'Hello there');
  assert.equal(summarize('"quoted"').text, 'Quoted');
});

test('long fallbacks are cut at a word boundary and stay within the limit', () => {
  const s = summarize('internationalization misunderstanding incomprehensibilities unquestionably characteristically bureaucratically');
  assert.equal(s.text, 'Internationalization misunderstanding incomprehensibilities…');
  assert.equal(s.text.length, BUBBLE_MAX);
  const exact = 'a'.repeat(30) + ' ' + 'b'.repeat(29); // 60 characters
  assert.equal(summarize(exact).text, 'A' + 'a'.repeat(29) + ' ' + 'b'.repeat(29));
  const over = 'a'.repeat(30) + ' ' + 'b'.repeat(30); // 61 characters
  assert.equal(summarize(over).text, 'A' + 'a'.repeat(29) + '…');
  // A single "word" longer than the limit has no boundary to cut at, so there is nothing to say.
  assert.deepEqual(summarize('x'.repeat(200)), { emoji: '💭', text: '' });
  assert.deepEqual(summarize('https://example.com/' + 'path/'.repeat(30)), { emoji: '💭', text: '' });
});

test('same words in, same bubble out', () => {
  for (const t of ["let's go eat at joe's tacos", 'whatever', '', 'drinks?']) {
    assert.deepEqual(summarize(t), summarize(t));
  }
});

test('summarize never throws and always respects the contract, whatever it is fed', () => {
  const bits = [
    'lunch', 'dinner', 'coffee', 'drinks', 'at', 'to', 'by', 'over at', 'the', 'a', 'and', 'so', 'now', 'right now', 'please',
    'everyone', 'joe\u2019s', "joe's tacos", 'Blue Bottle', 'CAFÉ', 'café', 'meet', 'wait', 'tired', 'hungry', 'need coffee',
    "let's", 'bathroom', 'heading out', '🍕', '👍🏽', '🇺🇸', '\u200D', '\uFE0F', '\uD83D', '\uDE00', '\u0000', '\u0301', '...', ',', '!', '?',
    '"', '(', ')', '-', '&', '12:30', '5pm', 'x'.repeat(70), 'ß', 'İ', '漢字', 'عربى', '\n', '\t', '  ',
  ];
  // A tiny seeded generator keeps failures reproducible.
  let seed = 20261017;
  const rnd = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  const inputs = [...bits, bits.join(' '), bits.join(''), 'x'.repeat(10_000), ' '.repeat(10_000), 'at '.repeat(5_000)];
  for (let i = 0; i < 1500; i++) inputs.push(Array.from({ length: 1 + rnd(12) }, () => bits[rnd(bits.length)]).join(rnd(3) === 0 ? '' : ' '));
  for (const input of inputs) {
    const s = summarize(input);
    const label = JSON.stringify(input.slice(0, 80));
    assert.equal(typeof s.emoji, 'string', label);
    assert.ok(s.emoji.length > 0, label);
    assert.ok(s.text.length <= BUBBLE_MAX, label);
    assert.equal(s.text, s.text.trim(), label);
    assert.ok(!/[\uD800-\uDBFF]$/.test(s.text) && !/^[\uDC00-\uDFFF]/.test(s.text), label);
    if (s.mood) assert.ok((MOODS as readonly string[]).includes(s.mood), label);
    if (s.plan) {
      assert.ok((PLAN_KINDS as readonly string[]).includes(s.plan.kind), label);
      assert.ok(s.plan.place.length > 0 && s.plan.place.length <= 30, label);
      assert.ok(s.text.includes(s.plan.place), label);
    }
  }
  for (const bad of [undefined, null, 42, {}] as unknown as string[]) assert.doesNotThrow(() => summarize(bad));
});

test('a feeling they said they do NOT have never becomes a mood or a bubble about it', () => {
  for (const said of ["i'm not hungry", 'not tired at all', "i'm never hungry", "I'm not even that tired", "isn't sleepy"]) {
    const s = summarize(said);
    assert.equal(s.mood, undefined, said);
    assert.equal(s.emoji, '💭', said);
  }
  const mixed = summarize("i'm not tired let's eat at joe's tacos");
  assert.equal(mixed.plan?.place, "Joe's Tacos");
  assert.equal(mixed.mood, undefined);
});

test('chit-chat that contains a keyword in another sense does not trigger it', () => {
  assert.equal(summarize("can't wait to see you").emoji, '💭');
  assert.equal(summarize('i beat the traffic').emoji, '💭');
  assert.equal(summarize('wait up i am coming').emoji, '✋');
  assert.equal(summarize('wait for me please').emoji, '✋');
});

test('abbreviations and bidi tricks are handled', () => {
  assert.equal(summarize('meet me at St. Marks Place').plan?.place, 'St Marks Place');
  assert.equal(summarize('coffee at 5th Ave. cafe').plan?.place, '5th Ave Cafe');
  const spoof = summarize('lunch at \u202Eevil\u202C tacos');
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(spoof.text + (spoof.plan?.place ?? '')), 'no bidi overrides survive');
});
