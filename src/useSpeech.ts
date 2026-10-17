// Speech to text for the Talk button, via the browser's SpeechRecognition (Chrome, Android Chrome,
// Safari). Heads up: Chrome sends the audio to Google's speech service unless it is processed on
// the device, so the UI offers typing as the alternative. Nothing is stored here.
import { useCallback, useEffect, useRef, useState } from 'react';

export type SpeechError = 'denied' | 'no-speech' | 'network' | 'unsupported' | 'other';

// The DOM lib may not type SpeechRecognition, so these are just the bits we use.
interface RecResult {
  isFinal: boolean;
  [i: number]: { transcript: string };
}
interface RecEvent {
  results: { length: number; [i: number]: RecResult };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const speechInputSupported = () => ctor() !== undefined;

const ERROR_OF: Record<string, SpeechError> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'no-speech': 'no-speech',
  network: 'network',
};

/** One utterance per start(). `onFinal` gets the trimmed transcript once, when the recognizer finishes. */
export function useSpeechInput(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<SpeechError | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal; // always the latest callback, never a stale closure

  const start = useCallback(() => {
    const Ctor = ctor();
    if (!Ctor) return setError('unsupported');
    if (recRef.current) return; // already listening
    setError(null);
    setInterim('');

    const rec = new Ctor();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    let heard = ''; // what the recognizer has settled on
    let live = ''; // its best guess for the rest, still changing
    let failed = false;
    rec.onresult = (e) => {
      heard = live = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) heard += e.results[i][0].transcript;
        else live += e.results[i][0].transcript;
      }
      setInterim((heard + live).trim());
    };
    rec.onerror = (e) => {
      failed = true;
      setError(ERROR_OF[e.error] ?? 'other');
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
      if (failed) return;
      // Some browsers end without ever marking a result final; the best guess beats losing it.
      const text = (heard || live).trim();
      if (text) onFinalRef.current(text);
      else setError('no-speech');
    };

    try {
      rec.start(); // must stay synchronous so it counts as part of the tap
    } catch {
      return setError('other');
    }
    recRef.current = rec;
    setListening(true);
  }, []);

  const stop = useCallback(() => recRef.current?.stop(), []);

  // Release the microphone if the component goes away mid-sentence.
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (!rec) return;
      rec.onresult = rec.onerror = rec.onend = null;
      rec.abort();
      recRef.current = null;
    },
    [],
  );

  return { supported: speechInputSupported(), listening, interim, error, start, stop };
}
