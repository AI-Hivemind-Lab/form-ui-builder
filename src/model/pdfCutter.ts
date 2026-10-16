import { PDFDocument } from 'pdf-lib';

/** Pages `start` to `end` (1-based, both included) of a PDF, as a new PDF. */
export async function cutPdfPages(source: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  const from = await PDFDocument.load(source, { ignoreEncryption: true });
  if (start < 1 || end < start || end > from.getPageCount()) throw new Error(`Pages ${start} - ${end} are not in a PDF of ${from.getPageCount()} pages`);
  const to = await PDFDocument.create();
  const pages = await to.copyPages(from, Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i));
  pages.forEach((p) => to.addPage(p));
  return to.save();
}
