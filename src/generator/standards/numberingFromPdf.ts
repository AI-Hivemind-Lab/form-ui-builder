import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { labelOf, patchUi, walk } from './util';

/** A label that already starts with its number or letter: "1.", "4(a).", "(c)", "A.". */
const NUMBERED = /^\s*(\d{1,2}(\([a-z]\))?[.)]|\([a-z]\)|[A-Za-z]\.|[ivx]+\.)\s/;
/** A PDF line that starts with a question number. */
const PDF_NUMBER = /^(\d{1,2}(?:\([a-z]\))?[.)])\s+(.+)$/;
const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]/g, '');
const INPUTS = ['TextBox', 'TextArea', 'Date', 'Dropdown', 'Radio', 'MultipleCheckbox', 'Country', 'State', 'Integer', 'Money', 'Percentage', 'CustomFormat', 'Phone', 'Email'];

/**
 * The number of a question is printed in the PDF's margin, outside the highlighted text, so the annotation sometimes lacks it
 * ("Legal form of entity ..." for "1. Legal form of entity ..."). Where the PDF has a numbered line that starts with the same words
 * just above the field, the number is put back in front of the label.
 */
export const numberingFromPdf: Standard = {
  id: 'numbering-from-pdf',
  title: 'Question numbers missing from a label are read from the PDF',
  source: 'rule',
  apply(ctx) {
    if (!ctx.pdf || ctx.pdf.length === 0) return;
    const anchorOf = (n: SchemaNode): { page: number; top: number } | null => {
      const ui = ctx.doc.uiSchema[n.name] ?? {};
      const aliases: string[] = Array.isArray(ui['ui:pdfMapping']) ? (ui['ui:pdfMapping'] as string[]).slice() : [];
      const options = (ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
      if (Array.isArray(options)) options.forEach((o) => Array.isArray(o) && aliases.push(...(((o[1] as { pdfMappings?: string[] } | null)?.pdfMappings) ?? [])));
      const found = aliases.map((a) => ctx.anchors[a]).filter(Boolean);
      if (found.length === 0) return null;
      const first = found.reduce((m, a) => (a.page < m.page || (a.page === m.page && a.top < m.top) ? a : m));
      return { page: first.page, top: first.top };
    };
    const done: string[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (!INPUTS.includes(getWidget(ctx.doc, n))) return;
      const html = ctx.doc.uiSchema[n.name]?.['ui:formattedText'];
      const label = labelOf(ctx.doc, n.name);
      if (typeof html !== 'string' || label === '' || NUMBERED.test(label)) return;
      const at = anchorOf(n);
      const lines = at ? ctx.pdf?.find((p) => p.page === at.page)?.lines : undefined;
      if (!at || !lines) return;
      const start = norm(label).slice(0, 18);
      if (start.length < 10) return;
      const hit = [...lines].reverse().find((l) => l.top <= at.top + 0.01 && at.top - l.top < 0.25 && PDF_NUMBER.test(l.text) && norm((PDF_NUMBER.exec(l.text) as RegExpExecArray)[2]).startsWith(start));
      if (!hit) return;
      const num = (PDF_NUMBER.exec(hit.text) as RegExpExecArray)[1];
      patchUi(ctx, n.name, { 'ui:formattedText': html.replace(/^(\s*<p[^>]*>)/, `$1${num} `) });
      done.push(`${num} ${n.name}`);
    });
    if (done.length > 0) ctx.log(`numbering-from-pdf: ${done.length} label(s) got their question number from the PDF (${done.slice(0, 4).join(', ')}${done.length > 4 ? ', …' : ''})`);
  },
};
