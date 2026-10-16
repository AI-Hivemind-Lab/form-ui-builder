import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOWED_TAGS: ['p', 'span', 'strong', 'em', 'u', 'br', 'a', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['style', 'href', 'target', 'rel', 'data-title', 'class', 'data-list'],
};

/**
 * Real exports mark a footnote as <span data-title="<tooltip html>">FOOT_NOTE_HERE</span>. Mark those spans
 * so the UI can draw them as an info icon with a tooltip; spans with real text keep their text.
 */
if (DOMPurify.isSupported) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    // the only classes kept are Quill's list indents (ql-indent-1 ...), so a nested bullet stays nested
    if (node.hasAttribute('class')) {
      const keep = (node.getAttribute('class') ?? '').split(/\s+/).filter((c) => /^ql-indent-[1-8]$/.test(c) || c === 'ql-ui');
      if (keep.length > 0) node.setAttribute('class', keep.join(' '));
      else node.removeAttribute('class');
    }
    if (node.nodeName === 'SPAN' && node.hasAttribute('data-title') && node.textContent?.trim() === 'FOOT_NOTE_HERE') {
      node.setAttribute('data-footnote', '');
    }
  });
}

/** Sanitize Form Builder `formattedText` HTML before dangerouslySetInnerHTML. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG);
}

/**
 * Markup read back from a contentEditable: browsers emit <b>/<i>, add contenteditable attributes and our
 * footnote marker. Turn it into the markup Form Builder stores.
 */
export function normalizeEdited(html: string): string {
  const mapped = html
    .replace(/<(\/?)b(?=[\s>])/g, '<$1strong')
    .replace(/<(\/?)i(?=[\s>])/g, '<$1em')
    .replace(/&nbsp;/g, ' ');
  return sanitizeHtml(mapped).replace(/ data-footnote=""/g, '');
}
