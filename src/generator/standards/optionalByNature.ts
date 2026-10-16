import { setRequired } from '../../model/editOps';
import { getWidget } from '../../model/schemaWalk';
import type { Standard } from './types';
import { labelOf, walk } from './util';

/** Boxes many people legitimately leave empty: fax, the bank's reference, "for further credit to". Never worth asking the user about. */
export const OPTIONAL_BY_NATURE = /^\s*(\d+[.)]\s*|[a-z]\)\s*)?(fax|facsimile|reference|ffc|for\s+further\s+credit)\b/i;

export const optionalByNature: Standard = {
  id: 'optional-by-nature',
  title: 'Fax, reference and further-credit boxes are optional',
  source: 'rule',
  apply(ctx) {
    const names: string[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (!['TextBox', 'TextArea', 'CustomFormat', 'Phone'].includes(getWidget(ctx.doc, n))) return;
      if (ctx.doc.uiSchema[n.name]?.['ui:required'] && OPTIONAL_BY_NATURE.test(labelOf(ctx.doc, n.name))) names.push(n.name);
    });
    names.forEach((n) => {
      ctx.doc = { ...ctx.doc, uiSchema: setRequired(ctx.doc.uiSchema, n, false) };
    });
    if (names.length > 0) ctx.log(`optional-by-nature: ${names.length} fax / reference / further-credit box(es) are optional (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''})`);
  },
};
