import { describe, expect, it } from 'vitest';
import { loadForm } from '../model/loadForm';
import type { Anchors } from '../model/pdfStore';
import { applyDecisions } from './ai/apply';
import { validateCoverage } from './ai/coverage';
import type { Decision } from './ai/types';
import { coverage, lostTexts, placeOf } from './coverage';
import type { PageText } from './pdfText';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const at = (page: number, top: number, bottom = top + 0.02) => ({ page, left: 0.1, top, right: 0.5, bottom });
const line = (top: number, text: string) => ({ top, text });
const pageText = (page: number, ...lines: [number, string][]): PageText => ({ page, text: '', lines: lines.map(([t, x]) => line(t, x)) });

describe('what the PDF prints that the form never shows', () => {
  // PDF page 1 (index 0): a question, a note nobody highlighted, a footer; page 2 is shown whole by an embedded PDF; page 3 is nowhere
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'Questions', properties: [{ name: 'q', type: 'string', title: 'q' }, { name: 'q2', type: 'string', title: 'q2' }, { name: 'e', type: 'null', title: 'Agreement.pdf' }] }],
    {
      pg: { 'ui:widget': 'Page' },
      q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of the investor as it appears in the books of the fund</p>', 'ui:pdfMapping': ['q'] },
      q2: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Telephone number of the investor</p>', 'ui:pdfMapping': ['q2'] },
      e: { 'ui:widget': 'Pdf', 'ui:pdfCutInfo': { start: 2, end: 2 } },
    },
  );
  const anchors: Anchors = { q: at(0, 0.2), q2: at(0, 0.5) };
  const dull = Array.from({ length: 9 }, (_, i) => [0.1 + i * 0.09, `Whereas the party number ${i} agrees to terms about distribution ${i * 7}`] as [number, string]);
  const pages = [
    pageText(0, [0.2, 'Name of the investor as it appears in the books of the fund'], [0.35, 'If the investor is a trust, please also complete the trust questionnaire attached hereto.'], [0.5, 'Telephone number of the investor'], [0.95, 'Page 1 of 3']),
    pageText(1, [0.2, 'Terms of the agreement that an embedded PDF shows whole']),
    pageText(2, ...dull),
  ];
  const c = coverage(doc, anchors, pages);

  it('finds a note the form does not have, and not the words it has, nor a page number', () => {
    expect(c.blocks.map((b) => [b.page, b.text])).toEqual([[0, 'If the investor is a trust, please also complete the trust questionnaire attached hereto.']]);
  });
  it('does not look at pages an embedded PDF shows, and reports a page that is nowhere on the form as a whole', () => {
    expect(c.pages.map((p) => [p.from, p.to])).toEqual([[3, 3]]);
  });
  it('places the text right after the element above it on the same PDF page', () => {
    expect(placeOf(doc, anchors, 0, 0.35)).toEqual({ after: 'q', before: null, page: null });
    expect(placeOf(doc, anchors, 0, 0.1)).toEqual({ after: null, before: 'q', page: null });
  });
  it('adds it as a paragraph with the words as printed, in the right place, and an instruction as an Info well', () => {
    const d: Decision = { id: 't', title: 't', detail: '', evidence: null, confidence: 'high', defaultAccepted: true, data: { kind: 'add-text', text: c.blocks[0].text, pdfPage: 1, after: 'q', before: null, page: null } };
    const out = applyDecisions(doc, anchors, [], [d]).doc;
    const names = out.schema.properties[0].properties?.map((n) => n.name);
    expect(names).toEqual(['q', 'paragraph_pdf', 'q2', 'e']);
    expect(out.uiSchema.paragraph_pdf).toMatchObject({ 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>If the investor is a trust, please also complete the trust questionnaire attached hereto.</p>' });
    expect(out.uiSchema.paragraph_pdf['ui:wellType']).toBe('Info');
  });
  it('the model answers only about the blocks it was shown, and names a page run by a heading or in plain words', () => {
    const ok = validateCoverage({ blocks: [{ id: 'b1', action: 'add', reason: 'a note' }, { id: 'zzz', action: 'ignore' }], pages: [{ id: 'pg1', action: 'embed', name: 'Annex 1' }] }, new Set(['b1']), new Set(['pg1']), new Set(['h1']));
    expect(ok.blocks.map((b) => [b.id, b.action])).toEqual([['b1', 'add']]);
    expect(() => validateCoverage({ pages: [{ id: 'pg1', action: 'embed', name: 'annex_1' }] }, new Set(), new Set(['pg1']), new Set())).toThrow();
    expect(() => validateCoverage({ pages: [{ id: 'pg1', action: 'embed', headingId: 'h9' }] }, new Set(), new Set(['pg1']), new Set(['h1']))).toThrow();
  });
});

describe('text the form lost', () => {
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'q', type: 'string', title: 'q' }] }],
    { pg: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of the investor as it appears in the books of the fund</p>' } },
  );
  it('lists the highlighted texts the form does not show, not the ones it shows', () => {
    const texts = ['Name of the investor as it appears in the books of the fund', 'The Investor represents and warrants that it is an accredited investor under Rule 501'];
    expect(lostTexts(doc, texts)).toEqual([texts[1]]);
  });
  it('with a form before the change: only what the change took away', () => {
    const before = raw(
      [{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'q', type: 'string', title: 'q' }, { name: 'n', type: 'null', title: 'n' }] }],
      { pg: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of the investor as it appears in the books of the fund</p>' }, n: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>If the answer is yes, please contact counsel before continuing</p>' } },
    );
    const texts = ['If the answer is yes, please contact counsel before continuing', 'A text the form never had in the first place, about something else'];
    expect(lostTexts(doc, texts, before)).toEqual([texts[0]]);
  });
});
