import { describe, expect, it } from 'vitest';
import { loadForm } from '../model/loadForm';
import { applyDecisions } from './ai/apply';
import { buildEmbeddedPages } from './ai/proposals';
import { judgeForm } from './ai/tasks';
import type { Decision } from './ai/types';
import { AiFormatError, validateGroups } from './ai/validate';
import { childrenOf, closeRange, resolveRange, startNumber } from './grouping';
import { runStandards } from './standards';
import type { StandardContext } from './standards/types';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const opt = (value: string, label: string, below: string[] = []): [string, Record<string, unknown>] => [value, { formattedText: `<p>${label}</p>`, pdfMappings: [], blueprintMetadataMapping: '', ...(below.length ? { fieldsBelow: below } : {}) }];
const text = (label: string) => ({ 'ui:widget': 'TextBox', 'ui:formattedText': `<p>${label}</p>` });
const para = (label: string) => ({ 'ui:widget': 'Paragraph', 'ui:formattedText': `<p>${label}</p>` });
const leaf = (name: string) => ({ name, type: 'string', title: name });

// A page: heading, question 1 with a box under an option and a note, question 2 alone, question 3 with a follow-up, question 4, then an unnumbered section and question 9.
const nodes = [{ name: 'pg', type: 'object', title: 'Page', properties: [
  { name: 'h', type: 'null', title: 'h' },
  { name: 'q1', type: 'string', title: 'q1', enum: ['y', 'n'] }, leaf('q1_box'), leaf('q1_note'),
  leaf('q2'),
  leaf('q3'), leaf('q3_more'), leaf('q4'),
  leaf('sec_title'), leaf('sec_a'), leaf('sec_b'),
  leaf('q9'),
] }];
const ui: Ui = {
  pg: { 'ui:widget': 'Page' }, h: { 'ui:widget': 'Header', 'ui:heading': 'H' },
  q1: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>1. Are you?</p>', 'ui:multipleOption': { options: [opt('y', 'Yes', ['q1_box']), opt('n', 'No')] } },
  q1_box: text('Why'), q1_note: para('Note: if yes, tell us.'),
  q2: text('2. Name'),
  q3: text('3. City'), q3_more: text('Postcode'), q4: text('4. Zip'),
  sec_title: para('Contact:'), sec_a: text('Name'), sec_b: text('Phone'),
  q9: text('9. Anything else'),
};
const run = (d = raw(nodes, ui), ids?: string[]) => {
  const ctx: StandardContext = { doc: d, anchors: {}, texts: [], log: () => {}, warn: () => {} };
  runStandards(ctx, ids ?? ['hidden-page', 'tax-forms']);
  return ctx.doc;
};
const names = (d: ReturnType<typeof raw>, parent: string) => childrenOf(d, parent).map((n) => n.name);
const dec = (id: string, data: Decision['data'], confidence: Decision['confidence'] = 'high'): Decision => ({ id, title: id, detail: '', evidence: null, confidence, defaultAccepted: confidence !== 'low', data });

describe('the number a question starts with', () => {
  it('is read from the label; 12(b) belongs to question 12', () => {
    expect(startNumber('13. U.S. Taxpayer Identification Number')).toBe(13);
    expect(startNumber('4) Place of birth')).toBe(4);
    expect(startNumber('12(b). If question 12(a) was answered')).toBeNull();
    expect(startNumber('Name:')).toBeNull();
  });
});

describe('numbered questions in groups', () => {
  const d = run(raw(nodes, ui), ['hidden-page', 'tax-forms']);
  it('puts a question with what belongs to it in a group, from its number to the next number', () => {
    expect(names(d, 'pg')).toEqual(['h', 'question_1', 'q2', 'question_3', 'q4', 'sec_title', 'sec_a', 'sec_b', 'q9']);
    expect(names(d, 'question_1')).toEqual(['q1', 'q1_box', 'q1_note']);
    expect(names(d, 'question_3')).toEqual(['q3', 'q3_more']);
    expect(d.uiSchema.question_1).toMatchObject({ 'ui:widget': 'Group' });
    expect(d.uiSchema.question_1['ui:formattedText']).toBeUndefined(); // only a name in the table of contents
    expect(childrenOf(d, 'pg')[1].title).toBe('Question 1');
  });
  it('leaves a question with nothing attached alone, and does not guess across a gap in the numbers (4 to 9)', () => {
    expect(names(d, 'pg')).toContain('q2');
    expect(names(d, 'pg')).toEqual(expect.arrayContaining(['q4', 'sec_title', 'sec_a', 'sec_b']));
  });
});

describe('closing a run over the boxes below options', () => {
  const d = raw(nodes, ui);
  const list = childrenOf(d, 'pg');
  it('takes the question with its box, and the box with its question', () => {
    expect(closeRange(d, list, 1, 1)).toEqual([1, 2]);
    expect(closeRange(d, list, 2, 3)).toEqual([1, 3]);
  });
  it('refuses a run with a heading in it', () => {
    expect(closeRange(d, list, 0, 3)).toBeNull();
  });
});

describe('finding a run by its two ends', () => {
  it('works after a group was built around one end', () => {
    const d = run();
    // question_3 now holds q3 and q3_more; a run from q3 to sec_b is [question_3 .. sec_b]
    expect(resolveRange(d, 'q3', 'sec_b')).toEqual({ parent: 'pg', from: 3, to: 7 });
    expect(resolveRange(d, 'q3', 'q3_more')).toEqual({ parent: 'question_3', from: 0, to: 1 });
    expect(resolveRange(d, 'pg', 'q9')).toBeNull(); // one holds the other
  });
});

describe('the groups the AI chooses', () => {
  it('must be runs of 2 or more, apart or one inside the other, with the opening element outside', () => {
    expect(() => validateGroups({ groups: [{ name: 'A', start: 3, end: 3 }] }, 10)).toThrow(AiFormatError);
    expect(() => validateGroups({ groups: [{ name: 'A', start: 1, end: 9 }] }, 5)).toThrow(AiFormatError);
    expect(() => validateGroups({ groups: [{ name: 'A', start: 1, end: 4 }, { name: 'B', start: 3, end: 6 }] }, 10)).toThrow(/overlap/);
    expect(() => validateGroups({ groups: [{ name: 'C', start: 4, end: 6, kind: 'conditional', controlIndex: 5 }] }, 10)).toThrow(/outside/);
    const ok = validateGroups({ groups: [{ name: 'Outer.', start: 1, end: 8, confidence: 'high' }, { name: 'Inner', start: 3, end: 5, kind: 'conditional', controlIndex: 2, condition: 'Q1 is Yes' }] }, 10);
    expect(ok.map((g) => g.name)).toEqual(['Outer', 'Inner']);
  });

  const ask = (answer: unknown) => async (task: string) => (task.startsWith('grouping:') ? JSON.stringify(answer) : '{}');
  const grouped = () => run(); // the page after the numbered rule: h, question_1, q2, question_3, q4, sec_title, sec_a, sec_b, q9

  it('become decisions by the aliases at their two ends, biggest first, and a condition names the element that opens it', async () => {
    const d = grouped();
    const r = await judgeForm({ doc: d, anchors: {}, pages: null, titleWords: [] }, ask({ groups: [
      { name: 'Contact', start: 5, end: 7, kind: 'section', confidence: 'high' },
      { name: 'Details', start: 1, end: 7, kind: 'conditional', controlIndex: 0, confidence: 'medium', condition: 'x' },
    ] }));
    const gs = r.decisions.filter((x) => x.data.kind === 'group');
    expect(gs.map((x) => (x.data as { name: string }).name)).toEqual(['Details', 'Contact']);
    expect(gs[0].data).toMatchObject({ fromAlias: 'question_1', toAlias: 'sec_b', groupKind: 'conditional', controlAlias: 'h', size: 7 });
  });

  it('are built outer first, so the inner one finds its place; a group that would hold its own opener is not built', () => {
    const d = grouped();
    const outer = dec('o', { kind: 'group', name: 'Everything', fromAlias: 'question_3', toAlias: 'sec_b', groupKind: 'section', controlAlias: null, condition: null, size: 5 });
    const inner = dec('i', { kind: 'group', name: 'Contact', fromAlias: 'sec_title', toAlias: 'sec_b', groupKind: 'section', controlAlias: null, condition: null, size: 3 });
    const out = applyDecisions(d, {}, [], [inner, outer]).doc;
    expect(names(out, 'pg')).toEqual(['h', 'question_1', 'q2', 'everything', 'q9']);
    expect(names(out, 'everything')).toEqual(['question_3', 'q4', 'contact']);
    expect(names(out, 'contact')).toEqual(['sec_title', 'sec_a', 'sec_b']);
    // the element that opens a conditional group stays outside it
    const bad = dec('b', { kind: 'group', name: 'Shown by q2', fromAlias: 'q2', toAlias: 'question_3', groupKind: 'conditional', controlAlias: 'q2', condition: 'q2', size: 2 });
    const res = applyDecisions(d, {}, [], [bad]);
    expect(names(res.doc, 'pg')).toEqual(names(d, 'pg'));
    expect(res.warnings.some((w) => w.startsWith('GROUP NOT BUILT'))).toBe(true);
  });

  it('a conditional group asks for a rule, and groups built after another was built around its end still land right', () => {
    const d = grouped();
    const first = dec('f', { kind: 'group', name: 'Contact', fromAlias: 'sec_title', toAlias: 'sec_b', groupKind: 'section', controlAlias: null, condition: null, size: 3 });
    const built = applyDecisions(d, {}, [], [first]).doc;
    // the outer one is proposed later; its end is now inside the group built first
    const outer = dec('o', { kind: 'group', name: 'Rest', fromAlias: 'q2', toAlias: 'sec_a', groupKind: 'conditional', controlAlias: 'q1', condition: 'Question 1 is Yes', size: 5 });
    const r = applyDecisions(built, {}, [], [outer]);
    expect(names(r.doc, 'pg')).toEqual(['h', 'question_1', 'rest', 'q9']);
    expect(names(r.doc, 'rest')).toEqual(['q2', 'question_3', 'q4', 'contact']);
    expect(r.warnings.some((w) => w.startsWith('NEEDS RULE: show rest only when Question 1 is Yes'))).toBe(true);
  });

  it('the sure ones are built into the form, the unsure ones stay proposals', () => {
    const d = grouped();
    const sure = dec('s', { kind: 'group', name: 'Contact', fromAlias: 'sec_title', toAlias: 'sec_b', groupKind: 'section', controlAlias: null, condition: null, size: 3 }, 'medium');
    const unsure = dec('u', { kind: 'group', name: 'Maybe', fromAlias: 'q2', toAlias: 'question_3', groupKind: 'section', controlAlias: null, condition: null, size: 2 }, 'low');
    const r = buildEmbeddedPages(d, {}, { decisions: [sure, unsure], notes: [], texts: [] });
    expect(r).toMatchObject({ groups: 1, pages: 0 });
    expect(r.set.decisions.map((x) => x.id)).toEqual(['u']);
    expect(names(r.doc, 'pg')).toContain('contact');
  });
});
