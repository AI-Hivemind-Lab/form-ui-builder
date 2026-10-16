import { describe, expect, it } from 'vitest';
import { loadForm } from '../model/loadForm';
import annotation from './__fixtures__/entity-annotation.json';
import expectedForm from './__fixtures__/entity-form-content.json';
import expectedWarnings from './__fixtures__/entity-warnings.json';
import { AnnotationError, annotationToForm, itemNameOf, nestBullets } from './annotationToForm';

describe('annotationToForm (Entity Self-Certification)', () => {
  const result = annotationToForm(JSON.stringify(annotation));

  it('matches the approved snapshot', () => {
    expect(result.form).toEqual(expectedForm);
  });
  it('reports the same warnings, in the same order (the fund name warning aside)', () => {
    expect(result.warnings.filter((w) => !w.startsWith('FUND NAME MISSING'))).toEqual(expectedWarnings);
  });
  it('maps every annotated field exactly once', () => {
    expect(result.stats).toMatchObject({ annotatedFields: 98, unmappedFields: [], unknownMappings: [], fieldsBelow: 19 });
  });
  it('gives every annotated field a box on its page', () => {
    expect(Object.keys(result.anchors)).toHaveLength(98);
    expect(Object.values(result.anchors).every((a) => a.right > a.left && a.bottom > a.top && a.page >= 0)).toBe(true);
  });
  it('loads into the app', () => {
    const doc = loadForm(result.form);
    expect(doc.schema.properties.map((n) => n.name)).toEqual(['file0', 'citco_crs']);
  });
});

describe('fund name', () => {
  const headerUi = (form: Record<string, unknown>) => {
    const ui = (form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
    return Object.values(ui).filter((u) => u['ui:widget'] === 'Header');
  };
  it('becomes the subtitle of every page heading', () => {
    const r = annotationToForm(JSON.stringify(annotation), { fundName: '  Valeas Demo Fund ' });
    const headers = headerUi(r.form);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.every((h) => h['ui:subtitle'] === 'Valeas Demo Fund')).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('FUND NAME MISSING'))).toBe(false);
  });
  it('warns, and invents nothing, when no fund name is given', () => {
    const r = annotationToForm(JSON.stringify(annotation));
    expect(headerUi(r.form).every((h) => !('ui:subtitle' in h))).toBe(true);
    expect(r.warnings.filter((w) => w.startsWith('FUND NAME MISSING'))).toHaveLength(1);
  });
});

describe('annotationToForm errors', () => {
  it('rejects non-JSON and non-annotation files with a clear message', () => {
    expect(() => annotationToForm('{nope')).toThrow(AnnotationError);
    expect(() => annotationToForm('{"a":1}')).toThrow(/pdfObjectDTO/);
    expect(() => annotationToForm('{"pdfObjectDTO":[]}')).toThrow(/page object/);
  });
});

type Obj = Record<string, unknown>;
const box = (top: number, left = 0.15, page = 0) => ({ area: { left, top, right: left + 0.2, bottom: top + 0.02 }, pageIndex: page });
const label = (of: string, text: string): Obj[] => [{ id: `l-${of}`, __typename__: 'PdfTextLabelDTO', labelOf: of, children: [], content: [1, text] }];
const build = (objects: Obj[]) => annotationToForm(JSON.stringify({ fileName: 'f.pdf', pdfObjectDTO: objects }), { fundName: 'Test Fund' });
type Ui = Record<string, Record<string, unknown>>;
const uiOf = (r: ReturnType<typeof build>) => (r.form.namespaceFormSchemaMap as { main: { uiSchema: Ui } }).main.uiSchema;

describe('annotationToForm: other annotation shapes', () => {
  const objects: Obj[] = [
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['emb', 'grp', 'yn', 'ifyes', 'sign'] },
    ...label('pg', 'I. Bank Account'),
    { id: 'emb', __typename__: 'PdfEmbeddedFileFieldDTO', name: 'sa', fileName: 'Agreement.pdf' },
    { id: 'grp', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'types', children: ['c1', 'c2'] },
    ...label('grp', 'Type — check all that apply:'),
    { id: 'c1', __typename__: 'PdfCheckboxFieldDTO', name: 'individual', ...box(0.1) },
    ...label('c1', 'Individual'),
    { id: 'c2', __typename__: 'PdfCheckboxFieldDTO', name: 'entity', ...box(0.15) },
    ...label('c2', 'Entity'),
    { id: 'yn', __typename__: 'PdfRadioGroupFieldDTO', name: 'sub', children: ['y', 'n'] },
    ...label('yn', 'Is it a subsidiary?'),
    { id: 'y', __typename__: 'PdfRadioFieldDTO', name: 'yes_sub', ...box(0.3, 0.15) },
    { id: 'n', __typename__: 'PdfRadioFieldDTO', name: 'no_sub', ...box(0.3, 0.45) },
    { id: 'ifyes', __typename__: 'PdfTextFieldDTO', name: 'parent', ...box(0.34, 0.15) },
    ...label('ifyes', 'If Yes, provide the parent name:'),
    { id: 'sign', __typename__: 'PdfSignatureFieldDTO', name: 'sig', ...box(0.5) },
    { id: 'loose', __typename__: 'PdfTextFieldDTO', name: 'stray', ...box(0.9, 0.15, 3) },
    ...label('loose', 'Stray field'),
  ];
  const r = build(objects);
  const ui = uiOf(r);

  it('builds an embedded PDF from the annotation', () => {
    expect(ui.sa).toMatchObject({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Agreement.pdf', 'ui:pdfMapping': ['sa'] });
  });
  it('builds a checkbox group with options and the page heading with the fund name', () => {
    expect(ui.types['ui:widget']).toBe('MultipleCheckbox');
    expect((ui.types['ui:multipleOption'] as { options: unknown[][] }).options.map((o) => o[0])).toEqual(['individual', 'entity']);
    const header = Object.values(ui).find((u) => u['ui:widget'] === 'Header');
    expect(header).toMatchObject({ 'ui:heading': 'I. Bank Account', 'ui:subtitle': 'Test Fund' });
  });
  it('labels yes_/no_ options from their alias', () => {
    const opts = (ui.sub['ui:multipleOption'] as { options: [string, { formattedText: string; fieldsBelow?: string[] }][] }).options;
    expect(opts.map((o) => o[1].formattedText)).toEqual(['<p>Yes</p>', '<p>No</p>']);
    expect(r.warnings.some((w) => w.startsWith('LABEL MISSING: option'))).toBe(false);
  });
  it('keeps an "If Yes" field independent and indented 24px, never tagged below a Yes/No option', () => {
    const opts = (ui.sub['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(opts.every((o) => o[1].fieldsBelow === undefined)).toBe(true);
    expect(ui.parent['ui:indentation']).toBe('24px');
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: parent applies only when "Is it a subsidiary?" is Yes'))).toBe(true);
  });
  it('requires radio groups, fields below (even with "If" wording) and single checkboxes', () => {
    expect(ui.sub['ui:required']).toBe('This field is required');
    expect(ui.parent['ui:required']).toBe('This field is required');
    expect(String(ui.sub['ui:formattedText'])).toContain('*');
  });
  it('parks objects outside any page in the hidden page, flagged, instead of making a page for them', () => {
    const pages = (r.form.namespaceFormSchemaMap as { main: { schema: { properties: { name: string; title: string }[] } } }).main.schema.properties;
    expect(pages.map((p) => p.name)).toEqual(['file0', 'hidden', 'pg']);
    expect(pages[1].title).toBe('Hidden');
    expect((r.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema.hidden).toMatchObject({ 'ui:widget': 'Page', 'ui:invisible': true });
    expect(r.warnings.some((w) => w.startsWith('UNASSIGNED: 1 objects') && w.includes('hidden page'))).toBe(true);
  });
  it('maps every annotated field, checkboxes included', () => {
    expect(r.stats.unmappedFields).toEqual([]);
    expect(r.anchors.individual).toBeDefined();
  });
  it('skips unsupported objects with a warning instead of failing', () => {
    const odd = build([
      { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['x'] },
      { id: 'x', __typename__: 'PdfMysteryFieldDTO', name: 'mystery' },
    ]);
    expect(odd.warnings).toContain('UNSUPPORTED: PdfMysteryFieldDTO mystery was skipped');
  });
});

describe('annotationToForm: groups of pages', () => {
  const objects: Obj[] = [
    { id: 'sec', __typename__: 'PdfGroupFieldDTO', name: 'sec', children: ['p1', 'p2'] },
    ...label('sec', 'INVESTOR QUESTIONNAIRE'),
    { id: 'p1', __typename__: 'PdfPageFieldDTO', name: 'p1', children: ['a', 'grp'] },
    ...label('p1', 'I. General Information'),
    { id: 'a', __typename__: 'PdfTextFieldDTO', name: 'a', ...box(0.1, 0.4, 5) },
    ...label('a', 'Name:'),
    { id: 'grp', __typename__: 'PdfGroupFieldDTO', name: 'grp', children: ['nested'] },
    { id: 'nested', __typename__: 'PdfParagraphFieldDTO', name: 'paragraph', children: [], content: [1, 'A note inside a group'] },
    { id: 'p2', __typename__: 'PdfPageFieldDTO', name: 'p2', children: ['b'] },
    ...label('p2', 'II. Address'),
    { id: 'b', __typename__: 'PdfTextFieldDTO', name: 'b', ...box(0.1, 0.4, 6) },
    ...label('b', 'Street:'),
  ];
  const r = build(objects);
  type TopNode = { name: string; title: string; properties?: TopNode[] };
  const top = (r.form.namespaceFormSchemaMap as { main: { schema: { properties: TopNode[] } } }).main.schema.properties;

  it('makes a group of pages a section holding its pages, named after its text', () => {
    expect(top.map((n) => n.name)).toEqual(['file0', 'sec']);
    expect(top[1].title).toBe('INVESTOR QUESTIONNAIRE');
    expect(top[1].properties?.map((n) => n.name)).toEqual(['p1', 'p2']);
    expect(top[1].properties?.map((n) => n.title)).toEqual(['I. General Information', 'II. Address']);
  });
  it('does not skip pages or show section text on the pages', () => {
    expect(r.warnings.filter((w) => w.startsWith('UNSUPPORTED') || w.startsWith('UNASSIGNED'))).toEqual([]);
    expect(uiOf(r).sec['ui:formattedText']).toBeUndefined();
  });
  it('takes a page title only from a title paragraph directly on the page, not one nested in a group', () => {
    expect(top[1].properties?.[0].title).toBe('I. General Information');
  });
});

describe('annotationToForm: required rules', () => {
  const objects: Obj[] = [
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['cond', 'opt', 'lead', 'ga', 'gb', 'gc', 'q', 'qs'] },
    ...label('pg', 'Page'),
    { id: 'cond', __typename__: 'PdfTextFieldDTO', name: 'cond', ...box(0.1, 0.4) },
    ...label('cond', 'If the Entity has a parent, provide its name:'),
    { id: 'opt', __typename__: 'PdfTextFieldDTO', name: 'opt', ...box(0.15, 0.4) },
    ...label('opt', 'Fax (optional):'),
    { id: 'lead', __typename__: 'PdfParagraphFieldDTO', name: 'lead', children: [], content: [1, 'Check the categories that apply:'], ...box(0.2) },
    { id: 'ga', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'ga', children: ['ca'] },
    ...label('ga', 'A. Individuals:'),
    { id: 'ca', __typename__: 'PdfCheckboxFieldDTO', name: 'ca', ...box(0.25) },
    ...label('ca', 'Natural person'),
    { id: 'gb', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'gb', children: ['cb'] },
    ...label('gb', 'B. Entities:'),
    { id: 'cb', __typename__: 'PdfCheckboxFieldDTO', name: 'cb', ...box(0.3) },
    ...label('cb', 'Company'),
    { id: 'gc', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'gc', children: ['cc'] },
    ...label('gc', 'C. Trusts:'),
    { id: 'cc', __typename__: 'PdfCheckboxFieldDTO', name: 'cc', ...box(0.35) },
    ...label('cc', 'Trust'),
    { id: 'q', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'q', children: ['cq'] },
    ...label('q', 'I confirm the above is true.'),
    { id: 'cq', __typename__: 'PdfCheckboxFieldDTO', name: 'cq', ...box(0.45) },
    ...label('cq', 'Confirmed'),
    { id: 'qs', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'qs', children: ['cs'] },
    ...label('qs', 'Other notes (if any):'),
    { id: 'cs', __typename__: 'PdfCheckboxFieldDTO', name: 'cs', ...box(0.5) },
    ...label('cs', 'Noted'),
  ];
  const r = build(objects);
  const ui = uiOf(r);

  it('keeps conditional wording required and lists the condition for a rule', () => {
    expect(ui.cond['ui:required']).toBe('This field is required');
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: cond applies only when'))).toBe(true);
  });
  it('makes a field optional only on an explicit marker', () => {
    expect(ui.opt['ui:required']).toBeUndefined();
    expect(ui.qs['ui:required']).toBeUndefined();
  });
  it('requires a checkbox group by default', () => {
    expect(ui.q['ui:required']).toBe('This field is required');
  });
  it('keeps the boxes of a split list optional, stars the paragraph before it and lists a rule', () => {
    ['ga', 'gb', 'gc'].forEach((g) => expect(ui[g]['ui:required']).toBeUndefined());
    expect(String(ui.lead['ui:formattedText'])).toContain('*');
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: at least one box must be checked among ga, gb, gc'))).toBe(true);
  });
});

describe('annotationToForm: questions beside a group stay in PDF order', () => {
  // A group holds the heading and question c; questions a and b sit beside it but lie between its first and last object.
  const q = (id: string, top: number, text: string): Obj[] => [
    { id, __typename__: 'PdfTextFieldDTO', name: id, ...box(top, 0.4, 5) },
    ...label(id, text),
  ];
  const objects: Obj[] = [
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['grp', 'qa', 'qb', 'after'] },
    ...label('pg', 'Page'),
    { id: 'grp', __typename__: 'PdfGroupFieldDTO', name: 'grp', children: ['qc1', 'qc2'] },
    { id: 'l-grp', __typename__: 'PdfTextLabelDTO', labelOf: 'grp', children: ['blk-grp'], content: [1, '3. Volcker Rule'] },
    { id: 'blk-grp', __typename__: 'PdfTextBlockDTO', pageIndex: 5, area: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.12 } },
    ...q('qa', 0.2, 'a) First question'),
    ...q('qb', 0.3, 'b) Second question'),
    ...q('qc1', 0.5, 'c1) Third question'),
    ...q('qc2', 0.6, 'c2) Fourth question'),
    ...q('after', 0.9, 'Later question'),
  ];
  const r = build(objects);
  type TopNode = { name: string; properties?: TopNode[] };
  const page = (r.form.namespaceFormSchemaMap as { main: { schema: { properties: TopNode[] } } }).main.schema.properties[1];
  it('moves a sibling lying inside a group span into the group, keeping the PDF order, and says so', () => {
    const body = page.properties?.filter((n) => !n.name.startsWith('gen_header')) ?? [];
    expect(body.map((n) => n.name)).toEqual(['grp', 'after']);
    expect(body[0].properties?.map((n) => n.name)).toEqual(['qa', 'qb', 'qc1', 'qc2']);
    expect(r.warnings.some((w) => w.startsWith('REORDERED: qa, qb'))).toBe(true);
  });
});

describe('annotationToForm: custom formats from the data schema', () => {
  const field = (id: string, text: string | null, top: number): Obj[] => [
    { id, __typename__: 'PdfTextFieldDTO', name: id, ...box(top, 0.4, 5) },
    ...(text ? label(id, text) : []),
  ];
  const r = build([
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['aba', 'both', 'swift', 'iban', 'zip', 'giin', 'giinname', 'giinalias', 'plain'] },
    ...label('pg', 'Page'),
    ...field('aba', 'Bank ABA/Routing Number:', 0.1),
    ...field('both', 'ABA, Chips or Swift Number:', 0.15),
    ...field('swift', 'SWIFT code:', 0.2),
    ...field('iban', 'IBAN:', 0.25),
    ...field('zip', 'ZIP Code:', 0.3),
    ...field('giin', 'GIIN:', 0.35),
    ...field('giinname', 'Name of the Sponsoring Entity:', 0.4),
    ...field('asa_giin_x', null, 0.45).map((o) => ('name' in o ? { ...o, id: 'giinalias', name: 'asa_giin_x' } : { ...o, labelOf: 'giinalias' })),
    ...field('plain', 'Telephone:', 0.5),
  ]);
  const nodes = (r.form.namespaceFormSchemaMap as { main: { schema: { properties: { properties: { name: string; format?: string }[] }[] } } }).main.schema.properties[1].properties;
  const format = (n: string) => nodes.find((x) => x.name === n)?.format;
  it('puts the Anduin format in the schema (and ui:customFormat) for fields that should validate', () => {
    expect(format('aba')).toBe('ABA');
    expect(format('swift')).toBe('SWIFT');
    expect(format('iban')).toBe('IBAN');
    expect(format('zip')).toBe('USZIP');
    expect(format('giin')).toBe('GIIN');
    expect(format('asa_giin_x')).toBe('GIIN');
    expect(uiOf(r).aba).toMatchObject({ 'ui:widget': 'CustomFormat', 'ui:customFormat': 'ABA' });
    expect(uiOf(r).giin['ui:placeholder']).toBe('e.g. XXXXXX.XXXXX.XX.XXX');
  });
  it('leaves ambiguous and unrelated fields as plain text boxes', () => {
    expect(format('both')).toBeUndefined();
    expect(format('giinname')).toBeUndefined();
    expect(format('plain')).toBeUndefined();
    expect(uiOf(r).giinname['ui:widget']).toBe('TextBox');
  });
});

describe('annotationToForm: address block layout', () => {
  const r = build([
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['addr'] },
    ...label('pg', 'Page'),
    { id: 'addr', __typename__: 'PdfGroupFieldDTO', name: 'addr', children: ['c', 's', 'ci', 'st', 'zp'] },
    ...label('addr', 'Registered Address'),
    { id: 'c', __typename__: 'PdfTextFieldDTO', name: 'country_x', ...box(0.10, 0.4, 5) }, ...label('c', 'Country'),
    { id: 's', __typename__: 'PdfTextFieldDTO', name: 's_street', ...box(0.15, 0.4, 5) }, ...label('s', 'Address'),
    { id: 'ci', __typename__: 'PdfTextFieldDTO', name: 'ci_city', ...box(0.20, 0.4, 5) }, ...label('ci', 'City'),
    { id: 'st', __typename__: 'PdfTextFieldDTO', name: 'st_state', ...box(0.25, 0.4, 5) }, ...label('st', 'State'),
    { id: 'zp', __typename__: 'PdfTextFieldDTO', name: 'zp_postcode', ...box(0.30, 0.4, 5) }, ...label('zp', 'Postal Code'),
  ]);
  type N = { name: string; properties?: N[] };
  const nodes = (r.form.namespaceFormSchemaMap as { main: { schema: { properties: N[] } } }).main.schema.properties;
  const ui = (r.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
  const find = (list: N[]): N | undefined => { for (const n of list) { if (n.name === 'addr') return n; const hit = find(n.properties ?? []); if (hit) return hit; } return undefined; };
  const group = find(nodes);
  it('lays the block out like the Anduin address: Country at half width, then rows of two at 70% / 30%', () => {
    expect(group?.properties?.map((n) => n.name)).toEqual(['country_x', 'addr_row_street_city', 'addr_row_us_state_zip', 'addr_row_state_postal']);
    expect(group?.properties?.slice(1).map((n) => n.properties?.length)).toEqual([2, 2, 2]);
    expect(ui.addr_row_street_city).toMatchObject({ 'ui:widget': 'Group', 'ui:dynamicLayout': { sectionsWidth: [70, 30], gutter: 8 }, 'ui:indentation': '16px' });
    expect(ui.country_x).toMatchObject({ 'ui:width': '50%', 'ui:indentation': '16px' });
    expect(ui.s_street['ui:marginBottom']).toBe('0px');
  });
});

describe('annotationToForm: Client A review rules', () => {
  const field = (id: string, text: string, top: number, name = id): Obj[] => [{ id, __typename__: 'PdfTextFieldDTO', name, ...box(top, 0.4) }, ...label(id, text)];
  const r = build([
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['q', 'res', 'cc', 'q2', 'plain'] },
    ...label('pg', 'Page'),
    { id: 'q', __typename__: 'PdfRadioGroupFieldDTO', name: 'q', children: ['qy', 'qn'] },
    { id: 'qy', __typename__: 'PdfRadioFieldDTO', name: 'qy', ...box(0.1, 0.1) }, ...label('qy', 'Yes'),
    { id: 'qn', __typename__: 'PdfRadioFieldDTO', name: 'qn', ...box(0.1, 0.3) }, ...label('qn', 'No'),
    ...label('q', '18. Is the Investor or any Investor Party, if applicable, an EEA Investor?'),
    ...field('res', '5. State of Residency Where Investor Files its State Income Tax Returns (if a U.S. person for U.S. federal income tax purposes):', 0.2, 'stateofresidency_x'),
    { id: 'cc', __typename__: 'PdfRepeatableFieldDTO', name: 'cc', maxLength: 2, children: ['cn', 'cn2'] },
    ...label('cc', 'Contact Person(s) for Capital Call and Distribution Notices:'),
    ...field('cn', 'Name:', 0.3, 'name_cc'), ...field('cn2', 'Name:', 0.35, 'name_cc_0'),
    { id: 'q2', __typename__: 'PdfRadioGroupFieldDTO', name: 'q2', children: ['q2y', 'q2n'] },
    { id: 'q2y', __typename__: 'PdfRadioFieldDTO', name: 'q2y', ...box(0.45, 0.1) }, ...label('q2y', 'Yes'),
    { id: 'q2n', __typename__: 'PdfRadioFieldDTO', name: 'q2n', ...box(0.45, 0.3) }, ...label('q2n', 'No'),
    ...label('q2', '19. Mailing address (optional)?'),
    ...field('plain', 'Fax number, if known', 0.6),
  ]);
  const ui = (r.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
  it('keeps a question required when "if applicable" is inside it, and makes only an explicit "(optional)" question optional', () => {
    expect(ui.q['ui:required']).toBe('This field is required');
    expect(ui.q2['ui:required']).toBeUndefined();
  });
  it('makes a field with a parenthetical "(if a U.S. person ...)" optional, as the US state widget', () => {
    expect(ui.stateofresidency_x['ui:widget']).toBe('State');
    expect(ui.stateofresidency_x['ui:required']).toBeUndefined();
    expect(ui.plain['ui:required']).toBeUndefined();
  });
  it('names what a repeatable row is, so the button does not say "row"', () => {
    expect(ui.cc['ui:repeatableText']).toBe('contact');
  });
});

describe('itemNameOf', () => {
  it('derives the row name from the heading, or keeps the default', () => {
    expect(itemNameOf('Contact Person(s) for Financial Information and Reporting:')).toBe('contact');
    expect(itemNameOf('The following individuals and/or entities have been duly authorized to instruct:')).toBe('person or entity');
    expect(itemNameOf('Direct beneficial owners')).toBe('beneficial owner');
    expect(itemNameOf('Something else entirely')).toBeNull();
  });
});

describe('annotationToForm: nested fields below options', () => {
  const cb = (id: string, text: string, top: number, left: number): Obj[] => [{ id, __typename__: 'PdfCheckboxFieldDTO', name: id, ...box(top, left) }, ...label(id, text)];
  const r = build([
    { id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['main', 'lic', 't1', 't2'] },
    ...label('pg', 'Page'),
    { id: 'main', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'main', children: ['a', 'c', 'd'] },
    ...label('main', 'FOR INDIVIDUALS:'),
    ...cb('a', '(A) First', 0.30, 0.1), ...cb('c', '(C) A licence holder', 0.40, 0.1), ...cb('d', '(D) Last', 0.60, 0.1),
    { id: 'lic', __typename__: 'PdfMultipleCheckboxesFieldDTO', name: 'lic', children: ['l1', 'l2'] },
    ...cb('l1', 'License held:', 0.45, 0.3), ...cb('l2', 'CRD number:', 0.50, 0.3),
    { id: 't1', __typename__: 'PdfTextFieldDTO', name: 't1', ...box(0.448, 0.6) },
    { id: 't2', __typename__: 'PdfTextFieldDTO', name: 't2', ...box(0.498, 0.6) },
  ]);
  const ui = (r.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
  const below = (q: string, value: string): unknown => ((ui[q]['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options.find((o) => o[0] === value)?.[1].fieldsBelow);
  it('puts the licence list under option (C), and each licence line under its own checkbox even though its box starts a hair higher', () => {
    expect(below('main', 'c')).toEqual(['lic']);
    expect(below('lic', 'l1')).toEqual(['t1']);
    expect(below('lic', 'l2')).toEqual(['t2']);
  });
});

describe('annotationToForm: page headings', () => {
  type N = { name: string; title: string; properties?: N[] };
  const pages = (r: ReturnType<typeof build>) => (r.form.namespaceFormSchemaMap as { main: { schema: { properties: N[] } } }).main.schema.properties.filter((n) => n.name !== 'file0');
  const uiOf = (r: ReturnType<typeof build>) => (r.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
  const para = (id: string, text: string, top: number, name = id): Obj => ({ id, __typename__: 'PdfParagraphFieldDTO', name, children: [], content: [1, text], ...box(top) });

  it('drops the colon at the end of a page title and heading', () => {
    const r = build([{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['t'] }, ...label('pg', 'F. Tax Exempt Status:'),
      { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.3) }, ...label('t', 'Name')]);
    expect(pages(r)[0].title).toBe('F. Tax Exempt Status');
    const header = Object.values(uiOf(r)).find((u) => u['ui:widget'] === 'Header');
    expect(header?.['ui:heading']).toBe('F. Tax Exempt Status');
  });
  it('uses the first paragraph as the heading of a page the annotation never titled', () => {
    const r = build([{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'investor_questionnaire_tax_exempt_status', children: ['p1', 't'] },
      para('p1', 'F. Tax Exempt Status:', 0.1), { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.3) }, ...label('t', 'Name')]);
    const page = pages(r)[0];
    expect(page.title).toBe('F. Tax Exempt Status');
    expect(page.properties?.map((n) => n.name)).not.toContain('p1');
    expect(r.warnings.some((w) => w.startsWith('PAGE HEADING GUESSED') && w.includes('its first paragraph'))).toBe(true);
  });
  it('reads the heading from the PDF above the page\'s first object, else makes the alias readable', () => {
    const objs = [{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'investor_questionnaire_miscellaneous_signature', children: ['t'] }, { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.5, 0.2, 54) }, ...label('t', 'Name')];
    const withPdf = annotationToForm(JSON.stringify({ fileName: 'f.pdf', pdfObjectDTO: objs }), { fundName: 'F', pdfPages: [{ page: 54, text: '', lines: [{ top: 0.1, text: 'I. Miscellaneous' }, { top: 0.3, text: 'The Investor understands that the foregoing information will be relied upon.' }] }] });
    expect(pages(withPdf)[0].title).toBe('I. Miscellaneous');
    const without = build(objs);
    expect(pages(without)[0].title).toBe('Investor Questionnaire Miscellaneous Signature');
  });
  it('makes a percentage question the Percentage widget', () => {
    const r = build([{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'pg', children: ['m'] }, ...label('pg', 'P'),
      { id: 'm', __typename__: 'PdfTextFieldDTO', name: 'maximumpercantage_x', ...box(0.3) }, ...label('m', 'If “Yes”, the maximum percentage of the Investor constituting “plan assets” will be')]);
    expect(uiOf(r).maximumpercantage_x['ui:widget']).toBe('Percentage');
  });
});

describe('nestBullets', () => {
  const li = (t: string) => `<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>${t}</li>`;
  const sub = (t: string) => `<p class="ql-indent-1">o ${t} </p>`;
  const nested = (t: string) => `<li data-list="bullet" class="ql-indent-1"><span class="ql-ui" contenteditable="false"></span>${t}</li>`;
  it('turns typed "o" sub-bullets after a list into nested items of that list, joining the two halves of a split list', () => {
    const html = `<ul>${li('Copy of passport')}${li('For individuals investing through an IRA:')}</ul>${sub('Signed form')}${sub('Certificate')}<ul>${li('Copy of address verification')}</ul>`;
    expect(nestBullets(html)).toBe(`<ul>${li('Copy of passport')}${li('For individuals investing through an IRA:')}${nested('Signed form')}${nested('Certificate')}${li('Copy of address verification')}</ul>`);
  });
  it('keeps a trailing run inside the list and leaves other html alone', () => {
    expect(nestBullets(`<ul>${li('a')}</ul>${sub('b')}`)).toBe(`<ul>${li('a')}${nested('b')}</ul>`);
    expect(nestBullets('<p>Plain text</p>')).toBe('<p>Plain text</p>');
  });
});

describe('box and bullet glyphs drawn in the PDF', () => {
  it('never reach the form, even when the annotation highlighted them with the text', () => {
    const data = structuredClone(annotation) as unknown as { pdfObjectDTO: { __typename__: string; content?: [number, string] }[] };
    const marked: string[] = [];
    data.pdfObjectDTO.forEach((o) => {
      if (o.__typename__ === 'PdfTextLabelDTO' && o.content && o.content[0] === 1 && marked.length < 3) {
        marked.push(o.content[1]);
        o.content = [1, ` ${o.content[1]}`]; // a Wingdings box before the words
      }
    });
    expect(marked.length).toBe(3);
    const json = JSON.stringify(data);
    expect(json).toMatch(/[\uE000-\uF8FF]/);
    const text = JSON.stringify(annotationToForm(json).form);
    expect(text).not.toMatch(/[-]/);
    // the same form as without the glyphs
    expect(annotationToForm(json).form).toEqual(annotationToForm(JSON.stringify(annotation)).form);
  });
});

describe('embedded files in the annotation', () => {
  it('keep the annotation\'s own name and pages: the cut info of the PDF widget, with the file id left to the platform', () => {
    const data = structuredClone(annotation) as unknown as { pdfObjectDTO: { __typename__: string; id: string; name: string; children?: string[]; fileName?: string; startPageIndex?: number; endPageIndex?: number }[] };
    const page = data.pdfObjectDTO.find((o) => o.__typename__ === 'PdfPageFieldDTO') as { children: string[] };
    page.children = ['emb-1', ...page.children];
    data.pdfObjectDTO.push({ __typename__: 'PdfEmbeddedFileFieldDTO', id: 'emb-1', name: 'embedded', fileName: 'Fund - Directions.pdf', startPageIndex: 2, endPageIndex: 7 });
    const form = annotationToForm(JSON.stringify(data)).form as { namespaceFormSchemaMap: { main: { uiSchema: Record<string, Record<string, unknown>> } } };
    const ui = form.namespaceFormSchemaMap.main.uiSchema.embedded;
    expect(ui['ui:widget']).toBe('Pdf');
    expect(ui['ui:embeddedPdf']).toBe('Fund - Directions.pdf');
    expect(ui['ui:pdfCutInfo']).toEqual({ start: 2, end: 7, fileId: '', reviewingFileId: null });
    expect(ui['ui:viewInModal']).toBeUndefined();
  });
});

describe('a repeatable that has choices as well as boxes', () => {
  const text = (id: string, name: string, top: number) => ({ __typename__: 'PdfTextFieldDTO', id, name, area: { left: 0.1, top, right: 0.4, bottom: top + 0.02 }, pageIndex: 0 });
  const radio = (id: string, name: string, left: number, top: number) => ({ __typename__: 'PdfRadioFieldDTO', id, name, area: { left, top, right: left + 0.03, bottom: top + 0.02 }, pageIndex: 0 });
  const group = (id: string, name: string, kids: string[]) => ({ __typename__: 'PdfRadioGroupFieldDTO', id, name, children: kids });
  it('is built with the choice column mapped to the same choice of every row (it used to stop the whole build)', () => {
    const data = structuredClone(annotation) as unknown as { pdfObjectDTO: Record<string, unknown>[] };
    const page = data.pdfObjectDTO.find((o) => o.__typename__ === 'PdfPageFieldDTO') as { children: string[] };
    page.children = ['rep-1', ...page.children];
    data.pdfObjectDTO.push(
      { __typename__: 'PdfRepeatableFieldDTO', id: 'rep-1', name: 'contacts', maxLength: 2, children: ['t0', 't1', 'g0', 'g1'] },
      text('t0', 'contact_name', 0.2), text('t1', 'contact_name_0', 0.3),
      group('g0', 'legal_contact', ['y0', 'n0']), radio('y0', 'yes_legal_contact', 0.5, 0.2), radio('n0', 'no_legal_contact', 0.6, 0.2),
      group('g1', 'legal_contact_0', ['y1', 'n1']), radio('y1', 'yes_legal_contact_0', 0.5, 0.3), radio('n1', 'no_legal_contact_0', 0.6, 0.3),
    );
    const result = annotationToForm(JSON.stringify(data));
    const ui = (result.form.namespaceFormSchemaMap as { main: { uiSchema: Record<string, Record<string, unknown>> } }).main.uiSchema;
    expect(ui.contacts['ui:maxLength']).toBe(2);
    expect(ui.contact_name['ui:pdfMapping']).toEqual(['contact_name', 'contact_name_0']);
    expect(ui.legal_contact['ui:widget']).toBe('Radio');
    expect(ui.legal_contact['ui:pdfMapping']).toEqual(['legal_contact', 'legal_contact_0']);
    const options = (ui.legal_contact['ui:multipleOption'] as { options: [string, { formattedText: string; pdfMappings: string[] }][] }).options;
    expect(options.map((o) => [o[0], o[1].formattedText, o[1].pdfMappings])).toEqual([
      ['yes_legal_contact', '<p>Yes</p>', ['yes_legal_contact', 'yes_legal_contact_0']],
      ['no_legal_contact', '<p>No</p>', ['no_legal_contact', 'no_legal_contact_0']],
    ]);
  });
});

describe('annotationToForm: page order and titles of embedded-file pages', () => {
  type N = { name: string; title: string; properties?: N[] };
  const pages = (r: ReturnType<typeof build>) => (r.form.namespaceFormSchemaMap as { main: { schema: { properties: N[] } } }).main.schema.properties.filter((n) => n.name !== 'file0');
  const embedded = (id: string, fileName: string, start: number, end: number): Obj => ({ id, __typename__: 'PdfEmbeddedFileFieldDTO', name: id, fileName, startPageIndex: start, endPageIndex: end });
  const objs: Obj[] = [
    // the signature page is listed first in the annotation but sits on PDF page 11; the embedded files come before it in the PDF
    { id: 'sig', __typename__: 'PdfPageFieldDTO', name: 'sig', children: ['t'] }, ...label('sig', 'Signature Page'), { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.3, 0.1, 10) }, ...label('t', 'Name'),
    { id: 'ins', __typename__: 'PdfPageFieldDTO', name: 'instructionspage', children: ['e1'] }, embedded('e1', 'Fund II Form of Subscription Agreement - Instructions.pdf', 1, 1),
    { id: 'sa', __typename__: 'PdfPageFieldDTO', name: 'subscriptionagreement', children: ['e2'] }, embedded('e2', 'Fund II Form of Subscription Agreement - Subscription Agreement.pdf', 2, 9),
  ];
  const r = build(objs);
  it('puts the pages that hold an embedded file where the file starts in the PDF', () => {
    expect(pages(r).map((n) => n.name)).toEqual(['instructionspage', 'subscriptionagreement', 'sig']);
  });
  it('names such a page after the document, not after its alias', () => {
    expect(pages(r).map((n) => n.title)).toEqual(['Instructions', 'Subscription Agreement', 'Signature Page']);
  });
  it('the paragraph named "paragraph" is the page heading only when it reads like one: a warning is body text, the heading comes from the PDF', () => {
    const warn = build([{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'form_page', children: ['paragraph', 't'] },
      { id: 'paragraph', __typename__: 'PdfParagraphFieldDTO', name: 'paragraph', children: [], content: [2, '<p><strong>WARNING! </strong></p><p><strong>This investment is risky. Do not invest unless you can afford to lose all the money you pay for this investment.</strong></p>'], ...box(0.2, 0.3, 3) },
      { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.5, 0.2, 3) }, ...label('t', 'Name')]);
    const page = pages(warn)[0];
    expect(page.properties?.map((n) => n.name)).toContain('paragraph');
    expect(page.title).not.toMatch(/WARNING/i);
    const title = build([{ id: 'pg', __typename__: 'PdfPageFieldDTO', name: 'form_page', children: ['paragraph', 't'] },
      { id: 'paragraph', __typename__: 'PdfParagraphFieldDTO', name: 'paragraph', children: [], content: [1, 'Schedule C Investor Information'], ...box(0.1, 0.3, 3) },
      { id: 't', __typename__: 'PdfTextFieldDTO', name: 't', ...box(0.5, 0.2, 3) }, ...label('t', 'Name')]);
    expect(pages(title)[0].title).toBe('Schedule C Investor Information');
  });
});
