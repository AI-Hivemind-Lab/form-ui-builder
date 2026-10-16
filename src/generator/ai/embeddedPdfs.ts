import { pageStart } from '../pageOrder';
import { cutOf } from '../../model/pdfCut';
import type { Anchors } from '../../model/pdfStore';
import { getWidget, isInvisible } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../../model/types';
import type { PageText } from '../pdfText';
import { signatureCandidates } from './candidates';
import { firstAlias, plainText, walk } from '../standards/util';

/**
 * Embedded PDFs: the parts of the sub-doc the investor only reads (the directions, the agreement, the annexes) are shown in the form
 * as PDF pages cut from the sub-doc. The annotation may already say which pages; when it does not, the AI reads the page headings.
 * These are the rules around its answer.
 */

export interface PdfPageFact {
  page: number;
  /** The first lines of the page, where its heading is. */
  head: string;
  /** How many annotated fields sit on it. */
  fields: number;
  hasSignature: boolean;
}

export interface FormPageFact {
  name: string;
  title: string;
  /** The first sub-doc page its fields or embedded PDF sit on (1-based). */
  firstPage: number | null;
}

export interface EmbeddedPdfFacts {
  total: number;
  pages: PdfPageFact[];
  /** Ranges the annotation already embeds: never overlapped. */
  existing: { start: number; end: number; name: string }[];
  formPages: FormPageFact[];
  /** Pages (1-based) that hold a signature block. */
  signaturePages: number[];
}

/** The first sub-doc page (1-based) of everything on a form page: its fields (choices through their options) and its embedded PDFs. */
function firstPageOf(doc: FormDoc, anchors: Anchors, page: SchemaNode): number | null {
  const start = pageStart(doc, anchors, page);
  return start ? start.page + 1 : null;
}

export function embeddedPdfFacts(doc: FormDoc, anchors: Anchors, pdf: PageText[]): EmbeddedPdfFacts {
  const sigPages = new Set(signatureCandidates(doc, anchors).flatMap((s) => (s.page === null ? [] : [s.page])));
  const fieldsOn = new Map<number, number>();
  Object.values(anchors).forEach((a) => fieldsOn.set(a.page + 1, (fieldsOn.get(a.page + 1) ?? 0) + 1));
  const pages: PdfPageFact[] = pdf.map((p) => ({
    page: p.page + 1,
    head: p.lines.slice(0, 3).map((l) => l.text).join(' / ').slice(0, 140),
    fields: fieldsOn.get(p.page + 1) ?? 0,
    hasSignature: sigPages.has(p.page + 1),
  }));
  const existing: EmbeddedPdfFacts['existing'] = [];
  walk(doc.schema.properties, (n) => {
    const cut = getWidget(doc, n) === 'Pdf' ? cutOf(doc.uiSchema[n.name]) : null;
    if (cut) existing.push({ ...cut, name: String(doc.uiSchema[n.name]?.['ui:embeddedPdf'] ?? n.title) });
  });
  const formPages = doc.schema.properties
    .filter((n) => getWidget(doc, n) === 'Page' && !isInvisible(doc, n.name))
    .map((n) => ({ name: n.name, title: n.title, firstPage: firstPageOf(doc, anchors, n) }));
  return { total: pdf.length, pages, existing, formPages, signaturePages: [...sigPages].sort((a, b) => a - b) };
}

/** "{{fund_name}} - {{file_name}}.pdf"; without a fund name, just the document name. Never the sub-doc's own file name. */
export function composeFileName(fundName: string, documentName: string, sourceName = ''): string {
  const doc = documentName.replace(/\s+/g, ' ').replace(/\.pdf$/i, '').trim();
  const fund = fundName.trim();
  let name = `${fund ? `${fund} - ` : ''}${doc}.pdf`;
  if (sourceName && name.toLowerCase() === sourceName.trim().toLowerCase()) name = `${fund ? `${fund} - ` : ''}${doc} (excerpt).pdf`;
  return name;
}

/**
 * The signature page is not part of an embedded file the AI chose: a trailing page that holds a signature block is cut off, unless the
 * AI says it carries other readable content the investor needs. A signature page inside the range stays (the range goes on after it).
 */
export function trimSignaturePages(start: number, end: number, signaturePages: number[], keepSignaturePage: boolean): number {
  if (keepSignaturePage) return end;
  let last = end;
  while (last > start && signaturePages.includes(last)) last -= 1;
  return last;
}

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => a.start <= b.end && b.start <= a.end;

/** The top-level form page a new page for sub-doc page `start` goes before: the first page whose content starts later in the sub-doc. */
export function pageToPrecede(facts: EmbeddedPdfFacts, start: number): string | null {
  return facts.formPages.find((p) => p.firstPage !== null && p.firstPage > start)?.name ?? null;
}

export const headText = (html: unknown): string => plainText(html);
