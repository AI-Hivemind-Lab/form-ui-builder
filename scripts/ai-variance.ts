// Asks the real model for the investor type question N times on one sub-doc and prints each answer, so you can see how stable it is.
// Needs .env.local (see .env.example). Usage:
//   node scripts/pdf-pages.mjs "<sub-doc>.pdf" pages.json
//   npx tsx scripts/ai-variance.ts "<annotation_document_data.json>" pages.json 8
import { readFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';

const [annotationPath, pagesPath, runs = '6'] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/ai-variance.ts <annotation.json> <pages.json> [runs]');
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const pages = JSON.parse(readFileSync(pagesPath, 'utf8'));
const built = buildForm(readFileSync(annotationPath, 'utf8'), { pdfPages: pages });
const doc = loadForm(built.form);

async function once(i: number) {
  // only the investor type task goes to the model; the others get an empty answer
  const ask = async (task: string, system: string, user: string): Promise<string> => (task.startsWith('investor-type') ? callLlm(env, { system, user }) : '{}');
  const t0 = Date.now();
  const res = await judgeForm({ doc, anchors: built.anchors, pages, titleWords: [] }, ask);
  const d = res.decisions.find((x) => x.id === 'investor-type');
  const v = d && d.data.kind === 'investor-type' ? d.data.value : null;
  return { run: i, secs: Math.round((Date.now() - t0) / 1000), individual: v?.individual.map((o) => o.label), entity: v?.entity.map((o) => o.label), source: v?.source, confidence: d?.confidence, note: res.notes.filter((n) => /Investor type/.test(n)).join(' ') || undefined };
}

void (async () => {
  const results = await Promise.all(Array.from({ length: Number(runs) }, (_, i) => once(i + 1)));
  results.forEach((r) => console.log(JSON.stringify(r)));
  const distinct = new Set(results.map((r) => JSON.stringify([r.individual, r.entity])));
  console.log(`${distinct.size} distinct answer(s) in ${results.length} runs`);
})();
