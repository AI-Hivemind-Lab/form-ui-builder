// Runs only the embedded PDF task of the AI review on one sub-doc and prints the pages it would cut.
//   npx tsx scripts/embedded-pdfs.ts "<annotation_document_data.json>" pages.json "Fund name" [out.json]   (out.json: the form with the proposals applied)
import { readFileSync, writeFileSync } from 'node:fs';
import { applyDecisions } from '../src/generator/ai/apply';
import { buildExport } from '../src/model/exportForm';
import { callLlm } from '../server/llmProxy';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';

const [annotationPath, pagesPath, fundName = '', outPath] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/embedded-pdfs.ts <annotation.json> <pages.json> [fund name]');
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const pages = JSON.parse(readFileSync(pagesPath, 'utf8'));
const built = buildForm(readFileSync(annotationPath, 'utf8'), { fundName, pdfPages: pages });
const doc = loadForm(built.form);

void (async () => {
  const ask = async (task: string, system: string, user: string): Promise<string> => (task === 'embedded-pdfs' ? callLlm(env, { system, user }) : '{}');
  const res = await judgeForm({ doc, anchors: built.anchors, pages, fundName, titleWords: [] }, ask);
  for (const d of res.decisions.filter((x) => x.data.kind === 'embedded-pdf')) {
    if (d.data.kind !== 'embedded-pdf') continue;
    console.log(`${d.title} [${d.confidence}]\n   file: ${d.data.fileName}\n   before page: ${d.data.beforePage}\n   evidence: ${d.evidence?.quote}\n   ${d.detail}\n`);
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(buildExport(applyDecisions(doc, built.anchors, built.texts, res.decisions.filter((x) => x.defaultAccepted)).doc)));
  console.log('notes:', res.notes.filter((n) => /Embedded/.test(n)));
})();
