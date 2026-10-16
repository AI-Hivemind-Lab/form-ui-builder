import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { filterWidgets } from '../model/widgetCatalog';
import { SearchIcon, WidgetIcon } from './icons';

export function WidgetPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const matches = filterWidgets(query);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  // The side columns scroll and clip what is drawn inside them (and a column that blurs its background is a box for fixed children too):
  // the popover is drawn at the end of the page and placed against the viewport, next to the button that opened it.
  useLayoutEffect(() => {
    const host = document.querySelector('[data-picker-anchor][aria-expanded="true"]')?.closest('.tree__row, .toc__head') ?? ref.current?.closest('.tree__row, .toc__head');
    if (!host) return;
    const r = host.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 480;
    const top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - h - 8));
    setPos({ top, left: Math.max(8, Math.min(r.left + 20, window.innerWidth - 480)) });
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // The "+" button toggles the popover itself, so a mousedown on it must not also close it here.
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-picker-anchor]')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return createPortal(
    <div className="picker picker--fixed" style={pos ?? { visibility: 'hidden' }} ref={ref} role="dialog" aria-label="Add a widget" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="picker__search">
        <SearchIcon />
        <input
          autoFocus
          placeholder="Search"
          aria-label="Search widgets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) onPick(matches[0].id);
          }}
        />
      </div>
      <div className="picker__heading">Widgets</div>
      {matches.length === 0 ? (
        <div className="picker__empty">No widgets</div>
      ) : (
        <div className="picker__grid">
          {matches.map((w) => (
            <button key={w.id} type="button" className="picker__item" onClick={() => onPick(w.id)}>
              <WidgetIcon id={w.id} />
              <span>{w.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
