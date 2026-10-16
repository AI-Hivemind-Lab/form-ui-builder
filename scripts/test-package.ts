// Builds a SMALL test package to find out whether Form Builder accepts a package whose embedded PDF we registered ourselves
// (a file id we made up, the cut recorded in form_metadata.pdfCuts, the cut PDF in the zip).
//   npx tsx scripts/test-package.ts "<blank draft folder>" "<real draft folder>" out/test-package
// The blank draft is a form exported from Form Builder with only the annotated PDF added. The real draft supplies the sample cut PDF
// (Annex 2 = page 64 of the sub-doc) so nothing has to be cut here.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

const [blank, real, out] = process.argv.slice(2);
if (!blank || !real || !out) {
  console.error('Usage: npx tsx scripts/test-package.ts <blank draft folder> <real draft folder> <out folder>');
  process.exit(1);
}
const read = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const EMBEDDED = 'Example Fund LP - Annex 2.pdf';
const START = 64;
const END = 64;

const pkg = read(blank, 'form_data.json');
const record = read(blank, 'record_data.json');
const meta = read(blank, 'form_metadata.json');
const [[sourceFileId, source]] = pkg.uploadedPdf as [string, { name: string }][];

// a file id in the pattern Form Builder uses: "<form id>.fdr000001.fil<9 characters>"
const random = (n: number) => [...randomBytes(n)].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const fileId = `${sourceFileId.split('.')[0]}.fdr000001.fil${random(9)}`;

// the form: the blank one, plus a page with the embedded PDF
const main = pkg.form.namespaceFormSchemaMap.main;
main.schema.properties.push({ name: 'test_page', type: 'object', title: 'Test embedded PDF', properties: [
  { name: 'test_header', type: 'null', title: 'Test embedded PDF' },
  { name: 'test_pdf', type: 'null', title: EMBEDDED },
] });
Object.assign(main.uiSchema, {
  test_page: { 'ui:widget': 'Page', 'ui:marginBottom': '12px' },
  test_header: { 'ui:widget': 'Header', 'ui:formattedText': 'Header', 'ui:heading': 'Test embedded PDF', 'ui:marginBottom': '12px', 'ui:subtitle': 'Example Fund LP' },
  test_pdf: { 'ui:widget': 'Pdf', 'ui:formattedText': 'Pdf', 'ui:embeddedPdf': EMBEDDED, 'ui:height': '600pt', 'ui:enabledComment': true, 'ui:marginBottom': '12px' },
});
pkg.embeddedPdf.push([EMBEDDED, fileId]);

// the records: the file, and the form data's name -> file link
const uuid = randomUUID();
record.rData[`0::${uuid}`] = { fileName: EMBEDDED };
const formRecord = Object.entries(record.rData).find(([k]) => k.startsWith('5::'))?.[1] as { embeddedPdfFileNameRecord: Record<string, [number, string]> };
formRecord.embeddedPdfFileNameRecord[EMBEDDED] = [0, uuid];

// the metadata: where the new widgets come from, and where the embedded PDF is cut from
['test_page', 'test_header', 'test_pdf'].forEach((n) => { meta.widgetSources[n] = 'MANUAL'; });
meta.widgetSourceSummary.sourceCount['0'] = (meta.widgetSourceSummary.sourceCount['0'] ?? 0) + 3;
meta.widgetSourceSummary.totalCount += 3;
meta.pdfCuts = { ...(meta.pdfCuts ?? {}), [EMBEDDED]: { fileName: source.name, start: START, end: END } };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const write = (f: string, v: unknown) => writeFileSync(join(out, f), JSON.stringify(v));
write('form_data.json', pkg);
write('record_data.json', record);
write('form_metadata.json', meta);
['form_integration_config.json', 'annotation_document_data.json', 'textract_annotation_target.json', 'sample-fund.pdf'].forEach((f) => copyFileSync(join(blank, f), join(out, f)));
const staticPdf = Object.values(record.rData as Record<string, { fileName?: string }>).map((r) => r.fileName).find((n) => n && /2\.pdf$/.test(n));
if (staticPdf) copyFileSync(existsSync(join(blank, staticPdf)) ? join(blank, staticPdf) : join(real, staticPdf), join(out, staticPdf)); // the real draft has the same file
copyFileSync(join(real, EMBEDDED), join(out, EMBEDDED));
rmSync(`${out}.zip`, { force: true });
execFileSync('zip', ['-q', '-r', resolve(`${out}.zip`), '.'], { cwd: out });
console.log(`written ${out}.zip\n  embedded PDF: ${EMBEDDED}\n  made-up file id: ${fileId}\n  cut: ${source.name} pages ${START}-${END}`);
