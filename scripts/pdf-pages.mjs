// Writes the positioned text of a PDF's pages (the same shape the app reads in the browser) to a JSON file.
// Usage: node scripts/pdf-pages.mjs <file.pdf> <pages.json>
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const [pdf, out] = process.argv.slice(2);
if (!pdf || !out) {
  console.error('Usage: node scripts/pdf-pages.mjs <file.pdf> <pages.json>');
  process.exit(1);
}
const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
const pages = [];
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  const { height, width } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })).filter((i) => i.str.trim() !== '');
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const i of items) {
    const row = rows.find((r) => Math.abs(r.y - i.y) < 2.5);
    if (row) row.items.push(i);
    else rows.push({ y: i.y, items: [i] });
  }
  const lines = rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    const groups = [];
    for (const i of sorted) {
      const last = groups[groups.length - 1];
      const prev = last?.[last.length - 1];
      if (prev && i.x - (prev.x + prev.w) <= 14) last.push(i);
      else groups.push([i]);
    }
    return {
      top: Math.max(0, Math.min(1, 1 - r.y / height)),
      text: sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
      segments: groups.map((g) => ({ left: g[0].x / width, right: (g[g.length - 1].x + g[g.length - 1].w) / width, text: g.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim() })),
    };
  });
  pages.push({ page: p - 1, lines, text: lines.map((l) => l.text).join('\n') });
}
writeFileSync(out, JSON.stringify(pages));
console.log(`${pages.length} pages written to ${out}`);
