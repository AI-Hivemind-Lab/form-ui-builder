import { getOptions, setOptions } from './editOps';
import { escapeHtml } from './html';
import { findNode, getAllPages, getPages, getWidget, widgetOf } from './schemaWalk';
import type { FormDoc, SchemaNode, UiEntry, UiSchema } from './types';
import { getWidgetDef, widgetKind } from './widgetCatalog';

export interface InsertLocation {
  /** Container name, or null for the top level. */
  parent: string | null;
  /** Sibling to insert after, or null to append at the end. */
  after: string | null;
}

export interface LocationOption {
  id: string;
  label: string;
  loc: InsertLocation;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const UNLABELLED = new Set(['Header', 'Page', 'Group']);
const CHOICE = new Set(['Radio', 'Dropdown', 'MultipleCheckbox', 'MultipleSuggest']);

/** Every name already in use: schema nodes and uiSchema keys. */
export function allNames(doc: FormDoc): Set<string> {
  const names = new Set<string>(Object.keys(doc.uiSchema));
  const visit = (nodes: SchemaNode[]) =>
    nodes.forEach((n) => {
      names.add(n.name);
      if (n.properties) visit(n.properties);
    });
  visit(doc.schema.properties);
  return names;
}

export function validateName(doc: FormDoc, name: string): string | null {
  if (name.trim() === '') return 'Name is required';
  if (!NAME_RE.test(name)) return 'Use letters, digits and _ only (must start with a letter)';
  if (name in Object.prototype) return 'Reserved name';
  if (allNames(doc).has(name)) return `"${name}" is already used`;
  return null;
}

export function defaultNameAndTitle(doc: FormDoc, widgetId: string): { name: string; title: string } {
  const used = allNames(doc);
  const base = widgetId.toLowerCase();
  let n = 1;
  while (used.has(`${base}${n}`)) n += 1;
  const label = getWidgetDef(widgetId)?.label ?? widgetId;
  return { name: `${base}${n}`, title: `${label} ${n}` };
}

export function buildNewField(doc: FormDoc, widgetId: string): { node: SchemaNode; ui: UiEntry } {
  const def = getWidgetDef(widgetId);
  if (!def) throw new Error(`Unknown widget "${widgetId}"`);
  const { name, title } = defaultNameAndTitle(doc, widgetId);
  const node: SchemaNode = { name, type: def.schema.type, title };
  if (def.schema.format) node.format = def.schema.format;
  if (def.kind === 'container') node.properties = [];
  const ui: UiEntry = { ...def.defaults };
  if (!UNLABELLED.has(widgetId)) ui['ui:formattedText'] = `<p>${escapeHtml(title)}</p>`;
  return { node, ui };
}

/** Switch a field's widget, keeping its schema node consistent. Pure: returns new objects. */
export function switchWidget(node: SchemaNode, ui: UiEntry, widgetId: string): { node: SchemaNode; ui: UiEntry } {
  const def = getWidgetDef(widgetId);
  if (!def) return { node, ui: { ...ui, 'ui:widget': widgetId } };
  const nextNode: SchemaNode = { ...node, type: def.schema.type };
  if (def.schema.format) nextNode.format = def.schema.format;
  else delete nextNode.format;
  if (def.kind === 'container' && !nextNode.properties) nextNode.properties = [];

  let nextUi: UiEntry = { ...ui, 'ui:widget': widgetId };
  if (widgetId === 'Repeatable') {
    if (nextUi['ui:maxLength'] === undefined) nextUi['ui:maxLength'] = 1;
  }
  if (CHOICE.has(widgetId) && getOptions(nextUi, nextNode).length === 0) {
    nextUi = setOptions({ x: nextUi }, 'x', [
      { value: 'option_1', label: 'Option 1' },
      { value: 'option_2', label: 'Option 2' },
    ]).x;
  }
  return { node: nextNode, ui: nextUi };
}

/** null = top level, undefined = no such node. */
export function findParentName(doc: FormDoc, name: string): string | null | undefined {
  const visit = (nodes: SchemaNode[], parent: string | null): string | null | undefined => {
    for (const n of nodes) {
      if (n.name === name) return parent;
      const hit = n.properties ? visit(n.properties, n.name) : undefined;
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return visit(doc.schema.properties, null);
}

function isInsideRepeatable(doc: FormDoc, name: string | null): boolean {
  let cur: string | null | undefined = name;
  while (cur) {
    const node = findNode(doc.schema.properties, cur);
    if (node && getWidget(doc, node) === 'Repeatable') return true;
    cur = findParentName(doc, cur);
  }
  return false;
}

/** Can container `parentName` hold a new widget `widgetId`? */
export function canContain(doc: FormDoc, parentName: string, widgetId: string): boolean {
  const parent = findNode(doc.schema.properties, parentName);
  if (!parent || widgetKind(getWidget(doc, parent)) !== 'container') return false;
  if (widgetId === 'Page') return false;
  if (widgetId === 'Repeatable' && isInsideRepeatable(doc, parentName)) return false;
  return true;
}

export function containsRepeatable(doc: FormDoc, node: SchemaNode): boolean {
  return (node.properties ?? []).some((c) => getWidget(doc, c) === 'Repeatable' || containsRepeatable(doc, c));
}

/** May the existing field `name` be switched to `widgetId`? Only Repeatable has a restriction: no nesting. */
export function canSwitchTo(doc: FormDoc, name: string, widgetId: string): boolean {
  if (widgetId !== 'Repeatable') return true;
  const node = findNode(doc.schema.properties, name);
  if (!node) return true;
  if (containsRepeatable(doc, node)) return false;
  const parent = findParentName(doc, name);
  return !parent || !isInsideRepeatable(doc, parent);
}

export const sameLocation = (a: InsertLocation, b: InsertLocation): boolean => a.parent === b.parent && a.after === b.after;

/** The top-level node that contains `name` (or is it). Used to place a new Page next to a nested active page. */
function topLevelAncestor(doc: FormDoc, name: string): string | null {
  const top = doc.schema.properties.find((n) => n.name === name || (n.properties && findNode(n.properties, name)));
  return top?.name ?? null;
}

export function resolveInsertion(
  doc: FormDoc,
  widgetId: string,
  selection: string | null,
  activePage: string | null,
): InsertLocation {
  const pages = getAllPages(doc);
  if (widgetId === 'Page') {
    const topPages = getPages(doc);
    const after = (activePage && topLevelAncestor(doc, activePage)) || topPages[topPages.length - 1]?.name || null;
    return { parent: null, after };
  }

  const sel = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (sel) {
    // Below a Page or Repeatable means inside it, at the end.
    if (['Page', 'Repeatable'].includes(getWidget(doc, sel)) && canContain(doc, sel.name, widgetId)) return { parent: sel.name, after: null };
    const parent = findParentName(doc, sel.name);
    if (parent === null && pages.length === 0) return { parent: null, after: sel.name };
    if (parent && canContain(doc, parent, widgetId)) return { parent, after: sel.name };
  }
  const page = pages.find((p) => p.name === activePage) ?? pages[0];
  return { parent: page?.name ?? null, after: null };
}

export function locationOptions(
  doc: FormDoc,
  widgetId: string,
  selection: string | null,
  _activePage: string | null,
): LocationOption[] {
  const pages = getAllPages(doc);
  if (widgetId === 'Page') {
    return [
      ...getPages(doc).map((p) => ({ id: `after:${p.name}`, label: `After "${p.title}"`, loc: { parent: null, after: p.name } })),
      { id: 'end', label: 'End of form', loc: { parent: null, after: null } },
    ];
  }
  const out: LocationOption[] = [];
  const sel = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (sel) {
    const parent = findParentName(doc, sel.name);
    if (parent && canContain(doc, parent, widgetId)) out.push({ id: `after:${sel.name}`, label: `After "${sel.title}"`, loc: { parent, after: sel.name } });
    else if (parent === null && pages.length === 0) out.push({ id: `after:${sel.name}`, label: `After "${sel.title}"`, loc: { parent: null, after: sel.name } });
  }
  const visit = (nodes: SchemaNode[]) => {
    for (const n of nodes) {
      const w = getWidget(doc, n);
      if (widgetKind(w) === 'container' && canContain(doc, n.name, widgetId)) {
        out.push({ id: `in:${n.name}`, label: w === 'Page' ? `End of "${n.title}"` : `Inside "${n.title}"`, loc: { parent: n.name, after: null } });
      }
      if (n.properties) visit(n.properties);
    }
  };
  visit(doc.schema.properties);
  if (pages.length === 0) out.push({ id: 'end', label: 'End of form', loc: { parent: null, after: null } });
  return out;
}

function place(list: SchemaNode[], after: string | null, node: SchemaNode): SchemaNode[] {
  const i = after === null ? -1 : list.findIndex((n) => n.name === after);
  const at = i < 0 ? list.length : i + 1;
  return [...list.slice(0, at), node, ...list.slice(at)];
}

function insertInto(nodes: SchemaNode[], parent: string, after: string | null, node: SchemaNode): SchemaNode[] {
  return nodes.map((n) => {
    if (n.name === parent) return { ...n, properties: place(n.properties ?? [], after, node) };
    return n.properties ? { ...n, properties: insertInto(n.properties, parent, after, node) } : n;
  });
}

export function insertNode(doc: FormDoc, node: SchemaNode, ui: UiEntry, loc: InsertLocation): FormDoc {
  if (allNames(doc).has(node.name)) throw new Error(`"${node.name}" is already used`);
  let properties: SchemaNode[];
  if (loc.parent === null) properties = place(doc.schema.properties, loc.after, node);
  else {
    if (!findNode(doc.schema.properties, loc.parent)) throw new Error(`Unknown parent "${loc.parent}"`);
    if (widgetOf(node, ui) === 'Repeatable' && isInsideRepeatable(doc, loc.parent)) {
      throw new Error('A Repeatable cannot be placed inside another Repeatable');
    }
    properties = insertInto(doc.schema.properties, loc.parent, loc.after, node);
  }
  const uiSchema: UiSchema = { ...doc.uiSchema, [node.name]: ui };
  return { ...doc, schema: { ...doc.schema, properties }, uiSchema };
}

/** Replace the node with the same name (anywhere in the tree), immutably. */
export function replaceNode(schema: FormDoc['schema'], node: SchemaNode): FormDoc['schema'] {
  const swap = (nodes: SchemaNode[]): SchemaNode[] =>
    nodes.map((n) => (n.name === node.name ? node : n.properties ? { ...n, properties: swap(n.properties) } : n));
  return { ...schema, properties: swap(schema.properties) };
}
