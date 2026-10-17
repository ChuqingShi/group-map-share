// The toolbar's flag button: tap it for the list of flags, or press and drag it onto the map to plant one right there.
// One gesture and one tap (to confirm) is the whole job. Built on pointer events so a finger, a pen and a mouse all work.
import { useRef, useState, type PointerEvent } from 'react';
import { store } from './safeStorage.ts';

const TIP_KEY = 'gms-flag-tip-seen';
/** How far the finger must travel before a press becomes a drag (a shaky tap must stay a tap). */
const DRAG_SLOP_PX = 12;

export function FlagButton({ count, canPlant, onTap, onDrop }: {
  count: number;
  /** False when the event has an organizer and I am not one: the button still opens the list, but cannot plant. */
  canPlant: boolean;
  onTap: () => void;
  /** Called with the screen position where the flag was let go. Not called if it was dropped back on the toolbar. */
  onDrop: (clientX: number, clientY: number) => void;
}) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragged = useRef(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [tip, setTip] = useState(() => canPlant && store.get(TIP_KEY) === null);

  const seenTip = () => {
    if (!tip) return;
    setTip(false);
    store.set(TIP_KEY, '1');
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (!canPlant || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragged.current = false;
    e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves even when the finger leaves the button
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return;
    if (!dragged.current && Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_SLOP_PX) return;
    dragged.current = true;
    seenTip();
    setAt({ x: e.clientX, y: e.clientY });
  };
  const finish = (e: PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const s = start.current;
    if (!s || e.pointerId !== s.id) return;
    start.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setAt(null);
    if (!dragged.current || cancelled) return;
    // Let go back over the toolbar means "never mind".
    const bar = document.querySelector('.hud-bottom')?.getBoundingClientRect();
    if (bar && e.clientY >= bar.top) return;
    onDrop(e.clientX, e.clientY);
  };

  return (
    <>
      <button
        type="button"
        className={`tool tool-flag ${at ? 'is-dragging' : ''}`}
        data-testid="btn-plans"
        aria-label={canPlant ? `Flags, ${count}. Press and drag onto the map to plant a flag.` : `Flags, ${count}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false; // the click that follows a drag is not a tap
            return;
          }
          seenTip();
          onTap();
        }}
      >
        <span className="tool-icon">🚩{count > 0 && <span className="tool-count">{count}</span>}</span>
        <span className="tool-label">Flags</span>
        {tip && canPlant && !at && (
          <span className="flag-tip" role="note" data-testid="flag-tip">
            Drag me onto the map
          </span>
        )}
      </button>
      {at && (
        <div className="flag-ghost" data-testid="flag-ghost" style={{ left: at.x, top: at.y }} aria-hidden="true">
          <span className="flag-ghost-flag">🚩</span>
          <span className="flag-ghost-ring" />
        </div>
      )}
    </>
  );
}
