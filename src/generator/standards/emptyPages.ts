import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { subtreeNames } from '../../model/tree';
import { nodesOf } from './util';

/**
 * A page with nothing but its heading is of no use to anyone: it appears when the one object a page was made for moved elsewhere
 * (a name box merged into the name question). It is taken out of the form.
 */
export const emptyPages: Standard = {
  id: 'empty-pages',
  title: 'A page with only a heading is removed',
  source: 'rule',
  apply(ctx) {
    const gone = nodesOf(ctx.doc, 'Page').filter((p) => !ctx.doc.uiSchema[p.name]?.['ui:invisible'] && (p.properties ?? []).every((c) => getWidget(ctx.doc, c) === 'Header'));
    if (gone.length === 0) return;
    const names = new Set(gone.map((p) => p.name));
    const drop = (list: SchemaNode[]): SchemaNode[] => list.filter((n) => !names.has(n.name)).map((n) => (n.properties ? { ...n, properties: drop(n.properties) } : n));
    const gone2 = new Set(gone.flatMap((p) => subtreeNames(p)));
    const uiSchema = Object.fromEntries(Object.entries(ctx.doc.uiSchema).filter(([k]) => !gone2.has(k)));
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: drop(ctx.doc.schema.properties) }, uiSchema };
    gone.forEach((p) => ctx.log(`empty-pages: the page "${p.title}" had nothing but its heading, so it was removed`));
  },
};
