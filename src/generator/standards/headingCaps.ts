import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { patchUi, walk } from './util';

/** A page heading is written in capitals. */
export const headingCase = (text: string): string => text.toUpperCase();

/** Heading 1, the heading at the top of every page, is ALL CAPS in the form; the page's name in the table of contents stays in Title Case. */
export const headingCaps: Standard = {
  id: 'heading-caps',
  title: 'Heading 1 in ALL CAPS',
  source: 'rule',
  apply(ctx) {
    const headers: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) !== 'Header') return;
      const level = ctx.doc.uiSchema[n.name]?.['ui:headerType'];
      if (level === undefined || level === 'Heading1') headers.push(n);
    });
    const names = new Set<string>();
    for (const n of headers) {
      const heading = ctx.doc.uiSchema[n.name]?.['ui:heading'];
      if (typeof heading !== 'string' || heading === headingCase(heading)) continue;
      patchUi(ctx, n.name, { 'ui:heading': headingCase(heading) });
      names.add(n.name);
    }
    if (names.size === 0) return;
    const retitle = (list: SchemaNode[]): SchemaNode[] => list.map((n) => ({ ...n, title: names.has(n.name) ? headingCase(n.title) : n.title, properties: n.properties ? retitle(n.properties) : undefined }));
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: retitle(ctx.doc.schema.properties) } };
    ctx.log(`heading-caps: ${names.size} page heading(s) written in capitals`);
  },
};
