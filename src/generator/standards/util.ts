import { getWidget } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode, UiEntry } from '../../model/types';
import type { StandardContext } from './types';

export const plainText = (html: unknown): string =>
  typeof html === 'string' ? html.replace(/<[^>]*>/g, '').replace(/FOOT_NOTE_HERE/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';

/** A field's label without the required star. */
export const labelOf = (doc: FormDoc, name: string): string => plainText(doc.uiSchema[name]?.['ui:formattedText']).replace(/\s*\*$/, '').trim();

export function walk(nodes: SchemaNode[], fn: (node: SchemaNode, parent: SchemaNode | null) => void, parent: SchemaNode | null = null): void {
  nodes.forEach((n) => {
    fn(n, parent);
    if (n.properties) walk(n.properties, fn, n);
  });
}

export const nodesOf = (doc: FormDoc, widget: string): SchemaNode[] => {
  const out: SchemaNode[] = [];
  walk(doc.schema.properties, (n) => {
    if (getWidget(doc, n) === widget) out.push(n);
  });
  return out;
};

/** Merge keys into a field's ui entry. */
export function patchUi(ctx: StandardContext, name: string, patch: UiEntry): void {
  ctx.doc = { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, [name]: { ...ctx.doc.uiSchema[name], ...patch } } };
}

/** Take a node out of the tree and hand it back; its ui entry stays. */
export function detach(ctx: StandardContext, name: string): SchemaNode | undefined {
  let found: SchemaNode | undefined;
  const strip = (list: SchemaNode[]): SchemaNode[] =>
    list.flatMap((n) => {
      if (n.name === name) {
        found = n;
        return [];
      }
      return [n.properties ? { ...n, properties: strip(n.properties) } : n];
    });
  const properties = strip(ctx.doc.schema.properties);
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties } };
  return found;
}

/** Put a node at the end of `parent`'s children (null = top level). */
export function appendTo(ctx: StandardContext, parent: string | null, node: SchemaNode): void {
  const add = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => (n.name === parent ? { ...n, properties: [...(n.properties ?? []), node] } : n.properties ? { ...n, properties: add(n.properties) } : n));
  const properties = parent === null ? [...ctx.doc.schema.properties, node] : add(ctx.doc.schema.properties);
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties } };
}

export function uniqueName(ctx: StandardContext, base: string): string {
  const used = new Set(Object.keys(ctx.doc.uiSchema));
  walk(ctx.doc.schema.properties, (n) => used.add(n.name));
  let name = base;
  for (let i = 1; used.has(name); i += 1) name = `${base}_${i}`;
  return name;
}

/** The first PDF alias a field (or signature) is mapped to. */
export function firstAlias(doc: FormDoc, name: string): string | undefined {
  const ui = doc.uiSchema[name] ?? {};
  const m = ui['ui:pdfMapping'];
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  const sig = ui['ui:signature'];
  if (Array.isArray(sig) && typeof (sig[0] as { mapping?: unknown })?.mapping === 'string') return (sig[0] as { mapping: string }).mapping;
  return undefined;
}
