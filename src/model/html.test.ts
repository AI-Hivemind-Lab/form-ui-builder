import { describe, expect, it } from 'vitest';
import { escapeHtml, stripHtml } from './html';

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('stripHtml', () => {
  it('removes tags and keeps text', () => {
    expect(stripHtml('<p>specify percentage <span style="color: red;">*</span></p>')).toBe('specify percentage *');
  });
  it('decodes entities, ampersand last, so &amp;lt; stays literal', () => {
    expect(stripHtml('<p>a &lt; b &amp; c &amp;lt;</p>')).toBe('a < b & c &lt;');
  });
  it('does not collapse or trim whitespace', () => {
    expect(stripHtml('<p>abc  </p>')).toBe('abc  ');
  });
});
