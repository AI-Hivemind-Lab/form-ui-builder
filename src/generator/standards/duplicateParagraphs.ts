import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { plainText } from './util';

const same = (a: string, b: string): boolean => a.toLowerCase().replace(/[^a-z0-9]+/g, '') === b.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The annotation sometimes highlights one paragraph twice: the same words twice in a row are shown once. */
export const duplicateParagraphs: Standard = {
  id: 'duplicate-paragraphs',
  title: 'The same paragraph twice in a row is shown once',
  source: 'rule',
  apply(ctx) {
    const removed: string[] = [];
    const visit = (list: SchemaNode[]): SchemaNode[] => {
      const out: SchemaNode[] = [];
      for (const n of list) {
        const prev = out[out.length - 1];
        const text = getWidget(ctx.doc, n) === 'Paragraph' ? plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']) : '';
        if (text !== '' && prev && getWidget(ctx.doc, prev) === 'Paragraph' && same(text, plainText(ctx.doc.uiSchema[prev.name]?.['ui:formattedText']))) {
          removed.push(n.name);
          continue;
        }
        out.push(n.properties ? { ...n, properties: visit(n.properties) } : n);
      }
      return out;
    };
    const properties = visit(ctx.doc.schema.properties);
    if (removed.length === 0) return;
    const uiSchema = Object.fromEntries(Object.entries(ctx.doc.uiSchema).filter(([k]) => !removed.includes(k)));
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties }, uiSchema };
    ctx.log(`duplicate-paragraphs: ${removed.length} paragraph(s) repeating the one above were removed (${removed.slice(0, 4).join(', ')})`);
  },
};
