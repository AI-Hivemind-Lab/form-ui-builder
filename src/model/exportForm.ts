import type { FormDoc, SchemaNode } from './types';

export const EXPORT_FILE_NAME = 'form-content-edited.json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The loaded export with only `schema.properties` and `uiSchema` replaced by the current ones, so
 * rules, libs and every other top-level key carry through. Falls back to a minimal export.
 */
/**
 * A Repeatable is an array of rows, and a row is an object: Form Builder wants its fields in `items.properties` (and the row object
 * titled like the Repeatable). Inside this app they are the node's own children, so they move back out on the way out.
 */
function forFormBuilder(doc: FormDoc, nodes: SchemaNode[]): SchemaNode[] {
  return nodes.map((n) => {
    const kids = n.properties ? forFormBuilder(doc, n.properties) : undefined;
    if (doc.uiSchema[n.name]?.['ui:widget'] === 'Repeatable' && kids) {
      const { properties: _own, items: _items, ...rest } = n;
      void _own;
      void _items;
      return { ...rest, type: 'array', items: { type: 'object', title: n.title, properties: kids } } as SchemaNode;
    }
    return kids ? { ...n, properties: kids } : n;
  });
}

export function buildExport(doc: FormDoc): unknown {
  const ns = doc.namespace ?? 'main';
  const base: Record<string, unknown> = isObj(doc.source) ? structuredClone(doc.source) : { defaultNamespace: ns };
  const map: Record<string, unknown> = isObj(base.namespaceFormSchemaMap) ? base.namespaceFormSchemaMap : {};
  const entry = isObj(map[ns]) ? (map[ns] as Record<string, unknown>) : {};
  const schema = isObj(entry.schema) ? entry.schema : {};
  map[ns] = {
    ...entry,
    schema: { ...schema, type: 'object', properties: forFormBuilder(doc, doc.schema.properties) },
    uiSchema: doc.uiSchema,
  };
  base.namespaceFormSchemaMap = map;
  return base;
}

export function exportJsonText(doc: FormDoc): string {
  return JSON.stringify(buildExport(doc), null, 2);
}
