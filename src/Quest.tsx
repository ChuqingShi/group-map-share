// The test mission screens: a one-time intro per new build, a little progress chip, and the checklist.
import { useCallback, useEffect, useState } from 'react';
import { STEPS, loadQuest, markDone, progress, resultsText, saveQuest, shouldShowIntro, type QuestState, type StepId } from './quest.ts';

export interface QuestApi {
  state: QuestState | null;
  intro: boolean;
  start: () => void;
  skip: () => void;
  done: (id: StepId) => void;
}

export function useQuest(build: string | null): QuestApi {
  const [state, setState] = useState<QuestState | null>(loadQuest);
  const [intro, setIntro] = useState(false);

  useEffect(() => {
    if (!build) return;
    const params = new URLSearchParams(location.search);
    setIntro(shouldShowIntro(loadQuest(), build, { forced: params.has('quest'), suppressed: params.has('noquest'), automated: navigator.webdriver === true }));
  }, [build]);

  const commit = useCallback((q: QuestState) => {
    saveQuest(q);
    setState(q);
  }, []);
  const start = useCallback(() => {
    if (build) commit({ build, started: true, done: [] });
    setIntro(false);
  }, [build, commit]);
  const skip = useCallback(() => {
    if (build) commit({ build, started: false, done: [] });
    setIntro(false);
  }, [build, commit]);
  // Only counts once the mission has been started, and only the first time.
  const done = useCallback((id: StepId) => {
    setState((prev) => {
      if (!prev?.started || prev.done.includes(id)) return prev;
      const next = markDone(prev, id);
      saveQuest(next);
      return next;
    });
  }, []);

  return { state, intro, start, skip, done };
}

export function QuestIntro({ build, onStart, onSkip }: { build: string; onStart: () => void; onSkip: () => void }) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="First mission" data-testid="quest-intro">
      <div className="sheet quest-intro">
        <p className="quest-tag">Welcome · build {build}</p>
        <h2>First mission</h2>
        <p>Seven quick steps to learn Groupz. Each one ticks itself off as you go.</p>
        <ol className="quest-list">
          {STEPS.map((s) => (
            <li key={s.id}>
              <span className="quest-icon" aria-hidden="true">{s.icon}</span>
              <span>{s.title}</span>
            </li>
          ))}
        </ol>
        <div className="controls">
          <button type="button" className="btn" data-testid="btn-quest-start" onClick={onStart}>Start the mission</button>
          <button type="button" className="btn btn-ghost" data-testid="btn-quest-skip" onClick={onSkip}>Not now</button>
        </div>
      </div>
    </div>
  );
}

export function QuestChip({ state, onClick }: { state: QuestState; onClick: () => void }) {
  const p = progress(state);
  return (
    <button type="button" className={`quest-chip ${p.complete ? 'is-complete' : ''}`} data-testid="btn-quest" aria-label={`First mission, ${p.done} of ${p.total} done`} onClick={onClick}>
      {p.complete ? '🎉' : '⏳'} {p.done}/{p.total}
    </button>
  );
}

export function QuestPanel({ state, onClose, onRestart }: { state: QuestState; onClose: () => void; onRestart: () => void }) {
  const p = progress(state);
  const mailto = `mailto:kuhlmanne@gmail.com?subject=${encodeURIComponent('Groupz feedback')}&body=${encodeURIComponent(resultsText(state))}`;
  return (
    <section className="sheet panel" data-testid="quest-panel">
      <header className="panel-head">
        <h2>First mission · {p.done}/{p.total}</h2>
        <button type="button" className="btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </header>
      <ol className="quest-steps">
        {STEPS.map((s) => {
          const ok = state.done.includes(s.id);
          return (
            <li key={s.id} className={`quest-step ${ok ? 'is-done' : ''}`} data-testid="quest-step" data-step={s.id} data-done={ok}>
              <span className="quest-check" aria-hidden="true">{ok ? '✅' : s.icon}</span>
              <span className="quest-body">
                <span className="quest-title">{s.title}</span>
                {!ok && <span className="quest-hint">{s.hint}</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {p.complete ? (
        <p className="quest-done">🎉 Mission complete! Tell us what felt great and what felt off.</p>
      ) : (
        <p className="fineprint">Build {state.build}. Steps tick themselves off as you go.</p>
      )}
      <div className="controls">
        <a className="btn btn-small" data-testid="btn-quest-send" href={mailto}>✉️ Send feedback</a>
        <button type="button" className="btn btn-small btn-ghost" onClick={onRestart}>Start over</button>
      </div>
    </section>
  );
}
