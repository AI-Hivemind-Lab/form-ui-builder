// Builds every real sub-doc listed in a local file and reports what changed since the last run: pages, warnings, change log and the
// AI candidate lists. Run it before and after a change that touches how forms are built, to see what the change did to real forms.
//   npx tsx scripts/regress.ts forms.local.json          first run: saves a baseline in .regress/
//   npx tsx scripts/regress.ts forms.local.json          later runs: lists the differences against it (add --save to keep the new one)
// forms.local.json (not committed: the documents are the clients'): [{ "name": "Example", "annotation": "/path/annotation_document_data.json", "pages": "/path/pages.json", "fund": "Example" }]
// pages.json comes from: node scripts/pdf-pages.mjs file.pdf pages.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as C from '../src/generator/ai/candidates';
import { embeddedPdfFacts } from '../src/generator/ai/embeddedPdfs';
import { groupPageFacts } from '../src/generator/ai/groupFacts';
import { buildForm } from '../src/generator/buildForm';
import { loadForm } from '../src/model/loadForm';

const [listPath, ...flags] = process.argv.slice(2);
if (!listPath) {
  console.error('Usage: npx tsx scripts/regress.ts forms.local.json [--save]');
  process.exit(1);
}
const forms = JSON.parse(readFileSync(listPath, 'utf8')) as { name: string; annotation: string; pages: string; fund?: string }[];
mkdirSync('.regress', { recursive: true });
let changed = 0;
for (const f of forms) {
  const pages = JSON.parse(readFileSync(f.pages, 'utf8'));
  const built = buildForm(readFileSync(f.annotation, 'utf8'), { fundName: f.fund ?? '', pdfPages: pages });
  const doc = loadForm(built.form);
  const snapshot: Record<string, unknown> = {
    form: built.form, warnings: built.warnings, changes: built.changes,
    signatures: C.signatureCandidates(doc, built.anchors), options: C.optionGroupCandidates(doc, built.anchors), labels: C.labelCandidates(doc, built.anchors, pages),
    groupLabels: C.groupLabelCandidates(doc, built.anchors, pages), addresses: C.addressCandidates(doc, built.anchors), required: C.requiredFieldCandidates(doc, built.anchors, pages),
    duplicates: C.duplicateCandidates(doc, built.anchors), embedded: embeddedPdfFacts(doc, built.anchors, pages), groups: groupPageFacts(doc, built.anchors, pages),
  };
  const file = `.regress/${f.name.replace(/[^a-z0-9]+/gi, '_')}.json`;
  const now = JSON.stringify(snapshot, null, 1);
  if (!existsSync(file)) {
    writeFileSync(file, now);
    console.log(`${f.name}: baseline saved`);
    continue;
  }
  const before = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const differs = Object.keys(snapshot).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(snapshot[k]));
  if (differs.length === 0) console.log(`${f.name}: no change`);
  else {
    changed += 1;
    console.log(`${f.name}: changed in ${differs.join(', ')}`);
    const pagesNow = (built.form as { namespaceFormSchemaMap: { main: { schema: { properties: { name: string; title: string }[] } } } }).namespaceFormSchemaMap.main.schema.properties;
    console.log(`  pages now: ${pagesNow.map((p) => p.title).join(' | ')}`);
    if (differs.includes('warnings')) {
      const was = new Set((before.warnings as string[]) ?? []);
      const is = new Set(built.warnings);
      [...is].filter((w) => !was.has(w)).slice(0, 8).forEach((w) => console.log(`  + ${w.slice(0, 150)}`));
      [...was].filter((w) => !is.has(w)).slice(0, 8).forEach((w) => console.log(`  - ${w.slice(0, 150)}`));
    }
  }
  if (flags.includes('--save')) writeFileSync(file, now);
}
console.log(changed === 0 ? 'Nothing changed.' : `${changed} form(s) changed.`);
