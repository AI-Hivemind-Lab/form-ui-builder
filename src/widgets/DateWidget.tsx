import { useEffect, useRef, useState } from 'react';
import { CalendarIcon } from '../components/icons';
import { resolveDateDraft } from '../model/draft';
import { formatDateDisplay } from '../model/format';
import { toText, type WidgetProps } from './shared';

/**
 * Stores ISO YYYY-MM-DD. Typed text (MM-DD-YYYY) is committed on blur only; text that is not a real
 * date is never saved: it stays visible and flagged, and the previously stored date is left alone.
 */
export function DateWidget({ id, ui, value, onChange }: WidgetProps) {
  const iso = toText(value);
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(null), [value]);
  const shown = draft ?? (iso ? formatDateDisplay(iso) : '');
  const invalid = draft !== null && resolveDateDraft(draft, value).kind === 'invalid';

  const commit = () => {
    setFocused(false);
    if (draft === null) return;
    const result = resolveDateDraft(draft, value);
    if (result.kind === 'invalid') return;
    if (result.kind === 'set') onChange(result.value);
    setDraft(null);
  };

  return (
    <div className="w-date">
      <button type="button" className="w-date__icon" aria-label="Pick a date" onClick={() => picker.current?.showPicker?.()}>
        <CalendarIcon />
      </button>
      <input
        id={id}
        className={`w-input${invalid ? ' w-input--invalid' : ''}`}
        placeholder={typeof ui['ui:placeholder'] === 'string' && ui['ui:placeholder'] ? ui['ui:placeholder'] : 'Pick a date, or enter as MM-DD-YYYY'}
        value={shown}
        onFocus={() => {
          setFocused(true);
          setDraft((d) => d ?? shown);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {invalid && !focused && <div className="w-error">Not a valid date, so it was not saved</div>}
      <input ref={picker} type="date" className="w-date__native" tabIndex={-1} aria-hidden="true" value={iso} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
