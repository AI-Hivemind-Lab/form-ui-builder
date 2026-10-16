import { findParentName } from './addField';
import { findNode, getWidget } from './schemaWalk';
import type { FormDoc, Option, SchemaNode, UiSchema } from './types';

/** Only these parents can have fields below their options. */
const PARENT_WIDGETS = new Set(['Radio', 'MultipleCheckbox']);

export interface BelowOwner {
  parent: string;
  option: string;
}

const cache = new WeakMap<UiSchema, Map<string, BelowOwner>>();

/**
 * child field name -> the single parent option it is shown under. A child belongs to ONE parent option;
 * if bad data tags it twice, the first tag (in uiSchema order) wins. Cached per uiSchema identity.
 */
export function belowMap(doc: FormDoc): Map<string, BelowOwner> {
  const hit = cache.get(doc.uiSchema);
  if (hit) return hit;
  const map = new Map<string, BelowOwner>();
  for (const [parent, entry] of Object.entries(doc.uiSchema)) {
    if (!PARENT_WIDGETS.has(String(entry['ui:widget']))) continue;
    const options = (entry['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(options)) continue;
    for (const item of options) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      const below = (item[1] as { fieldsBelow?: unknown } | null | undefined)?.fieldsBelow;
      if (!Array.isArray(below)) continue;
      for (const child of below) if (typeof child === 'string' && !map.has(child)) map.set(child, { parent, option: item[0] });
    }
  }
  cache.set(doc.uiSchema, map);
  return map;
}

export const isFieldBelow = (doc: FormDoc, name: string): boolean => belowMap(doc).has(name);

/** The existing fields shown under option `optionValue` of field `parent`, in tagged order. */
export function fieldsBelowOf(doc: FormDoc, parent: string, optionValue: string): string[] {
  const map = belowMap(doc);
  const options = (doc.uiSchema[parent]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  if (!PARENT_WIDGETS.has(String(doc.uiSchema[parent]?.['ui:widget'])) || !Array.isArray(options)) return [];
  const item = options.find((o) => Array.isArray(o) && o[0] === optionValue);
  const below = (item?.[1] as { fieldsBelow?: unknown } | null | undefined)?.fieldsBelow;
  if (!Array.isArray(below)) return [];
  return below.filter((n): n is string => {
    if (typeof n !== 'string') return false;
    const owner = map.get(n);
    return owner?.parent === parent && owner.option === optionValue && findNode(doc.schema.properties, n) !== undefined;
  });
}

function subtreeNames(node: SchemaNode): string[] {
  return [node.name, ...(node.properties ?? []).flatMap(subtreeNames)];
}

/**
 * Fields that can be tagged below an option of `parent`: not the parent, its ancestors or descendants, not
 * a Page, and not already tagged to any option anywhere. Siblings of the parent come first.
 */
export function candidatesForBelow(doc: FormDoc, parent: string): SchemaNode[] {
  const tagged = belowMap(doc);
  const blocked = new Set<string>([parent]);
  const parentNode = findNode(doc.schema.properties, parent);
  if (parentNode) subtreeNames(parentNode).forEach((n) => blocked.add(n));
  for (let cur = findParentName(doc, parent); cur; cur = findParentName(doc, cur)) blocked.add(cur);

  const all: SchemaNode[] = [];
  const visit = (nodes: SchemaNode[]) =>
    nodes.forEach((n) => {
      all.push(n);
      if (n.properties) visit(n.properties);
    });
  visit(doc.schema.properties);

  const ok = (n: SchemaNode) => !blocked.has(n.name) && !tagged.has(n.name) && getWidget(doc, n) !== 'Page';
  const parentName = findParentName(doc, parent);
  const siblings = parentName === undefined ? [] : parentName === null ? doc.schema.properties : (findNode(doc.schema.properties, parentName)?.properties ?? []);
  const first = siblings.filter(ok);
  const firstNames = new Set(first.map((n) => n.name));
  return [...first, ...all.filter((n) => ok(n) && !firstNames.has(n.name))];
}

/** Tag `child` below option `optionValue`; it is removed from any other option of this field first. */
export function withFieldBelow(options: Option[], optionValue: string, child: string): Option[] {
  if (!options.some((o) => o.value === optionValue)) return options;
  return options.map((o) => {
    if (o.value === optionValue) return { ...o, fieldsBelow: [...(o.fieldsBelow ?? []).filter((x) => x !== child), child] };
    return o.fieldsBelow?.includes(child) ? { ...o, fieldsBelow: o.fieldsBelow.filter((x) => x !== child) } : o;
  });
}

export function withoutFieldBelow(options: Option[], optionValue: string, child: string): Option[] {
  return options.map((o) => (o.value === optionValue && o.fieldsBelow ? { ...o, fieldsBelow: o.fieldsBelow.filter((x) => x !== child) } : o));
}
