import { describe, expect, it } from 'vitest';
import { buildExport } from './exportForm';
import { loadForm } from './loadForm';
import { buildTransformScript, embeddedCutsOf, saveProblems } from './transformScript';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } }, rules: [], defaultNamespace: 'main' });

/** What the extension's sandbox does with the function: run it on the form's formData, keep only schema and uiSchema of the namespace. */
function runLikeTheExtension(script: string, formData: Record<string, unknown>): Record<string, unknown> {
  const fn = eval(`(${script.trim()})`) as (d: unknown) => { form: { namespaceFormSchemaMap: Record<string, { schema: unknown; uiSchema: unknown }> } };
  const applied = fn(formData);
  const form = formData.form as { defaultNamespace: string };
  const ns = form.defaultNamespace || 'main';
  const out = { ...formData, form: JSON.parse(JSON.stringify(formData.form)) } as { form: { namespaceFormSchemaMap: Record<string, { schema: unknown; uiSchema: unknown }> } };
  out.form.namespaceFormSchemaMap[ns].schema = applied.form.namespaceFormSchemaMap[ns].schema;
  out.form.namespaceFormSchemaMap[ns].uiSchema = applied.form.namespaceFormSchemaMap[ns].uiSchema;
  return out;
}

describe('the transFORM script', () => {
  const doc = raw(
    [{ name: 'file0', type: 'null', title: 'ours.pdf' }, { name: 'pg', type: 'object', title: 'Page', properties: [{ name: 'q', type: 'string', title: 'Name' }, { name: 'rep', type: 'array', title: 'Contacts', properties: [{ name: 'c', type: 'string', title: 'Contact' }] }] }],
    { file0: { 'ui:widget': 'File', 'ui:fileName': 'ours.pdf' }, pg: { 'ui:widget': 'Page' }, q: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name “quoted”   line</p>' }, rep: { 'ui:widget': 'Repeatable' }, c: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Contact</p>' } },
  );
  const blankFormData = {
    form: { namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [{ name: 'file0', type: 'null', title: 'held.pdf' }] }, uiSchema: { file0: { 'ui:widget': 'File', 'ui:fileName': 'held.pdf' } } } }, rules: [], defaultNamespace: 'main', libs: [] },
    uploadedPdf: [['for1.fdr000001.fil1', { name: 'held.pdf', fields: [] }]], uploadedDocx: [], embeddedPdf: [], associatedLinks: [],
  };

  it('replaces the form\'s fields and widgets with ours and leaves every file reference, rule and setting of the form as it is', () => {
    const { script } = buildTransformScript(doc, 'Fund *Name*');
    const out = runLikeTheExtension(script, structuredClone(blankFormData)) as typeof blankFormData & { form: { namespaceFormSchemaMap: { main: { schema: { properties: { name: string }[] }; uiSchema: Record<string, Record<string, unknown>> } } } };
    expect(out.uploadedPdf).toEqual(blankFormData.uploadedPdf);
    expect(out.form.rules).toEqual([]);
    const main = out.form.namespaceFormSchemaMap.main;
    expect(main.schema.properties.map((n) => n.name)).toEqual(['file0', 'pg']);
    const expected = (buildExport(doc) as { namespaceFormSchemaMap: { main: { uiSchema: Record<string, Record<string, unknown>> } } }).namespaceFormSchemaMap.main.uiSchema;
    expect(main.uiSchema.q).toEqual(expected.q); // quotes and a line separator inside the text survive
  });
  it('makes the File widget name the PDF the form holds, and a Repeatable keeps its rows under items', () => {
    const { script } = buildTransformScript(doc);
    const out = runLikeTheExtension(script, structuredClone(blankFormData)) as { form: { namespaceFormSchemaMap: { main: { schema: { properties: { name: string; title: string; properties?: { name: string; type: string; items?: { properties: unknown[] } }[] }[] }; uiSchema: Record<string, Record<string, unknown>> } } } };
    const main = out.form.namespaceFormSchemaMap.main;
    expect(main.uiSchema.file0['ui:fileName']).toBe('held.pdf');
    expect(main.schema.properties[0].title).toBe('held.pdf');
    expect(main.schema.properties[1].properties?.[1].items?.properties).toHaveLength(1);
  });
  it('lists the embedded PDFs to cut: one per file name, pages counted from 1, with the name cleaned as in the package', () => {
    const withPdfs = raw(
      [{ name: 'file0', type: 'null', title: 'ours.pdf' }, { name: 'a', type: 'null', title: 'A' }, { name: 'b', type: 'null', title: 'B' }, { name: 'c', type: 'null', title: 'C' }],
      {
        file0: { 'ui:widget': 'File', 'ui:fileName': 'ours.pdf' },
        a: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund / Agreement.pdf', 'ui:pdfCutInfo': { start: 3, end: 16, fileId: '', reviewingFileId: null } },
        b: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund / Agreement.pdf', 'ui:pdfCutInfo': { start: 3, end: 16, fileId: '', reviewingFileId: null } },
        c: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'No pages.pdf' },
      },
    );
    const built = buildTransformScript(withPdfs);
    expect(built.problems).toEqual([]);
    const fn = eval(`(${built.script.trim()})`) as (d: unknown) => { embeddedCuts: unknown };
    expect(fn({ form: { defaultNamespace: 'main', namespaceFormSchemaMap: {} } }).embeddedCuts).toEqual([{ name: 'Fund Agreement.pdf', start: 3, end: 16 }]);
  });
  it('refuses a file name used with two different page ranges, and a page range that is not one', () => {
    const ui = (start: number, end: number) => ({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'x.pdf', 'ui:pdfCutInfo': { start, end } });
    expect(embeddedCutsOf({ a: ui(1, 2), b: ui(3, 4) }).problems[0]).toContain('also used with pages 1 to 2');
    expect(embeddedCutsOf({ a: ui(0, 2) }).problems[0]).toContain('not a page range');
    expect(embeddedCutsOf({ a: ui(5, 4) }).problems[0]).toContain('not a page range');
    expect(saveProblems({ properties: [{ name: 'a', type: 'null' }] }, { a: ui(5, 4) })).toHaveLength(1);
  });
  it('finds what would crash the save before anything is sent', () => {
    expect(buildTransformScript(doc).problems).toEqual([]);
    expect(saveProblems({ properties: [{ name: 'a', type: 'array' }] }, { a: {} })).toEqual(['/a: an array needs "items" (the server crashes without it)']);
    expect(saveProblems({ properties: [{ name: 'a', type: 'string' }, { name: 'a', type: 'string' }] }, {})[0]).toContain('used twice');
    expect(saveProblems({ properties: [] }, { ghost: {} })).toEqual(['uiSchema has "ghost" but the schema has no such field']);
  });
});
