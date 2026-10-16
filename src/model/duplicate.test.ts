import { describe, expect, it } from 'vitest';
import { duplicateNode } from './duplicate';
import { loadForm } from './loadForm';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });

describe('duplicating a field', () => {
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'P', properties: [
      { name: 'q', type: 'string', title: 'Is it so?', enum: ['yes', 'no'] }, { name: 'why', type: 'string', title: 'Why?' }, { name: 'after', type: 'string', title: 'After' },
      { name: 'grp', type: 'object', title: 'Group', properties: [{ name: 'inner', type: 'string', title: 'Inner' }] },
    ] }],
    {
      pg: { 'ui:widget': 'Page' },
      q: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Is it so?</p>', 'ui:pdfMapping': ['q'], 'ui:multipleOption': { options: [['yes', { formattedText: '<p>Yes</p>', pdfMappings: ['yes_q'], fieldsBelow: ['why'] }], ['no', { formattedText: '<p>No</p>', pdfMappings: ['no_q'] }]] } },
      why: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Why?</p>', 'ui:pdfMapping': ['why'] },
      after: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>After</p>', 'ui:pdfMapping': ['after'] },
      grp: { 'ui:widget': 'Group' }, inner: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Inner</p>', 'ui:pdfMapping': ['inner'] },
    },
  );
  it('puts the copy right after the field and the fields shown below its options, with names of their own and no PDF mappings', () => {
    const r = duplicateNode(doc, 'q');
    expect(r?.name).toBe('q_copy');
    const out = r?.doc as NonNullable<typeof r>['doc'];
    expect(out.schema.properties[0].properties?.map((n) => n.name)).toEqual(['q', 'why', 'q_copy', 'why_copy', 'after', 'grp']);
    expect(out.schema.properties[0].properties?.[2].title).toBe('Is it so? (copy)');
    expect(out.uiSchema.q_copy['ui:pdfMapping']).toEqual([]);
    const options = (out.uiSchema.q_copy['ui:multipleOption'] as { options: [string, { pdfMappings?: string[]; fieldsBelow?: string[] }][] }).options;
    expect(options[0][1].pdfMappings).toBeUndefined();
    expect(options[0][1].fieldsBelow).toEqual(['why_copy']);
    expect(out.uiSchema.why_copy['ui:pdfMapping']).toEqual([]);
    // the original is untouched
    expect((out.uiSchema.q['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options[0][1].fieldsBelow).toEqual(['why']);
  });
  it('copies a group with what is inside it, and a second copy gets a number', () => {
    const once = duplicateNode(doc, 'grp');
    expect(once?.doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['q', 'why', 'after', 'grp', 'grp_copy']);
    expect(once?.doc.schema.properties[0].properties?.[4].properties?.map((n) => n.name)).toEqual(['inner_copy']);
    const twice = duplicateNode((once as NonNullable<typeof once>).doc, 'grp');
    expect(twice?.name).toBe('grp_copy_2');
  });
  it('does not copy the source PDF file', () => {
    const d = raw([{ name: 'file0', type: 'null', title: 'a.pdf' }], { file0: { 'ui:widget': 'File' } });
    expect(duplicateNode(d, 'file0')).toBeNull();
  });
});
