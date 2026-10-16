import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard, StandardContext } from './types';
import { patchUi, plainText, uniqueName, walk } from './util';

export const REVIEW_SENTENCE = 'Please carefully review the document below before continuing to the next section.';

const isFullPagePdf = (ctx: StandardContext, n: SchemaNode): boolean => getWidget(ctx.doc, n) === 'Pdf' && ctx.doc.uiSchema[n.name]?.['ui:viewInModal'] !== true;
const isReviewNote = (ctx: StandardContext, n: SchemaNode): boolean =>
  getWidget(ctx.doc, n) === 'Paragraph' && /please carefully review the document below/i.test(plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']));

/** Fillable widgets, not counting signature blocks (those stay on the PDF page). */
const fillable = (ctx: StandardContext, nodes: SchemaNode[]): number => {
  let count = 0;
  walk(nodes, (n) => {
    const w = getWidget(ctx.doc, n);
    if (['TextBox', 'TextArea', 'Radio', 'MultipleCheckbox', 'Dropdown', 'Date', 'Country', 'State', 'Integer', 'Money', 'Percentage', 'CustomFormat', 'Email', 'Phone'].includes(w) && !ctx.doc.uiSchema[n.name]?.['ui:invisible']) count += 1;
  });
  return count;
};

/**
 * A full-page PDF (not opened in a modal) stays at the top of its page, right under the page heading, with the standard
 * sentence above it. A page that also holds fillable fields is reported: users miss fields under a full-screen PDF.
 */
export const pdfPages: Standard = {
  id: 'pdf-pages',
  title: 'Full-page PDFs on top, with the review sentence above',
  source: 'hybrid',
  apply(ctx) {
    const pages: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) === 'Page' && (n.properties ?? []).some((c) => isFullPagePdf(ctx, c))) pages.push(n);
    });
    for (const page of pages) {
      const kids = page.properties ?? [];
      const pdfs = kids.filter((c) => isFullPagePdf(ctx, c));
      const head = kids.filter((c) => getWidget(ctx.doc, c) === 'Header');
      const rest = kids.filter((c) => !pdfs.includes(c) && !head.includes(c) && !pdfs.some((p) => isReviewNote(ctx, c) && kids.indexOf(c) === kids.indexOf(p) - 1));
      // each PDF with its own review sentence (an existing one directly above it, else a new one)
      const blocks: SchemaNode[] = [];
      for (const pdf of pdfs) {
        const above = kids[kids.indexOf(pdf) - 1];
        if (above && isReviewNote(ctx, above)) {
          // a plain sentence, never a well (it would otherwise be read as an instruction and turned into an Info well)
          if (ctx.doc.uiSchema[above.name]?.['ui:wellType'] !== 'Default') patchUi(ctx, above.name, { 'ui:wellType': 'Default' });
          blocks.push(above);
        } else {
          const name = uniqueName(ctx, 'pdf_review_note');
          ctx.doc = { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, [name]: { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p>${REVIEW_SENTENCE}</p>`, 'ui:wellType': 'Default', 'ui:marginBottom': '12px' } } };
          blocks.push({ name, type: 'null', title: REVIEW_SENTENCE });
          ctx.log(`pdf-pages: added the review sentence above the PDF ${pdf.name}`);
        }
        blocks.push(pdf);
      }
      const properties = [...head, ...blocks, ...rest];
      const moved = kids.some((c, i) => properties[i] !== c);
      if (moved && kids.length === properties.length) ctx.log(`pdf-pages: the PDF on "${page.title}" now sits at the top of the page`);
      const swap = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === page.name ? { ...n, properties } : n.properties ? { ...n, properties: swap(n.properties) } : n));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) } };
      const others = fillable(ctx, rest);
      if (others > 0) ctx.warn(`PAGE MIX: "${page.title}" holds a full-page PDF and ${others} fillable field(s); fillable fields are better on another page (the AI review can propose where)`);
    }
  },
};
