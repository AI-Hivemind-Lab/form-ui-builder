import { cutOf, CUT_KEY } from './pdfCut';
import type { FormDoc, UiEntry } from './types';

/**
 * Importing a form into Form Builder takes a package, not only the form content: the form (form_data.json) inside a wrapper that also
 * lists the uploaded PDFs, the embedded PDFs, and the records that link every file by name. The system-made parts (the ids, the PDF's
 * positioned fields) come from a blank form exported from Form Builder with only the annotated PDF added; this replaces its form with
 * ours and registers our embedded PDFs: each one a cut of the sub-doc (form_metadata.pdfCuts), its cut PDF in the package.
 */

export type Files = Record<string, Uint8Array>;
/** Pages `start` to `end` (1-based, included) of a PDF, as a PDF of their own. */
export type Cutter = (source: Uint8Array, start: number, end: number) => Promise<Uint8Array>;

export interface PackageInput {
  /** The form content, as exported (buildExport of the form). */
  form: Record<string, unknown>;
  /** The files of the blank-draft package, by name. */
  blank: Files;
  /** The sub-doc PDF the embedded PDFs are cut from. */
  source: Uint8Array;
  cut: Cutter;
}

export interface PackageResult {
  files: Files;
  /** What went in, and what was left out and why. */
  notes: string[];
}

const dec = new TextDecoder();
const enc = new TextEncoder();
const parse = <T,>(files: Files, name: string): T => {
  const raw = files[name];
  if (!raw) throw new Error(`The blank-draft package has no ${name}. Export a blank form from Form Builder with the annotated PDF added, and use that.`);
  return JSON.parse(dec.decode(raw)) as T;
};
const json = (v: unknown): Uint8Array => enc.encode(JSON.stringify(v));

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const random = (n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join('');
const uuid = (): string => crypto.randomUUID();

interface Pkg {
  form: Record<string, unknown>;
  uploadedPdf: [string, { name: string }][];
  embeddedPdf: [string, string][];
  [k: string]: unknown;
}
interface RecordData {
  rData: Record<string, Record<string, unknown>>;
  [k: string]: unknown;
}
interface Meta {
  widgetSources: Record<string, string>;
  widgetSourceSummary: { sourceCount: Record<string, number>; totalCount: number };
  pdfCuts?: Record<string, { fileName: string; start: number; end: number }>;
  [k: string]: unknown;
}

/** File names are keys in the records: no folders, nothing the zip would split. */
export const safeFileName = (name: string): string => name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function buildPackage({ form, blank, source, cut }: PackageInput): Promise<PackageResult> {
  const notes: string[] = [];
  const pkg = parse<Pkg>(blank, 'form_data.json');
  const record = parse<RecordData>(blank, 'record_data.json');
  const meta = parse<Meta>(blank, 'form_metadata.json');
  const [sourceFileId, annotated] = pkg.uploadedPdf?.[0] ?? [];
  if (!sourceFileId || !annotated?.name) throw new Error('The blank-draft package has no uploaded PDF: add the annotated PDF to the blank form before exporting it.');
  const folder = sourceFileId.split('.')[0]; // the part of every file id that is the form's own

  const main = (form.namespaceFormSchemaMap as { main: { schema: { properties: unknown[] }; uiSchema: Record<string, UiEntry> } }).main;
  const out: Files = {};
  const embedded: [string, string][] = [];
  const cuts: NonNullable<Meta['pdfCuts']> = {};
  const formRecord = Object.values(record.rData).find((r) => 'embeddedPdfFileNameRecord' in r) as { embeddedPdfFileNameRecord: Record<string, [number, string]> } | undefined;
  if (!formRecord) throw new Error('The blank-draft package has no record of its form data (record_data.json).');
  const taken = new Set(Object.keys(blank));

  // the sub-doc: the File widget names the annotated PDF the package holds
  for (const ui of Object.values(main.uiSchema)) if (ui['ui:widget'] === 'File') ui['ui:fileName'] = annotated.name;
  const retitle = (list: unknown[]): void => (list as { name: string; title: string; properties?: unknown[] }[]).forEach((n) => {
    if (main.uiSchema[n.name]?.['ui:widget'] === 'File') n.title = annotated.name;
    if (n.properties) retitle(n.properties);
  });
  retitle(main.schema.properties);

  // every embedded PDF: its own file, listed, recorded, and cut from the sub-doc
  for (const [name, ui] of Object.entries(main.uiSchema)) {
    if (ui['ui:widget'] !== 'Pdf') continue;
    const range = cutOf(ui);
    const file = safeFileName(String(ui['ui:embeddedPdf'] ?? ''));
    if (!range || file === '') {
      notes.push(`${name}: not packaged, it has no source pages${file === '' ? ' and no file name' : ''}`);
      continue;
    }
    if (taken.has(file) || cuts[file]) {
      notes.push(`${name}: "${file}" is already in the package, so ${name} shares it`);
      continue;
    }
    taken.add(file);
    out[file] = await cut(source, range.start, range.end);
    const fileRecord = uuid();
    record.rData[`0::${fileRecord}`] = { fileName: file };
    formRecord.embeddedPdfFileNameRecord[file] = [0, fileRecord];
    embedded.push([file, `${folder}.fdr000001.fil${random(9)}`]);
    cuts[file] = { fileName: annotated.name, start: range.start, end: range.end };
    ui['ui:embeddedPdf'] = file;
    delete ui[CUT_KEY]; // the cut is recorded in the package metadata, not on the widget
    notes.push(`${file}: pages ${range.start} - ${range.end} of the sub-doc`);
  }

  // where each widget comes from: all of ours were built by hand as far as Form Builder is concerned
  const names = Object.keys(main.uiSchema);
  meta.widgetSources = Object.fromEntries(names.map((n) => [n, 'MANUAL']));
  meta.widgetSourceSummary = { sourceCount: { '0': names.length }, totalCount: names.length };
  meta.pdfCuts = cuts;

  // the blank package's files, the cut PDFs, and the three files that describe the form
  const files: Files = { ...blank, ...out };
  files['form_data.json'] = json({ ...pkg, form, embeddedPdf: [...(pkg.embeddedPdf ?? []), ...embedded] });
  files['record_data.json'] = json(record);
  files['form_metadata.json'] = json(meta);
  return { files, notes };
}
