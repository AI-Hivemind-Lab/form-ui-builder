import { escapeHtml } from './html';
import type { FormDoc, SchemaNode, UiEntry } from './types';
import { entryInvisible, entryRequired } from './uiEntry';
import { WIDGET_CATALOG, widgetKind } from './widgetCatalog';

export const INPUT_WIDGETS: string[] = WIDGET_CATALOG.filter((w) => w.kind === 'input').map((w) => w.id);

export function uiOf(doc: FormDoc, name: string): UiEntry {
  return doc.uiSchema[name] ?? {};
}

function defaultWidget(node: SchemaNode): string {
  if (node.type === 'object') return 'Group';
  if (node.type === 'null') return 'Paragraph';
  if (node.type === 'array') return node.properties ? 'Repeatable' : 'MultipleCheckbox';
  return 'TextBox';
}

/** The widget id for a node given its ui entry (falls back by schema type). */
export function widgetOf(node: SchemaNode, ui: UiEntry): string {
  const w = ui['ui:widget'];
  return typeof w === 'string' && w !== '' ? w : defaultWidget(node);
}

export function getWidget(doc: FormDoc, node: SchemaNode): string {
  return widgetOf(node, uiOf(doc, node.name));
}

export function getLabelHtml(doc: FormDoc, node: SchemaNode): string {
  const f = uiOf(doc, node.name)['ui:formattedText'];
  return typeof f === 'string' ? f : `<p>${escapeHtml(node.title)}</p>`;
}

export const isRequired = (doc: FormDoc, name: string): boolean => entryRequired(doc.uiSchema[name]);
export const isInvisible = (doc: FormDoc, name: string): boolean => entryInvisible(doc.uiSchema[name]);

export const isInputWidget = (widget: string): boolean => widgetKind(widget) === 'input';
export const isSelectable = (widget: string): boolean => widget !== 'Page' && widget !== 'Group';

export function getPages(doc: FormDoc, showInvisible = true): SchemaNode[] {
  return doc.schema.properties.filter(
    (n) => getWidget(doc, n) === 'Page' && (showInvisible || !isInvisible(doc, n.name)),
  );
}

export interface TocEntry {
  name: string;
  title: string;
  /** A Page is a leaf you can open; a section is a Group that contains Pages (possibly nested). */
  kind: 'page' | 'section';
  children: TocEntry[];
}

/**
 * The Table of Contents tree. Real exports put Pages inside section Groups (and Groups inside Groups).
 * Groups that contain no Pages are omitted. Invisible nodes (and their subtree) are skipped unless asked for.
 */
export function tocTree(doc: FormDoc, showInvisible: boolean): TocEntry[] {
  const build = (nodes: SchemaNode[]): TocEntry[] =>
    nodes.flatMap((n): TocEntry[] => {
      if (!showInvisible && isInvisible(doc, n.name)) return [];
      const w = getWidget(doc, n);
      if (w === 'Page') return [{ name: n.name, title: n.title, kind: 'page', children: [] }];
      if (widgetKind(w) === 'container' && w !== 'Repeatable' && n.properties) {
        const children = build(n.properties);
        return children.length > 0 ? [{ name: n.name, title: n.title, kind: 'section', children }] : [];
      }
      return [];
    });
  return build(doc.schema.properties);
}

/** Every openable Page, depth-first in TOC order (nested ones included). */
export function getAllPages(doc: FormDoc, showInvisible = true): SchemaNode[] {
  const out: SchemaNode[] = [];
  const visit = (entries: TocEntry[]) =>
    entries.forEach((e) => {
      if (e.kind === 'page') {
        const node = findNode(doc.schema.properties, e.name);
        if (node) out.push(node);
      } else visit(e.children);
    });
  visit(tocTree(doc, showInvisible));
  return out;
}

export function findNode(nodes: SchemaNode[], name: string): SchemaNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = n.properties ? findNode(n.properties, name) : undefined;
    if (hit) return hit;
  }
  return undefined;
}
