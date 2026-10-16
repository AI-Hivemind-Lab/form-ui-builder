import { describe, expect, it, vi } from 'vitest';
import { loadForm } from '../../model/loadForm';
import type { Anchors } from '../../model/pdfStore';
import { applyDecisions, termUsed } from './apply';
import { addressCandidates, duplicateCandidates, labelCandidates, nameQuestionPages, optionGroupCandidates, requiredFieldCandidates, signatureCandidates } from './candidates';
import { askValidated, hashText, makeAsk } from './client';
import { buildEmbeddedPages, previewNodes } from './proposals';
import { confidenceAfterVote, judgeForm } from './tasks';
import type { Decision } from './types';
import { AiFormatError, extractJson, validateInvestorType, validateSignatures } from './validate';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const box = (page: number, top: number) => ({ page, left: 0.1, top, right: 0.5, bottom: top + 0.02 });
const opt = (value: string, label: string, extra: Record<string, unknown> = {}): [string, Record<string, unknown>] => [value, { formattedText: `<p>${label}</p>`, pdfMappings: [value], blueprintMetadataMapping: '', ...extra }];

// A small form: a visible page, a type picklist, a name box, an address box, a signature page.
const types = ['Individual', 'Joint Tenants', 'Corporation', 'Limited Partnership', 'Trust'];
const doc = () => raw(
  [{ name: 'hidden', type: 'object', title: 'Hidden', properties: [] }, { name: 'p1', type: 'object', title: 'Intro', properties: [
    { name: 'h1', type: 'null', title: 'Intro' },
    { name: 'subname', type: 'string', title: 'Subscriber Name:' },
    { name: 'mailaddr', type: 'string', title: 'Mailing Address:' },
    { name: 'fax', type: 'string', title: 'Fax:' },
    { name: 'types', type: 'array', title: 'Type', items: { type: 'string', enum: ['ind', 'jt', 'corp', 'lp', 'trust'] } },
    { name: 'sigdate', type: 'string', title: 'Date' },
    { name: 'sig', type: 'null', title: 'Signature' },
  ] }],
  {
    hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, p1: { 'ui:widget': 'Page' }, h1: { 'ui:widget': 'Header', 'ui:heading': 'Intro' },
    subname: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Subscriber Name: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['subname'] },
    mailaddr: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Mailing Address: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['mailaddr'] },
    fax: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Fax: <span style="color: rgb(219, 55, 55);">*</span></p>', 'ui:required': 'This field is required', 'ui:pdfMapping': ['fax'] },
    types: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>Type of Subscriber — check all that apply:</p>', 'ui:multipleOption': { options: [opt('ind', types[0]), opt('jt', types[1]), opt('corp', types[2]), opt('lp', types[3]), opt('trust', types[4])] } },
    sigdate: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['sigdate'], 'ui:formattedText': '' },
    sig: { 'ui:widget': 'Signature', 'ui:signature': [{ mapping: 'sig', signatureType: 'Signature', isOptional: false }] },
  },
);
const anchors: Anchors = { subname: box(0, 0.1), mailaddr: box(0, 0.2), fax: box(0, 0.3), ind: box(1, 0.1), sigdate: box(2, 0.1), sig: box(2, 0.2) };
const texts = ['The Subscriber agrees', 'each Subscriber', 'an Investor'];
const nodeNames = (d: ReturnType<typeof doc>, parent: string) => d.schema.properties.find((n) => n.name === parent)?.properties?.map((n) => n.name) ?? [];
const dec = (id: string, data: Decision['data']): Decision => ({ id, title: id, detail: '', evidence: null, confidence: 'high', defaultAccepted: true, data });

describe('validators', () => {
  it('finds the JSON object in prose or code fences', () => {
    expect(extractJson('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson('no json here')).toThrow(AiFormatError);
  });
  const known = { groups: new Map([['types', ['ind', 'jt']]]), formPfGroups: new Set(['pf']) };
  const answer = (over: Record<string, unknown> = {}) => ({
    found: true, source: 'picklist', selectionMode: 'checkbox', existingGroupAlias: 'types',
    individual: [{ label: 'Individual', optionAlias: 'ind' }], entity: [{ label: 'Joint Tenants', optionAlias: 'jt' }],
    evidence: { page: 2, quote: 'Type of Subscriber' }, confidence: 'high', ...over,
  });
  it('accepts a good investor type answer', () => {
    expect(validateInvestorType(answer(), known)).toMatchObject({ found: true, selectionMode: 'checkbox', existingGroupAlias: 'types' });
    expect(validateInvestorType({ found: false }, known)).toEqual({ found: false });
  });
  it('rejects the Form PF list, an invented group or option alias, a repeated option and missing evidence', () => {
    expect(() => validateInvestorType(answer({ existingGroupAlias: 'pf' }), { groups: new Map([['pf', ['x']]]), formPfGroups: new Set(['pf']) })).toThrow(/Form PF/);
    expect(() => validateInvestorType(answer({ existingGroupAlias: 'made_up' }), known)).toThrow(/candidate/);
    expect(() => validateInvestorType(answer({ entity: [{ label: 'X', optionAlias: 'zzz' }] }), known)).toThrow(/not an option/);
    expect(() => validateInvestorType(answer({ entity: [{ label: 'Individual', optionAlias: 'ind' }] }), known)).toThrow(/twice/);
    expect(() => validateInvestorType(answer({ evidence: { page: 1, quote: '' } }), known)).toThrow(/evidence/);
  });
  it('drops signature answers about aliases it was never given, and unknown signer names are rejected', () => {
    const k = { signatures: new Set(['sig']), fields: new Set(['sigdate']) };
    const r = validateSignatures({ signatures: [{ signatureAlias: 'sig', signerName: 'Individual Signatory', role: 'LpSignature' }, { signatureAlias: 'other', signerName: 'Individual Signatory' }], fields: [{ fieldAlias: 'sigdate', signatureAlias: 'sig', type: 'Date' }, { fieldAlias: 'nope', signatureAlias: 'sig', type: 'Date' }] }, k);
    expect(r.signatures.map((s) => s.signatureAlias)).toEqual(['sig']);
    expect(r.fields.map((f) => f.fieldAlias)).toEqual(['sigdate']);
    expect(() => validateSignatures({ signatures: [{ signatureAlias: 'sig', signerName: 'The Boss' }] }, k)).toThrow(/signerName/);
  });
});

describe('client', () => {
  it('retries once with the reason when the answer is rejected', async () => {
    const ask = vi.fn().mockResolvedValueOnce('not json').mockResolvedValueOnce('{"ok": true}');
    expect(await askValidated(ask, 't', 's', 'u', (r) => r)).toEqual({ ok: true });
    expect(ask.mock.calls[1][2]).toContain('rejected');
  });
  it('caches answers by prompt so a repeat does not call the service', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const f = vi.fn(async () => new Response(JSON.stringify({ text: '{"a":1}' }), { status: 200 }));
    const ask = makeAsk(f as unknown as typeof fetch, storage);
    expect(await ask('t', 's', 'u')).toBe('{"a":1}');
    expect(await ask('t', 's', 'u')).toBe('{"a":1}');
    expect(f).toHaveBeenCalledTimes(1);
    expect(hashText('a')).not.toBe(hashText('b'));
  });
  it('surfaces the service error', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'not configured' }), { status: 502 }));
    await expect(makeAsk(f as unknown as typeof fetch, null)('t', 's', 'u')).rejects.toThrow('not configured');
  });
});

describe('candidates', () => {
  it('finds option lists, signatures and address boxes', () => {
    const d = doc();
    expect(optionGroupCandidates(d, anchors)).toMatchObject([{ alias: 'types', numbered: false, formPf: false, page: 2 }]);
    expect(signatureCandidates(d, anchors)).toMatchObject([{ alias: 'sig', page: 3, currentSigner: null }]);
    expect(addressCandidates(d, anchors).map((c) => c.alias)).toEqual(['mailaddr']);
  });
});

describe('judgeForm with a fake model', () => {
  const pages = [0, 1, 2].map((p) => ({ page: p, lines: [], text: `page ${p + 1} text` }));
  it('turns the answers into decisions, asking about only what is there', async () => {
    const asked: string[] = [];
    const ask = async (task: string) => {
      asked.push(task);
      if (task.startsWith('investor-type')) return JSON.stringify({ found: true, source: 'picklist', selectionMode: 'radio', existingGroupAlias: 'types', individual: [{ label: 'Individual', optionAlias: 'ind' }], entity: [{ label: 'Corporation', optionAlias: 'corp' }], evidence: { page: 2, quote: 'Type of Subscriber' }, confidence: 'high' });
      if (task.startsWith('signatures')) return JSON.stringify({ signatures: [{ signatureAlias: 'sig', signerName: 'Individual Signatory', role: 'LpSignature', evidence: { page: 3, quote: 'Individual' }, confidence: 'high' }], fields: [{ fieldAlias: 'sigdate', signatureAlias: 'sig', type: 'Date', evidence: { page: 3, quote: 'Date' }, confidence: 'medium' }] });
      if (task === 'addresses') return JSON.stringify({ expand: [{ alias: 'mailaddr', reason: 'a mailing address', confidence: 'high' }] });
      if (task === 'optional') return JSON.stringify({ optional: [{ alias: 'fax', reason: 'many have no fax', confidence: 'high' }] });
      return '{}';
    };
    const r = await judgeForm({ doc: doc(), anchors, pages, titleWords: [] }, ask);
    expect(asked).toEqual(['investor-type#1', 'investor-type#2', 'investor-type#3', 'signatures-p3', 'duplicates', 'addresses', 'embedded-pdfs', 'optional', 'grouping:p1']);
    expect(r.decisions.map((d) => d.id)).toEqual(['investor-type', 'sig:sig', 'sigfield:sigdate', 'address:mailaddr', 'optional:fax']);
    expect(r.decisions.find((d) => d.id === 'optional:fax')?.defaultAccepted).toBe(false);
    expect(r.decisions.find((d) => d.id === 'sigfield:sigdate')?.defaultAccepted).toBe(false);
  });
  it('notes what it skipped without a PDF, and survives a failing task', async () => {
    const ask = async (task: string) => {
      if (task === 'addresses') throw new Error('boom');
      return JSON.stringify({ optional: [] });
    };
    const r = await judgeForm({ doc: doc(), anchors, pages: null, titleWords: [] }, ask);
    expect(r.notes.some((n) => n.startsWith('Investor type: no PDF was given, so only the type picklist'))).toBe(true);
    expect(r.notes.some((n) => n.includes('Addresses: boom'))).toBe(true);
  });
  it('still finds the investor type from the annotation picklist when no PDF is given', async () => {
    const seen: string[] = [];
    const ask = async (task: string, _s: string, user: string) => {
      if (task.startsWith('investor-type')) {
        seen.push(user);
        return JSON.stringify({ found: true, source: 'picklist', selectionMode: 'radio', existingGroupAlias: 'types', individual: [{ label: 'Individual', optionAlias: 'ind' }], entity: [{ label: 'Corporation', optionAlias: 'corp' }], evidence: { page: 2, quote: 'Type of Subscriber' }, confidence: 'medium' });
      }
      return '{}';
    };
    const r = await judgeForm({ doc: doc(), anchors, pages: null, titleWords: [] }, ask);
    expect(r.decisions.find((d) => d.id === 'investor-type')).toMatchObject({ defaultAccepted: true });
    expect(JSON.parse(seen[0]).pages).toEqual([]);
  });
});

describe('optional candidates', () => {
  it('never offers telephone, mobile or email boxes, even a secondary contact\'s', () => {
    const d = raw(
      [{ name: 'p', type: 'object', title: 'P', properties: ['telephone_secondary', 'mobile', 'emailbox', 'attn', 'plain'].map((name) => ({ name, type: 'string', title: name })) }],
      {
        p: { 'ui:widget': 'Page' },
        telephone_secondary: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Telephone: *</p>', 'ui:required': 'This field is required' },
        mobile: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Mobile number: *</p>', 'ui:required': 'This field is required' },
        emailbox: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>E-mail: *</p>', 'ui:required': 'This field is required' },
        attn: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Attention: *</p>', 'ui:required': 'This field is required' },
        plain: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Second address line: *</p>', 'ui:required': 'This field is required' },
      },
    );
    expect(requiredFieldCandidates(d, {}).map((c) => c.alias)).toEqual(['attn', 'plain']);
  });
});

describe('applying decisions', () => {
  it('adds an Individual Signatory widget (name required, title optional) next to the entity one when a single block is signed by every investor type', () => {
    const d = doc();
    d.uiSchema.sig['ui:signature'] = [
      { mapping: 'sig', signatureType: 'Signature', isOptional: false }, { mapping: 'sigdate', signatureType: 'Date', isOptional: false },
      { mapping: 'signame', signatureType: 'Name', isOptional: false }, { mapping: 'sigtitle', signatureType: 'Title', isOptional: false },
    ];
    const r = applyDecisions(d, anchors, texts, [dec('s', { kind: 'signature', signatureAlias: 'sig', signerName: 'Authorized Signatory', role: 'LpSignature', sharedByAllInvestors: true })]);
    const names = nodeNames(r.doc, 'p1');
    expect(names.indexOf('sig_individual')).toBe(names.indexOf('sig') - 1);
    expect(r.doc.uiSchema.sig['ui:signatureSigner']).toBe('Authorized Signatory');
    expect(r.doc.uiSchema.sig_individual['ui:signatureSigner']).toBe('Individual Signatory');
    expect((r.doc.uiSchema.sig['ui:signature'] as unknown[]).length).toBe(4);
    // same lines for the individual: the name required, the title optional
    const individual = r.doc.uiSchema.sig_individual['ui:signature'] as { signatureType: string; isOptional: boolean }[];
    expect(individual.map((e) => [e.signatureType, e.isOptional])).toEqual([['Signature', false], ['Date', false], ['Name', false], ['Title', true]]);
    expect((r.doc.uiSchema.sig['ui:signature'] as { signatureType: string; isOptional: boolean }[]).find((e) => e.signatureType === 'Title')?.isOptional).toBe(false);
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: show sig_individual for individual investors'))).toBe(true);
    // a GP signature is never split
    const gp = applyDecisions(doc(), anchors, texts, [dec('g', { kind: 'signature', signatureAlias: 'sig', signerName: 'General Partner Signatory', role: 'GpSignature', sharedByAllInvestors: true })]);
    expect(nodeNames(gp.doc, 'p1')).not.toContain('sig_individual');
  });
  it('sets the signer and moves a signed-with field into the signature widget', () => {
    const r = applyDecisions(doc(), anchors, texts, [
      dec('s', { kind: 'signature', signatureAlias: 'sig', signerName: 'General Partner Signatory', role: 'GpSignature' }),
      dec('f', { kind: 'signature-field', fieldAlias: 'sigdate', signatureAlias: 'sig', type: 'Date', description: null }),
    ]);
    expect(r.doc.uiSchema.sig).toMatchObject({ 'ui:signatureSigner': 'General Partner Signatory', 'ui:signatureType': 'GpSignature' });
    expect((r.doc.uiSchema.sig['ui:signature'] as { mapping: string; signatureType: string }[]).map((m) => `${m.mapping}:${m.signatureType}`)).toEqual(['sig:Signature', 'sigdate:Date']);
    expect(nodeNames(r.doc, 'p1')).not.toContain('sigdate');
  });
  it('makes a field optional and keeps a word in capitals in titles', () => {
    const r = applyDecisions(doc(), anchors, texts, [dec('o', { kind: 'optional', alias: 'fax' }), dec('a', { kind: 'acronym', word: 'intro' })]);
    expect(r.doc.uiSchema.fax['ui:required']).toBeUndefined();
    expect(String(r.doc.uiSchema.fax['ui:formattedText'])).not.toContain('*');
    expect(r.doc.schema.properties[1].title).toBe('INTRO');
  });
  it('splits an address box into five elements plus a hidden mapped box', () => {
    const r = applyDecisions(doc(), anchors, texts, [dec('a', { kind: 'address', alias: 'mailaddr' })]);
    const group = r.doc.schema.properties[1].properties?.find((n) => n.name === 'mailaddr_address');
    // the Anduin address layout: Country at half width, then rows of two at 70% / 30%
    expect(group?.properties?.map((n) => n.name)).toEqual(['mailaddr_country', 'mailaddr_row_street_city', 'mailaddr_row_us_state_zip', 'mailaddr_row_state_postal', 'merged_mailaddr']);
    expect(group?.properties?.slice(1, 4).map((r) => r.properties?.map((n) => n.name))).toEqual([['mailaddr_street', 'mailaddr_city'], ['mailaddr_state_us', 'mailaddr_zip_us'], ['mailaddr_province', 'mailaddr_postal']]);
    expect(r.doc.uiSchema.mailaddr_row_street_city).toMatchObject({ 'ui:widget': 'Group', 'ui:dynamicLayout': { sectionsWidth: [70, 30], gutter: 8 } });
    expect(r.doc.uiSchema.mailaddr_country).toMatchObject({ 'ui:width': '50%', 'ui:indentation': '16px' });
    expect(r.doc.uiSchema.merged_mailaddr).toMatchObject({ 'ui:invisible': true, 'ui:pdfMapping': ['mailaddr'] });
    expect(r.doc.uiSchema.mailaddr_street['ui:pdfMapping']).toBeUndefined();
    expect(r.doc.uiSchema.mailaddr_state_us['ui:required']).toBe('This field is required');
    expect(r.doc.uiSchema.mailaddr).toBeUndefined();
  });
  const investor = (existing: string | null) => dec('t', { kind: 'investor-type', value: {
    source: 'picklist', selectionMode: 'checkbox', existingGroupAlias: existing,
    individual: [{ label: 'Individual', optionAlias: existing ? 'ind' : null }, { label: 'Joint Tenants', optionAlias: existing ? 'jt' : null }],
    entity: [{ label: 'Corporation', optionAlias: existing ? 'corp' : null }, { label: 'Trust', optionAlias: existing ? 'trust' : null }], unplaced: ['IRA'],
  } });
  it('moves an unnumbered picklist to the top as two columns, keeping its PDF mappings, optional and not clearable', () => {
    const r = applyDecisions(doc(), anchors, texts, [investor('types')]);
    expect(nodeNames(r.doc, 'p1').slice(0, 2)).toEqual(['h1', 'investor_type']);
    expect(nodeNames(r.doc, 'p1')).not.toContain('types');
    expect(r.doc.uiSchema.investor_type['ui:dynamicLayout']).toEqual({ sectionsWidth: [50, 50], gutter: 12 });
    const ind = r.doc.uiSchema.investor_type_individual;
    expect(ind['ui:widget']).toBe('Radio');
    expect(ind['ui:clearable']).toBe(false);
    expect(ind['ui:required']).toBeUndefined();
    expect((ind['ui:multipleOption'] as { options: [string, { pdfMappings: string[] }][] }).options[0]).toMatchObject(['ind', { pdfMappings: ['ind'] }]);
    expect(r.doc.uiSchema.investor_type_entity['ui:widget']).toBe('MultipleCheckbox');
    expect(r.warnings.some((w) => w.includes('"IRA" is not placed'))).toBe(true);
  });
  it('copies a numbered picklist instead of moving it, unnumbered and unmapped, and asks for a prefill rule', () => {
    const d = doc();
    d.uiSchema.types['ui:formattedText'] = '<p>4. Type of Subscriber — check all that apply:</p>';
    const r = applyDecisions(d, anchors, texts, [investor('types')]);
    expect(nodeNames(r.doc, 'p1')).toContain('types');
    const opts = (r.doc.uiSchema.investor_type_individual['ui:multipleOption'] as { options: [string, { pdfMappings?: string[] }][] }).options;
    expect(opts[0][0]).toBe('investor_type_individual');
    expect(opts[0][1].pdfMappings).toBeUndefined();
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: prefill the numbered list types'))).toBe(true);
  });
  it('copies the type list when it is one half of a numbered question: question 3 keeps its FOR INDIVIDUALS list', () => {
    const d = raw(
      [{ name: 'p', type: 'object', title: 'Data', properties: [{ name: 'h', type: 'null', title: 'H' }, { name: 'question_3', type: 'object', title: 'Question 3', properties: [
        { name: 'intro', type: 'null', title: 'i' }, { name: 'ind', type: 'string', title: 'FOR INDIVIDUALS' }, { name: 'ent', type: 'string', title: 'FOR ENTITIES' },
      ] }] }],
      {
        p: { 'ui:widget': 'Page' }, h: { 'ui:widget': 'Header', 'ui:heading': 'H' }, question_3: { 'ui:widget': 'Group' }, intro: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>3. Form of ownership of the Interest:</p>' },
        ind: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>FOR INDIVIDUALS</p>', 'ui:multipleOption': { options: [['i1', { formattedText: '<p>Individual</p>', pdfMappings: ['i1'] }], ['i2', { formattedText: '<p>Joint Tenants</p>', pdfMappings: ['i2'] }]] } },
        ent: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>FOR ENTITIES</p>', 'ui:multipleOption': { options: [['e1', { formattedText: '<p>Corporation</p>' }]] } },
      },
    );
    const r = applyDecisions(d, {}, [], [dec('t', { kind: 'investor-type', value: { source: 'picklist', selectionMode: 'radio', existingGroupAlias: 'ind', individual: [{ label: 'Individual', optionAlias: 'i1' }, { label: 'Joint Tenants', optionAlias: 'i2' }], entity: [{ label: 'Corporation', optionAlias: null }], unplaced: [] } })]);
    const q3 = r.doc.schema.properties[0].properties?.find((n) => n.name === 'question_3');
    expect(q3?.properties?.map((n) => n.name)).toEqual(['intro', 'ind', 'ent']);
    expect(r.doc.uiSchema.ind['ui:disable']).toBe(true);
    expect(nodeNames(r.doc, 'p')).toContain('investor_type');
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: prefill the numbered list ind'))).toBe(true);
  });
  it('maps several PDF places to one field, and keeps a prefilled field invisible with a rule to write', () => {
    const d = doc();
    d.schema.properties[1].properties?.push({ name: 'sigcopy', type: 'string', title: 'c' });
    d.uiSchema.sigcopy = { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['sigcopy'], 'ui:formattedText': '' };
    const r = applyDecisions(d, anchors, texts, [
      dec('m', { kind: 'merge-field', primaryAlias: 'subname', mergedAliases: ['sigcopy'] }),
      dec('p', { kind: 'prefilled-field', alias: 'fax', sourceAlias: 'subname' }),
    ]);
    expect(r.doc.uiSchema.subname['ui:pdfMapping']).toEqual(['subname', 'sigcopy']);
    expect(r.doc.uiSchema.sigcopy).toBeUndefined();
    expect(nodeNames(r.doc, 'p1')).not.toContain('sigcopy');
    expect(r.doc.uiSchema.fax['ui:invisible']).toBe(true);
    expect(r.warnings).toContain('NEEDS RULE: prefill fax from subname');
  });
  it('moves the fields shown below an option along with the question', () => {
    const d = raw(
      [{ name: 'sa', type: 'object', title: 'Agreement', properties: [{ name: 'pdf', type: 'null', title: 'sa' }, { name: 'q', type: 'string', title: 'q', enum: ['y', 'n'] }, { name: 'note', type: 'null', title: 'n' }] },
        { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gh', type: 'null', title: 'GI' }] }],
      {
        sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' },
        q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Q</p>', 'ui:multipleOption': { options: [['y', { formattedText: '<p>Yes</p>', fieldsBelow: ['note'] }], ['n', { formattedText: '<p>No</p>' }]] } },
        note: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>note</p>' },
        gi: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'GI' },
      },
    );
    const r = applyDecisions(d, {}, [], [dec('mv', { kind: 'move-fields', aliases: ['q'], targetPage: 'gi', wrapperTitle: 'Subscriber Information' })]);
    expect(nodeNames(r.doc, 'sa')).toEqual(['pdf']);
    const wrapper = r.doc.schema.properties.find((n) => n.name === 'gi')?.properties?.find((n) => n.name === 'subscriber_information');
    expect(wrapper?.properties?.map((n) => n.name)).toEqual(['q', 'note']);
  });
  it('moves fields off a PDF page into a "Subscriber Information" group at the start of the target page, with the investor type question first', () => {
    const d = raw(
      [{ name: 'sa', type: 'object', title: 'Agreement', properties: [{ name: 'pdf', type: 'null', title: 'sa' }, { name: 'note', type: 'null', title: 'n' }, { name: 'designation', type: 'string', title: 'd', enum: ['a'] }] },
        { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gh', type: 'null', title: 'GI' }, { name: 'q1', type: 'string', title: 'q1' }, { name: 'types', type: 'array', title: 'T', items: { type: 'string', enum: ['ind', 'corp'] } }] }],
      {
        sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' }, note: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>note</p>' },
        designation: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Designation</p>', 'ui:multipleOption': { options: [opt('a', 'A')] } },
        gi: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'GI' }, q1: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Q1</p>' },
        types: { 'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '<p>4. Type of Subscriber:</p>', 'ui:multipleOption': { options: [opt('ind', 'Individual'), opt('corp', 'Corporation')] } },
      },
    );
    const r = applyDecisions(d, {}, [], [
      dec('mv', { kind: 'move-fields', aliases: ['note', 'designation'], targetPage: 'gi', wrapperTitle: 'Subscriber Information' }),
      investor('types'),
    ]);
    expect(nodeNames(r.doc, 'sa')).toEqual(['pdf']);
    const gi = r.doc.schema.properties.find((n) => n.name === 'gi');
    expect(gi?.properties?.map((n) => n.name).slice(0, 3)).toEqual(['gh', 'subscriber_information', 'q1']);
    const wrapper = gi?.properties?.find((n) => n.name === 'subscriber_information');
    expect(wrapper?.properties?.map((n) => n.name)).toEqual(['investor_type', 'note', 'designation']);
    expect(String(r.doc.uiSchema.subscriber_information['ui:formattedText'])).toContain('Subscriber Information');
    // the numbered original keeps its place, disabled, with a prefill rule to write
    expect(gi?.properties?.map((n) => n.name)).toContain('types');
    expect(r.doc.uiSchema.types['ui:disable']).toBe(true);
    expect(r.warnings.some((w) => w.includes('prefill the numbered list types'))).toBe(true);
  });
  it('uses Subscriber or Investor, whichever the sub-doc uses more', () => {
    expect(termUsed(['Investor', 'the investors', 'Subscriber'])).toBe('Investor');
    expect(termUsed(['Subscriber', 'Subscribers', 'Investor'])).toBe('Subscriber');
    expect(termUsed([])).toBe('Subscriber');
  });
});

import { titleWordsFrom } from './titleWords';
describe('titleWordsFrom', () => {
  it('pairs each unsettled word with the original titles that contain it', () => {
    const r = titleWordsFrom(
      ['TITLE CASE REVIEW: FATF, XYZ may be acronyms; the document does not say, so they were written in Title Case'],
      ['title-case: "EXHIBIT A NON-FATF LIST" → "Exhibit A Non-Fatf List"', 'title-case: "OTHER" → "Other"'],
    );
    expect(r).toEqual([{ word: 'FATF', titles: ['EXHIBIT A NON-FATF LIST'] }, { word: 'XYZ', titles: [] }]);
    expect(titleWordsFrom([], [])).toEqual([]);
  });
});

describe('judgeForm: duplicates and page structure', () => {
  it('asks about duplicates with the page images, and about pages that mix a PDF with fields', async () => {
    const d = raw(
      [{ name: 'sa', type: 'object', title: 'Agreement', properties: [{ name: 'pdf', type: 'null', title: 'sa' }, { name: 'subname', type: 'string', title: 'Subscriber Name:' }] },
        { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gname', type: 'string', title: 'Name of Subscriber' }, { name: 'copy', type: 'string', title: 'c' }] }],
      { sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' }, subname: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Subscriber Name:</p>', 'ui:pdfMapping': ['subname'] }, gi: { 'ui:widget': 'Page' }, gname: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of Subscriber</p>', 'ui:pdfMapping': ['gname'] }, copy: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['copy'], 'ui:formattedText': '' } },
    );
    const a: Anchors = { subname: box(3, 0.1), gname: box(37, 0.1), copy: box(5, 0.5) };
    const pages = Array.from({ length: 40 }, (_, p) => ({ page: p, lines: [], text: `page ${p + 1}` }));
    const calls: { task: string; images?: string[] }[] = [];
    const ask = async (task: string, _s: string, _u: string, images?: string[]) => {
      calls.push({ task, images });
      if (task.startsWith('duplicates')) return JSON.stringify({ merge: [{ primaryAlias: 'gname', mergedAliases: ['subname'], reason: 'always shown', evidence: { page: 4, quote: 'Subscriber Name' }, confidence: 'high' }], prefilled: [{ alias: 'copy', sourceAlias: 'gname', reason: 'signature page copy', evidence: { page: 6, quote: 'name' }, confidence: 'medium' }] });
      if (task === 'page-structure') return JSON.stringify({ moves: [{ fromPage: 'sa', aliases: ['subname'], targetPage: 'gi', wrapperTitle: 'Subscriber Information', reason: 'fields under a full-page PDF are missed', confidence: 'high' }, { fromPage: 'sa', aliases: ['made_up'], targetPage: 'gi', wrapperTitle: 'x', reason: '', confidence: 'high' }] });
      return '{}';
    };
    const r = await judgeForm({ doc: d, anchors: a, pages, titleWords: [], pageImage: async (p) => `data:image/jpeg;base64,p${p}` }, ask);
    const dupCall = calls.find((c) => c.task.startsWith('duplicates'));
    expect(dupCall?.images?.length).toBeGreaterThan(0);
    expect(r.decisions.map((x) => x.id)).toEqual(['merge:gname', 'prefill:copy', 'move:gi:subname']);
    expect(r.decisions[0].defaultAccepted).toBe(true);
    expect(r.decisions[1].defaultAccepted).toBe(false);
  });
});

describe('investor type candidates', () => {
  it('flags a list that is only for entities or a tax category, which is never the investor type list', () => {
    const opt = (v: string, label: string) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '' }];
    const d = raw(
      [{ name: 'p', type: 'object', title: 'P', properties: [{ name: 'cat', type: 'string', title: 'c', enum: ['a', 'b', 'c', 'd'] }, { name: 'types', type: 'string', title: 't', enum: ['a', 'b', 'c', 'd'] }] }],
      {
        p: { 'ui:widget': 'Page' },
        cat: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Entity: To assist the General Partner in preparing the Partnership’s tax filing, please check the category into which you fall:</p>', 'ui:multipleOption': { options: [opt('a', 'Partnership'), opt('b', 'Corporation'), opt('c', 'IRA-EIN'), opt('d', 'LLC')] } },
        types: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>4. Type of Subscriber:</p>', 'ui:multipleOption': { options: [opt('a', 'Individual'), opt('b', 'Corporation'), opt('c', 'Trust'), opt('d', 'LLC')] } },
      },
    );
    expect(optionGroupCandidates(d, {}).map((g) => [g.alias, g.entityOnly])).toEqual([['cat', true], ['types', false]]);
  });
});

describe('name block candidates', () => {
  const d = raw(
    [{ name: 'p', type: 'object', title: 'P', properties: [
      { name: 'name_blocks', type: 'object', title: 'n', properties: [{ name: 'entityname', type: 'string', title: 'e' }, { name: 'mergedname', type: 'string', title: 'm' }] },
      { name: 'asa_fullname_investorname_x', type: 'string', title: 'f' },
      { name: 'other', type: 'string', title: 'o' },
    ] }],
    {
      p: { 'ui:widget': 'Page' }, name_blocks: { 'ui:widget': 'Group' },
      entityname: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Full Legal Name of Investor</p>', 'ui:pdfMapping': ['asa_fullname_investorname_x'] },
      mergedname: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': ['asa_fullname_investorname_x'], 'ui:invisible': true },
      asa_fullname_investorname_x: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name of Individual or Entity</p>', 'ui:pdfMapping': ['asa_fullname_investorname_x'] },
      other: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Capital Commitment:</p>', 'ui:pdfMapping': ['other'] },
    },
  );
  const a: Anchors = { asa_fullname_investorname_x: box(29, 0.3), other: box(5, 0.2) };
  it('never offers the mutually exclusive name blocks as information asked twice', () => {
    expect(duplicateCandidates(d, a).map((c) => c.alias)).not.toContain('entityname');
    expect(duplicateCandidates(d, a).map((c) => c.alias)).not.toContain('mergedname');
  });
  it('finds the page where the name is asked, for the investor type lead-in', () => {
    expect(nameQuestionPages(d, a)).toEqual([30]);
  });
});

describe('voting on the investor type', () => {
  const answer = (individual: string[], entity: string[], confidence = 'high') => JSON.stringify({ found: true, source: 'instructions', selectionMode: 'radio', existingGroupAlias: null, individual: individual.map((label) => ({ label, optionAlias: null })), entity: entity.map((label) => ({ label, optionAlias: null })), evidence: { page: 1, quote: 'q' }, confidence });
  const run = async (answers: string[]) => {
    let n = 0;
    const ask = async (task: string) => (task.startsWith('investor-type') ? answers[n++ % answers.length] : '{}');
    const r = await judgeForm({ doc: doc(), anchors, pages: [0, 1, 2].map((p) => ({ page: p, lines: [], text: `page ${p + 1}` })), titleWords: [] }, ask);
    return r.decisions.find((d) => d.id === 'investor-type');
  };
  const a = answer(['Individual', 'Custodial Account'], ['Partnership', 'Trust']);
  const b = answer(['Individual'], ['Partnership', 'Trust', 'Custodial Account']);
  it('takes the answer most tries agree on, and keeps full confidence only when all agree', async () => {
    const all = await run([a, a, a]);
    expect(all?.confidence).toBe('high');
    expect(all?.detail).not.toContain('did not give the same answer');
    const two = await run([a, b, a]);
    expect((two?.data as { value: { individual: { label: string }[] } }).value.individual.map((o) => o.label)).toEqual(['Individual', 'Custodial Account']);
    expect(two?.confidence).toBe('medium');
    expect(two?.defaultAccepted).toBe(true);
    expect(two?.detail).toContain('2 of 3 agree');
  });
  it('does not tick a split with no majority', async () => {
    const c = answer(['Individual', 'Trust'], ['Partnership']);
    const split = await run([a, b, c]);
    expect(split?.confidence).toBe('low');
    expect(split?.defaultAccepted).toBe(false);
  });
  it('computes the confidence after the vote', () => {
    expect(confidenceAfterVote('high', 3, 3)).toBe('high');
    expect(confidenceAfterVote('high', 2, 3)).toBe('medium');
    expect(confidenceAfterVote('medium', 2, 3)).toBe('medium');
    expect(confidenceAfterVote('high', 1, 3)).toBe('low');
    expect(confidenceAfterVote('high', 1, 2)).toBe('low');
  });
});

describe('optional candidates under a Yes / No question', () => {
  const opt = (v: string, label: string, map: string) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '', pdfMappings: [map] }];
  const field = (label: string, alias: string) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': `<p>${label} *</p>`, 'ui:required': 'This field is required', 'ui:pdfMapping': [alias] });
  const d = raw(
    [{ name: 'p', type: 'object', title: 'P', properties: [
      { name: 'q', type: 'string', title: 'q', enum: ['y', 'n'] },
      { name: 'custodian', type: 'string', title: 'c' },
      { name: 'taxid', type: 'string', title: 't' },
      { name: 'cat', type: 'string', title: 'cat', enum: ['a', 'b'] },
      { name: 'attn', type: 'string', title: 'a' },
    ] }],
    {
      p: { 'ui:widget': 'Page' },
      q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>10(b). Is the Investor a qualified IRA custodian or trustee?</p>', 'ui:multipleOption': { options: [opt('y', 'Yes', 'qy'), opt('n', 'No', 'qn')] } },
      custodian: field('Name of qualified IRA custodian or trustee:', 'custodian'), taxid: field('Custodian’s tax identification number:', 'taxid'),
      cat: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Pick one</p>', 'ui:multipleOption': { options: [opt('a', 'Alpha', 'ca'), opt('b', 'Beta', 'cb')] } },
      attn: field('Attention:', 'attn'),
    },
  );
  const a: Anchors = { qy: box(40, 0.5), qn: box(40, 0.5), custodian: box(40, 0.56), taxid: box(40, 0.66), ca: box(41, 0.3), attn: box(41, 0.4) };
  it('never offers the fields that open on Yes, and shows the AI the PDF lines above the others', () => {
    const pdf = [{ page: 41, text: '', lines: [{ top: 0.35, text: 'Pick one: Alpha Beta' }, { top: 0.1, text: 'Something far above' }] }];
    const list = requiredFieldCandidates(d, a, pdf);
    expect(list.map((c) => c.alias)).toEqual(['attn']);
    expect(list[0].pdfAbove).toEqual(['Pick one: Alpha Beta']);
  });
});

describe('labels read from the PDF', () => {
  const field = (required = false) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': [''], ...(required ? { 'ui:required': 'This field is required' } : {}) });
  const make = () => {
    const ui: Record<string, Record<string, unknown>> = {
      p: { 'ui:widget': 'Page' },
      a: { ...field(true), 'ui:pdfMapping': ['a'] }, b: { ...field(), 'ui:pdfMapping': ['b'] }, c: { ...field(), 'ui:pdfMapping': ['c'] }, d: { ...field(), 'ui:pdfMapping': ['d'] },
      hid: { ...field(), 'ui:pdfMapping': ['hid'], 'ui:invisible': true },
    };
    return raw(['a', 'b', 'c', 'd', 'hid'].map((name) => ({ name, type: 'string', title: name })).length ? [{ name: 'p', type: 'object', title: 'P', properties: ['a', 'b', 'c', 'd', 'hid'].map((name) => ({ name, type: 'string', title: name })) }] : [], ui);
  };
  const at = (top: number, left = 0.1, right = 0.5) => ({ page: 0, left, top, right, bottom: top + 0.02 });
  const anchors: Anchors = { a: at(0.3), b: at(0.5), c: at(0.7, 0.3), d: at(0.9), hid: at(0.95) };
  const seg = (left: number, right: number, text: string) => ({ left, right, text });
  const pages = [{ page: 0, text: '', lines: [
    { top: 0.27, text: 'Telephone:', segments: [seg(0.1, 0.2, 'Telephone:')] },
    { top: 0.47, text: 'Name: Name:', segments: [seg(0.1, 0.17, 'Name:'), seg(0.55, 0.62, 'Name:')] },
    { top: 0.665, text: 'Mailing Address', segments: [seg(0.3, 0.45, 'Mailing Address')] },
    { top: 0.7, text: 'Street:', segments: [seg(0.1, 0.15, 'Street:')] },
    { top: 0.2, text: 'Far away', segments: [seg(0.1, 0.2, 'Far away')] },
  ] }];

  it('finds the one printed text beside or above a box, skips the next column, asks when several are near, and ignores hidden fields', () => {
    const r = labelCandidates(make(), anchors, pages);
    expect(r.auto.map((c) => [c.alias, c.near[0].text, c.near[0].where])).toEqual([['a', 'Telephone:', 'above'], ['b', 'Name:', 'above']]);
    expect(r.ask.map((c) => [c.alias, c.near.map((n) => n.text)])).toEqual([['c', ['Street:', 'Mailing Address']]]);
    expect(r.none).toEqual(['d']);
  });
  it('turns the clear ones into ticked proposals and lets the AI pick only among the printed texts', async () => {
    const ask = async (task: string) => (task === 'labels' ? JSON.stringify({ labels: [{ alias: 'c', index: 0, confidence: 'high' }, { alias: 'made_up', index: 0, confidence: 'high' }] }) : '{}');
    const r = await judgeForm({ doc: make(), anchors, pages, titleWords: [] }, ask);
    const labels = r.decisions.filter((d) => d.data.kind === 'label');
    expect(labels.map((d) => [d.id, d.defaultAccepted, d.data.kind === 'label' ? d.data.text : ''])).toEqual([['label:a', true, 'Telephone:'], ['label:b', true, 'Name:'], ['label:c', true, 'Street:']]);
    expect(r.notes.some((n) => n.startsWith('Labels: 1 field(s) have no printed text'))).toBe(true);
  });
  it('rejects an index the model was never offered', async () => {
    const ask = async (task: string) => (task === 'labels' ? JSON.stringify({ labels: [{ alias: 'c', index: 7, confidence: 'high' }] }) : '{}');
    const r = await judgeForm({ doc: make(), anchors, pages, titleWords: [] }, ask);
    expect(r.decisions.some((d) => d.id === 'label:c')).toBe(false);
    expect(r.notes.some((n) => n.startsWith('Labels:') && n.includes('index'))).toBe(true);
  });
  it('writes the printed words as the label, with the star on a required box', () => {
    const r = applyDecisions(make(), anchors, [], [dec('l', { kind: 'label', alias: 'a', text: 'Telephone:', source: 'pdf-text' })]);
    expect(String(r.doc.uiSchema.a['ui:formattedText'])).toBe('<p>Telephone:</p> <span style="color: rgb(219, 55, 55);">*</span>'.replace('</p> <span style="color: rgb(219, 55, 55);">*</span>', ' <span style="color: rgb(219, 55, 55);">*</span></p>'));
    expect(r.doc.schema.properties[0].properties?.[0].title).toBe('Telephone:');
    // a label printed in lower case starts with a capital, as every label in the form does
    const lower = applyDecisions(make(), anchors, [], [dec('l3', { kind: 'label', alias: 'b', text: 'email:', source: 'pdf-text' })]);
    expect(String(lower.doc.uiSchema.b['ui:formattedText'])).toBe('<p>Email:</p>');
    // a box that got a label meanwhile is left alone
    const again = applyDecisions(r.doc, anchors, [], [dec('l2', { kind: 'label', alias: 'a', text: 'Other', source: 'ai' })]);
    expect(String(again.doc.uiSchema.a['ui:formattedText'])).toContain('Telephone:');
  });
});

describe('proposals accepted one at a time', () => {
  it('puts the investor type question into the Subscriber Information group an earlier accepted move made, in either order', () => {
    const base = () => raw(
      [{ name: 'sa', type: 'object', title: 'Agreement', properties: [{ name: 'pdf', type: 'null', title: 'sa' }, { name: 'note', type: 'string', title: 'n' }] },
        { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'gh', type: 'null', title: 'GI' }, { name: 'q1', type: 'string', title: 'q1' }] }],
      { sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' }, note: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Note</p>' }, gi: { 'ui:widget': 'Page' }, gh: { 'ui:widget': 'Header', 'ui:heading': 'GI' }, q1: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Q1</p>' } },
    );
    const move = dec('mv', { kind: 'move-fields', aliases: ['note'], targetPage: 'gi', wrapperTitle: 'Subscriber Information' });
    const type = dec('t', { kind: 'investor-type', value: { source: 'instructions', selectionMode: 'radio', existingGroupAlias: null, individual: [{ label: 'Individual', optionAlias: null }], entity: [{ label: 'Trust', optionAlias: null }], unplaced: [] } });
    const wrapperKids = (d: ReturnType<typeof base>) => d.schema.properties.find((n) => n.name === 'gi')?.properties?.find((n) => n.name === 'subscriber_information')?.properties?.map((n) => n.name);
    // move first, then the question accepted alone
    const one = applyDecisions(applyDecisions(base(), {}, [], [move]).doc, {}, [], [type]);
    expect(wrapperKids(one.doc)).toEqual(['investor_type', 'note']);
    // the question first, then the move accepted alone: the question still ends up first inside the new group
    const other = applyDecisions(applyDecisions(base(), {}, [], [type]).doc, {}, [], [move]);
    expect(wrapperKids(other.doc)).toEqual(['investor_type', 'note']);
    // and a second move reuses the group instead of making another
    const second = applyDecisions(one.doc, {}, [], [dec('mv2', { kind: 'move-fields', aliases: ['q1'], targetPage: 'gi', wrapperTitle: 'Subscriber Information' })]);
    expect(second.doc.schema.properties.find((n) => n.name === 'gi')?.properties?.filter((n) => n.name.startsWith('subscriber_information'))).toHaveLength(1);
  });
});

describe('previewNodes', () => {
  const before = () => doc();
  it('shows the field a label or optional change is about, drawn as it would be after', () => {
    const b = before();
    const after = applyDecisions(b, anchors, texts, [dec('o', { kind: 'optional', alias: 'fax' })]).doc;
    expect(previewNodes(b, after)).toEqual({ show: ['fax'], removed: [] });
  });
  it('shows a new group whole (an address split into elements) and lists what it takes away', () => {
    const b = before();
    const after = applyDecisions(b, anchors, texts, [dec('a', { kind: 'address', alias: 'mailaddr' })]).doc;
    const p = previewNodes(b, after);
    expect(p.show).toEqual(['mailaddr_address']);
    expect(p.removed).toEqual(['mailaddr']);
  });
  it('shows only what is new or moved inside a group that was already there', () => {
    const b = before();
    const after = applyDecisions(b, anchors, texts, [dec('s', { kind: 'signature', signatureAlias: 'sig', signerName: 'Individual Signatory', role: 'LpSignature' })]).doc;
    expect(previewNodes(b, after).show).toEqual(['sig']);
  });
});

import { MAY_BE_REQUIRED, cleanFileName, fileNameProblem, groupAlias } from './supportingDocs';
import { bulletText, mixedPageCandidates, supportingDocCandidates } from './candidates';
import { validateSupportingDocs } from './validate';

describe('supporting documents', () => {
  const li = (text: string, indent = 0) => `<li data-list="bullet"${indent ? ` class="ql-indent-${indent}"` : ''}><span class="ql-ui" contenteditable="false"></span>${text}</li>`;
  const natural = `<ul>${li('Copy of an unexpired passport, photo driver’s license or other government-issued photo ID.')}${li('Signed / dated copy of applicable IRS withholding form')}${li('For individuals investing through an IRA:')}${li('Signed / dated copy of applicable IRS withholding form for the IRA custodian', 1)}${li('Certificate of IRA custodian certifying that the subscription has been authorized', 1)}${li('Copy of a form of address verification')}${li('Power of Attorney or Personal Appointee will require a letter of authorization')}${li('The General Partner may request a copy of the beneficial ownership certificate')}</ul>`;
  const form = () => raw(
    [{ name: 'hidden', type: 'object', title: 'Hidden', properties: [] }, { name: 'aml', type: 'object', title: 'AML', properties: [
      { name: 'heading', type: 'null', title: 'h' }, { name: 'bullets', type: 'null', title: 'b' }, { name: 'legal', type: 'null', title: 'l' },
    ] }],
    {
      hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, aml: { 'ui:widget': 'Page' },
      heading: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p><strong>Natural Persons:</strong></p>' },
      bullets: { 'ui:widget': 'Paragraph', 'ui:formattedText': natural },
      legal: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>The Investor agrees to the terms of this agreement and the statement above.</p>' },
    },
  );

  it('reads a bullet list with its levels, and offers only paragraphs that may ask for documents', () => {
    expect(bulletText(natural).split('\n').slice(0, 5)).toEqual([
      '- Copy of an unexpired passport, photo driver’s license or other government-issued photo ID.', '- Signed / dated copy of applicable IRS withholding form', '- For individuals investing through an IRA:',
      '  - Signed / dated copy of applicable IRS withholding form for the IRA custodian', '  - Certificate of IRA custodian certifying that the subscription has been authorized',
    ]);
    const c = supportingDocCandidates(form());
    expect(c.map((x) => x.alias)).toEqual(['bullets']);
    expect(c[0]).toMatchObject({ pageTitle: 'AML', heading: 'Natural Persons:' });
  });

  it('knows the words that mean a document is not certain, and nothing else', () => {
    for (const t of ['Documents may be required', 'The GP may request a copy', 'available upon request', 'if requested by the General Partner', 'as the Partnership may reasonably request']) expect(MAY_BE_REQUIRED.test(t)).toBe(true);
    for (const t of ['Power of Attorney or Personal Appointee will require a letter of authorization', 'Copy of a form of address verification', 'Each trustee must provide a copy of the trust deed']) expect(MAY_BE_REQUIRED.test(t)).toBe(false);
  });

  it('cleans a file name of ending punctuation, and refuses a sentence, an order or an instruction (with no length limit)', () => {
    expect(cleanFileName('Copy of an unexpired passport, photo driver’s license or other government-issued photo ID.')).toBe('Copy of an unexpired passport, photo driver’s license or other government-issued photo ID');
    expect(cleanFileName('Certified copy of one of the following: ')).toBe('Certified copy of one of the following');
    expect(fileNameProblem('Copy of a form of address verification')).toBeNull();
    expect(fileNameProblem('A certified copy of the power of attorney or written authorisation for purposes of the Controlling Person Certification, together with a certified copy of every document that identifies who may act for the entity')).toBeNull();
    expect(fileNameProblem('Provide a copy of your passport')).toMatch(/instruction/);
    expect(fileNameProblem('Each trustee must provide the following: name')).toMatch(/instruction|must/);
    expect(fileNameProblem('Natural persons must submit a passport')).toMatch(/must/);
  });

  it('names the file group alias after the heading, and after the page for AML', () => {
    expect(groupAlias('For Trust', 'AML & KYC')).toBe('trust_aml');
    expect(groupAlias('For Natural Person', 'Documents')).toBe('natural_person_docs');
  });

  it('asks the model again when a name is a sentence, and drops aliases it was never given', () => {
    const known = new Set(['bullets']);
    expect(() => validateSupportingDocs({ groups: [{ paragraphAlias: 'bullets', groupName: 'For Natural Person', files: [{ description: 'Natural persons must submit a passport', helpText: [], sourceQuote: 'x' }] }] }, known)).toThrow(AiFormatError);
    expect(() => validateSupportingDocs({ groups: [{ paragraphAlias: 'bullets', groupName: 'Natural Person', files: [{ description: 'Passport', helpText: [], sourceQuote: 'x' }] }] }, known)).toThrow(/For /);
    expect(validateSupportingDocs({ groups: [{ paragraphAlias: 'made_up', groupName: 'For X', files: [{ description: 'Passport', helpText: [], sourceQuote: 'x' }] }] }, known)).toEqual([]);
  });

  const answer = JSON.stringify({ groups: [{ paragraphAlias: 'bullets', groupName: 'For Natural Person', confidence: 'high', files: [
    { description: 'Copy of an unexpired passport, photo driver’s license or other government-issued photo ID.', helpText: [], sourceQuote: 'Copy of an unexpired passport, photo driver’s license or other government-issued photo ID.' },
    { description: 'Signed / dated copy of applicable IRS withholding form', helpText: [], sourceQuote: 'Signed / dated copy of applicable IRS withholding form' },
    { description: 'Documents for individuals investing through an IRA', helpText: ['Signed / dated copy of applicable IRS withholding form for the IRA custodian', 'Certificate of IRA custodian certifying that the subscription has been authorized'], sourceQuote: 'For individuals investing through an IRA:' },
    { description: 'Copy of a form of address verification', helpText: [], sourceQuote: 'Copy of a form of address verification' },
    { description: 'A letter of authorization for Power of Attorney or Personal Appointee', helpText: [], sourceQuote: 'Power of Attorney or Personal Appointee will require a letter of authorization' },
    { description: 'Copy of the beneficial ownership certificate', helpText: [], sourceQuote: 'The General Partner may request a copy of the beneficial ownership certificate' },
  ] }] });

  it('proposes one file group per paragraph, skips what the sub-doc says "may" about, and logs the skip', async () => {
    const ask = async (task: string) => (task === 'supporting-docs' ? answer : '{}');
    const r = await judgeForm({ doc: form(), anchors: {}, pages: null, titleWords: [] }, ask);
    const d = r.decisions.find((x) => x.data.kind === 'supporting-docs') as Decision;
    expect(d.id).toBe('docs:bullets');
    expect(d.defaultAccepted).toBe(true);
    const data = d.data as Extract<Decision['data'], { kind: 'supporting-docs' }>;
    expect(data.files.map((f) => f.description)).toEqual([
      'Copy of an unexpired passport, photo driver’s license or other government-issued photo ID', 'Signed / dated copy of applicable IRS withholding form', 'Documents for individuals investing through an IRA',
      'Copy of a form of address verification', 'A letter of authorization for Power of Attorney or Personal Appointee',
    ]);
    expect(r.log).toEqual(['Supporting document "Copy of the beneficial ownership certificate" (For Natural Person) was not built: the sub-doc says "may request"']);
    expect(r.notes).toContain(r.log[0]);
  });

  it('builds the file group right below the paragraph, with the group name, the files and the help text', async () => {
    const ask = async (task: string) => (task === 'supporting-docs' ? answer : '{}');
    const b = form();
    const r = await judgeForm({ doc: b, anchors: {}, pages: null, titleWords: [] }, ask);
    const d = r.decisions.find((x) => x.id === 'docs:bullets') as Decision;
    const out = applyDecisions(b, {}, [], [d]).doc;
    const page = out.schema.properties[1].properties?.map((n) => n.name);
    expect(page).toEqual(['heading', 'bullets', 'natural_person_aml', 'natural_person_aml_note', 'legal']);
    // five documents: one generic blue message, not the list again
    expect(out.uiSchema.natural_person_aml_note).toMatchObject({ 'ui:widget': 'Paragraph', 'ui:wellType': 'Info', 'ui:formattedText': '<p>After completing the form, you will be asked to submit the list of documents above during the "Upload AML/KYC &amp; Other documents" process.</p>' });
    const node = out.schema.properties[1].properties?.[2];
    expect(node?.items?.enum).toEqual(['file1', 'file2', 'file3', 'file4', 'file5']);
    const g = out.uiSchema.natural_person_aml['ui:supportingFileGroup'] as { description: string; files: Record<string, { description: string; helpText: string }> };
    expect(g.description).toBe('For Natural Person');
    expect(g.files.file3.helpText).toBe('<ul><li>Signed / dated copy of applicable IRS withholding form for the IRA custodian</li><li>Certificate of IRA custodian certifying that the subscription has been authorized</li></ul>');
    expect(g.files.file1.helpText).toBe('');
    expect(previewNodes(b, out).show).toEqual(['natural_person_aml', 'natural_person_aml_note']);
  });

  it('names the one document in the blue message; several documents are "the list of documents above"', () => {
    const one = applyDecisions(form(), {}, [], [dec('d', { kind: 'supporting-docs', paragraphAlias: 'bullets', groupName: 'For Trust', files: [{ description: 'Copy of the trust deed', helpText: [] }] })]).doc;
    expect(one.uiSchema.trust_aml_note['ui:formattedText']).toBe('<p>After completing the form, you will be asked to submit the copy of the trust deed during the "Upload AML/KYC &amp; Other documents" process.</p>');
    const acronym = applyDecisions(form(), {}, [], [dec('d', { kind: 'supporting-docs', paragraphAlias: 'bullets', groupName: 'For Trust', files: [{ description: 'IRS Form W-9', helpText: [] }] })]).doc;
    expect(String(acronym.uiSchema.trust_aml_note['ui:formattedText'])).toContain('submit the IRS Form W-9 during');
  });

  it('when the sub-doc lets the investor provide the document instead of the form: an optional checkbox, then the upload and the message, at the end of the page before its signatures', () => {
    const b = raw(
      [{ name: 'hidden', type: 'object', title: 'Hidden', properties: [] }, { name: 'bank', type: 'object', title: 'Schedule E Banking Information', properties: [
        { name: 'note', type: 'null', title: 'n' }, { name: 'bankname', type: 'string', title: 'Bank Name' }, { name: 'bank_signatures', type: 'object', title: 'Signatures', properties: [{ name: 'sig', type: 'null', title: 'Signature' }] },
      ] }],
      { hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, bank: { 'ui:widget': 'Page' }, note: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>Note: Rather than completing this form, you may instead provide a copy of a void cheque.</p>' }, bankname: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Bank Name</p>' }, bank_signatures: { 'ui:widget': 'Group' }, sig: { 'ui:widget': 'Signature' } },
    );
    const r = applyDecisions(b, {}, [], [dec('d', { kind: 'supporting-docs', paragraphAlias: 'note', groupName: 'For Schedule E Banking Information', instead: true, files: [{ description: 'Copy of a void cheque', helpText: [] }] })]);
    expect(r.doc.schema.properties[1].properties?.map((n) => n.name)).toEqual(['note', 'bankname', 'schedule_e_banking_information_docs_instead', 'schedule_e_banking_information_docs', 'schedule_e_banking_information_docs_note', 'bank_signatures']);
    const check = r.doc.uiSchema.schedule_e_banking_information_docs_instead;
    expect(check).toMatchObject({ 'ui:widget': 'MultipleCheckbox' });
    expect(check['ui:required']).toBeUndefined();
    const opt = (check['ui:multipleOption'] as { options: [string, { formattedText: string; fieldsBelow: string[] }][] }).options[0][1];
    expect(opt.formattedText).toBe('<p>Check this box if you would like to provide the copy of a void cheque instead of completing the form above.</p>');
    expect(opt.fieldsBelow).toEqual(['schedule_e_banking_information_docs', 'schedule_e_banking_information_docs_note']);
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE'))).toBe(true);
  });
});

import { composeFileName, embeddedPdfFacts, overlaps, pageToPrecede, trimSignaturePages } from './embeddedPdfs';
import { validateEmbeddedPdfs } from './validate';

describe('embedded PDFs', () => {
  it('names the file "Fund - Document.pdf", with no fund name just the document, and never the sub-doc\'s own name', () => {
    expect(composeFileName('Blackstone Private IG', 'Subscription Agreement')).toBe('Blackstone Private IG - Subscription Agreement.pdf');
    expect(composeFileName('', 'Subscription Agreement.pdf')).toBe('Subscription Agreement.pdf');
    expect(composeFileName('Fund', 'Subscription Documents', 'Fund - Subscription Documents.pdf')).toBe('Fund - Subscription Documents (excerpt).pdf');
  });
  it('leaves a trailing signature page out, unless the document goes on or the page has other content to read', () => {
    expect(trimSignaturePages(8, 28, [28, 40], false)).toBe(27);
    expect(trimSignaturePages(8, 29, [28, 29], false)).toBe(27);
    expect(trimSignaturePages(8, 28, [28], true)).toBe(28);
    expect(trimSignaturePages(8, 30, [20, 28], false)).toBe(30); // a signature page in the middle stays
    expect(trimSignaturePages(5, 5, [5], false)).toBe(5); // never an empty range
  });
  it('checks page numbers against the PDF, and cleans the name', () => {
    expect(validateEmbeddedPdfs({ documents: [{ name: 'Annex 3.pdf', startPage: 65, endPage: 65, confidence: 'high' }] }, 76)).toMatchObject([{ name: 'Annex 3', startPage: 65, endPage: 65 }]);
    expect(() => validateEmbeddedPdfs({ documents: [{ name: 'X', startPage: 70, endPage: 90 }] }, 76)).toThrow(AiFormatError);
    expect(() => validateEmbeddedPdfs({ documents: [{ name: 'X', startPage: 10, endPage: 9 }] }, 76)).toThrow(/ends before/);
  });
  it('finds overlaps', () => {
    expect(overlaps({ start: 2, end: 7 }, { start: 7, end: 9 })).toBe(true);
    expect(overlaps({ start: 2, end: 7 }, { start: 8, end: 9 })).toBe(false);
  });

  const form = () => raw(
    [{ name: 'hidden', type: 'object', title: 'Hidden', properties: [{ name: 'file0', type: 'null', title: 'Sub-doc.pdf' }] },
      { name: 'dir', type: 'object', title: 'Directions', properties: [{ name: 'gen_header1', type: 'null', title: 'D' }, { name: 'emb', type: 'null', title: 'Directions.pdf' }] },
      { name: 'gi', type: 'object', title: 'General Information', properties: [{ name: 'q', type: 'string', title: 'Name' }] },
      { name: 'aml', type: 'object', title: 'AML', properties: [{ name: 'p', type: 'null', title: 'p' }] }],
    {
      hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, file0: { 'ui:widget': 'File', 'ui:fileName': 'Sub-doc.pdf' },
      dir: { 'ui:widget': 'Page' }, gen_header1: { 'ui:widget': 'Header', 'ui:heading': 'D' }, emb: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Directions.pdf', 'ui:pdfCutInfo': { start: 2, end: 7, fileId: '', reviewingFileId: null } },
      gi: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name</p>', 'ui:pdfMapping': ['q'] },
      aml: { 'ui:widget': 'Page' }, p: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>Documents</p>' },
    },
  );
  const anchorsEp: Anchors = { q: box(35, 0.1), sig: box(27, 0.5) };
  const pdf = Array.from({ length: 40 }, (_, i) => ({ page: i, lines: [{ top: 0.1, text: i === 7 ? 'SUBSCRIPTION AGREEMENT' : `page ${i + 1}` }], text: '' }));

  it('describes the sub-doc pages to the AI: headings, fields, signature pages, what is embedded, where the form pages start', () => {
    const f = embeddedPdfFacts(form(), anchorsEp, pdf);
    expect(f.total).toBe(40);
    expect(f.pages[7]).toMatchObject({ page: 8, head: 'SUBSCRIPTION AGREEMENT', fields: 0 });
    expect(f.pages[35]).toMatchObject({ page: 36, fields: 1 });
    expect(f.existing).toEqual([{ start: 2, end: 7, name: 'Directions.pdf' }]);
    expect(f.formPages.map((p) => [p.name, p.firstPage])).toEqual([['dir', 2], ['gi', 36], ['aml', null]]);
    expect(pageToPrecede(f, 8)).toBe('gi');
    expect(pageToPrecede(f, 60)).toBeNull();
  });

  it('proposes new pages, never over an existing range, with the signature page left out, the file named, and the page placed in sub-doc order', async () => {
    const answer = JSON.stringify({ documents: [
      { name: 'Subscription Agreement', startPage: 8, endPage: 28, keepSignaturePage: false, startHeading: 'SUBSCRIPTION AGREEMENT', endHeading: 'Signature page', confidence: 'high' },
      { name: 'Directions Again', startPage: 3, endPage: 5, confidence: 'high' },
      { name: 'Annex 1', startPage: 37, endPage: 39, confidence: 'low' },
    ] });
    const ask = async (task: string) => (task === 'embedded-pdfs' ? answer : '{}');
    const sigDoc = raw([...form().schema.properties, { name: 'sg', type: 'object', title: 'Sig', properties: [{ name: 'sig', type: 'null', title: 'Signature' }] }], { ...form().uiSchema, sg: { 'ui:widget': 'Page' }, sig: { 'ui:widget': 'Signature', 'ui:signature': [{ mapping: 'sig', signatureType: 'Signature', isOptional: false }] } });
    const r = await judgeForm({ doc: sigDoc, anchors: { ...anchorsEp, sig: box(27, 0.5) }, pages: pdf, titleWords: [], fundName: 'Blackstone Private IG' }, ask);
    const ds = r.decisions.filter((x) => x.data.kind === 'embedded-pdf');
    expect(ds.map((d) => d.id)).toEqual(['pdf:8-27', 'pdf:37-39']);
    expect(ds[0].data).toMatchObject({ fileName: 'Blackstone Private IG - Subscription Agreement.pdf', title: 'Subscription Agreement', start: 8, end: 27, beforePage: 'gi', subtitle: 'Blackstone Private IG' });
    expect(ds[0].defaultAccepted).toBe(true);
    expect(ds[1].defaultAccepted).toBe(false); // low confidence is not ticked
    expect(r.notes.some((n) => n.includes('"Directions Again"') && n.includes('already embedded'))).toBe(true);
  });

  it('builds the page before the page it goes before, with the heading, the review sentence and the PDF cut from the sub-doc', () => {
    const b = form();
    const out = applyDecisions(b, {}, [], [dec('p', { kind: 'embedded-pdf', fileName: 'Fund - Subscription Agreement.pdf', title: 'Subscription Agreement', start: 8, end: 27, beforePage: 'gi', subtitle: 'Fund' })]).doc;
    expect(out.schema.properties.map((n) => n.name)).toEqual(['hidden', 'dir', 'subscription_agreement', 'gi', 'aml']);
    const page = out.schema.properties[2];
    expect(page.properties?.map((n) => n.name)).toEqual(['gen_header', 'pdf_review_note', 'subscription_agreement_pdf']);
    expect(out.uiSchema.gen_header).toMatchObject({ 'ui:heading': 'SUBSCRIPTION AGREEMENT', 'ui:subtitle': 'Fund' });
    expect(out.uiSchema.subscription_agreement_pdf).toMatchObject({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund - Subscription Agreement.pdf', 'ui:pdfCutInfo': { start: 8, end: 27, fileId: '', reviewingFileId: null } });
    expect(out.uiSchema.subscription_agreement_pdf['ui:viewInModal']).toBeUndefined();
    expect(previewNodes(b, out).show).toEqual(['subscription_agreement']);
    const at = applyDecisions(b, {}, [], [dec('p', { kind: 'embedded-pdf', fileName: 'F - A.pdf', title: 'Annex 3', start: 65, end: 65, beforePage: null, subtitle: '' })]).doc;
    expect(at.schema.properties.map((n) => n.name)).toEqual(['hidden', 'dir', 'gi', 'aml', 'annex_3']);
  });
});

describe('embedded PDF pages are never proposals inside another page', () => {
  it('are built as pages of their own, and taken out of the proposals; the other proposals stay', () => {
    const d = doc();
    const set = { texts: [], notes: [], decisions: [
      dec('pdf:8-27', { kind: 'embedded-pdf', fileName: 'F - Subscription Agreement.pdf', title: 'Subscription Agreement', start: 8, end: 27, beforePage: 'p1', subtitle: 'F' }),
      dec('optional:fax', { kind: 'optional', alias: 'fax' }),
    ] };
    const r = buildEmbeddedPages(d, anchors, set);
    expect(r.built).toBe(1);
    expect(r.doc.schema.properties.map((n) => n.name)).toEqual(['hidden', 'subscription_agreement', 'p1']);
    // the new page is top level: no page holds another page
    expect(r.doc.schema.properties.every((n) => !(n.properties ?? []).some((c) => r.doc.uiSchema[c.name]?.['ui:widget'] === 'Page'))).toBe(true);
    expect(r.set.decisions.map((x) => x.id)).toEqual(['optional:fax']);
    expect(r.log.length).toBeGreaterThan(0);
    // nothing to build: the same objects come back
    expect(buildEmbeddedPages(d, anchors, r.set)).toMatchObject({ built: 0, doc: d, set: r.set });
  });
});

describe('what an accepted proposal leaves behind', () => {
  it('a page left with only its heading is removed, and a proposal that keeps every text reports none lost', () => {
    const d = raw(
      [{ name: 'a', type: 'object', title: 'A', properties: [{ name: 'ah', type: 'null', title: 'A' }, { name: 'q', type: 'string', title: 'q' }] }, { name: 'b', type: 'object', title: 'B', properties: [{ name: 'bh', type: 'null', title: 'B' }, { name: 'r', type: 'string', title: 'r' }] }],
      { a: { 'ui:widget': 'Page' }, ah: { 'ui:widget': 'Header', 'ui:heading': 'A' }, q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Telephone number of the investor</p>' }, b: { 'ui:widget': 'Page' }, bh: { 'ui:widget': 'Header', 'ui:heading': 'B' }, r: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Other</p>' } },
    );
    const r = applyDecisions(d, {}, [], [dec('mv', { kind: 'move-fields', aliases: ['q'], targetPage: 'b', wrapperTitle: 'Moved' })]);
    expect(r.doc.schema.properties.map((n) => n.name)).toEqual(['b']);
    const gone = applyDecisions(d, {}, ['Telephone number of the investor'], [dec('d', { kind: 'optional', alias: 'r' })]);
    expect(gone.warnings.filter((w) => w.startsWith('TEXT LOST'))).toEqual([]);
  });
});

describe('embedded PDF pages that ask for an agreement or a consent', () => {
  const base = { kind: 'embedded-pdf' as const, fileName: 'F - X.pdf', title: 'X', start: 8, end: 27, beforePage: null, subtitle: 'F' };
  const d0 = () => raw([{ name: 'p1', type: 'object', title: 'P', properties: [{ name: 'f', type: 'string', title: 'f' }] }], { p1: { 'ui:widget': 'Page' }, f: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Field</p>' } });
  it('get the checkbox right under the PDF inside their own page', () => {
    const out = applyDecisions(d0(), {}, [], [dec('a', { ...base, title: 'Subscription Agreement', confirm: 'agreement' })]).doc;
    const page = out.schema.properties[1];
    expect(page.properties?.map((n) => n.name)).toEqual(['gen_header', 'pdf_review_note', 'subscription_agreement_pdf', 'subscription_agreement_pdf_agreement']);
    expect(out.uiSchema.subscription_agreement_pdf_agreement['ui:required']).toBe('This field is required');
    const c = applyDecisions(d0(), {}, [], [dec('c', { ...base, title: 'Privacy Consent', confirm: 'consent' })]).doc;
    expect(c.uiSchema.privacy_consent_pdf_consent['ui:required']).toBeUndefined();
    const none = applyDecisions(d0(), {}, [], [dec('n', { ...base, title: 'Annex 1', confirm: null })]).doc;
    expect(none.schema.properties[1].properties?.map((n) => n.name)).toEqual(['gen_header', 'pdf_review_note', 'annex_1_pdf']);
  });
  it('the AI says what the document asks, with the name as the fallback', async () => {
    const pdf = Array.from({ length: 40 }, (_, i) => ({ page: i, lines: [{ top: 0.1, text: `page ${i + 1}` }], text: '' }));
    const answer = JSON.stringify({ documents: [
      { name: 'Subscription Agreement', startPage: 8, endPage: 20, confidence: 'high' },
      { name: 'Privacy Notice', startPage: 21, endPage: 24, confirm: 'consent', confidence: 'high' },
      { name: 'Annex 1', startPage: 25, endPage: 27, confirm: null, confidence: 'high' },
    ] });
    const r = await judgeForm({ doc: d0(), anchors: {}, pages: pdf, titleWords: [] }, async (t) => (t === 'embedded-pdfs' ? answer : '{}'));
    const confirms = r.decisions.filter((x) => x.data.kind === 'embedded-pdf').map((x) => (x.data as { confirm?: unknown }).confirm);
    expect(confirms).toEqual(['agreement', 'consent', null]);
  });
});

describe('supporting documents given instead of a form; confirmation boxes stay with their PDF', () => {
  it('reads "instead" from the answer', () => {
    const files = [{ description: 'Copy of a void cheque', helpText: [], sourceQuote: 'you may instead provide a copy of a void cheque' }];
    const known = new Set(['note']);
    expect(validateSupportingDocs({ groups: [{ paragraphAlias: 'note', groupName: 'For Banking', instead: true, files }] }, known)[0].instead).toBe(true);
    expect(validateSupportingDocs({ groups: [{ paragraphAlias: 'note', groupName: 'For Banking', files }] }, known)[0].instead).toBe(false);
  });
  it('never offers the agreement checkbox under a full-page PDF as a field to move off that page', () => {
    const d = raw(
      [{ name: 'sa', type: 'object', title: 'Subscription Agreement', properties: [{ name: 'pdf', type: 'null', title: 'f.pdf' }, { name: 'sa_agreement', type: 'array', title: 'Agreement confirmation', items: { type: 'string', enum: ['agree'] } }, { name: 'other', type: 'string', title: 'Other' }] }],
      { sa: { 'ui:widget': 'Page' }, pdf: { 'ui:widget': 'Pdf' }, sa_agreement: { 'ui:widget': 'MultipleCheckbox', 'ui:multipleOption': { options: [['agree', { formattedText: '<p><strong>I confirm that I have read, understand, and agree to the above. *</strong></p>' }]] } }, other: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Other</p>' } },
    );
    expect(mixedPageCandidates(d)[0].fields.map((f) => f.alias)).toEqual(['other']);
  });
});

import { validateGroupLabelPicks } from './validate';
import { validateStructure } from './structure';
import type { StructureFacts } from '../structure';

describe('the questions above choices, picked by line number', () => {
  it('takes a run of the printed lines by number, drops an alias it was not given, and refuses a run that is not there', () => {
    const offered = new Map([['q1', 5]]);
    expect(validateGroupLabelPicks({ labels: [{ alias: 'q1', from: 1, to: 3, confidence: 'high' }, { alias: 'other', from: 0, to: 0 }, { alias: 'q1', from: null, to: null }] }, offered)).toEqual([{ alias: 'q1', from: 1, to: 3, confidence: 'high' }]);
    expect(() => validateGroupLabelPicks({ labels: [{ alias: 'q1', from: 2, to: 9 }] }, offered)).toThrow(AiFormatError);
    expect(() => validateGroupLabelPicks({ labels: [{ alias: 'q1', from: 3, to: 1 }] }, offered)).toThrow(AiFormatError);
  });
});

describe('the structure plan', () => {
  const facts: StructureFacts = {
    headings: [{ id: 'h1', page: 34, top: 0.2, text: 'E. Supplemental Data for Entities', kind: 'lettered' }],
    pageNames: ['a', 'b'],
    pages: [{ name: 'a', title: 'A', source: 'alias', startPage: 5, heading: null, candidates: [], firstTexts: [], proposed: null }],
    runs: [
      { id: 'r1', count: 3, fromPage: 35, toPage: 36, kinds: {}, sample: [], heading: null, hideable: false, action: { kind: 'hidden' } },
      { id: 'r2', count: 2, fromPage: 20, toPage: 20, kinds: {}, sample: [], heading: null, hideable: true, action: { kind: 'hidden' } },
    ],
  };
  it('names a heading by its id, a page by its name, and hides only what may be hidden', () => {
    const plan = validateStructure({ runs: [{ run: 'r1', action: 'new', headingId: 'h1' }, { run: 'r2', action: 'hidden' }], pages: [{ page: 'a', title: 'Consent for the Processing of Personal Data' }] }, facts);
    expect(plan.runs).toEqual({ r1: { kind: 'new', title: 'E. Supplemental Data for Entities', headingId: 'h1' }, r2: { kind: 'hidden' } });
    expect(plan.titles.a).toEqual({ title: 'Consent for the Processing of Personal Data' });
  });
  it('refuses to hide a run with fields an investor fills, a page that is not there, an invented heading, and a title that is an alias', () => {
    expect(() => validateStructure({ runs: [{ run: 'r1', action: 'hidden' }] }, facts)).toThrow(/cannot be hidden/);
    expect(() => validateStructure({ runs: [{ run: 'r1', action: 'page', page: 'zzz' }] }, facts)).toThrow(AiFormatError);
    expect(() => validateStructure({ runs: [{ run: 'r1', action: 'new', headingId: 'h99' }] }, facts)).toThrow(AiFormatError);
    expect(() => validateStructure({ pages: [{ page: 'a', title: 'sensitive_personal_information' }] }, facts)).toThrow(AiFormatError);
  });
});
