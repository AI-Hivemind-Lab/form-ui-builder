import type { FormDoc, SchemaNode, UiSchema } from './types';

export class FormLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormLoadError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const NODE_TYPES = new Set(['null', 'string', 'number', 'object', 'array']);

/** Validate and normalise schema nodes so the renderer never meets a malformed one. */
function normalizeNodes(raw: unknown, path: string): SchemaNode[] {
  if (!Array.isArray(raw)) throw new FormLoadError(`${path} is not an array`);
  return raw.map((n, i): SchemaNode => {
    const at = `${path}[${i}]`;
    if (!isObj(n)) throw new FormLoadError(`${at} is not an object`);
    if (typeof n.name !== 'string' || n.name === '') throw new FormLoadError(`${at} has no "name"`);
    const node = {
      ...n,
      name: n.name,
      type: typeof n.type === 'string' && NODE_TYPES.has(n.type) ? n.type : 'string',
      title: typeof n.title === 'string' ? n.title : n.name,
    } as SchemaNode;
    if (n.enum !== undefined) {
      if (!Array.isArray(n.enum)) throw new FormLoadError(`${at}.enum is not an array`);
      node.enum = n.enum.map(String);
    }
    if (n.properties !== undefined) node.properties = normalizeNodes(n.properties, `${at}.properties`);
    // Form Builder keeps a Repeatable's fields in `items.properties` (one row = one object); here they are the node's own children
    if (node.type === 'array' && isObj(n.items) && n.items.type === 'object' && Array.isArray(n.items.properties)) {
      node.properties = normalizeNodes(n.items.properties, `${at}.items.properties`);
      delete node.items;
    }
    return node;
  });
}

/**
 * Keys an earlier version of this app wrote that Form Builder does not know: a Repeatable's maximum is `ui:maxLength` and its item name
 * `ui:repeatableText`; "hide from TOC when hidden" was never a Form Builder key. A form saved with them is read with the real ones.
 */
export function migrateUiKeys(ui: UiSchema): UiSchema {
  const old = (e: Record<string, unknown>): boolean => 'ui:maxItems' in e || 'ui:itemName' in e || 'ui:invisibleOnTocWhenHidden' in e;
  if (!Object.values(ui).some(old)) return ui;
  return Object.fromEntries(Object.entries(ui).map(([name, e]) => {
    if (!old(e)) return [name, e];
    const { 'ui:maxItems': max, 'ui:itemName': item, 'ui:invisibleOnTocWhenHidden': _toc, ...rest } = e as Record<string, unknown>;
    void _toc;
    return [name, { ...rest, ...(max !== undefined && rest['ui:maxLength'] === undefined ? { 'ui:maxLength': max } : {}), ...(item !== undefined && rest['ui:repeatableText'] === undefined ? { 'ui:repeatableText': item } : {}) }];
  })) as UiSchema;
}

export function loadForm(raw: unknown): FormDoc {
  if (!isObj(raw)) throw new FormLoadError('File is not a JSON object');
  const map = raw.namespaceFormSchemaMap;
  if (!isObj(map)) throw new FormLoadError('Missing "namespaceFormSchemaMap"');
  const keys = Object.keys(map);
  if (keys.length === 0) throw new FormLoadError('"namespaceFormSchemaMap" is empty');
  const ns =
    typeof raw.defaultNamespace === 'string' && raw.defaultNamespace in map ? raw.defaultNamespace : keys[0];
  const entry = map[ns];
  if (!isObj(entry) || !isObj(entry.schema) || !Array.isArray(entry.schema.properties)) {
    throw new FormLoadError(`Namespace "${ns}" has no schema.properties array`);
  }
  const uiSchema = migrateUiKeys(isObj(entry.uiSchema) ? (entry.uiSchema as UiSchema) : {});
  return {
    schema: { type: 'object', properties: normalizeNodes(entry.schema.properties, 'schema.properties') },
    uiSchema,
    namespace: ns,
    source: raw,
  };
}

export function parseFormJson(text: string): FormDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormLoadError('File is not valid JSON');
  }
  return loadForm(raw);
}
