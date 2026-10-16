// Runs only the supporting documents task of the AI review on one sub-doc and prints what it would propose and skip.
//   npx tsx scripts/supporting-docs.ts "<annotation_document_data.json>" pages.json [out.json]   (out.json: the form with the proposals applied)
import { readFileSync, writeFileSync } from 'node:fs';
import { applyDecisions } from '../src/generator/ai/apply';
import { buildExport } from '../src/model/exportForm';
import { callLlm } from '../server/llmProxy';
import { judgeForm } from '../src/generator/ai/tasks';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';
import { supportingDocCandidates } from '../src/generator/ai/candidates';

const [annotationPath, pagesPath, outPath] = process.argv.slice(2);
if (!annotationPath || !pagesPath) {
  console.error('Usage: npx tsx scripts/supporting-docs.ts <annotation.json> <pages.json>');
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

void (async () => {
  console.log('candidates:', supportingDocCandidates(doc).map((c) => `${c.alias} [${c.pageTitle}] <- ${c.heading.slice(0, 40)}`));
  const ask = async (task: string, system: string, user: string): Promise<string> => (task === 'supporting-docs' ? callLlm(env, { system, user }) : '{}');
  const res = await judgeForm({ doc, anchors: built.anchors, pages, titleWords: [] }, ask);
  for (const d of res.decisions.filter((x) => x.data.kind === 'supporting-docs')) {
    if (d.data.kind !== 'supporting-docs') continue;
    console.log(`\n${d.title} [${d.confidence}] below ${d.data.paragraphAlias}${d.data.instead ? ' (INSTEAD of completing the form: optional checkbox, at the end of the page)' : ''}`);
    d.data.files.forEach((f, i) => console.log(`  file${i + 1}: ${f.description}${f.helpText.length ? `\n      helptext: ${f.helpText.join(' | ')}` : ''}`));
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(buildExport(applyDecisions(doc, built.anchors, built.texts, res.decisions.filter((x) => x.defaultAccepted)).doc)));
  console.log('\nskipped (log):', res.log);
  console.log('notes:', res.notes.filter((n) => /Supporting/.test(n)));
})();
