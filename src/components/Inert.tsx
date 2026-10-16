import { useState, type ReactNode } from 'react';
import { useForm } from '../state/useFormStore';

export function InertButton({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const { dispatch } = useForm();
  return (
    <button
      type="button"
      className={className}
      title="Not in prototype"
      onClick={() => dispatch({ type: 'notify', message: `“${label}” isn't part of this prototype` })}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' toggle--on' : ''}`} onClick={onChange}>
      <span className="toggle__knob" />
    </button>
  );
}

/** Wired when `onToggle` is given (controlled by `checked`); otherwise flips visually only. */
export function ToggleRow({ label, checked, onToggle, defaultOn = false }: { label: string; checked?: boolean; onToggle?: () => void; defaultOn?: boolean }) {
  const [local, setLocal] = useState(defaultOn);
  const wired = onToggle !== undefined;
  return (
    <div className="tool-row" title={wired ? undefined : 'Not in prototype'}>
      <span>{label}</span>
      <Toggle label={label} checked={wired ? Boolean(checked) : local} onChange={wired ? onToggle : () => setLocal((v) => !v)} />
    </div>
  );
}
