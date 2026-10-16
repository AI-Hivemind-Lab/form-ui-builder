// Runs only the label tasks of the AI review (text boxes, and the questions above Yes/No and checkbox groups) and prints what they find.
//   npx tsx scripts/labels.ts "<annotation_document_data.json>" pages.json "Fund Name"
import { readFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { groupLabelCandidates } from '../src/generator/ai/candidates';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';
import { allWarnings } from '../src/model/warnings';

const [annotationPath, pagesPath, fundName = ''] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/labels.ts <annotation.json> <pages.json> [fund name]');
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
  const before = allWarnings(doc).filter((w) => w.messages.includes('Missing label')).length;
  const cands = groupLabelCandidates(doc, built.anchors, pages);
  console.log(`missing labels: ${before}; question candidates: ${cands.length}`);
  const ask = async (task: string, system: string, user: string): Promise<string> => (/^(labels|group-labels)/.test(task) ? callLlm(env, { system, user }) : '{}');
  const res = await judgeForm({ doc, anchors: built.anchors, pages, titleWords: [] }, ask);
  const labels = res.decisions.filter((d) => d.data.kind === 'label');
  console.log(`labels found: ${labels.length}`);
  labels.forEach((d) => console.log(`  [${d.confidence}] ${d.title}`));
  console.log('notes:', res.notes.filter((n) => /Label/.test(n)));
  const found = new Set(labels.map((d) => (d.data.kind === 'label' ? d.data.alias : '')));
  const left = allWarnings(doc).filter((w) => w.messages.includes('Missing label') && !found.has(w.name));
  console.log(`still without a label: ${left.length}`, left.slice(0, 15).map((w) => w.name));
})();
