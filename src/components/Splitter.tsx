import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react';

export type Column = 'toc' | 'pdf' | 'right';
export type Widths = Partial<Record<Column, number>>;

const KEY = 'formbuilder:column-widths';
export const LIMITS: Record<Column, [number, number]> = { toc: [180, 620], pdf: [300, 1000], right: [260, 760] };
const CSS_VAR: Record<Column, string> = { toc: '--toc-w', pdf: '--pdf-w', right: '--right-w' };

const clamp = (c: Column, v: number): number => Math.max(LIMITS[c][0], Math.min(LIMITS[c][1], Math.round(v)));

function readSaved(): Widths {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries((Object.keys(LIMITS) as Column[]).flatMap((c) => {
      const v = (raw as Record<string, unknown>)[c];
      return typeof v === 'number' && Number.isFinite(v) ? [[c, clamp(c, v)]] : [];
    })) as Widths;
  } catch {
    return {};
  }
}

/** The widths of the columns the user dragged (the others keep their default), kept in the browser. */
export function useColumnWidths(): { widths: Widths; set: (c: Column, px: number | null) => void; style: Record<string, string> } {
  const [widths, setWidths] = useState<Widths>(readSaved);
  const set = useCallback((c: Column, px: number | null) => {
    setWidths((w) => {
      const next = { ...w };
      if (px === null) delete next[c];
      else next[c] = clamp(c, px);
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch { /* not critical */ }
      return next;
    });
  }, []);
  const style = Object.fromEntries((Object.keys(widths) as Column[]).map((c) => [CSS_VAR[c], `${widths[c]}px`]));
  return { widths, set, style };
}

/**
 * The line between two columns: drag it to resize, arrow keys to nudge, double-click to go back to the default width.
 * `grows` is the way dragging to the right changes the column: +1 when the column is on its left, -1 when it is on its right.
 */
export function Splitter({ column, grows, measure, onResize, label }: {
  column: Column;
  grows: 1 | -1;
  /** The column's width on screen now. */
  measure: () => number;
  onResize: (column: Column, px: number | null) => void;
  label: string;
}) {
  const [dragging, setDragging] = useState(false);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = measure();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => onResize(column, start + grows * (ev.clientX - startX));
    const up = () => {
      setDragging(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      onResize(column, measure() + (e.key === 'ArrowRight' ? 1 : -1) * grows * step);
    } else if (e.key === 'Home' || e.key === 'Escape') onResize(column, null);
  };
  return (
    <div
      className={`splitter${dragging ? ' splitter--active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={LIMITS[column][0]}
      aria-valuemax={LIMITS[column][1]}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={() => onResize(column, null)}
    />
  );
}
