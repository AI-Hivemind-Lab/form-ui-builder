import { useState } from 'react';
import { asStringArray } from '../model/format';
import { RichHtml } from '../components/RichHtml';
import { layoutClass, optionHtml, type WidgetProps } from './shared';

export function MultipleCheckbox({ ui, value, onChange, options, renderBelow }: WidgetProps) {
  const selected = asStringArray(value);
  const hasBelow = options.some((o) => (o.fieldsBelow?.length ?? 0) > 0);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className={`w-radio${layoutClass(ui, hasBelow)}`} role="group">
      {options.map((o) => {
        const below = renderBelow?.(o);
        return (
          <div key={o.value} className="w-opt">
            <label className="w-check__opt">
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="w-check__box" />
              <RichHtml className="w-opt__label" html={optionHtml(o)} />
            </label>
            {below ? <div className="w-opt__below">{below}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function MultipleSuggest({ id, value, onChange, options }: WidgetProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = asStringArray(value);
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !selected.includes(o.value) && o.label.toLowerCase().includes(q)).slice(0, 8);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="w-suggest">
      {selected.length > 0 && (
        <div className="w-chips">
          {selected.map((v) => (
            <span key={v} className="w-chip">
              {labelOf(v)}
              <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="w-input"
        placeholder="Type to search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul className="w-suggest__list">
          {matches.length === 0 ? (
            <li className="w-suggest__empty">No matches</li>
          ) : (
            matches.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange([...selected, o.value]);
                    setQuery('');
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
