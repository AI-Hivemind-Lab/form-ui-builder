import { describe, expect, it } from 'vitest';
import { loadForm } from '../model/loadForm';
import type { Anchors } from '../model/pdfStore';
import { pageOrderWarnings, pagesOutOfOrder, pageStart } from './pageOrder';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const at = (page: number, top = 0.2) => ({ page, left: 0.1, top, right: 0.5, bottom: top + 0.02 });
const field = (alias: string) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': `<p>${alias}</p>`, 'ui:pdfMapping': [alias] });
const page = (name: string, title: string, kids: string[]) => ({ name, type: 'object', title, properties: kids.map((k) => ({ name: k, type: 'string', title: k })) });

describe('page order follows the sub-doc', () => {
  const nodes = [page('gi', 'General Information', ['a']), page('ins', 'Instructions', ['pdf1']), page('sa', 'Subscription Agreement', ['pdf2']), page('inv', 'Accredited Investor', ['b'])];
  const ui: Ui = {
    gi: { 'ui:widget': 'Page' }, ins: { 'ui:widget': 'Page' }, sa: { 'ui:widget': 'Page' }, inv: { 'ui:widget': 'Page' },
    a: field('a'), b: field('b'),
    pdf1: { 'ui:widget': 'Pdf', 'ui:pdfCutInfo': { start: 1, end: 1 } }, pdf2: { 'ui:widget': 'Pdf', 'ui:pdfCutInfo': { start: 2, end: 10 } },
  };
  const anchors: Anchors = { a: at(10), b: at(11) };

  it('a page starts where its first annotated field is, or where its embedded PDF is cut from (numbered from 1)', () => {
    const d = raw(nodes, ui);
    expect(pageStart(d, anchors, d.schema.properties[0])).toEqual({ page: 10, top: 0.2 });
    expect(pageStart(d, anchors, d.schema.properties[1])).toEqual({ page: 0, top: 0 });
    expect(pageStart(d, anchors, d.schema.properties[2])).toEqual({ page: 1, top: 0 });
  });
  it('reports only the page that is out of place, and where it belongs', () => {
    const issues = pagesOutOfOrder(raw(nodes, ui), anchors);
    expect(issues.map((x) => [x.title, x.pdfPage, x.after?.title ?? null])).toEqual([['General Information', 11, 'Subscription Agreement']]);
    expect(pageOrderWarnings(raw(nodes, ui), anchors)).toEqual(['PAGE ORDER: "General Information" starts on PDF page 11 but sits out of the PDF\'s order; in the PDF it comes after "Subscription Agreement" (PDF page 2)']);
  });
  it('says nothing when the pages are in order, when a page is tied to nothing in the PDF, or for a hidden page', () => {
    const ordered = [nodes[1], nodes[2], nodes[0], nodes[3]];
    expect(pagesOutOfOrder(raw(ordered, ui), anchors)).toEqual([]);
    expect(pagesOutOfOrder(raw(nodes, ui), {})).toEqual([]); // only the two embedded-PDF pages are tied to the PDF, and they are in order
    const hiddenFirst = { ...ui, gi: { 'ui:widget': 'Page', 'ui:invisible': true } };
    expect(pagesOutOfOrder(raw(nodes, hiddenFirst), anchors)).toEqual([]);
  });
});
