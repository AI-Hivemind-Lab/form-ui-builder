// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { normalizeEdited, sanitizeHtml } from './sanitize';

describe('sanitizeHtml (Review Focus 3)', () => {
  it('keeps the required-star markup used by Form Builder labels', () => {
    const html = '<p>Is it exempt? <span style="color: rgb(219, 55, 55);">*</span></p>';
    const out = sanitizeHtml(html);
    expect(out).toContain('<p>');
    expect(out).toContain('*');
    expect(out).toContain('style=');
  });
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });
  it('strips event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">a</p><a href="#" onmouseover="y()">b</a>');
    expect(out).not.toMatch(/onclick|onmouseover/);
  });
  it('strips javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });
  it('drops disallowed tags like img/iframe but keeps text', () => {
    const out = sanitizeHtml('<img src=x onerror=alert(1)><iframe src="//e"></iframe><strong>ok</strong>');
    expect(out).toBe('<strong>ok</strong>');
  });
});

describe('real export markup (underline and footnotes)', () => {
  it('keeps <u> underlines', () => {
    expect(sanitizeHtml('<p>the “<u>Subscriber</u>”</p>')).toBe('<p>the “<u>Subscriber</u>”</p>');
  });
  it('keeps a data-title tooltip and marks a FOOT_NOTE_HERE span as a footnote icon', () => {
    const out = sanitizeHtml('<p>net worth <span data-title="&lt;p&gt;tip &lt;u&gt;x&lt;/u&gt;&lt;/p&gt;">FOOT_NOTE_HERE</span> (or</p>');
    const box = document.createElement('div');
    box.innerHTML = out;
    const span = box.querySelector('span')!;
    expect(span.getAttribute('data-title')).toBe('<p>tip <u>x</u></p>');
    expect(span.hasAttribute('data-footnote')).toBe(true);
  });
  it('does not mark a data-title span with real text as a footnote icon', () => {
    const out = sanitizeHtml('<p><span data-title="tip">net worth</span></p>');
    expect(out).toContain('data-title="tip"');
    expect(out).not.toContain('data-footnote');
  });
  it('does not let a data-title carry markup into the page: it stays an inert attribute value', () => {
    const out = sanitizeHtml('<span data-title="&lt;img src=x onerror=alert(1)&gt;">FOOT_NOTE_HERE</span>');
    const box = document.createElement('div');
    box.innerHTML = out;
    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('span')?.getAttribute('data-title')).toBe('<img src=x onerror=alert(1)>');
  });
  it('still strips event handlers and scripts next to footnotes', () => {
    const out = sanitizeHtml('<span data-title="t" onclick="x()">FOOT_NOTE_HERE</span><script>alert(1)</script>');
    expect(out).not.toMatch(/onclick|<script/);
  });
});

describe('normalizeEdited', () => {
  it('maps b/i to strong/em and drops editing attributes and the footnote marker', () => {
    const out = normalizeEdited('<p contenteditable="true">a <b>bold</b> <i>it</i>&nbsp;x <span data-title="&lt;p&gt;n&lt;/p&gt;" contenteditable="false">FOOT_NOTE_HERE</span></p>');
    expect(out).toBe('<p>a <strong>bold</strong> <em>it</em> x <span data-title="<p>n</p>">FOOT_NOTE_HERE</span></p>');
  });
  it('is stable on already clean markup', () => {
    const clean = '<p>Hi <u>there</u> <a href="http://x" target="_blank" rel="noopener">link</a></p>';
    expect(normalizeEdited(clean)).toBe(sanitizeHtml(clean));
  });
});

describe('nested bullets', () => {
  it('keeps the indent class of a nested list item and drops other classes', () => {
    const out = sanitizeHtml('<ul><li data-list="bullet">a</li><li data-list="bullet" class="ql-indent-1 evil">b</li><li class="other">c</li></ul>');
    expect(out).toContain('<li data-list="bullet" class="ql-indent-1">b</li>');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('class="other"');
  });
});
