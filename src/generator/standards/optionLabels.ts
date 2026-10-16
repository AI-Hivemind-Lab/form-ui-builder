import { escapeHtml } from '../../model/html';
import type { Anchor } from '../../model/pdfStore';
import { getWidget } from '../../model/schemaWalk';
import type { PdfLine } from '../pdfText';
import type { Standard, StandardContext } from './types';
import { patchUi, plainText, walk } from './util';

const CHOICES = ['Radio', 'MultipleCheckbox'];
/** The box printed in the PDF is a character of its own ("□ Individual"): it is not part of the words. */
const PRINTED_BOX = /^[□☐☑☒❏❑▢■◻◯○●◦oO]?\s*(?=[A-Za-z0-9(“"'])|^[□☐☑☒❏❑▢■◻◯○●]+\s*/;
interface Seg {
  left: number;
  right: number;
  text: string;
  /** The run began with the printed box: it starts where the box does. */
  glyph: boolean;
}
const segmentsOf = (l: PdfLine): Seg[] =>
  (l.segments ?? [{ left: 0, right: 1, text: l.text }]).map((s) => ({ ...s, glyph: /^[□☐☑☒❏❑▢■◻◯○●]/.test(s.text), text: /^[□☐☑☒❏❑▢■◻◯○●]/.test(s.text) ? s.text.replace(PRINTED_BOX, '').trim() : s.text })).filter((s) => s.text !== '');
const startsAtBox = (s: Seg, box: Anchor): boolean => (s.glyph ? s.left >= box.left - 0.012 : s.left >= box.right - 0.012) && s.left <= box.right + 0.07;
const clean = (t: string): string => t.replace(/^[•·▪◦–\-_\s]+/, '').replace(/_{2,}/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The text printed next to a checkbox or radio box: the words right of the box on its row, and the lines under them that keep the same
 * indent (a wrapped option) until the next box or a gap. When nothing is right of the box, the words just left of it.
 */
export function textBesideBox(lines: PdfLine[], box: Anchor, others: Anchor[]): string {
  const sorted = [...lines].sort((a, b) => a.top - b.top);
  const rowTop = box.top - 0.004;
  const rowEnd = box.bottom + 0.012;
  // the next box on the same row, to the right: it ends this box's text; the next box below ends the wrapped lines
  const sameRowRight = others.filter((o) => o.page === box.page && o.left > box.right && o.top < rowEnd && o.bottom > rowTop).map((o) => o.left);
  const limit = sameRowRight.length > 0 ? Math.min(...sameRowRight) - 0.004 : 1;
  const below = others.filter((o) => o.page === box.page && o.top >= box.bottom - 0.004 && Math.abs(o.left - box.left) < 0.05).map((o) => o.top);
  const stop = below.length > 0 ? Math.min(...below) - 0.004 : Infinity;
  const rowLine = sorted.find((l) => l.top >= rowTop && l.top <= rowEnd && segmentsOf(l).some((s) => startsAtBox(s, box) && s.right <= limit + 0.03));
  if (!rowLine) {
    const left = sorted.flatMap((l) => (l.top >= rowTop && l.top <= rowEnd ? segmentsOf(l).filter((s) => s.right <= box.left + 0.012 && box.left - s.right <= 0.07) : [])).pop();
    if (left) return clean(left.text);
    // a table of boxes names its columns above them: the words right above the box, over the same width
    const head = sorted.flatMap((l) => (l.top < rowTop && rowTop - l.top <= 0.05 ? segmentsOf(l).filter((s) => s.left <= box.right + 0.02 && s.right >= box.left - 0.02 && s.right - s.left < 0.3) : [])).pop();
    return head ? clean(head.text) : '';
  }
  // every run of words on the row between this box and the next ("(i)" and the sentence after it)
  const onRow = segmentsOf(rowLine).filter((s) => (s.glyph ? s.left >= box.left - 0.012 : s.left >= box.right - 0.012) && s.right <= limit + 0.03);
  const main = onRow.reduce((m, s) => (s.text.length > m.text.length ? s : m), onRow[0]);
  const parts = onRow.map((s) => s.text);
  let lastTop = rowLine.top;
  for (const l of sorted) {
    if (l.top <= lastTop + 0.001 || l.top > stop || l.top - lastTop > 0.026) continue;
    const cont = segmentsOf(l).find((s) => (Math.abs(s.left - main.left) <= 0.03 || Math.abs(s.left - onRow[0].left) <= 0.03) && s.right <= limit + 0.03);
    if (!cont) continue;
    parts.push(cont.text);
    lastTop = l.top;
  }
  return clean(parts.join(' '));
}

/**
 * An option the annotation did not highlight still has its words in the PDF, right beside its box. They are copied verbatim into the
 * option (never reworded), and listed in the change log so the DS can check each against the PDF.
 */
export const optionLabelsFromPdf: Standard = {
  id: 'option-labels-from-pdf',
  title: 'Options with no highlighted text take the words printed beside their box',
  source: 'rule',
  apply(ctx: StandardContext) {
    if (!ctx.pdf || ctx.pdf.length === 0) return;
    const filled: string[] = [];
    const missing: string[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (!CHOICES.includes(getWidget(ctx.doc, n)) || ctx.doc.uiSchema[n.name]?.['ui:invisible']) return;
      const ui = ctx.doc.uiSchema[n.name];
      const options = (ui?.['ui:multipleOption'] as { options?: [string, { formattedText?: unknown; pdfMappings?: string[] }][] } | undefined)?.options;
      if (!Array.isArray(options)) return;
      const boxes = options.flatMap((o) => (o[1]?.pdfMappings ?? []).map((a) => ctx.anchors[a]).filter(Boolean));
      let changed = false;
      const next = options.map((o) => {
        if (plainText(o[1]?.formattedText) !== '') return o;
        const alias = o[1]?.pdfMappings?.[0];
        const box = alias ? ctx.anchors[alias] : undefined;
        const page = box ? ctx.pdf?.find((p) => p.page === box.page) : undefined;
        if (!box || !page) return o;
        const text = textBesideBox(page.lines, box, boxes.filter((b) => b !== box));
        if (text === '') {
          missing.push(`${n.name}/${o[0]}`);
          return o;
        }
        changed = true;
        filled.push(`${n.name}: option ${o[0]} = "${text.slice(0, 70)}"`);
        return [o[0], { ...o[1], formattedText: `<p>${escapeHtml(text)}</p>` }] as [string, { formattedText?: unknown; pdfMappings?: string[] }];
      });
      if (changed) patchUi(ctx, n.name, { 'ui:multipleOption': { ...(ui['ui:multipleOption'] as object), options: next } });
    });
    if (filled.length > 0) ctx.log(`option-labels-from-pdf: ${filled.length} option(s) with no highlighted text took the words printed beside their box in the PDF (check them): ${filled.slice(0, 4).join('; ')}${filled.length > 4 ? '; …' : ''}`);
    if (missing.length > 0) ctx.warn(`OPTION TEXT: no printed words were found beside the box of ${missing.length} option(s) (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}); type them in`);
  },
};
