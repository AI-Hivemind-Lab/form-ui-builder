import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { normalizeEdited, sanitizeHtml } from './sanitize';

interface Tip {
  html: string;
  x: number;
  y: number;
}

/** Put the caret where the user clicked (Chrome/Safari and Firefox spell this differently). */
function placeCaret(x: number, y: number) {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let range: Range | null = null;
  if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y);
  else if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
    }
  }
  if (!range) return;
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Sanitized Form Builder markup. Elements carrying `data-title` (footnotes) show their content as a tooltip
 * on hover; `data-footnote` placeholders are drawn as an info icon by CSS.
 *
 * With `onCommit` the text is editable in place: one click starts editing, clicking elsewhere saves (Esc cancels).
 */
export function RichHtml({ html, className = '', onCommit }: { html: string; className?: string; onCommit?: (html: string) => void }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const safe = sanitizeHtml(html);

  useEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    el.contentEditable = 'true';
    // Footnote icons behave as single characters while editing.
    el.querySelectorAll('[data-footnote]').forEach((n) => n.setAttribute('contenteditable', 'false'));
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported: Enter then yields a line break */ }
    el.focus();
  }, [editing]);

  const show = (e: MouseEvent) => {
    if (editing) return;
    const el = (e.target as HTMLElement).closest('[data-title]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTip({ html: sanitizeHtml(el.getAttribute('data-title') ?? ''), x: r.left + r.width / 2, y: r.top });
  };
  const hide = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-title]')) setTip(null);
  };

  const start = (e: MouseEvent) => {
    if (!onCommit || editing) return;
    e.preventDefault(); // do not follow a link: this click means "edit"
    cancelled.current = false;
    setTip(null);
    setEditing(true);
    const { clientX, clientY } = e;
    requestAnimationFrame(() => placeCaret(clientX, clientY));
  };

  const finish = () => {
    const el = ref.current;
    if (!el || !editing) return;
    el.contentEditable = 'false';
    setEditing(false);
    if (cancelled.current) {
      el.innerHTML = safe;
      return;
    }
    const next = normalizeEdited(el.innerHTML);
    const hasText = (el.textContent ?? '').replace(/\s+/g, '') !== '';
    if (!hasText) {
      el.innerHTML = safe; // an emptied label cannot be clicked again; keep the old text
      return;
    }
    if (next !== normalizeEdited(safe)) onCommit?.(next);
    else el.innerHTML = safe;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelled.current = true;
      ref.current?.blur();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    // Plain text only: pasted styles would be lost or garbled by the sanitizer anyway.
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };

  const cls = ['rich', className, onCommit && 'rich--editable', editing && 'rich--editing'].filter(Boolean).join(' ');
  return (
    <>
      <div
        ref={ref}
        className={cls}
        dangerouslySetInnerHTML={{ __html: safe }}
        onMouseOver={show}
        onMouseOut={hide}
        onClick={start}
        onBlur={finish}
        onKeyDown={editing ? onKeyDown : undefined}
        onPaste={editing ? onPaste : undefined}
      />
      {tip && <div className="tooltip" role="tooltip" style={{ left: tip.x, top: tip.y }} dangerouslySetInnerHTML={{ __html: tip.html }} />}
    </>
  );
}
