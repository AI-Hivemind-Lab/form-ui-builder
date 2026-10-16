import { cleanGlyphs } from './cleanText';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** One run of text on a line; a two-column row ("Name:   Name:") is two segments. Positions are 0 to 1 across the page. */
export interface PdfSegment {
  left: number;
  right: number;
  text: string;
}

export interface PdfLine {
  /** Distance from the top of the page, 0 to 1. */
  top: number;
  text: string;
  /** Where each run of text on the line sits, when the PDF gave widths. */
  segments?: PdfSegment[];
}

export interface PageText {
  /** 0-based, the same numbering as the annotation's pageIndex. */
  page: number;
  lines: PdfLine[];
  text: string;
}

interface Item {
  str: string;
  x: number;
  /** Width of the text, in the same units as x. */
  w?: number;
  /** Baseline height from the bottom of the page. */
  y: number;
}

/** A gap wider than this (page units) between two bits of text starts a new segment: a new column. */
const SEGMENT_GAP = 14;

/** Group text items into lines (items on the same baseline), left to right, top to bottom. */
export function linesFromItems(items: Item[], pageHeight: number, pageWidth = 0): PdfLine[] {
  const rows: { y: number; items: Item[] }[] = [];
  [...items]
    .map((i) => ({ ...i, str: cleanGlyphs(i.str) }))
    .filter((i) => i.str.trim() !== '')
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .forEach((i) => {
      const row = rows.find((r) => Math.abs(r.y - i.y) < 2.5);
      if (row) row.items.push(i);
      else rows.push({ y: i.y, items: [i] });
    });
  return rows.map((r) => {
    const sorted = r.items.sort((a, b) => a.x - b.x);
    const line: PdfLine = {
      top: pageHeight > 0 ? Math.max(0, Math.min(1, 1 - r.y / pageHeight)) : 0,
      text: sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
    };
    if (pageWidth > 0 && sorted.every((i) => typeof i.w === 'number')) {
      const groups: Item[][] = [];
      sorted.forEach((i) => {
        const last = groups[groups.length - 1];
        const prev = last?.[last.length - 1];
        if (prev && i.x - (prev.x + (prev.w ?? 0)) <= SEGMENT_GAP) last.push(i);
        else groups.push([i]);
      });
      line.segments = groups.map((g) => ({
        left: g[0].x / pageWidth,
        right: (g[g.length - 1].x + (g[g.length - 1].w ?? 0)) / pageWidth,
        text: g.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
      }));
    }
    return line;
  });
}

export const pageTextOf = (page: number, lines: PdfLine[]): PageText => ({ page, lines, text: lines.map((l) => l.text).join('\n') });

const loaded = new WeakMap<Blob, Promise<import('pdfjs-dist').PDFDocumentProxy>>();
async function openPdf(blob: Blob) {
  const hit = loaded.get(blob);
  if (hit) return hit;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const p = blob.arrayBuffer().then((data) => pdfjs.getDocument({ data }).promise);
  loaded.set(blob, p);
  return p;
}

/** One page as a JPEG data URL, for the model to look at. Runs in the browser. */
export async function renderPageImage(blob: Blob, pageIndex: number, width = 900, timeoutMs = 8000): Promise<string | null> {
  // Rendering needs a visible tab; if it stalls the judgment goes on with the page text alone.
  const render = (async (): Promise<string | null> => {
    const doc = await openPdf(blob);
    if (pageIndex < 0 || pageIndex >= doc.numPages) return null;
    const page = await doc.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  })().catch(() => null);
  return Promise.race([render, new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))]);
}

/** The text of every page of a PDF, with where each line sits. Runs in the browser. */
export async function extractPdfText(blob: Blob): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  const out: PageText[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const { height, width } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items.flatMap((i) => ('str' in i && Array.isArray(i.transform) ? [{ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width }] : []));
    out.push(pageTextOf(n - 1, linesFromItems(items, height, width)));
  }
  return out;
}
