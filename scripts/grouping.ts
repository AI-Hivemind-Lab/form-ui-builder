// Runs only the grouping task of the AI review on one sub-doc and prints the groups it would build.
//   npx tsx scripts/grouping.ts "<annotation_document_data.json>" pages.json [out.json]   (out.json: the form with the groups built)
import { readFileSync, writeFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { applyDecisions } from '../src/generator/ai/apply';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { buildExport } from '../src/model/exportForm';
import { loadForm } from '../src/model/loadForm';

const [annotationPath, pagesPath, outPath] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/grouping.ts <annotation.json> <pages.json> [out.json]');
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const pages = JSON.parse(readFileSync(pagesPath, 'utf8'));
const built = buildForm(readFileSync(annotationPath, 'utf8'), { fundName: 'Example Fund LP', pdfPages: pages });
const doc = loadForm(built.form);

void (async () => {
  const ask = async (task: string, system: string, user: string): Promise<string> => (task.startsWith('grouping:') ? callLlm(env, { system, user }) : '{}');
  const res = await judgeForm({ doc, anchors: built.anchors, pages, titleWords: [] }, ask);
  const groups = res.decisions.filter((x) => x.data.kind === 'group');
  for (const d of groups) {
    if (d.data.kind !== 'group') continue;
    console.log(`[${d.confidence}] ${d.data.groupKind.padEnd(11)} "${d.data.name}" (${d.data.size})  ${d.data.fromAlias} … ${d.data.toAlias}${d.data.condition ? `\n      when: ${d.data.condition}` : ''}`);
  }
  console.log('notes:', res.notes.filter((n) => /Group/.test(n)));
  if (outPath) writeFileSync(outPath, JSON.stringify(buildExport(applyDecisions(doc, built.anchors, built.texts, groups.filter((x) => x.confidence !== 'low')).doc)));
})();
