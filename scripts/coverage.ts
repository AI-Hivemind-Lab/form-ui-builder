// Runs only the "content never on the form" check with the real model and prints what it would propose.
//   npx tsx scripts/coverage.ts "<annotation_document_data.json>" pages.json "Fund Name"
import { readFileSync } from 'node:fs';
import { callLlm } from '../server/llmProxy';
import { findMissingContent } from '../src/generator/ai/coverage';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';

const [annotationPath, pagesPath, fundName = ''] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/coverage.ts <annotation.json> <pages.json> [fund name]');
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
  const res = await findMissingContent({ doc, anchors: built.anchors, pages, fundName, texts: built.texts }, ask, (m) => console.log(m));
  console.log(`lines checked ${res.found.checked}, not on the form ${res.found.uncovered}`);
  res.decisions.forEach((d) => console.log(`[${d.confidence}] ${d.title}${d.data.kind === 'add-text' ? `  -> after ${d.data.after ?? '-'} / before ${d.data.before ?? '-'} / page ${d.data.page ?? '-'}` : ''}`));
  console.log('NOTES', res.notes);
})();
