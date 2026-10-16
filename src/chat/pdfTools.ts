import { openStoredPdf } from '../model/pdfCache';
import { loadPdf } from '../model/pdfStore';
import { linesFromItems, renderPageImage } from '../generator/pdfText';
import type { ToolEnv } from './tools';

/** The source PDF kept in this browser, for the assistant to read (never to change). Null when none was added. */
export function browserPdfTools(): NonNullable<ToolEnv['pdf']> {
  return {
    async pageCount() {
      return (await openStoredPdf())?.doc.numPages ?? null;
    },
    async pageText(page) {
      const opened = await openStoredPdf();
      if (!opened || page < 1 || page > opened.doc.numPages) return null;
      const p = await opened.doc.getPage(page);
      const view = p.getViewport({ scale: 1 });
      const content = await p.getTextContent();
      const items = content.items.flatMap((i) => ('str' in i && Array.isArray(i.transform) ? [{ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : []));
      return linesFromItems(items, view.height, view.width).map((l) => l.text).join('\n');
    },
    async pageImage(page) {
      const stored = await loadPdf();
      return stored ? renderPageImage(stored.blob, page - 1, 1000) : null;
    },
  };
}
