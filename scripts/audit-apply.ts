// Runs the whole AI review with the real model on one sub-doc, applies EVERY proposal, and lists what the proposals took off the form
// (texts the form showed before and no longer shows) and the warnings they raised.
//   npx tsx scripts/audit-apply.ts "<annotation_document_data.json>" pages.json "Fund Name"
import { readFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { applyDecisions } from '../src/generator/ai/apply';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { lostTexts } from '../src/generator/coverage';
import { loadForm } from '../src/model/loadForm';

const [annotationPath, pagesPath, fundName = ''] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/audit-apply.ts <annotation.json> <pages.json> [fund name]');
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
  const ask = (_task: string, system: string, user: string): Promise<string> => callLlm(env, { system, user });
  const judged = await judgeForm({ doc, anchors: built.anchors, pages, fundName, titleWords: [] }, ask, (m) => console.log(m));
  console.log(`${judged.decisions.length} proposals:`, Object.entries(judged.decisions.reduce<Record<string, number>>((n, d) => ({ ...n, [d.data.kind]: (n[d.data.kind] ?? 0) + 1 }), {})));
  // every proposal on its own, so a loss is traced to the proposal that caused it
  for (const d of judged.decisions) {
    const one = applyDecisions(doc, built.anchors, built.texts, [d]);
    const lost = lostTexts(one.doc, built.texts, doc);
    if (lost.length > 0) console.log(`LOSS by ${d.id} (${d.data.kind}): ${lost.map((t) => `"${t.slice(0, 70)}"`).join('; ')}`);
  }
  const all = applyDecisions(doc, built.anchors, built.texts, judged.decisions);
  console.log('all together:', all.warnings.filter((w) => /^TEXT LOST/.test(w)));
})();
