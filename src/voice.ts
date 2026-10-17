// Spoken announcements via the browser's built-in speech synthesis. No network, nothing stored.
// Browsers only let a page speak after the user has tapped something, so call unlockVoice()
// from a tap handler (joining the room is the natural place).
import { store } from './safeStorage.ts';

const KEY = 'gms-voice';

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Off by default: pings arrive as a toast and a thought bubble, and speaking is opt-in. */
export const voiceOn = () => voiceSupported() && store.get(KEY) === 'on';

export function setVoiceOn(on: boolean) {
  store.set(KEY, on ? 'on' : 'off');
  if (!on && voiceSupported()) speechSynthesis.cancel();
}

/** Prime speech synthesis from inside a user gesture (a silent utterance). */
export function unlockVoice() {
  if (!voiceSupported()) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

/** Returns false when the voice is off or unsupported, so the caller can rely on the visual card alone. */
export function speak(text: string): boolean {
  if (!voiceOn()) return false;
  speechSynthesis.cancel(); // never queue up a pile of old pings
  const u = new SpeechSynthesisUtterance(text);
  u.lang = navigator.language || 'en-US';
  speechSynthesis.speak(u);
  return true;
}

/** A short double buzz on phones that support it. */
export const buzz = () => navigator.vibrate?.([180, 90, 180]);
