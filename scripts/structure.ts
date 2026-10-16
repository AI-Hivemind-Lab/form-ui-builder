// Runs the structure step (where loose objects go, what untitled pages are called) with the real model and prints the pages that result.
//   npx tsx scripts/structure.ts "<annotation_document_data.json>" pages.json "Fund Name"
import { readFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { planStructure } from '../src/generator/ai/structure';
import { buildForm } from '../src/generator/buildForm';

const [annotationPath, pagesPath, fundName = ''] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/structure.ts <annotation.json> <pages.json> [fund name]');
  process.exit(1);
}
const env: Record<string, string> = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}
const text = readFileSync(annotationPath, 'utf8');
const pages = JSON.parse(readFileSync(pagesPath, 'utf8'));
void (async () => {
  const first = buildForm(text, { fundName, pdfPages: pages });
  console.log('RUNS (the program)');
  first.structure.runs.forEach((r) => console.log(`  ${r.id} p${r.fromPage}-${r.toPage} x${r.count} under "${r.heading?.text ?? '-'}" -> ${JSON.stringify(r.action)}`));
  const ask = (task: string, system: string, user: string): Promise<string> => callLlm(env, { system, user });
  const plan = await planStructure(first.structure, ask, (m) => console.log(m));
  console.log('\nPLAN', JSON.stringify(plan, null, 1));
  const second = buildForm(text, { fundName, pdfPages: pages, plan });
  const f = second.form as { namespaceFormSchemaMap: { main: { schema: { properties: { name: string; title: string; properties?: unknown[] }[] } } } };
  console.log('\nPAGES');
  f.namespaceFormSchemaMap.main.schema.properties.forEach((p) => console.log(`  ${p.name.padEnd(55)} ${p.title}  (${p.properties?.length ?? 0})`));
  console.log('\nLOG', second.changes.filter((c) => c.startsWith('structure:')));
})();
