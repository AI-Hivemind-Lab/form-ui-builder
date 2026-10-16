import { describe, expect, it } from 'vitest';
import { loadForm } from '../model/loadForm';
import type { FormDoc } from '../model/types';
import { runTurn, trimHistory } from './agent';
import { diffDocs, revertChange } from './changes';
import { StreamAccumulator } from './sse';
import { runTool } from './tools';
import type { ChatMessage } from './types';

type Ui = Record<string, Record<string, unknown>>;
const star = ' <span style="color: rgb(219, 55, 55);">*</span>';
const doc = (): FormDoc => loadForm({ namespaceFormSchemaMap: { main: {
  schema: { type: 'object', properties: [
    { name: 'pg', type: 'object', title: 'General Information', properties: [
      { name: 'h', type: 'null', title: 'General Information' },
      { name: 'name', type: 'string', title: 'Name' },
      { name: 'phone', type: 'string', title: 'Telephone' },
      { name: 'fax', type: 'string', title: 'Fax' },
      { name: 'q1', type: 'string', title: 'q1', enum: ['yes', 'no'] },
      { name: 'q1_more', type: 'string', title: 'More' },
      { name: 'note', type: 'null', title: 'note' },
    ] },
  ] },
  uiSchema: {
    pg: { 'ui:widget': 'Page' }, h: { 'ui:widget': 'Header', 'ui:heading': 'General Information' },
    name: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>Name${star}</p>`, 'ui:required': 'This field is required' },
    phone: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>Telephone${star}</p>`, 'ui:required': 'This field is required' },
    fax: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Fax</p>' },
    q1: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Do you?</p>', 'ui:multipleOption': { options: [['yes', { formattedText: '<p>Yes</p>', fieldsBelow: ['q1_more'] }], ['no', { formattedText: '<p>No</p>' }]] } },
    q1_more: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Why</p>' },
    note: { 'ui:widget': 'Paragraph', 'ui:formattedText': '<p>If the answer is Yes, please say why.</p>' },
  },
} }, defaultNamespace: 'main' });

const env = (d: FormDoc, selection: string | null = null) => ({ doc: d, selection });

describe('the stream of a completion', () => {
  it('joins pieces of text, and pieces of a tool call (its name once, its arguments in parts)', () => {
    const acc = new StreamAccumulator();
    const ev = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    expect(acc.push(ev({ choices: [{ delta: { content: 'Making ' } }] }) + ev({ choices: [{ delta: { content: 'it optional.' } }] }))).toBe(true);
    acc.push(ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'update_widget', arguments: '{"alias":"fa' } }] } }] }));
    acc.push(ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'x","required":false}' } }] } }] }) + ev({ usage: { prompt_tokens: 10, completion_tokens: 4 } }) + 'data: [DONE]\n\n');
    const m = acc.message();
    expect(m.content).toBe('Making it optional.');
    expect(m.tool_calls).toEqual([{ id: 'c1', type: 'function', function: { name: 'update_widget', arguments: '{"alias":"fax","required":false}' } }]);
    expect(acc.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4 });
    expect(acc.done).toBe(true);
  });
  it('holds half an event until the rest comes, and skips a broken line', () => {
    const acc = new StreamAccumulator();
    acc.push('data: {"choices":[{"delta":{"content":"a');
    acc.push('b"}}]}\n\ndata: not json\n\n');
    expect(acc.text).toBe('ab');
  });
});

describe('reading tools', () => {
  it('outline: pages first, then a page as a tree with flags', async () => {
    const pages = (await runTool('get_form_outline', {}, env(doc()))).output as { pages: { alias: string; children: number }[] };
    expect(pages.pages).toEqual([{ alias: 'pg', widget: 'Page', title: 'General Information', children: 7, hidden: false }]);
    const tree = (await runTool('get_form_outline', { page: 'pg' }, env(doc()))).output as { outline: string };
    expect(tree.outline).toContain('phone [TextBox] Telephone  (*)');
    expect(tree.outline).toContain('q1_more [TextBox] Why  (below q1)');
  });
  it('search finds by alias, label and option text; get_widget tells everything about one', async () => {
    const hits = (await runTool('search_form', { query: 'teleph' }, env(doc()))).output as { matches: { alias: string; page: string }[] };
    expect(hits.matches).toEqual([{ alias: 'phone', widget: 'TextBox', label: 'Telephone', page: 'pg' }]);
    const w = (await runTool('get_widget', { alias: 'q1' }, env(doc()))).output as { options: { value: string; fields_below: string[] }[]; below_of: unknown };
    expect(w.options).toEqual([{ value: 'yes', label: 'Yes', fields_below: ['q1_more'] }, { value: 'no', label: 'No', fields_below: [] }]);
    expect(((await runTool('get_widget', { alias: 'nope' }, env(doc()))).output as { error: string }).error).toMatch(/no element/);
  });
});

describe('editing tools', () => {
  it('update: label, required (star kept in step), ui keys (null deletes), title', async () => {
    const r = await runTool('update_widget', { alias: 'fax', label: 'Facsimile', required: true, ui: { 'ui:indentation': '24px' } }, env(doc()));
    expect((r.output as { changed: string[] }).changed).toEqual(['label', 'ui:indentation', 'required']);
    const ui = r.doc?.uiSchema.fax as Record<string, unknown>;
    expect(ui['ui:required']).toBe('This field is required');
    expect(String(ui['ui:formattedText'])).toContain('Facsimile');
    expect(String(ui['ui:formattedText'])).toContain('rgb(219, 55, 55)');
    const off = await runTool('update_widget', { alias: 'name', required: false, ui: { 'ui:indentation': null } }, env(r.doc as FormDoc));
    expect(off.doc?.uiSchema.name['ui:required']).toBeUndefined();
    expect(String(off.doc?.uiSchema.name['ui:formattedText'])).not.toContain('*');
  });
  it('update: options replace the choices and keep the schema values in step; an unknown ui key shape is refused', async () => {
    const r = await runTool('update_widget', { alias: 'q1', options: [{ value: 'yes', label: 'Yes', fields_below: ['q1_more'] }, { value: 'no', label: 'No' }, { value: 'na', label: 'Not applicable' }] }, env(doc()));
    expect(r.doc && (r.doc.schema.properties[0].properties?.find((n) => n.name === 'q1')?.enum)).toEqual(['yes', 'no', 'na']);
    const bad = await runTool('update_widget', { alias: 'name', ui: { required: true } }, env(doc()));
    expect((bad.output as { error: string }).error).toMatch(/ui:\*/);
    const widget = await runTool('update_widget', { alias: 'name', ui: { 'ui:widget': 'Radio' } }, env(doc()));
    expect((widget.output as { error: string }).error).toMatch(/widget/);
  });
  it('add: a new element in a page after a sibling, with its label and required; refuses a wrong place and a used alias', async () => {
    const r = await runTool('add_widget', { widget: 'Email', parent: 'pg', after: 'phone', alias: 'email_main', label: 'Email', required: true }, env(doc()));
    expect(r.doc?.schema.properties[0].properties?.map((n) => n.name)).toEqual(['h', 'name', 'phone', 'email_main', 'fax', 'q1', 'q1_more', 'note']);
    expect(r.doc?.uiSchema.email_main).toMatchObject({ 'ui:widget': 'Email', 'ui:required': 'This field is required' });
    expect(((await runTool('add_widget', { widget: 'TextBox', parent: 'name' }, env(doc()))).output as { error: string }).error).toMatch(/cannot contain/);
    expect(((await runTool('add_widget', { widget: 'TextBox', parent: 'pg', alias: 'fax' }, env(doc()))).output as { error: string }).error).toMatch(/already used/);
    expect(((await runTool('add_widget', { widget: 'Nonsense', parent: 'pg' }, env(doc()))).output as { error: string }).error).toMatch(/Unknown widget/);
  });
  it('delete, move (after a sibling, last) and refuse a move into itself', async () => {
    const del = await runTool('delete_widget', { alias: 'fax' }, env(doc()));
    expect(del.doc?.schema.properties[0].properties?.map((n) => n.name)).not.toContain('fax');
    const mv = await runTool('move_widget', { alias: 'fax', parent: 'pg', after: 'name' }, env(doc()));
    expect(mv.doc?.schema.properties[0].properties?.map((n) => n.name).slice(0, 4)).toEqual(['h', 'name', 'fax', 'phone']);
    const last = await runTool('move_widget', { alias: 'name', parent: 'pg' }, env(doc()));
    const kids = last.doc?.schema.properties[0].properties ?? [];
    expect(kids[kids.length - 1].name).toBe('name');
    expect(((await runTool('move_widget', { alias: 'pg', parent: 'pg' }, env(doc()))).output as { error: string }).error).toBeTruthy();
  });
  it('group: wraps a run of neighbours, keeps a question with the field below its option, and refuses to split them', async () => {
    const ok = await runTool('group_widgets', { from_alias: 'name', to_alias: 'fax', name: 'Contact' }, env(doc()));
    expect(ok.doc?.schema.properties[0].properties?.map((n) => n.name)).toEqual(['h', 'contact', 'q1', 'q1_more', 'note']);
    const split = await runTool('group_widgets', { from_alias: 'fax', to_alias: 'q1', name: 'X' }, env(doc()));
    expect((split.output as { error: string }).error).toMatch(/split a question/);
    expect(((await runTool('group_widgets', { from_alias: 'name', to_alias: 'name', name: 'X' }, env(doc()))).output as { error: string }).error).toMatch(/neighbours/);
  });
  it('the PDF tools say so when no PDF is loaded, and return the text and the picture when it is', async () => {
    expect(((await runTool('get_pdf_page_text', { page: 3 }, env(doc()))).output as { error: string }).error).toMatch(/No source PDF/);
    const pdf = { pageText: async (p: number) => (p === 3 ? 'Page three text' : null), pageImage: async () => 'data:image/jpeg;base64,xx', pageCount: async () => 5 };
    expect((await runTool('get_pdf_page_text', { page: 3 }, { ...env(doc()), pdf })).output).toEqual({ page: 3, text: 'Page three text' });
    expect(((await runTool('get_pdf_page_text', { page: 9 }, { ...env(doc()), pdf })).output as { error: string }).error).toMatch(/5 pages/);
    expect((await runTool('get_pdf_page_image', { page: 2 }, { ...env(doc()), pdf })).image).toEqual({ page: 2, url: 'data:image/jpeg;base64,xx' });
  });
});

describe('what changed, and putting it back', () => {
  const base = doc();
  it('finds a modified element with a summary, and puts it back', async () => {
    const after = (await runTool('update_widget', { alias: 'phone', label: 'Phone number', required: false }, env(base))).doc as FormDoc;
    const changes = diffDocs(base, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'modified', alias: 'phone', label: 'Phone number' });
    expect(changes[0].summary).toEqual(['label: “Telephone” → “Phone number”', 'required: yes → no']);
    expect(revertChange(after, changes[0]).uiSchema.phone).toEqual(base.uiSchema.phone);
  });
  it('finds an added element and a removed one, and puts each back', async () => {
    const added = (await runTool('add_widget', { widget: 'Email', parent: 'pg', after: 'name', alias: 'em', label: 'Email' }, env(base))).doc as FormDoc;
    const c1 = diffDocs(base, added);
    expect(c1.map((c) => [c.kind, c.alias])).toEqual([['added', 'em']]);
    expect(revertChange(added, c1[0]).schema.properties[0].properties?.map((n) => n.name)).toEqual(base.schema.properties[0].properties?.map((n) => n.name));
    const removed = (await runTool('delete_widget', { alias: 'fax' }, env(base))).doc as FormDoc;
    const c2 = diffDocs(base, removed);
    expect(c2.map((c) => [c.kind, c.alias])).toEqual([['removed', 'fax']]);
    const back = revertChange(removed, c2[0]);
    expect(back.schema.properties[0].properties?.map((n) => n.name)).toEqual(base.schema.properties[0].properties?.map((n) => n.name));
    expect(back.uiSchema.fax).toEqual(base.uiSchema.fax);
  });
  it('shows a new group as one change, not a move for each element it gathered, and unwraps it on revert', async () => {
    const grouped = (await runTool('group_widgets', { from_alias: 'name', to_alias: 'fax', name: 'Contact' }, env(base))).doc as FormDoc;
    const changes = diffDocs(base, grouped);
    expect(changes.map((c) => [c.kind, c.alias])).toEqual([['added', 'contact']]);
    expect(changes[0].gathered?.map((g) => g.alias)).toEqual(['name', 'phone', 'fax']);
    const back = revertChange(grouped, changes[0]);
    expect(back.schema.properties[0].properties?.map((n) => n.name)).toEqual(base.schema.properties[0].properties?.map((n) => n.name));
    expect(back.uiSchema.contact).toBeUndefined();
  });
  it('finds a move', async () => {
    const moved = (await runTool('move_widget', { alias: 'fax', parent: 'pg', after: 'name' }, env(base))).doc as FormDoc;
    const changes = diffDocs(base, moved);
    // fax went before phone: which of the two is "the one that moved" cannot be told from the result, but one change puts both right
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('moved');
    expect(revertChange(moved, changes[0]).schema.properties[0].properties?.map((n) => n.name)).toEqual(base.schema.properties[0].properties?.map((n) => n.name));
  });
  it('sees nothing when nothing changed', () => {
    expect(diffDocs(base, base)).toEqual([]);
  });
});

describe('a turn', () => {
  const asst = (content: string | null, calls: { id: string; name: string; args: unknown }[] = []): { message: Extract<ChatMessage, { role: 'assistant' }>; usage: { prompt_tokens: number; completion_tokens: number } } => ({
    message: { role: 'assistant', content, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) },
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
  it('runs the tools the model asks for on the form as it is, sends the results back, and ends on its words', async () => {
    let current = doc();
    const seen: ChatMessage[][] = [];
    const script = [
      asst(null, [{ id: 'a', name: 'search_form', args: { query: 'fax' } }]),
      asst(null, [{ id: 'b', name: 'update_widget', args: { alias: 'fax', required: true } }, { id: 'c', name: 'update_widget', args: { alias: 'nope', required: true } }]),
      asst('Made Fax required.\n- [Fax](#w:fax)'),
    ];
    const tools: string[] = [];
    const r = await runTurn([], 'make fax required', {
      getDoc: () => current, setDoc: (d) => { current = d; }, getSelection: () => 'fax',
      onTool: (n, _a, ok) => tools.push(`${n}:${ok}`),
      stream: async (body) => { seen.push(body.messages); return script.shift() as never; },
    });
    expect(tools).toEqual(['search_form:true', 'update_widget:true', 'update_widget:false']);
    expect(current.uiSchema.fax['ui:required']).toBe('This field is required');
    expect(r.stopped).toBe(false);
    expect(r.usage).toEqual({ prompt_tokens: 300, completion_tokens: 60 });
    expect(r.added.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'tool', 'assistant']);
    // the model sees the context of the editor with the request, and the error of the failed call
    expect(String((seen[0][0] as { content: string }).content)).toContain('The person has selected: fax');
    expect(JSON.stringify(seen[2])).toContain('There is no element');
  });
  it('stops after too many steps, and keeps a short history', async () => {
    const r = await runTurn([], 'loop', { getDoc: () => doc(), setDoc: () => {}, getSelection: () => null, stream: async () => asst(null, [{ id: 'x', name: 'get_form_outline', args: {} }]) as never });
    expect(r.stopped).toBe(true);
    const long: ChatMessage[] = Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? { role: 'user', content: `q${i}` } : { role: 'assistant', content: `a${i}` }) as ChatMessage);
    const t = trimHistory(long, 10);
    expect(t.length).toBeLessThanOrEqual(10);
    expect(t[0].role).toBe('user');
  });
});

import { formReducer, initialState } from '../state/formReducer';
describe('the form state around a turn', () => {
  it('one undo step per turn, the changes wait for review, accept clears one, put back restores it, undo clears the list', async () => {
    const start = initialState(doc());
    let s = formReducer(start, { type: 'botStart' });
    const a = (await runTool('update_widget', { alias: 'fax', required: true }, { doc: s.doc, selection: null })).doc as FormDoc;
    s = formReducer(s, { type: 'botSetDoc', doc: a });
    const b = (await runTool('update_widget', { alias: 'name', label: 'Full name' }, { doc: s.doc, selection: null })).doc as FormDoc;
    s = formReducer(s, { type: 'botSetDoc', doc: b });
    s = formReducer(s, { type: 'botEnd' });
    expect(s.past).toHaveLength(1);
    expect(s.botBase).toBeNull();
    expect(s.botChanges.map((c) => c.alias).sort()).toEqual(['fax', 'name']);

    const accepted = formReducer(s, { type: 'botAccept', id: 'modified:fax' });
    expect(accepted.botChanges.map((c) => c.alias)).toEqual(['name']);
    expect(accepted.doc.uiSchema.fax['ui:required']).toBe('This field is required'); // accepting keeps the change

    const back = formReducer(s, { type: 'botRevert', id: 'modified:name' });
    expect(back.doc.uiSchema.name).toEqual(start.doc.uiSchema.name);
    expect(back.botChanges.map((c) => c.alias)).toEqual(['fax']);

    const undone = formReducer(s, { type: 'undo' });
    expect(undone.doc.uiSchema.fax).toEqual(start.doc.uiSchema.fax);
    expect(undone.botChanges).toEqual([]);
  });
  it('a turn that changed nothing leaves no undo step and nothing to review', () => {
    let s = formReducer(initialState(doc()), { type: 'botStart' });
    s = formReducer(s, { type: 'botEnd' });
    expect(s.past).toHaveLength(0);
    expect(s.botChanges).toEqual([]);
  });
});
