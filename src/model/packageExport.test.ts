import { describe, expect, it } from 'vitest';
import { buildPackage, safeFileName, type Files } from './packageExport';
import { readZip, writeZip } from './zip';

const enc = new TextEncoder();
const dec = new TextDecoder();
const j = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v));
const blank = (): Files => ({
  'form_data.json': j({
    form: { namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [{ name: 'file0', type: 'null', title: 'sub-doc.pdf' }] }, uiSchema: { file0: { 'ui:widget': 'File', 'ui:fileName': 'sub-doc.pdf' } } } }, gaiaLogicVersion: 100 },
    uploadedPdf: [['forAAAA.fdr000001.fil111111111', { name: 'sub-doc.pdf', fields: [{ key: 'x' }] }]], uploadedDocx: [], embeddedPdf: [], associatedLinks: [],
  }),
  'record_data.json': j({ rData: { '0::u1': { fileName: 'sub-doc.pdf' }, '5::u5': { fileName: 'form_data.json', uploadedPdfFileNameRecord: { 'sub-doc.pdf': [0, 'u1'] }, embeddedPdfFileNameRecord: {} } }, rKey: [] }),
  'form_metadata.json': j({ id: 'for0.fve0.fvm', widgetSources: { file0: 'MANUAL' }, widgetSourceSummary: { sourceCount: { '0': 1 }, totalCount: 1 }, isPdfCutsMigrated: true }),
  'sub-doc.pdf': new Uint8Array([1, 2, 3]),
});
const ours = () => ({
  namespaceFormSchemaMap: { main: {
    schema: { type: 'object', properties: [
      { name: 'hidden', type: 'object', title: 'Hidden', properties: [{ name: 'file0', type: 'null', title: 'Sub-doc (June 2026).pdf' }] },
      { name: 'pg', type: 'object', title: 'Agreement', properties: [{ name: 'sa', type: 'null', title: 'x' }, { name: 'plain', type: 'null', title: 'y' }] },
    ] },
    uiSchema: {
      hidden: { 'ui:widget': 'Page', 'ui:invisible': true }, file0: { 'ui:widget': 'File', 'ui:fileName': 'Sub-doc (June 2026).pdf' }, pg: { 'ui:widget': 'Page' },
      sa: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund - Subscription Agreement.pdf', 'ui:pdfCutInfo': { start: 8, end: 27, fileId: '', reviewingFileId: null } },
      plain: { 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund - No Pages.pdf' },
    },
  } },
  defaultNamespace: 'main', gaiaLogicVersion: 200,
});

describe('the package for Form Builder\'s import', () => {
  const cuts: [number, number][] = [];
  const cut = async (_s: Uint8Array, a: number, b: number): Promise<Uint8Array> => { cuts.push([a, b]); return new Uint8Array([a, b]); };
  const run = async () => buildPackage({ form: ours(), blank: blank(), source: new Uint8Array([9]), cut });

  it('keeps the blank draft\'s files and replaces the form, with the sub-doc File named after the annotated PDF', async () => {
    const { files } = await run();
    expect(files['sub-doc.pdf']).toEqual(new Uint8Array([1, 2, 3]));
    const data = JSON.parse(dec.decode(files['form_data.json']));
    expect(data.uploadedPdf).toEqual([['forAAAA.fdr000001.fil111111111', { name: 'sub-doc.pdf', fields: [{ key: 'x' }] }]]); // the system-made part stays
    const main = data.form.namespaceFormSchemaMap.main;
    expect(main.uiSchema.file0['ui:fileName']).toBe('sub-doc.pdf');
    expect(main.schema.properties[0].properties[0].title).toBe('sub-doc.pdf');
    expect(data.form.gaiaLogicVersion).toBe(200);
  });

  it('cuts each embedded PDF from the sub-doc, lists it with an id of the form\'s own pattern, records it by name, and records the cut in the metadata', async () => {
    cuts.length = 0;
    const { files, notes } = await run();
    expect(cuts).toEqual([[8, 27]]);
    expect(files['Fund - Subscription Agreement.pdf']).toEqual(new Uint8Array([8, 27]));
    const data = JSON.parse(dec.decode(files['form_data.json']));
    expect(data.embeddedPdf).toHaveLength(1);
    expect(data.embeddedPdf[0][0]).toBe('Fund - Subscription Agreement.pdf');
    expect(data.embeddedPdf[0][1]).toMatch(/^forAAAA\.fdr000001\.fil[a-z0-9]{9}$/);
    const record = JSON.parse(dec.decode(files['record_data.json'])).rData;
    const formRecord = Object.entries(record).find(([k]) => k.startsWith('5::'))?.[1] as { embeddedPdfFileNameRecord: Record<string, [number, string]> };
    const [, uuid] = formRecord.embeddedPdfFileNameRecord['Fund - Subscription Agreement.pdf'];
    expect(record[`0::${uuid}`]).toEqual({ fileName: 'Fund - Subscription Agreement.pdf' });
    const meta = JSON.parse(dec.decode(files['form_metadata.json']));
    expect(meta.pdfCuts).toEqual({ 'Fund - Subscription Agreement.pdf': { fileName: 'sub-doc.pdf', start: 8, end: 27 } });
    expect(meta.widgetSourceSummary).toEqual({ sourceCount: { '0': 5 }, totalCount: 5 });
    expect(notes.some((n) => n.startsWith('plain: not packaged'))).toBe(true);
  });

  it('moves the cut from the widget to the metadata: the widget keeps only the file name', async () => {
    const { files } = await run();
    const ui = JSON.parse(dec.decode(files['form_data.json'])).form.namespaceFormSchemaMap.main.uiSchema;
    expect(ui.sa).toEqual({ 'ui:widget': 'Pdf', 'ui:embeddedPdf': 'Fund - Subscription Agreement.pdf' });
  });

  it('refuses a blank draft with no uploaded PDF, and says what to export', async () => {
    const b = blank();
    b['form_data.json'] = j({ form: {}, uploadedPdf: [], embeddedPdf: [] });
    await expect(buildPackage({ form: ours(), blank: b, source: new Uint8Array(), cut })).rejects.toThrow(/annotated PDF/);
  });

  it('cleans file names that would split in a zip, and a zip reads back what was written', async () => {
    expect(safeFileName('Annex 3: IRS/Withholding  Forms?.pdf')).toBe('Annex 3 IRS Withholding Forms .pdf');
    const { files } = await run();
    const again = await readZip(new Blob([writeZip(files) as BlobPart]));
    expect(Object.keys(again).sort()).toEqual(Object.keys(files).sort());
    expect(again['Fund - Subscription Agreement.pdf']).toEqual(new Uint8Array([8, 27]));
  });
});
