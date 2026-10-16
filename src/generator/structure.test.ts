import { describe, expect, it } from 'vitest';
import { annotationToForm } from './annotationToForm';
import type { PageText } from './pdfText';
import { aliasOf, defaultRuns, governing, headingTitle, pdfHeadings, splitGlued, vocabularyOf } from './structure';

const line = (top: number, text: string) => ({ top, text });
const page = (n: number, ...lines: [number, string][]): PageText => ({ page: n, text: '', lines: lines.map(([t, x]) => line(t, x)) });

describe('headings of the PDF', () => {
  const pages = [
    page(0, [0.1, 'EXAMPLE HOLDINGS II LP'], [0.2, '(FOR U.S. AND NON-U.S. INVESTORS)']),
    page(1, [0.1, 'INVESTOR QUESTIONNAIRE'], [0.2, 'A. General Information'], [0.5, 'B. Accredited Investor Status'], [0.7, '1. Subscription Agreement'], [0.95, 'IQ – 3']),
    page(2, [0.1, 'EXAMPLE HOLDINGS II LP'], [0.15, 'E. Supplemental Data for Entities'], [0.3, 'A. Exempt Persons']),
    page(3, [0.1, 'EXAMPLE HOLDINGS II LP'], [0.2, 'C. Additional U.S. Federal Securities Law Representations'], [0.5, 'DIRECTIONS FOR THE COMPLETION'], [0.52, 'OF THE SUBSCRIPTION DOCUMENTS'], [0.6, 'NAME:']),
    page(4, [0.1, 'EXAMPLE HOLDINGS II LP'], [0.2, 'D. Supplemental Data for Individuals']),
  ];
  const h = pdfHeadings(pages, 'Example Holdings II LP');
  it('takes lettered headings in sequence, capitals headings, and runs a capitals heading on to its second line', () => {
    expect(h.map((x) => x.text)).toEqual(['INVESTOR QUESTIONNAIRE', 'A. General Information', 'B. Accredited Investor Status', 'C. Additional U.S. Federal Securities Law Representations', 'DIRECTIONS FOR THE COMPLETION OF THE SUBSCRIPTION DOCUMENTS', 'D. Supplemental Data for Individuals']);
  });
  it('leaves out a letter that is not the next one ("A. Exempt Persons" inside a section), footers, the fund name, and labels with a colon', () => {
    const texts = h.map((x) => x.text);
    expect(texts).not.toContain('A. Exempt Persons');
    expect(texts).not.toContain('E. Supplemental Data for Entities'); // E before D: not the next letter
    expect(texts.some((t) => /EXAMPLE|IQ/.test(t))).toBe(false);
    expect(texts).not.toContain('NAME:');
  });
  it('says which heading a place is under, and does not reach back over a page for a page that starts near the top', () => {
    expect(governing(h, { page: 1, top: 0.6 })?.text).toBe('B. Accredited Investor Status');
    expect(governing(h, { page: 1, top: 0.48 })?.text).toBe('B. Accredited Investor Status'); // a field a hair above its heading's line
    expect(governing(h, { page: 3, top: 0.05 }, true)).toBeNull(); // the heading above is high on the page before: its section ended
    expect(governing(h, { page: 3, top: 0.3 }, true)?.text).toContain('C. Additional');
  });
  it('writes a heading as a title and as an alias', () => {
    expect(headingTitle(h[4])).toBe('DIRECTIONS FOR THE COMPLETION OF THE SUBSCRIPTION DOCUMENTS'); // the title standard writes it in Title Case
    expect(headingTitle(h[1])).toBe('A. General Information');
    expect(aliasOf('E. Supplemental Data for Entities')).toBe('e_supplemental_data_for_entities');
    expect(aliasOf('CONSENT FOR THE PROCESSING OF SENSITIVE PERSONAL INFORMATION')).toBe('consent_for_the_processing_of_sensitive_personal');
  });
});

describe('objects the annotation left outside every page', () => {
  const box = (top: number, left = 0.1, pageIndex = 0) => ({ pageIndex, area: { left, top, right: left + 0.3, bottom: top + 0.02 } });
  const label = (id: string, text: string) => [{ id: `${id}_l`, __typename__: 'PdfTextLabelDTO', name: `${id}_l`, labelOf: id, content: [1, text], children: [] }];
  const pages = [
    page(0, [0.1, 'INVESTOR QUESTIONNAIRE'], [0.15, 'A. General Information'], [0.5, 'B. Supplemental Data for Entities']),
    page(1, [0.1, 'SIGNATURE PAGE']),
  ];
  const objs = [
    { id: 'pa', __typename__: 'PdfPageFieldDTO', name: 'a_general', children: ['n'] },
    { id: 'n', __typename__: 'PdfTextFieldDTO', name: 'name_a', ...box(0.2) }, ...label('n', 'Name'),
    { id: 'x', __typename__: 'PdfTextFieldDTO', name: 'legalform_e', ...box(0.6) }, ...label('x', 'Legal form of entity'),
    { id: 'y', __typename__: 'PdfRadioGroupFieldDTO', name: 'flow_e', children: ['y1', 'y2'] }, ...label('y', 'Is it a flow-through vehicle?'),
    { id: 'y1', __typename__: 'PdfRadioFieldDTO', name: 'yes_flow_e', ...box(0.7, 0.1) }, ...label('y1', 'Yes'),
    { id: 'y2', __typename__: 'PdfRadioFieldDTO', name: 'no_flow_e', ...box(0.7, 0.3) }, ...label('y2', 'No'),
    { id: 's', __typename__: 'PdfSignatureFieldDTO', name: 'lpsignature_x', ...box(0.3, 0.1, 1) },
    { id: 'd', __typename__: 'PdfTextFieldDTO', name: 'date_signature_x', ...box(0.35, 0.1, 1) },
  ];
  const build = (plan?: NonNullable<Parameters<typeof annotationToForm>[1]>['plan']) => annotationToForm(JSON.stringify({ fileName: 'f.pdf', pdfObjectDTO: objs }), { fundName: 'F', pdfPages: pages, plan });
  type N = { name: string; title: string; properties?: N[] };
  const top = (r: ReturnType<typeof build>) => (r.form.namespaceFormSchemaMap as { main: { schema: { properties: N[] } } }).main.schema.properties;

  it('goes into a page of its own named after the heading it is under, and a signature block alone is hidden', () => {
    const r = build();
    expect(top(r).map((p) => [p.name, p.title])).toEqual([['file0', 'f.pdf'], ['hidden', 'Hidden'], ['a_general', 'A. General Information'], ['b_supplemental_data_for_entities', 'B. Supplemental Data for Entities']]);
    expect(top(r)[3].properties?.map((n) => n.name)).toEqual(expect.arrayContaining(['legalform_e', 'flow_e']));
    expect(top(r)[1].properties?.map((n) => n.name)).toEqual(expect.arrayContaining(['lpsignature_x']));
    expect(r.structure.runs.map((x) => x.action.kind)).toEqual(['new', 'hidden']);
  });
  it('the plan can put a run into a page that is there, or name the new page its own way', () => {
    const into = build({ runs: { r1: { kind: 'page', page: 'a_general' } }, titles: {} });
    expect(top(into).map((p) => p.name)).toEqual(['file0', 'hidden', 'a_general']);
    const named = build({ runs: { r1: { kind: 'new', title: 'B. Supplemental Data for Entities (Entities Only)' } }, titles: {} });
    expect(top(named)[3].title).toBe('B. Supplemental Data for Entities (Entities Only)');
  });
  it('a page the annotation never titled is named from the heading, and a name the plan gives wins', () => {
    const r = build();
    expect(r.structure.pages.find((p) => p.name === 'a_general')).toMatchObject({ title: 'A. General Information', source: 'heading' });
    const given = build({ runs: {}, titles: { a_general: { title: 'General Information (Investors)' } } });
    expect(top(given)[2].title).toBe('General Information (Investors)');
  });
});

describe('defaultRuns', () => {
  it('makes a run of neighbours under the same heading and leaves a run with no heading to the page before it', () => {
    const headings = pdfHeadings([page(0, [0.1, 'A. First'], [0.5, 'SECOND SECTION'])]);
    const runs = defaultRuns(headings, [{ id: 'p', name: 'p', start: { page: 0, top: 0.2 } }], [
      { id: 'a', name: 'a', type: 'PdfTextFieldDTO', at: { page: 0, top: 0.3 }, text: '', signer: false },
      { id: 'b', name: 'b', type: 'PdfTextFieldDTO', at: { page: 0, top: 0.6 }, text: '', signer: false },
    ]);
    expect(runs.map((r) => [r.items.map((i) => i.name), r.action])).toEqual([[['a'], { kind: 'page', page: 'p' }], [['b'], { kind: 'new', title: 'SECOND SECTION', headingId: 'h2' }]]);
  });
});

describe('an alias as words', () => {
  const vocab = vocabularyOf(['CONSENT FOR THE PROCESSING OF SENSITIVE PERSONAL INFORMATION', 'Qualified client status', 'Beneficial ownership information']);
  it('splits a glued alias with the words the document uses, and leaves what it cannot split', () => {
    expect(splitGlued('sensitivepersonalinformation', vocab)).toEqual(['sensitive', 'personal', 'information']);
    expect(splitGlued('qualifiedclientstatus', vocab)).toEqual(['qualified', 'client', 'status']);
    expect(splitGlued('zzzqqqxxxyyy', vocab)).toBeNull();
    expect(splitGlued('information', vocab)).toBeNull();
  });
});
