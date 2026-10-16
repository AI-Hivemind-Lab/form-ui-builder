import { useEffect, useRef, useState } from 'react';
import { normalizeEdited, sanitizeHtml } from './sanitize';

/**
 * A small rich-text box for a help text: click to type, bold / italic / bullets / link above it while it has focus.
 * It saves when focus leaves, and an empty box is an empty help text (unlike a label, it may be emptied).
 */
export function HtmlBox({ value, onChange, label, placeholder = 'Click here to edit' }: { value: string; onChange: (html: string) => void; label: string; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [empty, setEmpty] = useState(value.replace(/<[^>]*>/g, '').trim() === '');
  // show a change made elsewhere (undo, the AI), but never while the user is typing in it
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    el.innerHTML = sanitizeHtml(value);
    setEmpty((el.textContent ?? '').trim() === '');
  }, [value]);

  const run = (command: string, arg?: string) => {
    ref.current?.focus();
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported */ }
    document.execCommand(command, false, arg);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // pressing a tool must not take the selection away from the text
  const link = () => {
    const url = window.prompt('Link address (https://…)');
    if (url && /^https?:\/\//i.test(url.trim())) run('createLink', url.trim());
  };
  const finish = () => {
    const el = ref.current;
    setFocused(false);
    if (!el) return;
    const hasText = (el.textContent ?? '').trim() !== '';
    const next = hasText ? normalizeEdited(el.innerHTML) : '';
    setEmpty(!hasText);
    if (next !== normalizeEdited(sanitizeHtml(value))) onChange(next);
  };

  return (
    <div className={`htmlbox${focused ? ' htmlbox--focus' : ''}`}>
      {focused && (
        <div className="htmlbox__tools" role="toolbar" aria-label="Text formatting">
          <button type="button" aria-label="Bold" onMouseDown={keep} onClick={() => run('bold')}><b>B</b></button>
          <button type="button" aria-label="Italic" onMouseDown={keep} onClick={() => run('italic')}><i>I</i></button>
          <button type="button" aria-label="Bulleted list" onMouseDown={keep} onClick={() => run('insertUnorderedList')}>• List</button>
          <button type="button" aria-label="Link" onMouseDown={keep} onClick={link}>Link</button>
        </div>
      )}
      <div
        ref={ref}
        className="htmlbox__edit rich"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        data-placeholder={placeholder}
        data-empty={empty ? 'true' : 'false'}
        onFocus={() => setFocused(true)}
        onInput={(e) => setEmpty((e.currentTarget.textContent ?? '').trim() === '')}
        onBlur={finish}
        onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
      />
    </div>
  );
}
