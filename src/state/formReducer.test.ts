import { describe, expect, it } from 'vitest';
import type { Decision } from '../generator/ai/types';
import type { FormDoc } from '../model/types';
import { buildNewField } from '../model/addField';
import { getAllPages } from '../model/schemaWalk';
import { formReducer, initialState } from './formReducer';

const doc: FormDoc = {
  schema: {
    type: 'object',
    properties: [
      { name: 'p', type: 'object', title: 'Page', properties: [
        { name: 'a', type: 'string', title: 'A' },
        { name: 'b', type: 'string', title: 'B' },
      ] },
    ],
  },
  uiSchema: { p: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'TextBox' } },
};
const fresh = () => initialState(doc);

describe('initialState', () => {
  it('selects the first page', () => {
    expect(fresh().activePage).toBe('p');
  });
  it('has no active page when the doc has none', () => {
    expect(initialState({ schema: { type: 'object', properties: [] }, uiSchema: {} }).activePage).toBeNull();
  });
});

describe('values and edits', () => {
  it('sets values by field name', () => {
    let s = formReducer(fresh(), { type: 'setValue', name: 'a', value: 'x' });
    s = formReducer(s, { type: 'setValue', name: 'b', value: 'y' });
    expect(s.values).toEqual({ a: 'x', b: 'y' });
  });
  it('editDoc replaces uiSchema and/or schema', () => {
    const edited = { ...doc.uiSchema, a: { 'ui:widget': 'Money' } };
    let s = formReducer(fresh(), { type: 'editDoc', uiSchema: edited });
    expect(s.doc.uiSchema.a['ui:widget']).toBe('Money');
    expect(s.doc.schema).toBe(doc.schema);
    const schema = { type: 'object' as const, properties: [] };
    s = formReducer(s, { type: 'editDoc', schema });
    expect(s.doc.schema).toBe(schema);
    expect(s.doc.uiSchema).toBe(edited);
  });
});

describe('loadDoc, toggles, notices', () => {
  it('loadDoc replaces everything but keeps showInvisible', () => {
    let s = formReducer(fresh(), { type: 'toggleInvisible' });
    s = formReducer(s, { type: 'setValue', name: 'a', value: 'x' });
    s = formReducer(s, { type: 'select', name: 'a' });
    const next: FormDoc = { schema: { type: 'object', properties: [] }, uiSchema: {} };
    s = formReducer(s, { type: 'loadDoc', doc: next });
    expect(s.doc).toBe(next);
    expect(s.values).toEqual({});
    expect(s.selection).toBeNull();
    expect(s.showInvisible).toBe(false);
  });
  it('toggleInvisible flips and setPage/select/notify/dismiss work', () => {
    expect(fresh().showInvisible).toBe(true);
    let s = formReducer(fresh(), { type: 'toggleInvisible' });
    expect(s.showInvisible).toBe(false);
    s = formReducer(s, { type: 'select', name: 'b' });
    expect(s.selection).toBe('b');
    s = formReducer(s, { type: 'setPage', name: 'p' });
    expect(s.activePage).toBe('p');
    s = formReducer(s, { type: 'notify', message: 'hi' });
    expect(s.notice).toBe('hi');
    s = formReducer(s, { type: 'dismissNotice' });
    expect(s.notice).toBeNull();
  });
  it('notify leaves the doc untouched (failed load keeps the current form)', () => {
    const s = fresh();
    expect(formReducer(s, { type: 'notify', message: 'File is not valid JSON' }).doc).toBe(s.doc);
  });
});

describe('hidden pages (Review: invisible pages)', () => {
  const twoPages: FormDoc = {
    schema: {
      type: 'object',
      properties: [
        { name: 'p1', type: 'object', title: 'Hidden', properties: [] },
        { name: 'p2', type: 'object', title: 'Shown', properties: [] },
      ],
    },
    uiSchema: { p1: { 'ui:widget': 'Page', 'ui:invisible': true }, p2: { 'ui:widget': 'Page' } },
  };
  it('shows invisible pages greyed out, but opens on the first page that is not hidden', () => {
    expect(initialState(twoPages).activePage).toBe('p2');
    expect(getAllPages(initialState(twoPages).doc, true).map((p) => p.name)).toEqual(['p1', 'p2']);
  });
  it('moves off a hidden page when invisible pages are turned off', () => {
    let s = formReducer(initialState(twoPages), { type: 'setPage', name: 'p1' });
    expect(s.activePage).toBe('p1');
    s = formReducer(s, { type: 'toggleInvisible' });
    expect(s.showInvisible).toBe(false);
    expect(s.activePage).toBe('p2');
  });
});

describe('adding fields', () => {
  it('startAdd opens the add panel and keeps the selection; cancelAdd closes it; select closes it', () => {
    let s = formReducer(fresh(), { type: 'select', name: 'a' });
    s = formReducer(s, { type: 'startAdd', widget: 'Email' });
    expect(s.adding).toEqual({ widget: 'Email' });
    expect(s.selection).toBe('a');
    expect(formReducer(s, { type: 'cancelAdd' }).adding).toBeNull();
    expect(formReducer(s, { type: 'select', name: 'b' }).adding).toBeNull();
  });
  it('addNode inserts, selects the new field and closes the panel', () => {
    const { node, ui } = buildNewField(doc, 'Email');
    let s = formReducer(fresh(), { type: 'startAdd', widget: 'Email' });
    s = formReducer(s, { type: 'addNode', node, ui, loc: { parent: 'p', after: 'a' } });
    expect(s.doc.schema.properties[0].properties!.map((n) => n.name)).toEqual(['a', 'email1', 'b']);
    expect(s.doc.uiSchema.email1['ui:widget']).toBe('Email');
    expect(s.selection).toBe('email1');
    expect(s.adding).toBeNull();
  });
  it('addNode of a Page makes it the active page and leaves nothing selected', () => {
    const { node, ui } = buildNewField(doc, 'Page');
    const s = formReducer(fresh(), { type: 'addNode', node, ui, loc: { parent: null, after: 'p' } });
    expect(s.activePage).toBe('page1');
    expect(s.selection).toBeNull();
    expect(s.doc.schema.properties.map((n) => n.name)).toEqual(['p', 'page1']);
  });
  it('loadDoc clears the add panel', () => {
    let s = formReducer(fresh(), { type: 'startAdd', widget: 'Email' });
    s = formReducer(s, { type: 'loadDoc', doc: { schema: { type: 'object', properties: [] }, uiSchema: {} } });
    expect(s.adding).toBeNull();
  });
});

describe('addNode guards (review finding #1)', () => {
  it('keeps the doc and shows a notice instead of throwing when a node cannot be inserted', () => {
    const nested: FormDoc = {
      schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'Rep', properties: [] }] },
      uiSchema: { rep: { 'ui:widget': 'Repeatable' } },
    };
    const { node, ui } = buildNewField(nested, 'Repeatable');
    let s = formReducer(initialState(nested), { type: 'startAdd', widget: 'Repeatable' });
    const before = s.doc;
    s = formReducer(s, { type: 'addNode', node, ui, loc: { parent: 'rep', after: null } });
    expect(s.doc).toBe(before);
    expect(s.notice).toMatch(/Repeatable/);
    expect(s.adding).toEqual({ widget: 'Repeatable' });
  });
  it('shows a notice for a duplicate name', () => {
    const { node, ui } = buildNewField(doc, 'Email');
    const s = formReducer(fresh(), { type: 'addNode', node: { ...node, name: 'a' }, ui, loc: { parent: 'p', after: null } });
    expect(s.notice).toMatch(/already/);
  });
});

describe('repeatable rows (Review Focus 3)', () => {
  const repDoc: FormDoc = {
    schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'c', type: 'string', title: 'C' }] }] },
    uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:maxLength': 2 }, c: { 'ui:widget': 'TextBox' } },
  };
  const start = () => initialState(repDoc);
  it('setRowValue writes into a row, materialising the array', () => {
    const s = formReducer(start(), { type: 'setRowValue', rep: 'rep', index: 0, name: 'c', value: 'x' });
    expect(s.values.rep).toEqual([{ c: 'x' }]);
  });
  it('addRow respects ui:maxLength and removeRow keeps the last row', () => {
    let s = formReducer(start(), { type: 'addRow', rep: 'rep' });
    expect(s.values.rep).toEqual([{}, {}]);
    const atMax = formReducer(s, { type: 'addRow', rep: 'rep' });
    expect(atMax).toBe(s);
    s = formReducer(s, { type: 'removeRow', rep: 'rep', index: 0 });
    expect(s.values.rep).toEqual([{}]);
    const last = formReducer(s, { type: 'removeRow', rep: 'rep', index: 0 });
    expect(last).toBe(s);
  });
  it('treats a missing or bad ui:maxLength as 1 (no extra rows)', () => {
    const d: FormDoc = { ...repDoc, uiSchema: { ...repDoc.uiSchema, rep: { 'ui:widget': 'Repeatable', 'ui:maxLength': 0 } } };
    const s = initialState(d);
    expect(formReducer(s, { type: 'addRow', rep: 'rep' })).toBe(s);
  });
});

describe('nested pages (real exports put Pages inside section Groups)', () => {
  const nestedDoc: FormDoc = {
    schema: {
      type: 'object',
      properties: [
        { name: 'sec', type: 'object', title: 'Section', properties: [
          { name: 'pa', type: 'object', title: 'PA', properties: [] },
          { name: 'pb', type: 'object', title: 'PB', properties: [] },
        ] },
        { name: 'top', type: 'object', title: 'Top', properties: [] },
      ],
    },
    uiSchema: { sec: { 'ui:widget': 'Group' }, pa: { 'ui:widget': 'Page' }, pb: { 'ui:widget': 'Page', 'ui:invisible': true }, top: { 'ui:widget': 'Page' } },
  };
  it('starts on the first visible page even when it is nested', () => {
    expect(initialState(nestedDoc).activePage).toBe('pa');
  });
  it('can switch to a nested page and moves off a hidden nested page when invisibles are turned off', () => {
    let s = formReducer(initialState(nestedDoc), { type: 'setPage', name: 'pb' });
    expect(s.activePage).toBe('pb');
    s = formReducer(s, { type: 'toggleInvisible' });
    expect(s.activePage).toBe('pa');
  });
  it('keeps a still-valid nested page when invisibles are toggled', () => {
    let s = formReducer(initialState(nestedDoc), { type: 'setPage', name: 'pa' });
    s = formReducer(s, { type: 'toggleInvisible' });
    expect(s.activePage).toBe('pa');
  });
});

describe('remove, move and undo', () => {
  it('removeNode deletes, clears a selection inside it and tells the user', () => {
    let s = formReducer(fresh(), { type: 'select', name: 'a' });
    s = formReducer(s, { type: 'removeNode', name: 'a' });
    expect(s.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['b']);
    expect(s.selection).toBeNull();
    expect(s.notice).toContain('Deleted');
  });
  it('removing the active page falls back to another page', () => {
    const two: FormDoc = { schema: { type: 'object', properties: [
      { name: 'p', type: 'object', title: 'P', properties: [] }, { name: 'q', type: 'object', title: 'Q', properties: [] },
    ] }, uiSchema: { p: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'Page' } } };
    const s = formReducer(initialState(two), { type: 'removeNode', name: 'p' });
    expect(s.activePage).toBe('q');
  });
  it('moveNode reorders; an illegal move keeps the doc and explains', () => {
    let s = formReducer(fresh(), { type: 'moveNode', name: 'a', parent: 'p', index: 1 });
    expect(s.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['b', 'a']);
    const before = s.doc;
    s = formReducer(s, { type: 'moveNode', name: 'a', parent: 'a', index: 0 });
    expect(s.doc).toBe(before);
    expect(s.notice).toBeTruthy();
  });
  it('undo reverts add, remove and move, newest first', () => {
    let s = fresh();
    const { node, ui } = buildNewField(s.doc, 'TextBox');
    s = formReducer(s, { type: 'addNode', node, ui, loc: { parent: 'p', after: null } });
    s = formReducer(s, { type: 'removeNode', name: 'a' });
    s = formReducer(s, { type: 'moveNode', name: 'b', parent: 'p', index: 1 });
    expect(s.past).toHaveLength(3);
    s = formReducer(s, { type: 'undo' });
    s = formReducer(s, { type: 'undo' });
    expect(s.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['a', 'b', node.name]);
    s = formReducer(s, { type: 'undo' });
    expect(s.doc).toBe(doc);
    expect(s.past).toHaveLength(0);
    expect(formReducer(s, { type: 'undo' })).toBe(s);
  });
  it('undo drops a selection that no longer exists', () => {
    let s = fresh();
    const { node, ui } = buildNewField(s.doc, 'TextBox');
    s = formReducer(s, { type: 'addNode', node, ui, loc: { parent: 'p', after: null } });
    expect(s.selection).toBe(node.name);
    s = formReducer(s, { type: 'undo' });
    expect(s.selection).toBeNull();
  });
  it('loadDoc clears history', () => {
    let s = formReducer(fresh(), { type: 'removeNode', name: 'a' });
    s = formReducer(s, { type: 'loadDoc', doc });
    expect(s.past).toEqual([]);
  });
  it('startAdd remembers the anchor', () => {
    const s = formReducer(fresh(), { type: 'startAdd', widget: 'TextBox', anchor: 'a' });
    expect(s.adding).toEqual({ widget: 'TextBox', anchor: 'a' });
  });
});

describe('show alias', () => {
  it('is off by default, toggles, and survives loading another form', () => {
    expect(fresh().showAlias).toBe(false);
    let s = formReducer(fresh(), { type: 'toggleAlias' });
    expect(s.showAlias).toBe(true);
    s = formReducer(s, { type: 'loadDoc', doc });
    expect(s.showAlias).toBe(true);
    expect(formReducer(s, { type: 'toggleAlias' }).showAlias).toBe(false);
  });
});

describe('ignored warnings', () => {
  it('ignores and restores, and loading another form clears them', () => {
    let s = formReducer(fresh(), { type: 'ignoreWarnings', name: 'a', messages: ['Missing label'] });
    s = formReducer(s, { type: 'ignoreWarnings', name: 'a', messages: ['Missing label'] });
    expect(s.ignoredWarnings).toEqual(['a|Missing label']);
    expect(formReducer(s, { type: 'restoreWarnings' }).ignoredWarnings).toEqual([]);
    expect(formReducer(s, { type: 'loadDoc', doc }).ignoredWarnings).toEqual([]);
  });
});

describe('pdf panel', () => {
  it('toggles and survives loading another form', () => {
    expect(fresh().pdfOpen).toBe(false);
    let s = formReducer(fresh(), { type: 'togglePdf' });
    expect(s.pdfOpen).toBe(true);
    s = formReducer(s, { type: 'loadDoc', doc });
    expect(s.pdfOpen).toBe(true);
  });
});

describe('undo of edits', () => {
  const edit = (s: ReturnType<typeof fresh>, text: string, at: number, key = 'a') =>
    formReducer(s, { type: 'editDoc', uiSchema: { ...s.doc.uiSchema, a: { 'ui:widget': 'TextBox', 'ui:formattedText': text } }, key, at });
  it('puts back an edit made on a field', () => {
    let s = edit(fresh(), '<p>One</p>', 1000);
    expect(s.past).toHaveLength(1);
    s = formReducer(s, { type: 'undo' });
    expect(s.doc.uiSchema.a['ui:formattedText']).toBeUndefined();
  });
  it('treats typing on one field as one step, and a different field or a pause as a new one', () => {
    let s = edit(fresh(), 'a', 1000);
    s = edit(s, 'ab', 1300);
    s = edit(s, 'abc', 1600);
    expect(s.past).toHaveLength(1);
    s = edit(s, 'abcd', 4000);
    expect(s.past).toHaveLength(2);
    s = edit(s, 'x', 4100, 'b');
    expect(s.past).toHaveLength(3);
    s = formReducer(s, { type: 'undo' });
    expect(s.doc.uiSchema.a['ui:formattedText']).toBe('abcd');
  });
});

describe('AI proposals, accepted one at a time in the form', () => {
  const decision = (id: string, data: Decision['data'], extra: Partial<Decision> = {}): Decision => ({ id, title: id, detail: '', evidence: null, confidence: 'high', defaultAccepted: true, data, ...extra });
  const label = decision('label:a', { kind: 'label', alias: 'a', text: 'Telephone:', source: 'pdf-text' });
  const optional = decision('optional:b', { kind: 'optional', alias: 'b' }, { defaultAccepted: false });
  const withProposals = (): ReturnType<typeof fresh> => {
    const d: FormDoc = { ...doc, uiSchema: { ...doc.uiSchema, a: { 'ui:widget': 'TextBox', 'ui:formattedText': '' }, b: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>B</p>', 'ui:required': 'This field is required' } } };
    return formReducer(initialState(d), { type: 'setProposals', set: { decisions: [label, optional], notes: ['a note'], texts: [] }, anchors: {} });
  };

  it('holds the proposals and the AI notes', () => {
    const s = withProposals();
    expect(s.proposals.map((d) => d.id)).toEqual(['label:a', 'optional:b']);
    expect(s.proposalNotes).toEqual(['a note']);
  });
  it('accepting one applies only that change, removes it from the list and can be undone', () => {
    const s = formReducer(withProposals(), { type: 'acceptProposals', ids: ['label:a'] });
    expect(s.doc.uiSchema.a['ui:formattedText']).toBe('<p>Telephone:</p>');
    expect(s.doc.uiSchema.b['ui:required']).toBe('This field is required'); // the other proposal is untouched
    expect(s.proposals.map((d) => d.id)).toEqual(['optional:b']);
    const undone = formReducer(s, { type: 'undo' });
    expect(undone.doc.uiSchema.a['ui:formattedText']).toBe('');
  });
  it('accepting several applies them together', () => {
    const s = formReducer(withProposals(), { type: 'acceptProposals', ids: ['label:a', 'optional:b'] });
    expect(s.doc.uiSchema.a['ui:formattedText']).toBe('<p>Telephone:</p>');
    expect(s.doc.uiSchema.b['ui:required']).toBeUndefined();
    expect(s.proposals).toEqual([]);
  });
  it('dismissing removes a proposal without changing the form', () => {
    const before = withProposals();
    const s = formReducer(before, { type: 'dismissProposals', ids: ['optional:b'] });
    expect(s.doc.uiSchema).toEqual(before.doc.uiSchema);
    expect(s.proposals.map((d) => d.id)).toEqual(['label:a']);
  });
  it('undo after accepting puts the proposal back on its widget, in its place, and restores the form', () => {
    const accepted = formReducer(withProposals(), { type: 'acceptProposals', ids: ['label:a'] });
    expect(accepted.proposals.map((d) => d.id)).toEqual(['optional:b']);
    const undone = formReducer(accepted, { type: 'undo' });
    expect(undone.doc.uiSchema.a['ui:formattedText']).toBe('');
    expect(undone.proposals.map((d) => d.id)).toEqual(['label:a', 'optional:b']);
    expect(undone.notice).toBe('Undone: the AI proposal is back');
    // and accepting again works
    expect(formReducer(undone, { type: 'acceptProposals', ids: ['label:a'] }).doc.uiSchema.a['ui:formattedText']).toBe('<p>Telephone:</p>');
  });
  it('undo after accepting several brings them all back; later edits are undone first', () => {
    let s = formReducer(withProposals(), { type: 'acceptProposals', ids: ['label:a', 'optional:b'] });
    s = formReducer(s, { type: 'editDoc', uiSchema: { ...s.doc.uiSchema, a: { ...s.doc.uiSchema.a, 'ui:placeholder': 'x' } }, key: 'k', at: 1 });
    s = formReducer(s, { type: 'undo' });
    expect(s.proposals).toEqual([]); // that was the edit
    s = formReducer(s, { type: 'undo' });
    expect(s.proposals.map((d) => d.id)).toEqual(['label:a', 'optional:b']);
    expect(s.notice).toBe('Undone: 2 AI proposals are back');
  });
  it('undo after dismissing brings the proposal back', () => {
    const dismissed = formReducer(withProposals(), { type: 'dismissProposals', ids: ['label:a'] });
    expect(dismissed.proposals.map((d) => d.id)).toEqual(['optional:b']);
    const undone = formReducer(dismissed, { type: 'undo' });
    expect(undone.proposals.map((d) => d.id)).toEqual(['label:a', 'optional:b']);
  });
});
