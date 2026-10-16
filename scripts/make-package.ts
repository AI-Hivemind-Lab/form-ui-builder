// Makes an importable package from a form exported by the app ("Export form JSON") and a blank-draft package exported by Form Builder.
//   npx tsx scripts/make-package.ts "<form.json>" "<blank draft>.zip" "<sub-doc>.pdf" out/package.zip
import { readFileSync, writeFileSync } from 'node:fs';
import { buildExport } from '../src/model/exportForm';
import { parseFormJson } from '../src/model/loadForm';
import { buildPackage } from '../src/model/packageExport';
import { cutPdfPages } from '../src/model/pdfCutter';
import { readZip, writeZip } from '../src/model/zip';

const [formPath, blankPath, pdfPath, outPath] = process.argv.slice(2);
if (!formPath || !blankPath || !pdfPath || !outPath) {
  console.error('Usage: npx tsx scripts/make-package.ts <form.json> <blank draft.zip> <sub-doc.pdf> <out.zip>');
  process.exit(1);
}
void (async () => {
  const form = buildExport(parseFormJson(readFileSync(formPath, 'utf8'))) as Record<string, unknown>;
  const blank = await readZip(new Blob([readFileSync(blankPath)]));
  const result = await buildPackage({ form, blank, source: new Uint8Array(readFileSync(pdfPath)), cut: cutPdfPages });
  writeFileSync(outPath, writeZip(result.files));
  console.log(`written ${outPath}: ${Object.keys(result.files).length} files`);
  result.notes.forEach((n) => console.log('  ', n));
})();
