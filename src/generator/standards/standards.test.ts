import { describe, expect, it } from 'vitest';
import { loadForm } from '../../model/loadForm';
import annotation from '../__fixtures__/entity-annotation.json';
import { applyDecisions } from '../ai/apply';
import { buildForm } from '../buildForm';
import { capitalizeLabel } from './capitalize';
import { layoutFor } from './optionLayouts';
import { runStandards, STANDARDS } from './index';
import { documentAcronyms, titleCase } from './titleCase';
import type { StandardContext } from './types';

type Ui = Record<string, Record<string, unknown>>;
type Node = { name: string; title: string; properties?: Node[] };
const top = (form: Record<string, unknown>) => (form.namespaceFormSchemaMap as { main: { schema: { properties: Node[] } } }).main.schema.properties;
const uiOf = (form: Record<string, unknown>) => (form.namespaceFormSchemaMap as { main: { uiSchema: Ui } }).main.uiSchema;

const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const run = (doc: ReturnType<typeof raw>, anchors: StandardContext['anchors'] = {}, ids?: string[], texts: string[] = []) => {
  const changes: string[] = [];
  const warns: string[] = [];
  const ctx: StandardContext = { doc, anchors, texts, log: (m) => changes.push(m), warn: (m) => warns.push(m) };
  runStandards(ctx, ids ? ['hidden-page', 'tax-forms', 'gp-filled-fields', 'signature-fields', 'signature-groups', 'option-layouts', 'title-case'].filter((x) => !ids.includes(x)) : []);
  return { doc: ctx.doc, changes, warns };
};
const box = (page: number, top: number) => ({ page, left: 0.1, top, right: 0.5, bottom: top + 0.02 });

describe('hidden page', () => {
  it('moves the File into a hidden page that is also hidden from the TOC, first in the form', () => {
    const doc = raw([{ name: 'file0', type: 'null', title: 'a.pdf' }, { name: 'pg', type: 'object', title: 'P', properties: [] }], { file0: { 'ui:widget': 'File', 'ui:fileName': 'a.pdf' }, pg: { 'ui:widget': 'Page' } });
    const { doc: out } = run(doc, {}, ['hidden-page']);
    expect(out.schema.properties.map((n) => n.name)).toEqual(['hidden', 'pg']);
    expect(out.schema.properties[0].properties?.map((n) => n.name)).toEqual(['file0']);
    expect(out.uiSchema.hidden).toMatchObject({ 'ui:widget': 'Page', 'ui:invisible': true });
  });
});

describe('hidden page with stray objects', () => {
  it('puts the PDF file into the hidden page the importer already made, not a second one', () => {
    const doc = raw(
      [{ name: 'file0', type: 'null', title: 'a.pdf' }, { name: 'hidden', type: 'object', title: 'Hidden', properties: [{ name: 'stray', type: 'string', title: 's' }] }, { name: 'pg', type: 'object', title: 'P', properties: [] }],
      { file0: { 'ui:widget': 'File' }, hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, stray: { 'ui:widget': 'TextBox' }, pg: { 'ui:widget': 'Page' } },
    );
    const { doc: out } = run(doc, {}, ['hidden-page']);
    expect(out.schema.properties.map((n) => n.name)).toEqual(['hidden', 'pg']);
    expect(out.schema.properties[0].properties?.map((n) => n.name)).toEqual(['file0', 'stray']);
  });
});

describe('signatures', () => {
  const nodes = [{ name: 'pg', type: 'object', title: 'Signature Page', properties: [
    { name: 'signername_a', type: 'string', title: 'n' },
    { name: 'date_a', type: 'string', title: 'd' },
    { name: 'acceptedamount_gp', type: 'string', title: 'Accepted Capital Commitment:' },
    { name: 'sig_a', type: 'null', title: 'Signature' },
    { name: 'signername_b', type: 'string', title: 'n2' },
    { name: 'sig_b', type: 'null', title: 'Signature' },
    { name: 'other', type: 'string', title: 'Other' },
  ] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    signername_a: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['signername_a'] },
    date_a: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['date_a'] },
    acceptedamount_gp: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Accepted Capital Commitment: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:pdfMapping': ['acceptedamount_gp'] },
    sig_a: { 'ui:widget': 'Signature', 'ui:signature': [{ mapping: 'sig_a', signatureType: 'Signature', isOptional: false }] },
    signername_b: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['signername_b'] },
    sig_b: { 'ui:widget': 'Signature', 'ui:signature': [{ mapping: 'sig_b', signatureType: 'Signature', isOptional: false }] },
    other: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['other'] },
  };
  const anchors = {
    signername_a: box(1, 0.1), date_a: box(1, 0.15), acceptedamount_gp: box(1, 0.2), sig_a: box(1, 0.25),
    signername_b: box(1, 0.4), sig_b: box(1, 0.45), other: box(1, 0.9),
  };
  const out = run(raw(nodes, ui), anchors, ['gp-filled-fields', 'signature-fields', 'signature-groups']);
  const page = out.doc.schema.properties[0];
  const sig = (n: string) => out.doc.uiSchema[n] as { 'ui:signature': { mapping: string; signatureType: string }[]; [k: string]: unknown };

  it('moves a GP-filled field into the signature below it and makes that a General Partner signature', () => {
    expect(sig('sig_a')['ui:signatureType']).toBe('GpSignature');
    expect(sig('sig_a')['ui:signatureSigner']).toBe('General Partner Signatory');
    const m = sig('sig_a')['ui:signature'].find((x) => x.mapping === 'acceptedamount_gp') as Record<string, unknown>;
    expect(m).toMatchObject({ signatureType: 'Custom', customTypeConfig: { isCommitmentAmount: true, description: 'Accepted Capital Commitment' } });
    expect(sig('sig_b')['ui:signatureType']).toBeUndefined();
  });
  it('moves the signer date and name into the signature of their own block, by position', () => {
    expect(sig('sig_a')['ui:signature'].map((x) => `${x.mapping}:${x.signatureType}`)).toEqual(['sig_a:Signature', 'acceptedamount_gp:Custom', 'signername_a:Name', 'date_a:Date']);
    expect(sig('sig_b')['ui:signature'].map((x) => `${x.mapping}:${x.signatureType}`)).toEqual(['sig_b:Signature', 'signername_b:Name']);
    expect(out.doc.uiSchema.signername_a).toBeUndefined();
  });
  it('puts the signature widgets in a group at the end of the page and leaves other fields', () => {
    expect(page.properties?.map((n) => n.name)).toEqual(['other', 'pg_signatures']);
    expect(page.properties?.[1].properties?.map((n) => n.name)).toEqual(['sig_a', 'sig_b']);
  });
  it('keeps a GP field where it is, with a warning, when no signature follows', () => {
    const lone = run(raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'acceptedamount_gp', type: 'string', title: 'x' }] }], { pg: { 'ui:widget': 'Page' }, acceptedamount_gp: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Accepted Capital Amount:</p>', 'ui:pdfMapping': ['acceptedamount_gp'] } }), { acceptedamount_gp: box(1, 0.2) }, ['gp-filled-fields']);
    expect(lone.warns.some((w) => w.startsWith('GP FIELD: acceptedamount_gp'))).toBe(true);
    expect(lone.doc.uiSchema.acceptedamount_gp).toBeDefined();
  });
});

describe('option layouts', () => {
  it('chooses Inline, columns or Default from the option texts', () => {
    expect(layoutFor(['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Dr.', 'Other'], false)).toBe('Inline');
    expect(layoutFor(['A', 'B', 'C', 'D', 'E', 'F', 'G'], false)).toBe('TwoColumns');
    expect(layoutFor(Array.from({ length: 13 }, () => 'x'), false)).toBe('ThreeColumns');
    expect(layoutFor(['a very long option that is certainly longer than forty characters', 'No'], false)).toBe('Default');
    expect(layoutFor(['Yes', 'No'], true)).toBe('Default');
    expect(layoutFor(['Yes', 'No'], false)).toBe('Inline');
    expect(layoutFor(['True', 'False', 'N/A'], false)).toBe('Inline');
  });
});

describe('capitalize labels', () => {
  it('capitalises the first letter, after any numbering, but not an enumerator', () => {
    expect(capitalizeLabel('<p>please specify: <span style="color: rgb(219, 55, 55);">*</span></p>')).toBe('<p>Please specify: <span style="color: rgb(219, 55, 55);">*</span></p>');
    expect(capitalizeLabel('<p>5. is the Subscriber…</p>')).toBe('<p>5. Is the Subscriber…</p>');
    expect(capitalizeLabel('<p>Name:</p>')).toBe('<p>Name:</p>');
    expect(capitalizeLabel('<p>a) date of birth</p>')).toBe('<p>a) date of birth</p>');
    expect(capitalizeLabel('<p>(please specify basis for exemption):</p>')).toBe('<p>(Please specify basis for exemption):</p>');
    expect(capitalizeLabel('<p>(i) more than 50%</p>')).toBe('<p>(i) more than 50%</p>');
  });
});

describe('title case', () => {
  it('writes all-caps titles in Title Case, keeping Roman numerals, labels and listed acronyms', () => {
    expect(titleCase('BACKGROUND DOCUMENTATION', new Set())).toBe('Background Documentation');
    expect(titleCase('DIRECTIONS FOR THE COMPLETION OF THE SUBSCRIPTION DOCUMENTS', new Set())).toBe('Directions for the Completion of the Subscription Documents');
    expect(titleCase('VII. PLAN AND BENEFIT PLAN INVESTOR STATUS', new Set())).toBe('VII. Plan and Benefit Plan Investor Status');
    expect(titleCase('EXHIBIT A-1 AML CERTIFICATION FORM FOR LP', new Set())).toBe('Exhibit A-1 AML Certification Form for LP');
    expect(titleCase('EXHIBIT A ADDITIONAL INFORMATION', new Set())).toBe('Exhibit A Additional Information');
  });
  it('leaves a title that already has lower-case letters alone', () => {
    expect(titleCase('I. General Information Regarding the Subscriber:', new Set())).toBe('I. General Information Regarding the Subscriber:');
  });
  it('lets the document settle an acronym, but only when it writes it in capitals in two mixed-case places', () => {
    const acro = documentAcronyms(['The CIC fund shall', 'invest through CIC entities', 'Related Persons ONLY:', 'EVERYTHING IN CAPS']);
    expect(acro.has('CIC')).toBe(true);
    expect(acro.has('ONLY')).toBe(false);
    expect(titleCase('CIC VI SUBSCRIPTION', acro)).toBe('CIC VI Subscription');
  });
});

describe('buildForm on the Entity annotation', () => {
  const built = buildForm(JSON.stringify(annotation), { fundName: 'Test Fund' });
  it('puts the PDF in a hidden first page and groups the signatures at the end of the page', () => {
    expect(top(built.form).map((n) => n.name)).toEqual(['hidden', 'citco_crs']);
    const page = top(built.form)[1];
    expect(page.properties?.[page.properties.length - 1].name).toBe('citco_crs_signatures');
    expect(built.changes.some((c) => c.startsWith('hidden-page'))).toBe(true);
  });
  it('moves date, printed name and position into each signature widget', () => {
    const sig = uiOf(built.form).signature_entity_crs['ui:signature'] as { signatureType: string }[];
    expect(sig.map((s) => s.signatureType).sort()).toEqual(['Date', 'Name', 'Signature', 'Title']);
  });
  it('reports the signer name as missing once per signature, and drops warnings about moved fields', () => {
    expect(built.warnings.filter((w) => w.startsWith('SIGNATURE:')).length).toBe(2);
    expect(built.warnings.some((w) => w.includes('printname_entity_crs'))).toBe(false);
  });
  it('can switch a standard off', () => {
    const off = buildForm(JSON.stringify(annotation), { fundName: 'T', disabledStandards: ['hidden-page', 'tax-forms'] });
    expect(top(off.form).map((n) => n.name)).toEqual(['file0', 'citco_crs']);
  });
});

import { wellFor } from './wells';
import { allWarnings } from '../../model/warnings';
import { idTypesFor, TAX_ID_LABEL } from './taxId';
import { NOT_FOR_EVERYONE } from './naNotes';
import { REVIEW_SENTENCE } from './pdfPages';

describe('info wells', () => {
  it('makes instructions and notices wells and leaves body text alone', () => {
    expect(wellFor('* If you are married and live in a community property state, both you and your spouse must sign.')).toBe('Info');
    expect(wellFor('Please note that a Subscriber may be deemed formed for the purpose.')).toBe('Info');
    expect(wellFor('Warning: do not send cash.')).toBe('Warning');
    expect(wellFor('This Subscription Agreement is made between the Fund and the Subscriber.')).toBeNull();
    expect(wellFor('Please ' + 'x'.repeat(700))).toBeNull();
  });
});

describe('tax id types', () => {
  it('offers only the types the sub-doc mentions, and SSN, EIN and ITIN for a bare Taxpayer ID', () => {
    expect(idTypesFor('2. Taxpayer ID (EIN or social security number):').map((t) => t.format)).toEqual(['SSN', 'EIN']);
    expect(idTypesFor('Taxpayer ID').map((t) => t.format)).toEqual(['SSN', 'EIN', 'ITIN']);
    expect(idTypesFor('Taxpayer Identification Number (ITIN)').map((t) => t.format)).toEqual(['ITIN']);
  });
});

describe('n/a note trigger', () => {
  it('matches questions that do not apply to everyone, not ordinary conditionals', () => {
    expect(NOT_FOR_EVERYONE.test('f) If the Subscriber or the Principal is not a U.S. citizen, provide passport number:')).toBe(true);
    expect(NOT_FOR_EVERYONE.test('If Yes, provide the name:')).toBe(false);
    expect(NOT_FOR_EVERYONE.test('If the Subscriber is an individual, please provide:')).toBe(false);
  });
});

describe('tax id, pdf pages, wells and notes on a small form', () => {
  const nodes = [
    { name: 'pg', type: 'object', title: 'Subscription Agreement', properties: [
      { name: 'hdr', type: 'null', title: 'H' },
      { name: 'name', type: 'string', title: 'Subscriber Name:' },
      { name: 'msg', type: 'null', title: 'm' },
      { name: 'pdf', type: 'null', title: 'sa' },
      { name: 'modalpdf', type: 'null', title: 'm' },
      { name: 'tin', type: 'string', title: 'Taxpayer ID' },
      { name: 'gov', type: 'string', title: 'f' },
    ] },
  ];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' }, hdr: { 'ui:widget': 'Header', 'ui:heading': 'H' },
    name: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Subscriber Name:</p>', 'ui:pdfMapping': ['name'] },
    msg: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>* If you are married, both must sign.</p>' },
    pdf: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'sa.pdf' }, modalpdf: { 'ui:widget': 'Pdf', 'ui:viewInModal': true },
    tin: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>2. Taxpayer ID (EIN or social security number): <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['tin'] },
    gov: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>If the Subscriber is not a U.S. citizen, provide the passport number:</p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['gov'] },
  };
  const out = run(raw(nodes, ui), {}, ['tax-id', 'pdf-pages', 'info-wells', 'na-notes']);
  const names = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];

  it('replaces the plain taxpayer ID box with a radio of ID types with validated boxes below', () => {
    expect(names).toEqual(expect.arrayContaining(['tin_type', 'tin_ssn', 'tin_ein', 'tin_other', 'merged_tin']));
    expect(names).not.toContain('tin');
    const opts = (out.doc.uiSchema.tin_type['ui:multipleOption'] as { options: [string, { fieldsBelow: string[] }][] }).options;
    expect(opts.map((o) => o[0])).toEqual(['ssn', 'ein', 'other']);
    expect(opts[0][1].fieldsBelow).toEqual(['tin_ssn']);
    expect(out.doc.uiSchema.tin_ssn).toMatchObject({ 'ui:widget': 'CustomFormat', 'ui:customFormat': 'SSN', 'ui:placeholder': '___-__-____', 'ui:required': 'This field is required' });
    expect(out.doc.uiSchema.tin_type['ui:required']).toBe('This field is required');
    expect(out.doc.uiSchema.merged_tin).toMatchObject({ 'ui:invisible': true, 'ui:pdfMapping': ['tin'] });
    const other = out.doc.schema.properties[0].properties?.find((n) => n.name === 'tin_other');
    expect(other?.properties?.map((n) => n.name)).toEqual(['tin_other_specify', 'tin_other_note']);
    expect(String(out.doc.uiSchema.tin_other_note['ui:formattedText'])).toContain('Please write "N/A" if not applicable.');
  });
  it('puts the full-page PDF at the top under the heading with the review sentence, and warns about fields on the same page', () => {
    expect(names.slice(0, 3)).toEqual(['hdr', 'pdf_review_note', 'pdf']);
    expect(String(out.doc.uiSchema.pdf_review_note['ui:formattedText'])).toContain(REVIEW_SENTENCE);
    expect(names).toContain('modalpdf');
    expect(names[names.indexOf('modalpdf') - 1]).not.toBe('pdf_review_note');
    expect(out.warns.some((w) => w.startsWith('PAGE MIX: "Subscription Agreement"'))).toBe(true);
  });
  it('makes the instruction paragraph an Info well', () => {
    expect(out.doc.uiSchema.msg['ui:wellType']).toBe('Info');
  });
  it('keeps the review sentence a Default well, never an Info well', () => {
    expect(out.doc.uiSchema.pdf_review_note['ui:wellType']).toBe('Default');
  });
  it('gives the boxes under the ID options no label of their own (the option says it) and no Missing label warning', () => {
    for (const n of ['tin_ssn', 'tin_ein', 'tin_other_specify']) expect(out.doc.uiSchema[n]['ui:formattedText']).toBe('');
    expect(allWarnings(out.doc).filter((w) => /^tin_/.test(w.name))).toEqual([]);
  });
  it('keeps a not-for-everyone question required and puts the orange note right under it', () => {
    expect(out.doc.uiSchema.gov['ui:required']).toBe('This field is required');
    expect(names[names.indexOf('gov') + 1]).toBe('gov_na_note');
  });
});

describe('subscriber name blocks and the community property question', () => {
  const nodes = [
    { name: 'pg', type: 'object', title: 'Questionnaire', properties: [
      { name: 'copy', type: 'string', title: 'Subscriber Name:' },
      { name: 'sub', type: 'string', title: 'n' },
      { name: 'sigcopy', type: 'string', title: 'c' },
      { name: 'entcopy', type: 'string', title: 'e' },
      { name: 'msg', type: 'null', title: 'm' },
      { name: 'types', type: 'array', title: 't', items: { type: 'string', enum: ['i', 'j', 'r'] } },
    ] },
  ];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    copy: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Subscriber Name:</p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['copy'] },
    sub: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>1. Name of Subscriber: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['sub'] },
    sigcopy: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': ['asa_fullname_investorname_generalinfo_0'] },
    entcopy: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': ['fulllegalname_entity_ussignaturepage'] },
    types: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>4. Type of Subscriber:</p>', 'ui:multipleOption': { options: [['i', { formattedText: '<p>Individual</p>' }], ['j', { formattedText: '<p>Joint Tenants</p>' }], ['r', { formattedText: '<p>Individual Retirement Account</p>' }]] } },
    msg: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>* If you are married and live in a community property state, both you and your spouse must sign.</p>' },
  };
  const out = run(raw(nodes, ui), {}, ['subscriber-name', 'community-property']);
  const all: string[] = [];
  const visit = (list: { name: string; properties?: unknown[] }[]): void => list.forEach((n) => { all.push(n.name); visit((n.properties ?? []) as never); });
  visit(out.doc.schema.properties as never);

  it('builds natural person, joint tenants, other individual and entity name blocks where the numbered question was', () => {
    expect(all).toEqual(expect.arrayContaining(['name_blocks', 'name_individuals', 'name_natural_person', 'name_individual', 'firstname', 'middlename', 'lastname', 'suffix', 'name_joint_tenants', 'jointname', 'otherindividualsname', 'entityname', 'mergedname']));
    expect(all).not.toContain('sub');
    // the numbered heading belongs to the individual's blocks; the entity's box carries the number itself
    expect(String(out.doc.uiSchema.name_individuals['ui:formattedText'])).toContain('1. Name of Subscriber:');
    expect(out.doc.uiSchema.name_blocks['ui:formattedText']).toBeUndefined();
    expect(String(out.doc.uiSchema.entityname['ui:formattedText'])).toContain('1. Full Legal Name of Subscriber');
    expect(out.doc.uiSchema.name_individual['ui:dynamicLayout']).toEqual({ sectionsWidth: [33, 33, 34], gutter: 8 });
    expect(out.doc.uiSchema.firstname['ui:required']).toBe('This field is required');
    expect(out.doc.uiSchema.middlename['ui:required']).toBeUndefined();
    expect(out.doc.uiSchema.suffix['ui:required']).toBeUndefined();
    expect(String(out.doc.uiSchema.jointname['ui:formattedText'])).toContain('Joint Subscribers should enter their names in the format &quot;Name 1 and Name 2 JTWROS/TIC/TBE&quot;. E.g. James Smith and Pauline Jones JTWROS.');
    expect(out.doc.uiSchema.entityname['ui:required']).toBe('This field is required');
  });
  it('keeps mergedname hidden right below the natural person boxes, mapped to the subscriber name line and never to an entity name', () => {
    const natural = out.doc.schema.properties[0].properties?.find((n) => n.name === 'name_blocks')?.properties?.[0].properties?.[0];
    expect(natural?.properties?.map((n) => n.name)).toEqual(['name_individual', 'suffix', 'mergedname']);
    expect(out.doc.uiSchema.mergedname).toMatchObject({ 'ui:invisible': true });
    expect(out.doc.uiSchema.mergedname['ui:pdfMapping']).toEqual(['sub', 'copy', 'asa_fullname_investorname_generalinfo_0']);
    for (const n of ['firstname', 'middlename', 'lastname', 'suffix']) expect(out.doc.uiSchema[n]['ui:pdfMapping']).toEqual([]);
    // the suffix lines up with the first / middle / last row above it
    expect(out.doc.uiSchema.suffix['ui:indentation']).toBe('16px');
    expect(out.doc.uiSchema.name_individual['ui:indentation']).toBe('16px');
    expect(out.warns.some((w) => w.startsWith('NEEDS RULE: show name_natural_person'))).toBe(true);
  });
  it('moves a numbered lead-in paragraph into the individual blocks and numbers the entity box the same', () => {
    const lead = raw([{ name: 'pg', type: 'object', title: 'P', properties: [
      { name: 'lead', type: 'null', title: 'l' }, { name: 'sub', type: 'string', title: 'n' }, { name: 'after', type: 'string', title: 'a' },
    ] }], {
      pg: { 'ui:widget': 'Page' },
      lead: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>1. Full Name of Investor: Individual, Partnership, Other:</p>' },
      sub: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of Individual or Entity</p>', 'ui:pdfMapping': ['asa_fullname_investorname_generalinfo'] },
      after: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>2. Address</p>' },
    });
    const r = run(lead, {}, ['subscriber-name']);
    const page = r.doc.schema.properties[0].properties ?? [];
    expect(page.map((n) => n.name)).toEqual(['name_blocks', 'after']);
    expect(page[0].properties?.[0].properties?.[0].name).toBe('lead');
    expect(String(r.doc.uiSchema.entityname['ui:formattedText'])).toContain('1. Full Legal Name of');
  });
  it('maps the entity block, and only it, to the entity name lines', () => {
    expect(out.doc.uiSchema.entityname['ui:pdfMapping']).toContain('fulllegalname_entity_ussignaturepage');
    for (const n of ['jointname', 'otherindividualsname', 'mergedname']) expect(out.doc.uiSchema[n]['ui:pdfMapping']).not.toContain('fulllegalname_entity_ussignaturepage');
    expect(out.doc.uiSchema.jointname['ui:pdfMapping']).toContain('sub');
    expect(all).not.toContain('entcopy');
  });
  it('folds the repeated name line and the signature-page name copies into mergedname instead of keeping them in the form', () => {
    expect(all).not.toContain('copy');
    expect(all).not.toContain('sigcopy');
    expect(out.doc.uiSchema.copy).toBeUndefined();
  });
  it('asks the community property question right above the sub-doc sentence, which stays', () => {
    const list = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];
    expect(list.indexOf('communitypropertystate')).toBe(list.indexOf('msg') - 1);
    expect(out.doc.uiSchema.communitypropertystate).toMatchObject({ 'ui:widget': 'Radio', 'ui:required': 'This field is required', 'ui:fixedLayout': 'Inline' });
    expect(String(out.doc.uiSchema.msg['ui:formattedText'])).toContain('both you and your spouse must sign');
    expect(out.doc.uiSchema.msg['ui:wellType']).toBe('Info');
    // an independent follow-up, never a field below an option (that would stack Yes and No in a column)
    const opts = (out.doc.uiSchema.communitypropertystate['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(opts.every((o) => o[1].fieldsBelow === undefined)).toBe(true);
    expect(out.doc.uiSchema.msg['ui:indentation']).toBe('24px');
    expect(out.doc.uiSchema.communitypropertystate['ui:fixedLayout']).toBe('Inline');
  });
  it('does not ask again when the sub-doc already asks it', () => {
    const asked = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'cp', type: 'string', title: 'q', enum: ['a', 'b'] }, { name: 'msg', type: 'null', title: 'm' }] }], {
      pg: { 'ui:widget': 'Page' }, cp: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Do you live in a community property state?</p>', 'ui:multipleOption': { options: [['a', { formattedText: '<p>Yes</p>' }], ['b', { formattedText: '<p>No</p>' }]] } }, msg: ui.msg,
    });
    expect(run(asked, {}, ['community-property']).doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['cp', 'msg']);
  });
});

describe('signer lines go with the signature their alias names', () => {
  const nodes = [{ name: 'pg', type: 'object', title: 'Signature Page', properties: [
    { name: 'signature_indi_ussignaturepage', type: 'null', title: 'Signature' },
    { name: 'signername_indi_ussignaturepage', type: 'string', title: 'n' },
    { name: 'signature_entity_ussignaturepage', type: 'null', title: 'Signature' },
    { name: 'signername_entity_ussignaturepage', type: 'string', title: 'n2' },
    { name: 'title_entity_ussignaturepage', type: 'string', title: 't' },
  ] }];
  const sigUi = (m: string) => ({ 'ui:widget': 'Signature', 'ui:signature': [{ mapping: m, signatureType: 'Signature', isOptional: false }] });
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    signature_indi_ussignaturepage: sigUi('signature_indi_ussignaturepage'), signature_entity_ussignaturepage: sigUi('signature_entity_ussignaturepage'),
    signername_indi_ussignaturepage: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['signername_indi_ussignaturepage'] },
    signername_entity_ussignaturepage: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['signername_entity_ussignaturepage'] },
    title_entity_ussignaturepage: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['title_entity_ussignaturepage'] },
  };
  // the printed names sit BELOW their own signature lines, so "the first signature below" would pick the wrong one
  const anchors = { signature_indi_ussignaturepage: box(1, 0.1), signername_indi_ussignaturepage: box(1, 0.15), signature_entity_ussignaturepage: box(1, 0.3), signername_entity_ussignaturepage: box(1, 0.35), title_entity_ussignaturepage: box(1, 0.4) };
  it('uses the alias, not the position, and recognises a title line', () => {
    const out = run(raw(nodes, ui), anchors, ['signature-fields']);
    const maps = (n: string) => (out.doc.uiSchema[n]['ui:signature'] as { mapping: string; signatureType: string }[]).map((m) => `${m.mapping}:${m.signatureType}`);
    expect(maps('signature_indi_ussignaturepage')).toEqual(['signature_indi_ussignaturepage:Signature', 'signername_indi_ussignaturepage:Name']);
    expect(maps('signature_entity_ussignaturepage')).toEqual(['signature_entity_ussignaturepage:Signature', 'signername_entity_ussignaturepage:Name', 'title_entity_ussignaturepage:Title']);
  });
});

describe('name block rule after the AI settles the investor type', () => {
  const opt = (v: string, label: string) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '' }];
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'General Information', properties: [
      { name: 'hdr', type: 'null', title: 'H' },
      { name: 'q', type: 'array', title: 'T', items: { type: 'string', enum: ['indiv', 'jt', 'llc'] } },
      { name: 'sub', type: 'string', title: 'n' },
    ] }],
    {
      pg: { 'ui:widget': 'Page' }, hdr: { 'ui:widget': 'Header', 'ui:heading': 'H' },
      q: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>4. Type of Subscriber:</p>', 'ui:multipleOption': { options: [opt('indiv', 'Individual'), opt('jt', 'Joint Tenants'), opt('llc', 'Limited Liability Company')] } },
      sub: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of Subscriber:</p>', 'ui:pdfMapping': ['sub'] },
    },
  );
  it('builds no investor type question on its own, then names which answers open which name block once the AI one is applied', () => {
    const built = run(doc, {}, ['subscriber-name'], ['Joint Tenants']);
    expect(built.doc.schema.properties[0].properties?.map((n) => n.name)).not.toContain('investor_type');
    expect(built.warns.some((w) => w.startsWith('NEEDS RULE: show name_natural_person') && w.includes('no investor type') === false)).toBe(true);
    const decision = { id: 'investor-type', title: 't', detail: 'd', evidence: null, confidence: 'high' as const, defaultAccepted: true, data: { kind: 'investor-type' as const, value: {
      source: 'picklist' as const, selectionMode: 'radio' as const, existingGroupAlias: 'q',
      individual: [{ label: 'Individual', optionAlias: 'indiv' }, { label: 'Joint Tenants', optionAlias: 'jt' }], entity: [{ label: 'Limited Liability Company', optionAlias: 'llc' }], unplaced: [],
    } } };
    const applied = applyDecisions(built.doc, {}, [], [decision]);
    const note = applied.warnings.find((w) => w.startsWith('NEEDS RULE: show name_natural_person when investor_type_individual'));
    expect(note).toContain('Individual (investor_type_individual');
    expect(note).toContain('name_joint_tenants when it is Joint Tenants');
    expect(note).toContain('entityname when investor_type_entity has any choice');
  });
});

describe('yes / no questions', () => {
  const opt = (v: string, label: string, below?: string[]) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '', ...(below ? { fieldsBelow: below } : {}) }];
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'P', properties: [
      { name: 'q', type: 'string', title: 'q', enum: ['y', 'n'] },
      { name: 'other', type: 'string', title: 'o' },
      { name: 'detail', type: 'string', title: 'd' },
    ] }],
    {
      pg: { 'ui:widget': 'Page' },
      q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Are you a US person?</p>', 'ui:fixedLayout': 'Default', 'ui:multipleOption': { options: [opt('y', 'Yes', ['detail']), opt('n', 'No')] } },
      other: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Other</p>' },
      detail: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Details</p>' },
    },
  );
  it('puts what was below an answer right under the question, indented, and keeps Yes and No on one line', () => {
    const out = run(doc, {}, ['yes-no']);
    const options = (out.doc.uiSchema.q['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(options.every((o) => o[1].fieldsBelow === undefined)).toBe(true);
    expect(out.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['q', 'detail', 'other']);
    expect(out.doc.uiSchema.detail['ui:indentation']).toBe('24px');
    expect(out.doc.uiSchema.q['ui:fixedLayout']).toBe('Inline');
    expect(out.warns.some((w) => w.startsWith('NEEDS RULE: show detail only when') && w.endsWith('is Yes'))).toBe(true);
  });
  it('is also enforced after the AI review applies its decisions', () => {
    const r = applyDecisions(doc, {}, [], []);
    expect(r.doc.uiSchema.q['ui:fixedLayout']).toBe('Inline');
    expect(r.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['q', 'detail', 'other']);
  });
  it('moves a question together with its indented follow-ups', () => {
    const d = raw(
      [{ name: 'sa', type: 'object', title: 'A', properties: [{ name: 'pdf', type: 'null', title: 'p' }, { name: 'q', type: 'string', title: 'q', enum: ['y', 'n'] }, { name: 'note', type: 'null', title: 'n' }, { name: 'tail', type: 'string', title: 't' }] },
        { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gh', type: 'null', title: 'GI' }] }],
      {
        sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' }, gi: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'GI' },
        q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Q</p>', 'ui:fixedLayout': 'Inline', 'ui:multipleOption': { options: [opt('y', 'Yes'), opt('n', 'No')] } },
        note: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>note</p>', 'ui:indentation': '24px' },
        tail: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Tail</p>' },
      },
    );
    const decision = { id: 'mv', title: 'mv', detail: '', evidence: null, confidence: 'high' as const, defaultAccepted: true, data: { kind: 'move-fields' as const, aliases: ['q'], targetPage: 'gi', wrapperTitle: 'Subscriber Information' } };
    const r = applyDecisions(d, {}, [], [decision]);
    expect(r.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['pdf', 'tail']);
    const wrapper = r.doc.schema.properties[1].properties?.find((n) => n.name === 'subscriber_information');
    expect(wrapper?.properties?.map((n) => n.name)).toEqual(['q', 'note']);
  });
});

describe('GP and LP name, title and date lines of the signature page', () => {
  const nodes = [{ name: 'pg', type: 'object', title: 'Signature Pages', properties: [
    { name: 'name_signaturepagetosubscriptionagreemen', type: 'string', title: 'n' },
    { name: 'title_signaturepagetosubscriptionagreement', type: 'string', title: 't' },
    { name: 'signature_signaturepagetosubscriptionagreemen', type: 'null', title: 'Signature' },
    { name: 'gpname_acceptanceofsubscription', type: 'string', title: 'gn' },
    { name: 'gptitle_acceptanceofsubscription', type: 'string', title: 'gt' },
    { name: 'gpdate_acceptanceofsubscription', type: 'string', title: 'gd' },
    { name: 'gpsignature_acceptanceofsubscription', type: 'null', title: 'Signature' },
  ] }];
  const sig = (m: string) => ({ 'ui:widget': 'Signature', 'ui:signature': [{ mapping: m, signatureType: 'Signature', isOptional: false }] });
  const text = (a: string, w = 'TextBox') => ({ 'ui:widget': w, 'ui:pdfMapping': [a] });
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    name_signaturepagetosubscriptionagreemen: text('name_signaturepagetosubscriptionagreemen'), title_signaturepagetosubscriptionagreement: text('title_signaturepagetosubscriptionagreement'),
    signature_signaturepagetosubscriptionagreemen: sig('signature_signaturepagetosubscriptionagreemen'),
    gpname_acceptanceofsubscription: text('gpname_acceptanceofsubscription'), gptitle_acceptanceofsubscription: text('gptitle_acceptanceofsubscription'),
    gpdate_acceptanceofsubscription: text('gpdate_acceptanceofsubscription', 'Date'), gpsignature_acceptanceofsubscription: sig('gpsignature_acceptanceofsubscription'),
  };
  const anchors = {
    name_signaturepagetosubscriptionagreemen: box(1, 0.6), title_signaturepagetosubscriptionagreement: box(1, 0.65), signature_signaturepagetosubscriptionagreemen: box(1, 0.5),
    gpname_acceptanceofsubscription: box(2, 0.4), gptitle_acceptanceofsubscription: box(2, 0.45), gpdate_acceptanceofsubscription: box(2, 0.5), gpsignature_acceptanceofsubscription: box(2, 0.35),
  };
  it('puts each line into the signature its alias names, even when the signature sits above it or the alias is truncated', () => {
    const out = run(raw(nodes, ui), anchors, ['signature-fields']);
    const maps = (n: string) => (out.doc.uiSchema[n]['ui:signature'] as { mapping: string; signatureType: string }[]).map((m) => `${m.signatureType}`);
    expect(maps('signature_signaturepagetosubscriptionagreemen')).toEqual(['Signature', 'Name', 'Title']);
    expect(maps('gpsignature_acceptanceofsubscription')).toEqual(['Signature', 'Name', 'Title', 'Date']);
    expect(out.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['signature_signaturepagetosubscriptionagreemen', 'gpsignature_acceptanceofsubscription']);
  });
});

describe('optional by nature', () => {
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: ['fax', 'ref', 'ffc', 'name', 'faxopt'].map((name) => ({ name, type: 'string', title: name })) }];
  const star = ' <span style="color: rgb(219, 55, 55);">*</span>';
  const field = (label: string) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': `<p>${label}${star}</p>`, 'ui:required': 'This field is required' });
  const ui: Ui = { pg: { 'ui:widget': 'Page' }, fax: field('Fax:'), ref: field('Reference:'), ffc: field('For further credit to:'), name: field('Name:'), faxopt: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Fax:</p>' } };
  it('makes fax, reference and for-further-credit boxes optional and leaves other boxes alone', () => {
    const out = run(raw(nodes, ui), {}, ['optional-by-nature']);
    for (const n of ['fax', 'ref', 'ffc']) {
      expect(out.doc.uiSchema[n]['ui:required']).toBeUndefined();
      expect(String(out.doc.uiSchema[n]['ui:formattedText'])).not.toContain('*');
    }
    expect(out.doc.uiSchema.name['ui:required']).toBe('This field is required');
  });
});

describe('name blocks adapt to the sub-doc', () => {
  const nodes = [{ name: 'pg', type: 'object', title: 'General Information', properties: [
    { name: 'intro', type: 'null', title: 'i' },
    { name: 'asa_fullname_investorname_generalinfo', type: 'string', title: 'Name of Individual or Entity' },
  ] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' }, intro: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>1. Full Name of Investor: Individual, Partnership, Corporation:</p>' },
    asa_fullname_investorname_generalinfo: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of Individual or Entity <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['asa_fullname_investorname_generalinfo'] },
  };
  const out = run(raw(nodes, ui), {}, ['subscriber-name'], ['Investor', 'Individual, Partnership, Corporation, Trust, Custodial Account']);
  const names: string[] = [];
  const visit = (list: { name: string; properties?: unknown[] }[]): void => list.forEach((n) => { names.push(n.name); visit((n.properties ?? []) as never); });
  visit(out.doc.schema.properties as never);
  it('splits a box labelled just "Name of Individual or Entity" into an individual group (four boxes) and an entity box, nothing else', () => {
    expect(names).toEqual(expect.arrayContaining(['name_blocks', 'name_natural_person', 'firstname', 'middlename', 'lastname', 'suffix', 'mergedname', 'entityname']));
    expect(names).not.toContain('jointname');
    expect(names).not.toContain('otherindividualsname');
    expect(names).not.toContain('asa_fullname_investorname_generalinfo');
    expect(out.doc.uiSchema.name_blocks['ui:formattedText']).toBeUndefined();
    expect(out.doc.uiSchema.entityname['ui:pdfMapping']).toEqual(['asa_fullname_investorname_generalinfo']);
    expect(String(out.doc.uiSchema.entityname['ui:formattedText'])).toContain('Full Legal Name of Investor');
  });
});

describe('initial blanks, additional pages and specify-other', () => {
  const opt = (v: string, label: string) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '' }];
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: [
    { name: 'initialq', type: 'null', title: 'i' },
    { name: 'us', type: 'string', title: 'us' },
    { name: 'notus', type: 'string', title: 'notus' },
    { name: 'attach', type: 'null', title: 'a' },
    { name: 'sourceoffunds_x', type: 'string', title: 's', enum: ['work', 'other_sourceoffunds_x'] },
    { name: 'specify_other_sourceoffunds_x', type: 'string', title: 'sp' },
  ] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    initialq: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>14. Investor is (initial one blank below):</p>' },
    us: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>A U.S. Person (as defined in the Subscription Agreement); or <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['us'] },
    notus: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Not a U.S. Person (as defined in the Subscription Agreement). <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['notus'] },
    attach: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>(attach additional pages as necessary) Any changes must be accepted in writing.</p>' },
    sourceoffunds_x: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>22. Source of Funds:</p>', 'ui:multipleOption': { options: [opt('work', 'Employment'), opt('other_sourceoffunds_x', 'Other')] } },
    specify_other_sourceoffunds_x: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': ['specify_other_sourceoffunds_x'] },
  };
  const out = run(raw(nodes, ui), {}, ['initial-blanks', 'additional-pages', 'specify-other']);
  const kids = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];

  it('turns "initial one blank below" into a required radio group of the lines, mapped to their PDF lines, saying "check one"', () => {
    expect(kids).toContain('initialq_choice');
    expect(kids).not.toContain('us');
    expect(kids).not.toContain('initialq');
    const radio = out.doc.uiSchema.initialq_choice;
    expect(String(radio['ui:formattedText'])).toContain('14. Investor is (check one):');
    expect(radio['ui:required']).toBe('This field is required');
    const options = (radio['ui:multipleOption'] as { options: [string, { formattedText: string; pdfMappings: string[] }][] }).options;
    expect(options.map((o) => o[0])).toEqual(['us', 'notus']);
    expect(options[0][1].formattedText).toBe('<p>A U.S. Person (as defined in the Subscription Agreement)</p>');
    expect(options[0][1].pdfMappings).toEqual(['us']);
  });
  it('adds a checkbox and an upload below "attach additional pages", the upload shown under the checked box', () => {
    const at = kids.indexOf('attach');
    expect(kids.slice(at + 1, at + 3)).toEqual(['attach_additionalpages', 'attach_additionalpages_files']);
    const options = (out.doc.uiSchema.attach_additionalpages['ui:multipleOption'] as { options: [string, { formattedText: string; fieldsBelow: string[] }][] }).options;
    expect(options[0][1].formattedText).toContain('Check this box if you would like to submit additional pages');
    expect(options[0][1].fieldsBelow).toEqual(['attach_additionalpages_files']);
    expect(out.doc.uiSchema.attach_additionalpages_files['ui:widget']).toBe('FileGroup');
  });
  it('shows the specify box below the option Other of the question it is named after', () => {
    const options = (out.doc.uiSchema.sourceoffunds_x['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(options[1][1].fieldsBelow).toEqual(['specify_other_sourceoffunds_x']);
    expect(options[0][1].fieldsBelow).toBeUndefined();
    expect(out.doc.uiSchema.specify_other_sourceoffunds_x['ui:placeholder']).toBe('Please specify');
  });
});

describe('tax id label', () => {
  it('also recognises "U.S. Taxpayer Identification Number (...) or Foreign Taxpayer Identification Number"', () => {
    expect(TAX_ID_LABEL.test('13. U.S. Taxpayer Identification Number (i.e., SSN, EIN, and/or ITIN, as applicable) or Foreign Taxpayer Identification Number:')).toBe(true);
    expect(idTypesFor('13. U.S. Taxpayer Identification Number (i.e., SSN, EIN, and/or ITIN, as applicable)').map((t) => t.format)).toEqual(['SSN', 'EIN', 'ITIN']);
  });
});

const STANDARDS_OFF_EXCEPT = (id: string): string[] => STANDARDS.map((x) => x.id).filter((x) => x !== id);

describe('Client A batch 2', () => {
  const opt = (v: string, label: string) => [v, { formattedText: label === '' ? '' : `<p>${label}</p>`, blueprintMetadataMapping: '' }];

  it('labels unlabelled Yes / No options from their aliases', () => {
    const doc = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'q', type: 'string', title: 'q', enum: ['asa_yes_q', 'asa_no_q'] }] }],
      { pg: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>5. Question?</p>', 'ui:multipleOption': { options: [opt('asa_yes_q', ''), opt('asa_no_q', '')] } } });
    const out = run(doc, {}, ['yes-no-labels']);
    const labels = (out.doc.uiSchema.q['ui:multipleOption'] as { options: [string, { formattedText: string }][] }).options.map((o) => o[1].formattedText);
    expect(labels).toEqual(['<p>Yes</p>', '<p>No</p>']);
  });

  it('turns "(Month/Day)" into a month dropdown and a day field in a two-column row, with a hidden mapped box', () => {
    const doc = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'taxyear', type: 'string', title: 't' }] }],
      { pg: { 'ui:widget': 'Page' }, taxyear: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>13. If the Investor’s tax year ends on a date other than December 31, please indicate such date below: (Month/Day) <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['taxyear_pdf'] } });
    const out = run(doc, {}, ['month-day']);
    const group = out.doc.schema.properties[0].properties?.[0];
    expect(group?.name).toBe('taxyear_monthday');
    // an optional "ends on December 31" checkbox first, then the month and day in two columns, then the hidden mapped box
    expect(group?.properties?.map((n) => n.name)).toEqual(['taxyear_monthday_dec31', 'taxyear_monthday_row', 'merged_taxyear']);
    const row = group?.properties?.[1];
    expect(row?.properties?.map((n) => n.name)).toEqual(['taxyear_monthday_month', 'taxyear_monthday_day']);
    expect(out.doc.uiSchema.taxyear_monthday_row['ui:dynamicLayout']).toEqual({ sectionsWidth: [50, 50], gutter: 12 });
    // the question has no asterisk of its own: month and day are required
    expect(String(out.doc.uiSchema.taxyear_monthday['ui:formattedText'])).not.toContain('Month/Day');
    expect(String(out.doc.uiSchema.taxyear_monthday['ui:formattedText'])).not.toContain('*');
    const gate = out.doc.uiSchema.taxyear_monthday_dec31;
    expect(gate['ui:required']).toBeUndefined();
    expect(JSON.stringify(gate['ui:multipleOption'])).toContain('Check this box if the Investor’s tax year ends on December 31.');
    expect(out.warns.some((w) => w.startsWith('NEEDS RULE: when taxyear_monthday_dec31 is checked'))).toBe(true);
    expect(out.doc.uiSchema.taxyear_monthday_month).toMatchObject({ 'ui:widget': 'Dropdown', 'ui:required': 'This field is required' });
    expect((row?.properties?.[0] as unknown as { enum: string[] }).enum).toEqual(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
    expect(out.doc.uiSchema.taxyear_monthday_day['ui:widget']).toBe('Integer');
    expect(out.doc.uiSchema.merged_taxyear).toMatchObject({ 'ui:invisible': true, 'ui:pdfMapping': ['taxyear_pdf'] });
  });

  it('keeps a plain month-day pair in one two-column group when the question is not about December 31', () => {
    const doc = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'fy', type: 'string', title: 't' }] }],
      { pg: { 'ui:widget': 'Page' }, fy: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Fiscal year end (Month/Day):</p>', 'ui:pdfMapping': ['fy_pdf'] } });
    const group = run(doc, {}, ['month-day']).doc.schema.properties[0].properties?.[0];
    expect(group?.properties?.map((n) => n.name)).toEqual(['fy_monthday_month', 'fy_monthday_day', 'merged_fy']);
  });

  it('shows a box that says "If Other was checked, please describe" below the option Other of the choice above it', () => {
    const doc = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'cap', type: 'array', title: 'c', items: { type: 'string', enum: ['a', 'other'] } }, { name: 'desc', type: 'string', title: 'd' }] }],
      { pg: { 'ui:widget': 'Page' }, cap: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>3. Check one</p>', 'ui:multipleOption': { options: [opt('a', 'Broker-dealer'), opt('other', 'Other')] } },
        desc: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>If “Other” was checked, please describe the entity or beneficial owner:</p>', 'ui:pdfMapping': ['d'] } });
    const out = run(doc, {}, ['specify-other']);
    const options = (out.doc.uiSchema.cap['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(options[1][1].fieldsBelow).toEqual(['desc']);
    expect(options[0][1].fieldsBelow).toBeUndefined();
  });

  it('puts the question number printed in the PDF margin back in front of a label that lacks it', () => {
    const doc = raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'legal', type: 'string', title: 'l' }, { name: 'numbered', type: 'string', title: 'n' }] }],
      { pg: { 'ui:widget': 'Page' },
        legal: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Legal form of entity (trust, corporation, partnership, limited liability company, etc.):</p>', 'ui:pdfMapping': ['legal'] },
        numbered: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>2. Jurisdiction of formation:</p>', 'ui:pdfMapping': ['numbered'] } });
    const anchors = { legal: { page: 39, left: 0.2, top: 0.2, right: 0.8, bottom: 0.22 }, numbered: { page: 39, left: 0.2, top: 0.3, right: 0.8, bottom: 0.32 } };
    const pdf = [{ page: 39, text: '', lines: [{ top: 0.19, text: '1. Legal form of entity (trust, corporation, partnership, limited liability company, etc.):_____' }, { top: 0.29, text: '2. Jurisdiction of formation:' }] }];
    const changes: string[] = [];
    const ctx: StandardContext = { doc, anchors, texts: [], pdf, log: (m) => changes.push(m), warn: () => {} };
    runStandards(ctx, STANDARDS_OFF_EXCEPT('numbering-from-pdf'));
    expect(String(ctx.doc.uiSchema.legal['ui:formattedText'])).toBe('<p>1. Legal form of entity (trust, corporation, partnership, limited liability company, etc.):</p>');
    expect(String(ctx.doc.uiSchema.numbered['ui:formattedText'])).toBe('<p>2. Jurisdiction of formation:</p>');
    expect(changes.some((c) => c.startsWith('numbering-from-pdf: 1 label'))).toBe(true);
  });
});

describe('investor type documentation pages', () => {
  const para = (name: string) => ({ name, type: 'null', title: name });
  const page = (name: string, title: string, kids: string[], texts: Record<string, string>) => ({ nodes: { name, type: 'object', title, properties: kids.map(para) }, ui: { [name]: { 'ui:widget': 'Page' }, ...Object.fromEntries(kids.map((k) => [k, { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p>${texts[k] ?? 'bullets'}</p>` }])) } });
  const aml = page('aml', 'AML', ['a', 'b', 'c', 'd', 'e', 'f'], { a: 'Natural Persons:', b: 'Copy of a passport', c: 'Private Corporation:', d: 'Certified resolutions', e: 'Partnership:', f: 'Partnership certificate' });
  const first = page('pg1', 'A. General Information', ['x'], {});
  const last = page('pg2', 'B. Accredited Investor Status', ['y'], {});
  const doc = raw([aml.nodes, first.nodes, last.nodes], { ...aml.ui, ...first.ui, ...last.ui });

  it('moves an unnumbered page that lists what each kind of investor provides to the end of the form', () => {
    const out = run(doc, {}, ['investor-type-table']);
    expect(out.doc.schema.properties.map((n) => n.name)).toEqual(['pg1', 'pg2', 'aml']);
    expect(out.warns.some((w) => w.startsWith('NEEDS RULE: on "AML"'))).toBe(true);
  });
  it('leaves a numbered page, or one that is not about investor types, where it is', () => {
    const numbered = raw([{ ...aml.nodes, title: 'C. Background Documentation' }, first.nodes], { ...aml.ui, ...first.ui });
    expect(run(numbered, {}, ['investor-type-table']).doc.schema.properties.map((n) => n.name)).toEqual(['aml', 'pg1']);
    const other = raw([page('p', 'Notes', ['a', 'b', 'c'], { a: 'Hello', b: 'World', c: 'Again' }).nodes, first.nodes], { ...page('p', 'Notes', ['a', 'b', 'c'], { a: 'Hello', b: 'World', c: 'Again' }).ui, ...first.ui });
    expect(run(other, {}, ['investor-type-table']).doc.schema.properties.map((n) => n.name)).toEqual(['p', 'pg1']);
  });
});

describe('in-kind distributions', () => {
  const field = (name: string) => ({ name, type: 'string', title: name });
  const group = (name: string) => ({ name, type: 'object', title: name, properties: [field(`${name}_firm`), field(`${name}_account`)] });
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: [group('cash'), group('inkind'), group('other')] }];
  const star = ' <span style="color: rgb(219, 55, 55);">*</span>';
  const input = (a: string) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': `<p>Firm Name:${star}</p>`, 'ui:required': 'This field is required', 'ui:pdfMapping': [a] });
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    cash: { 'ui:widget': 'Group', 'ui:formattedText': '<p><strong>For distributions of cash, please wire funds to the following bank account:</strong></p>' },
    inkind: { 'ui:widget': 'Group', 'ui:formattedText': '<p><strong>For distributions in-kind, please:</strong></p><p>Credit securities to my brokerage account at the following firm:</p>' },
    other: { 'ui:widget': 'Group', 'ui:formattedText': '<p><strong>Contact</strong></p>' },
    cash_firm: input('a'), cash_account: input('b'), inkind_firm: input('c'), inkind_account: input('d'), other_firm: input('e'), other_account: input('f'),
  };
  const out = run(raw(nodes, ui), {}, ['in-kind-gate']);
  const kids = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];

  it('puts the in-kind block behind an optional checkbox, opening under it, and leaves cash and other blocks alone', () => {
    expect(kids).toEqual(['cash', 'inkind_gate', 'inkind', 'other']);
    const options = (out.doc.uiSchema.inkind_gate['ui:multipleOption'] as { options: [string, { formattedText: string; fieldsBelow: string[] }][] }).options;
    expect(options[0][1].formattedText).toBe('<p>Check this box if you would like to provide in-kind distribution instructions.</p>');
    expect(options[0][1].fieldsBelow).toEqual(['inkind']);
    expect(out.doc.uiSchema.inkind_gate['ui:required']).toBeUndefined();
    // what is inside stays required once it is open
    expect(out.doc.uiSchema.inkind_firm['ui:required']).toBe('This field is required');
  });
});

describe('same as above for repeated contact details', () => {
  const box = (name: string, label: string) => ({ name, type: 'string', title: label });
  const fields = (p: string) => ['Name', 'Address', 'Telephone', 'Email'].map((l) => box(`${l.toLowerCase()}_${p}`, l));
  const fieldUi = (p: string): Ui => Object.fromEntries(['Name', 'Address', 'Telephone', 'Email'].map((l) => [`${l.toLowerCase()}_${p}`, { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>${l}:</p>`, 'ui:pdfMapping': [`${l}_${p}`] }]));
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: [
    { name: 'call', type: 'array', title: 'c', properties: fields('call') },
    { name: 'fin', type: 'array', title: 'f', properties: fields('fin') },
    { name: 'signers', type: 'array', title: 's', properties: fields('sig') },
  ] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    call: { 'ui:widget': 'Repeatable', 'ui:formattedText': '<p>Contact Person(s) for Capital Call and Distribution Notices:</p>' },
    fin: { 'ui:widget': 'Repeatable', 'ui:formattedText': '<p>Contact Person(s) for Financial Information and Reporting (including quarterly and annual financial reports and capital account statements):</p>' },
    signers: { 'ui:widget': 'Repeatable', 'ui:formattedText': '<p>The following individuals have been duly authorized to instruct the General Partner:</p>' },
    ...fieldUi('call'), ...fieldUi('fin'), ...fieldUi('sig'),
  };
  const out = run(raw(nodes, ui), {}, ['same-as-above']);
  const kids = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];

  it('puts an optional checkbox above the later contact block, naming both blocks without the parenthetical', () => {
    expect(kids).toEqual(['call', 'fin_same_as_above', 'fin', 'signers']);
    const options = (out.doc.uiSchema.fin_same_as_above['ui:multipleOption'] as { options: [string, { formattedText: string }][] }).options;
    expect(options[0][1].formattedText).toBe('<p>Check this box if the Contact Person(s) for Financial Information and Reporting is(are) the same as the Contact Person(s) for Capital Call and Distribution Notices above.</p>');
    expect(out.doc.uiSchema.fin_same_as_above['ui:required']).toBeUndefined();
    expect(out.warns.some((w) => w.startsWith('NEEDS RULE: when fin_same_as_above is checked, prefill name_fin from name_call'))).toBe(true);
  });
  it('leaves a list of authorized signers alone even when its boxes look alike', () => {
    expect(kids).not.toContain('signers_same_as_above');
  });
});

describe('one list of choices under two PDF headings', () => {
  const opt = (value: string, text: string): [string, { formattedText: string; pdfMappings: string[] }] => [value, { formattedText: `<p>${text}</p>`, pdfMappings: [value] }];
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'qp', type: 'array', title: 'q', items: { type: 'string', enum: ['a', 'b', 'c'] } }] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    qp: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>FOR ENTITIES: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['qp_pdf'], 'ui:multipleOption': { options: [opt('a', '(i) A natural person who owns not less than $5 million.'), opt('b', '(ii) An entity that owns not less than $5 million.'), opt('c', '(iii) A trust that is not covered by (i) above.')] } },
  };
  const pdf = [{ page: 0, text: '', lines: [
    { top: 0.1, text: 'Qualified purchaser.' }, { top: 0.2, text: 'FOR INDIVIDUALS:' }, { top: 0.22, text: '(i) A natural person who owns not less than' }, { top: 0.24, text: '$5 million.' },
    { top: 0.3, text: 'FOR ENTITIES:' }, { top: 0.32, text: '(ii) An entity that owns not less than $5 million.' }, { top: 0.4, text: '(iii) A trust that is not covered by (i) above.' },
  ] }];
  const apply = (pages: typeof pdf | null) => {
    const warns: string[] = [];
    const ctx: StandardContext = { doc: raw(nodes, ui), anchors: {}, texts: [], pdf: pages, log: () => {}, warn: (m) => warns.push(m) };
    runStandards(ctx, STANDARDS.map((s) => s.id).filter((id) => id !== 'option-sections'));
    return { ctx, warns };
  };

  it('splits it into one list per heading, keeping the original name for the heading the annotation highlighted, and the PDF group mapping on both', () => {
    const { ctx, warns } = apply(pdf);
    expect(ctx.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['qp_individuals', 'qp']);
    expect(String(ctx.doc.uiSchema.qp_individuals['ui:formattedText'])).toContain('FOR INDIVIDUALS:');
    expect(String(ctx.doc.uiSchema.qp['ui:formattedText'])).toContain('FOR ENTITIES:');
    expect((ctx.doc.uiSchema.qp_individuals['ui:multipleOption'] as { options: unknown[][] }).options.map((o) => o[0])).toEqual(['a']);
    expect((ctx.doc.uiSchema.qp['ui:multipleOption'] as { options: unknown[][] }).options.map((o) => o[0])).toEqual(['b', 'c']);
    expect(ctx.doc.uiSchema.qp['ui:pdfMapping']).toEqual(['qp_pdf']);
    // one PDF group field behind both lists: both map to it
    expect(ctx.doc.uiSchema.qp_individuals['ui:pdfMapping']).toEqual(['qp_pdf']);
    expect(ctx.doc.uiSchema.qp_individuals['ui:required']).toBe('This field is required');
    expect(warns.some((w) => w.includes('qp_individuals (FOR INDIVIDUALS:)'))).toBe(true);
  });
  it('does nothing without the PDF text', () => {
    expect(apply(null).ctx.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['qp']);
  });
});

describe('tax forms file group', () => {
  const doc = () => raw([{ name: 'file0', type: 'null', title: 'a.pdf' }, { name: 'pg', type: 'object', title: 'P', properties: [] }], { file0: { 'ui:widget': 'File' }, pg: { 'ui:widget': 'Page' } });
  const apply = (d: ReturnType<typeof raw>) => {
    const ctx: StandardContext = { doc: d, anchors: {}, texts: [], log: () => {}, warn: () => {} };
    runStandards(ctx, STANDARDS.map((s) => s.id).filter((id) => !['hidden-page', 'tax-forms'].includes(id)));
    return ctx.doc;
  };
  it('puts the standard Tax Forms group (W-9, then the W-8s with their links) in the hidden page', () => {
    const out = apply(doc());
    const hidden = out.schema.properties[0];
    expect(hidden.properties?.map((n) => n.name)).toEqual(['file0', 'tax_forms']);
    expect(out.uiSchema.tax_forms['ui:widget']).toBe('FileGroup');
    const g = out.uiSchema.tax_forms['ui:supportingFileGroup'] as { description: string; files: Record<string, { description: string; helpText: string }> };
    expect(g.description).toBe('Tax Forms');
    expect(Object.keys(g.files)).toEqual(['file1', 'file2']);
    expect(g.files.file1.description).toBe('IRS Form W-9');
    expect(g.files.file1.helpText).toContain('www.irs.gov/pub/irs-pdf/fw9.pdf');
    expect(g.files.file2.description).toBe('The appropriate IRS Form(s) W-8');
    expect(g.files.file2.helpText).toContain('Form W-8BEN-E - ');
    expect(g.files.file2.helpText).toContain('Please check with your tax advisor(s) on which form is appropriate for your situation.');
    expect(out.schema.properties[0].properties?.[1].items?.enum).toEqual(['file1', 'file2']);
  });
  it('does not add a second one when the form has a W-9 file already, and can be switched off', () => {
    const once = apply(doc());
    expect(apply(once).schema.properties[0].properties?.filter((n) => n.name.startsWith('tax_forms')).length).toBe(1);
    const off = buildForm(JSON.stringify(annotation), { fundName: 'T', disabledStandards: ['tax-forms'] });
    expect(JSON.stringify(off.form)).not.toContain('tax_forms');
  });
});

import { AGREE_TEXT, CONSENT_TEXT, confirmationFor, embeddedConfirmation } from './embeddedConfirmation';

describe('agreement and consent under an embedded PDF', () => {
  const pdfUi = (name: string): Record<string, unknown> => ({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': name, 'ui:height': '600pt' });
  const nodes = [{ name: 'pg', type: 'object', title: 'Pages', properties: [
    { name: 'sa', type: 'null', title: 'Fund - Subscription Agreement.pdf' }, { name: 'dir', type: 'null', title: 'Directions' }, { name: 'priv', type: 'null', title: 'Privacy Consent' },
    { name: 'after', type: 'string', title: 'a' },
  ] }];
  const ui: Ui = { pg: { 'ui:widget': 'Page' }, sa: pdfUi('Fund - Subscription Agreement.pdf'), dir: pdfUi('Fund - Directions for Completion of the Subscription Documents.pdf'), priv: pdfUi('Fund - Consent to Electronic Delivery.pdf'), after: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name</p>' } };
  const only = (d: ReturnType<typeof raw>) => {
    const ctx: StandardContext = { doc: d, anchors: {}, texts: [], log: () => {}, warn: () => {} };
    embeddedConfirmation.apply(ctx);
    return ctx.doc;
  };
  const out = { doc: only(raw(nodes, ui)) };
  const kids = out.doc.schema.properties[0].properties?.map((n) => n.name) ?? [];

  it('tells an agreement from a consent from a file that only informs, by its name', () => {
    expect(confirmationFor('Fund - Subscription Agreement.pdf')).toBe('agreement');
    expect(confirmationFor('Representations and Warranties')).toBe('agreement');
    expect(confirmationFor('Consent to Electronic Delivery')).toBe('consent');
    expect(confirmationFor('Directions for Completion of the Subscription Documents')).toBeNull();
    expect(confirmationFor('Annex 3 - IRS Withholding Tax Forms')).toBeNull();
  });
  it('puts a required checkbox right under an agreement, and an optional one under a consent, and none under the directions', () => {
    expect(kids).toEqual(['sa', 'sa_agreement', 'dir', 'priv', 'priv_consent', 'after']);
  });
  it('the agreement checkbox has no label, one option in bold red with the red asterisk, and is required', () => {
    const ui1 = out.doc.uiSchema.sa_agreement;
    expect(ui1).toMatchObject({ 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:required': 'This field is required' });
    const options = (ui1['ui:multipleOption'] as { options: [string, { formattedText: string }][] }).options;
    expect(options).toHaveLength(1);
    expect(options[0][1].formattedText).toBe(`<p><span style="color: rgb(219, 55, 55);"><strong>${AGREE_TEXT} *</strong></span></p>`);
  });
  it('the consent checkbox is optional and plain', () => {
    const ui2 = out.doc.uiSchema.priv_consent;
    expect(ui2['ui:required']).toBeUndefined();
    expect(ui2['ui:formattedText']).toBe('');
    expect((ui2['ui:multipleOption'] as { options: [string, { formattedText: string }][] }).options[0][1].formattedText).toBe(`<p>${CONSENT_TEXT}</p>`);
  });
  it('does not add a second one when run again', () => {
    expect(only(out.doc).schema.properties[0].properties?.map((n) => n.name)).toEqual(kids);
  });
});

import { belowIndent } from './belowIndent';

describe('fields below an option are indented 24px', () => {
  const opt2 = (value: string, label: string, below: string[] = []): [string, Record<string, unknown>] => [value, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '', ...(below.length ? { fieldsBelow: below } : {}) }];
  const nodes = [{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 'q', type: 'string', title: 'q', enum: ['a', 'b'] }, { name: 'plain', type: 'string', title: 'p' }, { name: 'below', type: 'string', title: 'b' }, { name: 'custom', type: 'string', title: 'c' }] }];
  const ui: Ui = {
    pg: { 'ui:widget': 'Page' },
    q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Q</p>', 'ui:multipleOption': { options: [opt2('a', 'A', ['below', 'custom']), opt2('b', 'B')] } },
    plain: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Plain</p>' },
    below: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:indentation': '0px' },
    custom: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:indentation': '48px' },
  };
  it('sets it on a field below an option, keeps one set on purpose, and leaves other fields alone', () => {
    const ctx: StandardContext = { doc: raw(nodes, ui), anchors: {}, texts: [], log: () => {}, warn: () => {} };
    belowIndent.apply(ctx);
    expect(ctx.doc.uiSchema.below['ui:indentation']).toBe('24px');
    expect(ctx.doc.uiSchema.custom['ui:indentation']).toBe('48px');
    expect(ctx.doc.uiSchema.plain['ui:indentation']).toBeUndefined();
  });
});

describe('messages that depend on an answer are Info wells', () => {
  it('wells "if the answer ..., please ..." and the like, and leaves question lead-ins and body text', () => {
    for (const t of [
      'If the answer to the above question is “Yes”, please contact our counsel, Akin Gump Strauss Hauer & Feld LLP, for additional information that will be required.',
      'If both questions above were answered “Yes”, please contact our counsel.',
      'If you are subscribing through an IRA, you must provide the custodian’s details.',
      '(Note that the Investor has an obligation under Section 4(t) to promptly notify the General Partner.)',
    ]) expect(wellFor(t)).toBe('Info');
    for (const t of ['12(b). If question 12(a) was answered “Yes”, please indicate whether or not:', 'The Investor represents and warrants that it is an accredited investor.', '(b) If you are purchasing an Interest with another person:']) expect(wellFor(t)).toBeNull();
  });
});

describe('agreements: only the documents the investor agrees to, and signing is said', () => {
  const pdf = (n: string, file: string) => ({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': file, 'ui:height': '600pt' });
  const fund = 'Example Fund II, L.P. Form of Subscription Agreement (Canadian Investors)';
  const nodes = [
    { name: 'ins', type: 'object', title: 'Instructions', properties: [{ name: 'ins_pdf', type: 'null', title: `${fund} - Instructions.pdf` }] },
    { name: 'sa', type: 'object', title: 'Subscription Agreement', properties: [{ name: 'sa_pdf', type: 'null', title: `${fund} - Subscription Agreement.pdf` }] },
    { name: 'priv', type: 'object', title: 'Privacy Notice', properties: [{ name: 'priv_pdf', type: 'null', title: `${fund} - Privacy Notice.pdf` }] },
  ];
  const ui: Ui = { ins: { 'ui:widget': 'Page' }, sa: { 'ui:widget': 'Page' }, priv: { 'ui:widget': 'Page' }, ins_pdf: pdf('ins', `${fund} - Instructions.pdf`), sa_pdf: pdf('sa', `${fund} - Subscription Agreement.pdf`), priv_pdf: pdf('priv', `${fund} - Privacy Notice.pdf`) };
  it('the fund\'s own name says nothing: instructions and a privacy notice get no agreement box, the subscription agreement does', () => {
    const out = run(raw(nodes, ui), {}, ['embedded-confirmation']).doc;
    expect(out.schema.properties.map((n) => n.properties?.map((c) => c.name).filter((c) => !c.startsWith('pdf_review')))).toEqual([['ins_pdf'], ['sa_pdf', 'sa_pdf_agreement'], ['priv_pdf']]);
  });
  it('a notice that asks for a consent still gets the consent box', () => {
    expect(confirmationFor('Fund - Privacy Notice and Consent.pdf')).toBe('consent');
    expect(confirmationFor('Fund - Privacy Notice.pdf')).toBeNull();
  });
  it('says "you will be asked to sign the document during the signature process" under the agreement when the form has a signature, not otherwise', () => {
    const withSig = [...nodes, { name: 'sg', type: 'object', title: 'Signatures', properties: [{ name: 'sig', type: 'null', title: 'Signature' }] }];
    const uiSig: Ui = { ...ui, sg: { 'ui:widget': 'Page' }, sig: { 'ui:widget': 'Signature' } };
    const out = run(raw(withSig, uiSig), {}, ['embedded-confirmation']).doc;
    expect(out.schema.properties[1].properties?.map((c) => c.name).filter((c) => !c.startsWith('pdf_review'))).toEqual(['sa_pdf', 'sa_pdf_agreement', 'sa_pdf_signing_note']);
    expect(out.uiSchema.sa_pdf_signing_note).toMatchObject({ 'ui:widget': 'Paragraph', 'ui:wellType': 'Info', 'ui:formattedText': '<p>After completing the form, you will be asked to sign the document during the signature process.</p>' });
    expect(out.schema.properties[0].properties?.map((c) => c.name).filter((c) => !c.startsWith('pdf_review'))).toEqual(['ins_pdf']);
    expect(run(raw(nodes, ui), {}, ['embedded-confirmation']).doc.uiSchema.sa_pdf_signing_note).toBeUndefined();
  });
});

describe('headings in capitals; no visible signature page', () => {
  it('writes Heading 1 in ALL CAPS and leaves the page name in Title Case', () => {
    const d = raw(
      [{ name: 'p1', type: 'object', title: 'Schedule C', properties: [{ name: 'h', type: 'null', title: 'Schedule C' }, { name: 'h2', type: 'null', title: 'Sub heading' }] }],
      { p1: { 'ui:widget': 'Page' }, h: { 'ui:widget': 'Header', 'ui:heading': 'Schedule C', 'ui:headerType': 'Heading1' }, h2: { 'ui:widget': 'Header', 'ui:heading': 'Sub heading', 'ui:headerType': 'Heading2' } },
    );
    const out = run(d, {}, ['heading-caps']).doc;
    expect(out.uiSchema.h['ui:heading']).toBe('SCHEDULE C');
    expect(out.uiSchema.h2['ui:heading']).toBe('Sub heading');
    expect(out.schema.properties[0].title).toBe('Schedule C');
  });
  const sigPage = (extra: unknown[], extraUi: Ui) => raw(
    [{ name: 'sp', type: 'object', title: 'Limited Partner Signature Page', properties: [{ name: 'gh', type: 'null', title: 'LIMITED PARTNER SIGNATURE PAGE' }, ...extra, { name: 'sp_signatures', type: 'object', title: 'Signatures', properties: [{ name: 'sig', type: 'null', title: 'Signature' }] }] }],
    { sp: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'LIMITED PARTNER SIGNATURE PAGE', 'ui:headerType': 'Heading1' }, sp_signatures: { 'ui:widget': 'Group' }, sig: { 'ui:widget': 'Signature' }, ...extraUi },
  );
  it('a signature page that still holds the investor\'s information is the General Information page', () => {
    const out = run(sigPage([{ name: 'nm', type: 'string', title: 'Name' }, { name: 'gp_signature', type: 'object', title: 'gp_signature', properties: [] }], { nm: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name</p>' }, gp_signature: { 'ui:widget': 'Group' } }), {}, ['signature-page', 'heading-caps']).doc;
    expect(out.schema.properties[0].title).toBe('General Information');
    expect(out.uiSchema.gh['ui:heading']).toBe('GENERAL INFORMATION');
    expect(out.schema.properties[0].properties?.map((n) => n.name)).toEqual(['gh', 'nm', 'sp_signatures']);
  });
  it('a page of only signatures is a hidden page', () => {
    const out = run(sigPage([], {}), {}, ['signature-page']).doc;
    expect(out.uiSchema.sp['ui:invisible']).toBe(true);
    expect(out.schema.properties[0].title).toBe('Limited Partner Signature Page');
  });
});

import { initialSelections } from './initials';

describe('statements the PDF asks the investor to initial', () => {
  const at = (top: number, left = 0.853) => ({ page: 11, left, top, right: left + 0.076, bottom: top + 0.024 });
  const line = (top: number, ...segments: [number, number, string][]) => ({ top, text: segments.map((x) => x[2]).join(' '), segments: segments.map(([left, right, text]) => ({ left, right, text })) });
  const pdf = [{ page: 11, text: '', lines: [
    line(0.441, [0.07, 0.23, '2. Risk acknowledgement']),
    line(0.464, [0.85, 0.88, 'Your']),
    line(0.477, [0.07, 0.4, 'This investment is risky. Initial that you understand that:'], [0.85, 0.89, 'initials']),
    line(0.501, [0.07, 0.44, 'Risk of loss - You could lose your entire investment of CAD$'], [0.54, 0.81, '. [ Instruction: Insert the total dollar amount of']),
    line(0.514, [0.07, 0.17, 'the investment.]']),
    line(0.538, [0.07, 0.54, 'Liquidity risk - You may not be able to sell your investment quickly - or at all.']),
    line(0.57, [0.07, 0.59, '• Lack of information - You may receive little or no information.']),
    line(0.62, [0.07, 0.3, 'Next section text']),
  ] }];
  const anchors = { amount: { page: 11, left: 0.398, top: 0.489, right: 0.54, bottom: 0.502 }, a_initials_x: at(0.491), b_initials_x: at(0.526), c_initials_x: at(0.557) };
  const box = (alias: string) => ({ 'ui:widget': 'TextBox', 'ui:pdfMapping': [alias], 'ui:formattedText': '' });
  const make = () => raw(
    [{ name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gh', type: 'null', title: 'GI' }, { name: 'name_blocks', type: 'object', title: 'Name', properties: [] }] },
      { name: 'pg', type: 'object', title: 'Form', properties: [{ name: 'risk', type: 'object', title: '2. Risk acknowledgement', properties: [
        { name: 'amount', type: 'string', title: 'amount' }, { name: 'a_initials_x', type: 'string', title: 'a' }, { name: 'b_initials_x', type: 'string', title: 'b' }, { name: 'c_initials_x', type: 'string', title: 'c' },
      ] }] }],
    { gi: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'GI' }, name_blocks: { 'ui:widget': 'Group' }, pg: { 'ui:widget': 'Page' }, risk: { 'ui:widget': 'Group' }, amount: box('amount'), a_initials_x: box('a_initials_x'), b_initials_x: box('b_initials_x'), c_initials_x: box('c_initials_x') },
  );
  const apply = () => {
    const ctx: StandardContext = { doc: make(), anchors, texts: [], pdf, log: () => {}, warn: () => {} };
    initialSelections.apply(ctx);
    return ctx.doc;
  };

  it('becomes one checkbox group, its options read from the PDF beside each initial box, the lead-in saying "check" and linked to the Initials box', () => {
    const out = apply();
    const risk = out.schema.properties[1].properties?.[0].properties?.map((n) => n.name);
    expect(risk).toEqual(['initialscheckbox_x', 'amount']);
    const ui = out.uiSchema.initialscheckbox_x;
    expect(ui).toMatchObject({ 'ui:widget': 'MultipleCheckbox', 'ui:initialSignatureAlias': 'initials', 'ui:required': 'This field is required' });
    expect(ui['ui:formattedText']).toBe('<p>This investment is risky. Check that you understand that <span style="color: rgb(219, 55, 55);">*</span></p>');
    const options = (ui['ui:multipleOption'] as { options: [string, { formattedText: string; pdfMappings: string[] }][] }).options;
    expect(options.map((o) => [o[0], o[1].formattedText, o[1].pdfMappings])).toEqual([
      ['a_initials_x', '<p>Risk of loss - You could lose your entire investment.</p>', ['a_initials_x']],
      ['b_initials_x', '<p>Liquidity risk - You may not be able to sell your investment quickly - or at all.</p>', ['b_initials_x']],
      ['c_initials_x', '<p>Lack of information - You may receive little or no information.</p>', ['c_initials_x']],
    ]);
  });
  it('the blank in a statement keeps its box, below the group, labelled with the PDF\'s own instruction', () => {
    const out = apply();
    expect(out.uiSchema.amount['ui:formattedText']).toBe('<p>Insert the total dollar amount of the investment <span style="color: rgb(219, 55, 55);">*</span></p>');
    expect(out.uiSchema.amount['ui:pdfMapping']).toEqual(['amount']);
  });
  it('makes the Initials box once, right after the investor\'s name: a required free text with the footnote', () => {
    const out = apply();
    expect(out.schema.properties[0].properties?.map((n) => n.name)).toEqual(['gh', 'name_blocks', 'initials']);
    expect(out.uiSchema.initials).toMatchObject({ 'ui:widget': 'TextBox', 'ui:required': 'This field is required' });
    expect(String(out.uiSchema.initials['ui:formattedText'])).toContain('FOOT_NOTE_HERE');
    expect(String(out.uiSchema.initials['ui:formattedText'])).toContain('please enter the initials of the person filling out the form.');
  });
  it('a wide box whose alias says "initial" is an ordinary field, not an initials box', () => {
    const wide = { ...anchors, a_initials_x: { ...at(0.491), right: 0.9, left: 0.2 } };
    const ctx: StandardContext = { doc: make(), anchors: wide, texts: [], pdf, log: () => {}, warn: () => {} };
    initialSelections.apply(ctx);
    expect(ctx.doc.uiSchema.a_initials_x['ui:widget']).toBe('TextBox');
    expect(ctx.doc.uiSchema.initialscheckbox_x).toBeDefined(); // the other two small boxes still are
  });
  it('a form with no initial boxes gets no Initials box', () => {
    const ctx: StandardContext = { doc: raw([{ name: 'pg', type: 'object', title: 'P', properties: [{ name: 't', type: 'string', title: 'T' }] }], { pg: { 'ui:widget': 'Page' }, t: box('t') }), anchors: {}, texts: [], log: () => {}, warn: () => {} };
    initialSelections.apply(ctx);
    expect(ctx.doc.uiSchema.initials).toBeUndefined();
  });
});
