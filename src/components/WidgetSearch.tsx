import { useEffect, useMemo, useRef, useState } from 'react';
import { findNode } from '../model/schemaWalk';
import { searchWidgets } from '../model/search';
import type { FormDoc } from '../model/types';
import { WidgetIcon } from './icons';

const MAX_SHOWN = 40;
type Scope = 'all' | 'alias' | 'text';
const SCOPES: { id: Scope; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'alias', label: 'Alias' }, { id: 'text', label: 'Text' }];

/** Find a widget by its alias (or PDF field) or by what it says; picking one opens its page and selects it. Ctrl/Cmd+K focuses the box. */
export function WidgetSearch({ doc, onPick }: { doc: FormDoc; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchWidgets(doc, query, scope), [doc, query, scope]);
  const shown = hits.slice(0, MAX_SHOWN);
  const pageTitle = (name: string): string => findNode(doc.schema.properties, name)?.title ?? '';

  useEffect(() => setActive(0), [query, scope]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (name: string) => {
    onPick(name);
  };
  return (
    <div className="wsearch">
      <div className="wsearch__row">
        <input
          ref={input}
          className="w-input wsearch__input"
          type="search"
          value={query}
          placeholder="Find a widget by alias or text (Ctrl/Cmd+K)"
          aria-label="Find a widget by alias or text"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && shown[active]) pick(shown[active].name);
            else if (e.key === 'Escape') setQuery('');
          }}
        />
        <select className="wsearch__scope" value={scope} aria-label="Search in" onChange={(e) => setScope(e.target.value as Scope)}>
          {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      {query.trim() !== '' && (
        <ul className="wsearch__list" role="listbox" aria-label="Search results">
          {shown.length === 0 && <li className="wsearch__none">No widget matches.</li>}
          {shown.map((h, i) => (
            <li key={h.name} role="option" aria-selected={i === active}>
              <button type="button" className={`wsearch__hit${i === active ? ' wsearch__hit--active' : ''}`} onClick={() => pick(h.name)} onMouseEnter={() => setActive(i)}>
                <span className="tree__icon"><WidgetIcon id={h.widget} /></span>
                <span className="wsearch__text">
                  <span className="wsearch__label">{h.label}</span>
                  <span className="wsearch__meta"><code>{h.name}</code>{h.page && h.page !== h.name ? ` · ${pageTitle(h.page)}` : ''}{h.matchedIn.includes('pdf') && !h.matchedIn.includes('alias') ? ' · PDF field' : ''}</span>
                </span>
              </button>
            </li>
          ))}
          {hits.length > shown.length && <li className="wsearch__none">{hits.length - shown.length} more; refine the search.</li>}
        </ul>
      )}
    </div>
  );
}
