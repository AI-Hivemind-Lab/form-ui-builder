import { useEffect, useState } from 'react';
import type { DraftResult } from '../model/draft';
import { toText } from './shared';

interface Props {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  resolve: (draft: string, current: unknown) => DraftResult;
  /** Text shown when not editing. */
  display?: (v: unknown) => string;
  /** Text shown when editing starts. */
  editText?: (v: unknown) => string;
  errorText: string;
  inputMode?: 'decimal' | 'numeric' | 'email' | 'tel' | 'text';
  placeholder?: string;
}

/**
 * Free text while editing; committed on blur only. Text that does not resolve is never saved: it stays
 * visible and flagged, and the previously stored value is left alone.
 */
export function DraftField({ id, value, onChange, resolve, display = toText, editText = toText, errorText, inputMode, placeholder }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(null), [value]);
  const invalid = draft !== null && resolve(draft, value).kind === 'invalid';

  const commit = () => {
    setFocused(false);
    if (draft === null) return;
    const result = resolve(draft, value);
    if (result.kind === 'invalid') return;
    if (result.kind === 'set') onChange(result.value);
    setDraft(null);
  };

  return (
    <div className="w-number">
      <input
        id={id}
        className={`w-input${invalid ? ' w-input--invalid' : ''}`}
        inputMode={inputMode}
        placeholder={placeholder}
        value={draft ?? display(value)}
        onFocus={() => {
          setFocused(true);
          setDraft((d) => d ?? editText(value));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {invalid && !focused && <div className="w-error">{errorText}</div>}
    </div>
  );
}
