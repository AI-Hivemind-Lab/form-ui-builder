import { primaryBox } from '../model/pdfAnchors';
import type { Anchors } from '../model/pdfStore';
import { getAllPages, getWidget } from '../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../model/types';
import { walk } from './standards/util';

/** Where a form page starts in the sub-doc: its first PDF page (0-based) and the height on it. */
export interface PageStart {
  page: number;
  top: number;
}

/**
 * The first place of the sub-doc a page uses: the earliest of its fields' main boxes and of its embedded PDFs (the page the cut starts on). The single answer to "where does this page sit in the PDF"; null when nothing on the page is tied to the PDF.
 */
export function pageStart(doc: FormDoc, anchors: Anchors, page: SchemaNode): PageStart | null {
  const found: PageStart[] = [];
  walk(page.properties ?? [], (n) => {
    // (a field merged from several PDF places belongs to the page of its main place, not of the copies it is also written to)
    const at = primaryBox(doc, n, anchors);
    if (at) found.push({ page: at.page, top: at.top });
    if (getWidget(doc, n) === 'Pdf') {
      const cut = doc.uiSchema[n.name]?.['ui:pdfCutInfo'] as { start?: unknown } | undefined;
      if (typeof cut?.start === 'number') found.push({ page: cut.start - 1, top: 0 }); // the cut's pages are numbered from 1
    }
  });
  if (found.length === 0) return null;
  return found.reduce((m, f) => (f.page < m.page || (f.page === m.page && f.top < m.top) ? f : m));
}

export interface OrderIssue {
  name: string;
  title: string;
  /** 1-based, as printed. */
  pdfPage: number;
  /** The page it should come after, or null for the top of the form. */
  after: { name: string; title: string; pdfPage: number } | null;
}

/**
 * Visible pages that are out of the sub-doc's order. The form's pages should read in the order the sub-doc does; the fewest pages are
 * reported (the longest run that is in order stays, the others are the ones to move). A page with nothing tied to the PDF is not judged.
 */
export function pagesOutOfOrder(doc: FormDoc, anchors: Anchors): OrderIssue[] {
  const known = getAllPages(doc, false).flatMap((p) => {
    const start = pageStart(doc, anchors, p);
    return start ? [{ name: p.name, title: p.title, start }] : [];
  });
  const n = known.length;
  if (n < 2) return [];
  // the longest non-decreasing run by PDF page
  const best: number[] = Array(n).fill(1);
  const from: number[] = Array(n).fill(-1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (known[j].start.page <= known[i].start.page && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        from[i] = j;
      }
    }
  }
  let end = 0;
  best.forEach((b, i) => {
    if (b > best[end]) end = i;
  });
  const keep = new Set<number>();
  for (let i = end; i >= 0; i = from[i]) keep.add(i);
  const kept = known.filter((_, i) => keep.has(i));
  return known.flatMap((k, i) => {
    if (keep.has(i)) return [];
    const before = kept.filter((c) => c.start.page <= k.start.page).pop();
    return [{ name: k.name, title: k.title, pdfPage: k.start.page + 1, after: before ? { name: before.name, title: before.title, pdfPage: before.start.page + 1 } : null }];
  });
}

/** The same, as the warnings the build lists. */
export function pageOrderWarnings(doc: FormDoc, anchors: Anchors): string[] {
  return pagesOutOfOrder(doc, anchors).map((o) => `PAGE ORDER: "${o.title}" starts on PDF page ${o.pdfPage} but sits out of the PDF's order; in the PDF it comes ${o.after ? `after "${o.after.title}" (PDF page ${o.after.pdfPage})` : 'before the first page of the form'}`);
}
