import { getWidget } from '../../model/schemaWalk';
import type { Standard } from './types';
import { uniqueName } from './util';

/** The annotated PDF lives in a hidden page, not loose at the top level. */
export const hiddenPage: Standard = {
  id: 'hidden-page',
  title: 'Hidden page for the source PDF',
  source: 'rule',
  apply(ctx) {
    const top = ctx.doc.schema.properties;
    const at = top.findIndex((n) => getWidget(ctx.doc, n) === 'File');
    if (at < 0) return;
    const file = top[at];
    const existing = top.find((n) => n.name === 'hidden' && getWidget(ctx.doc, n) === 'Page');
    if (existing) {
      // the importer already parked stray objects there; the PDF file joins them
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: top.filter((n) => n !== file).map((n) => (n === existing ? { ...n, properties: [file, ...(n.properties ?? [])] } : n)) } };
      ctx.log(`hidden-page: moved the PDF file "${file.title}" into the hidden page "hidden"`);
      return;
    }
    const name = uniqueName(ctx, 'hidden');
    ctx.doc = {
      ...ctx.doc,
      schema: { ...ctx.doc.schema, properties: [{ name, type: 'object', title: 'Hidden', properties: [file] }, ...top.filter((_, i) => i !== at)] },
      uiSchema: { ...ctx.doc.uiSchema, [name]: { 'ui:widget': 'Page', 'ui:marginBottom': '12px', 'ui:pdfMapping': [], 'ui:signature': [], 'ui:invisible': true } },
    };
    ctx.log(`hidden-page: moved the PDF file "${file.title}" into the hidden page "${name}"`);
  },
};
