import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { labelOf, uniqueName, walk } from './util';

/** "If the Subscriber or the Principal is not a U.S. citizen, provide…": a question that does not apply to everyone. */
export const NOT_FOR_EVERYONE = /^\s*(\d+[.)]\s*|[a-z]\)\s*)?if\s+(the\s+)?(subscriber|principal|investor|entity|owner|person)\b[^,:]*\bnot\b/i;
export const NA_NOTE = 'Please write "N/A" if not applicable.';

/** Required, but with an escape: an orange note under the field. */
export const naNotes: Standard = {
  id: 'na-notes',
  title: 'N/A note under questions that do not apply to everyone',
  source: 'rule',
  apply(ctx) {
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      if ((w === 'TextBox' || w === 'TextArea') && ctx.doc.uiSchema[n.name]?.['ui:required'] && NOT_FOR_EVERYONE.test(labelOf(ctx.doc, n.name))) targets.push(n);
    });
    for (const field of targets) {
      const name = uniqueName(ctx, `${field.name}_na_note`);
      ctx.doc = {
        ...ctx.doc,
        uiSchema: { ...ctx.doc.uiSchema, [name]: { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p><span style="font-size: 11px; color: rgb(217, 130, 43);">${NA_NOTE}</span></p>`, 'ui:marginBottom': '12px' } },
      };
      const put = (list: SchemaNode[]): SchemaNode[] =>
        list.flatMap((n) => (n.name === field.name ? [n, { name, type: 'null', title: NA_NOTE }] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) } };
      ctx.log(`na-notes: "${labelOf(ctx.doc, field.name).slice(0, 60)}" (${field.name}) is required, with a note: ${NA_NOTE}`);
    }
  },
};
