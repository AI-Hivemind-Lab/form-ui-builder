import { canContain, containsRepeatable, findParentName } from './addField';
import { labelText } from './editOps';
import { signatureTitle } from './signature';
import { findNode, getPages, getWidget, uiOf } from './schemaWalk';
import type { FormDoc, SchemaNode, UiSchema } from './types';

export function subtreeNames(node: SchemaNode): string[] {
  return [node.name, ...(node.properties ?? []).flatMap(subtreeNames)];
}

/** Drop `names` from every option's fieldsBelow list (a deleted or moved field must not stay tagged below an option). */
function stripBelowRefs(uiSchema: UiSchema, names: Set<string>): UiSchema {
  let out = uiSchema;
  for (const [key, entry] of Object.entries(uiSchema)) {
    const mo = entry['ui:multipleOption'] as { options?: unknown } | undefined;
    if (!mo || !Array.isArray(mo.options)) continue;
    let changed = false;
    const options = mo.options.map((item) => {
      const meta = Array.isArray(item) ? (item[1] as { fieldsBelow?: unknown } | null | undefined) : null;
      if (!Array.isArray(item) || !meta || !Array.isArray(meta.fieldsBelow) || !meta.fieldsBelow.some((n) => names.has(String(n)))) return item;
      changed = true;
      const { fieldsBelow, ...rest } = meta;
      const kept = fieldsBelow.filter((n) => !names.has(String(n)));
      return [item[0], kept.length > 0 ? { ...rest, fieldsBelow: kept } : rest];
    });
    if (changed) out = { ...out, [key]: { ...entry, 'ui:multipleOption': { ...mo, options } } };
  }
  return out;
}

function detach(nodes: SchemaNode[], name: string): { nodes: SchemaNode[]; removed?: SchemaNode } {
  let removed: SchemaNode | undefined;
  const walk = (list: SchemaNode[]): SchemaNode[] =>
    list.flatMap((n) => {
      if (n.name === name) {
        removed = n;
        return [];
      }
      return [n.properties ? { ...n, properties: walk(n.properties) } : n];
    });
  const out = walk(nodes);
  return { nodes: out, removed };
}

/** Delete a field and everything inside it. Returns the same doc when the name is unknown. */
export function removeNode(doc: FormDoc, name: string): FormDoc {
  const { nodes, removed } = detach(doc.schema.properties, name);
  if (!removed) return doc;
  const gone = new Set(subtreeNames(removed));
  const uiSchema = Object.fromEntries(Object.entries(stripBelowRefs(doc.uiSchema, gone)).filter(([k]) => !gone.has(k)));
  return { ...doc, schema: { ...doc.schema, properties: nodes }, uiSchema };
}

/** Why `name` cannot be moved into container `parent` (null = top level); null when it can. */
export function moveBlocker(doc: FormDoc, name: string, parent: string | null): string | null {
  const node = findNode(doc.schema.properties, name);
  if (!node) return `Unknown field "${name}"`;
  const widget = getWidget(doc, node);
  if (parent === null) {
    const othersHavePages = getPages(doc).some((p) => p.name !== name);
    return widget === 'Page' || widget === 'File' || !othersHavePages ? null : 'Only pages can sit at the top level';
  }
  if (subtreeNames(node).includes(parent)) return 'A field cannot be moved into itself';
  const target = findNode(doc.schema.properties, parent);
  if (!target) return `Unknown parent "${parent}"`;
  if (widget === 'Page') return getWidget(doc, target) === 'Group' ? null : 'A page can only sit at the top level or in a group';
  if (!canContain(doc, parent, widget)) return `"${target.title}" cannot contain this field`;
  if (containsRepeatable(doc, node) && !canContain(doc, parent, 'Repeatable')) return 'A Repeatable cannot be placed inside another Repeatable';
  return null;
}

export const canMoveTo = (doc: FormDoc, name: string, parent: string | null): boolean => moveBlocker(doc, name, parent) === null;

/** Move a field (with its children) into `parent` at `index`, counted after the field is lifted out. */
export function moveNode(doc: FormDoc, name: string, parent: string | null, index: number): FormDoc {
  const blocked = moveBlocker(doc, name, parent);
  if (blocked) throw new Error(blocked);
  const { nodes, removed } = detach(doc.schema.properties, name);
  if (!removed) return doc;
  const put = (list: SchemaNode[]): SchemaNode[] => {
    const at = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), removed, ...list.slice(at)];
  };
  const into = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => (n.name === parent ? { ...n, properties: put(n.properties ?? []) } : n.properties ? { ...n, properties: into(n.properties) } : n));
  const properties = parent === null ? put(nodes) : into(nodes);
  // A field moved out of its place stops being tagged below an option.
  return { ...doc, schema: { ...doc.schema, properties }, uiSchema: stripBelowRefs(doc.uiSchema, new Set([name])) };
}

/** Where `name` currently sits: its parent (null = top level) and index among siblings. */
export function positionOf(doc: FormDoc, name: string): { parent: string | null; index: number } | null {
  const parent = findParentName(doc, name);
  if (parent === undefined) return null;
  const list = parent === null ? doc.schema.properties : (findNode(doc.schema.properties, parent)?.properties ?? []);
  return { parent, index: list.findIndex((n) => n.name === name) };
}

export type DropZone = 'before' | 'after' | 'into';

/**
 * Where dropping `dragged` on row `over` (upper edge, lower edge or middle) would put it, or null when that is
 * not allowed or would change nothing. `index` is counted after `dragged` is lifted out, as moveNode expects.
 */
export function dropTarget(doc: FormDoc, dragged: string, over: string, zone: DropZone): { parent: string | null; index: number } | null {
  if (dragged === over) return null;
  const from = positionOf(doc, dragged);
  if (!from) return null;
  let parent: string | null;
  let index: number;
  if (zone === 'into') {
    parent = over;
    const kids = findNode(doc.schema.properties, over)?.properties ?? [];
    index = kids.filter((n) => n.name !== dragged).length;
  } else {
    const at = positionOf(doc, over);
    if (!at) return null;
    parent = at.parent;
    index = at.index + (zone === 'after' ? 1 : 0);
    if (from.parent === parent && from.index < at.index) index -= 1;
  }
  if (!canMoveTo(doc, dragged, parent)) return null;
  if (from.parent === parent && from.index === index) return null;
  return { parent, index };
}

/** The text shown for a field in the structure tree. */
export function nodeLabel(doc: FormDoc, node: SchemaNode): string {
  const ui = uiOf(doc, node.name);
  const widget = getWidget(doc, node);
  const text =
    widget === 'Header' ? String(ui['ui:heading'] ?? '')
    : widget === 'Signature' ? signatureTitle(ui)
    : widget === 'File' ? String(ui['ui:fileName'] ?? node.title)
    : labelText(ui, node.title);
  return text.replace(/FOOT_NOTE_HERE/g, '').replace(/\s+/g, ' ').trim() || node.title || node.name;
}
