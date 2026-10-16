import { describe, expect, it } from 'vitest';

/** The extension patch (docs/transform-extension/cutApi.js): the three calls were read from what Form Builder sends when a Pdf widget's source pages are set. */
interface Transformed {
  formData: { uploadedPdf: [string, { name: string }][]; embeddedPdf: [string, string][] };
  formModel: { formId: string };
  metadata?: { pdfCuts?: Record<string, { fileName: string; start: number; end: number }> };
  embeddedCuts?: { name: string; start: number; end: number }[];
}
interface Api {
  CUT_PATHS: { info: string; cut: string; check: string };
  applyEmbeddedCuts(t: Transformed, call: (path: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>, say?: (m: string) => void): Promise<{ made: number; kept: number }>;
}
const modulePath = '../../docs/transform-extension/cutApi.js';
const load = async (): Promise<Api> => (await import(/* @vite-ignore */ modulePath)) as Api;

const SOURCE = 'for1.fdr000001.filsource';
const form = (embedded: [string, string][] = [], pdfCuts?: Record<string, { fileName: string; start: number; end: number }>): Transformed => ({
  formData: { uploadedPdf: [[SOURCE, { name: 'Packet.pdf' }]], embeddedPdf: embedded },
  formModel: { formId: 'for1' },
  metadata: pdfCuts ? { pdfCuts } : {},
  embeddedCuts: [{ name: 'Instructions.pdf', start: 2, end: 2 }, { name: 'Agreement.pdf', start: 3, end: 16 }],
});

/** A server that knows the source PDF (34 pages), makes a file per cut and knows the files it made (and any in `known`). */
function server(known: string[] = []) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const files = new Set(known);
  let n = 0;
  const call = async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    calls.push({ path, body });
    if (path === 'form/getFileInfoToCut') return { url: 'u', pageCount: 34 };
    if (path === 'form/cutFile') { const id = `for1.fdr000001.filcut${++n}`; files.add(id); return { fileId: id }; }
    if (path === 'files/getPdfUrl') { if (!files.has(String(body.fileId))) throw new Error('not found'); return { url: 'u', numberOfFiles: 1 }; }
    throw new Error(`unknown ${path}`);
  };
  return { call, calls };
}

describe('transFORM patch: embedded PDF cuts', () => {
  it('cuts each wanted page range from the form\'s PDF and lists the new files in the form and its metadata', async () => {
    const { applyEmbeddedCuts } = await load();
    const t = form();
    const api = server();
    expect(await applyEmbeddedCuts(t, api.call)).toEqual({ made: 2, kept: 0 });
    expect(api.calls.filter((c) => c.path === 'form/cutFile').map((c) => c.body)).toEqual([
      { fileId: SOURCE, formId: 'for1', start: 2, end: 2, fileName: 'Instructions.pdf' },
      { fileId: SOURCE, formId: 'for1', start: 3, end: 16, fileName: 'Agreement.pdf' },
    ]);
    expect(t.formData.embeddedPdf).toEqual([['Instructions.pdf', 'for1.fdr000001.filcut1'], ['Agreement.pdf', 'for1.fdr000001.filcut2']]);
    expect(t.metadata?.pdfCuts).toEqual({ 'Instructions.pdf': { fileName: 'Packet.pdf', start: 2, end: 2 }, 'Agreement.pdf': { fileName: 'Packet.pdf', start: 3, end: 16 } });
  });
  it('makes nothing when the form already has the cut (same pages, file still there), so a second Apply leaves no copy', async () => {
    const { applyEmbeddedCuts } = await load();
    const t = form([['Instructions.pdf', 'for1.fdr000001.filold1'], ['Agreement.pdf', 'for1.fdr000001.filold2']], { 'Instructions.pdf': { fileName: 'Packet.pdf', start: 2, end: 2 }, 'Agreement.pdf': { fileName: 'Packet.pdf', start: 3, end: 16 } });
    const api = server(['for1.fdr000001.filold1', 'for1.fdr000001.filold2']);
    expect(await applyEmbeddedCuts(t, api.call)).toEqual({ made: 0, kept: 2 });
    expect(api.calls.some((c) => c.path === 'form/cutFile')).toBe(false);
    expect(t.formData.embeddedPdf[0][1]).toBe('for1.fdr000001.filold1');
  });
  it('cuts again when the listed file does not exist (an id made up by a package import) or the pages changed, replacing the entry', async () => {
    const { applyEmbeddedCuts } = await load();
    const t = form([['Instructions.pdf', 'for1.fdr000001.filmadeup'], ['Agreement.pdf', 'for1.fdr000001.filold2'], ['Other.pdf', 'for1.fdr000001.fil9']], { 'Instructions.pdf': { fileName: 'Packet.pdf', start: 2, end: 2 }, 'Agreement.pdf': { fileName: 'Packet.pdf', start: 3, end: 10 }, 'Other.pdf': { fileName: 'Packet.pdf', start: 1, end: 1 } });
    const api = server(['for1.fdr000001.filold2']);
    expect(await applyEmbeddedCuts(t, api.call)).toEqual({ made: 2, kept: 0 });
    expect(t.formData.embeddedPdf.map((e) => e[0])).toEqual(['Instructions.pdf', 'Agreement.pdf', 'Other.pdf']); // the unrelated entry stays
    expect(t.formData.embeddedPdf[0][1]).toBe('for1.fdr000001.filcut1');
    expect(t.metadata?.pdfCuts?.['Agreement.pdf']).toEqual({ fileName: 'Packet.pdf', start: 3, end: 16 });
  });
  it('checks every range against the page count before it makes anything', async () => {
    const { applyEmbeddedCuts } = await load();
    const t = form();
    t.embeddedCuts = [{ name: 'Fine.pdf', start: 1, end: 2 }, { name: 'Too far.pdf', start: 30, end: 35 }];
    const api = server();
    await expect(applyEmbeddedCuts(t, api.call)).rejects.toThrow('pages 30 to 35 are not inside the 34-page PDF');
    expect(api.calls.some((c) => c.path === 'form/cutFile')).toBe(false);
    expect(t.formData.embeddedPdf).toEqual([]);
  });
  it('does nothing when the function asked for no cuts (the original behaviour), and says so when the form holds no PDF', async () => {
    const { applyEmbeddedCuts } = await load();
    const none = form();
    delete none.embeddedCuts;
    const api = server();
    expect(await applyEmbeddedCuts(none, api.call)).toEqual({ made: 0, kept: 0 });
    expect(api.calls).toEqual([]);
    const empty = form();
    empty.formData.uploadedPdf = [];
    await expect(applyEmbeddedCuts(empty, api.call)).rejects.toThrow('holds no source PDF');
  });
});
