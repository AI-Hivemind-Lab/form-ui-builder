import { findNode, getWidget } from '../model/schemaWalk';
import { moveNode } from '../model/tree';
import type { FormDoc, SchemaNode, UiEntry, UiSchema } from '../model/types';
import { labelOf, plainText } from '../generator/standards/util';

/**
 * What the assistant changed, for the person to review: each change knows how the thing looked before, so it can be shown beside the
 * new version and put back. Found by comparing the form before the assistant's turn with the form after it.
 */
export type ChangeKind = 'added' | 'modified' | 'removed' | 'moved';

export interface Where {
  parent: string | null;
  index: number;
}

export interface Change {
  id: string;
  alias: string;
  label: string;
  widget: string;
  kind: ChangeKind;
  /** What was said changed, one line each ("label: "A" → "B""). */
  summary: string[];
  /** Where it was before (modified, removed, moved). */
  was?: Where;
  /** The node as it was, with its children for a removed one. */
  before?: { node: SchemaNode; ui: UiSchema };
  /** For an added group: the elements that were gathered into it, and where each one was. */
  gathered?: { alias: string; was: Where }[];
}

interface Entry {
  node: SchemaNode;
  parent: string | null;
  index: number;
}

function index(doc: FormDoc): Map<string, Entry> {
  const map = new Map<string, Entry>();
  const visit = (list: SchemaNode[], parent: string | null): void => list.forEach((node, i) => {
    map.set(node.name, { node, parent, index: i });
    visit(node.properties ?? [], node.name);
  });
  visit(doc.schema.properties, null);
  return map;
}

const own = (n: SchemaNode): Omit<SchemaNode, 'properties'> => {
  const { properties: _p, ...rest } = n;
  void _p;
  return rest;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const short = (v: unknown): string => {
  const t = typeof v === 'string' ? v : JSON.stringify(v);
  return t === undefined ? 'none' : t.length > 70 ? `${t.slice(0, 69)}…` : t;
};

/** The subtree of a node: its names. */
function subtree(node: SchemaNode): string[] {
  return [node.name, ...(node.properties ?? []).flatMap(subtree)];
}

/** Which of the common siblings changed their order: those outside the longest run that kept it. */
function reordered(before: string[], after: string[]): Set<string> {
  const common = before.filter((n) => after.includes(n));
  const seq = after.filter((n) => before.includes(n)).map((n) => common.indexOf(n));
  const best: number[] = seq.map(() => 1);
  const prev: number[] = seq.map(() => -1);
  for (let i = 0; i < seq.length; i += 1) for (let j = 0; j < i; j += 1) if (seq[j] < seq[i] && best[j] + 1 > best[i]) { best[i] = best[j] + 1; prev[i] = j; }
  let at = best.indexOf(Math.max(0, ...best));
  const keep = new Set<number>();
  while (at >= 0) { keep.add(at); at = prev[at]; }
  const names = after.filter((n) => before.includes(n));
  return new Set(names.filter((_, i) => !keep.has(i)));
}

function describeChange(before: { node: SchemaNode; ui: UiEntry }, after: { node: SchemaNode; ui: UiEntry }): string[] {
  const out: string[] = [];
  const lbl = (e: UiEntry): string => plainText(e['ui:formattedText']).replace(/\s*\*$/, '');
  if (lbl(before.ui) !== lbl(after.ui)) out.push(`label: “${short(lbl(before.ui))}” → “${short(lbl(after.ui))}”`);
  const req = (e: UiEntry): boolean => Boolean(e['ui:required']);
  if (req(before.ui) !== req(after.ui)) out.push(`required: ${req(before.ui) ? 'yes' : 'no'} → ${req(after.ui) ? 'yes' : 'no'}`);
  if (before.node.title !== after.node.title) out.push(`title: “${short(before.node.title)}” → “${short(after.node.title)}”`);
  if (before.ui['ui:widget'] !== after.ui['ui:widget']) out.push(`widget: ${short(before.ui['ui:widget'])} → ${short(after.ui['ui:widget'])}`);
  const keys = new Set([...Object.keys(before.ui), ...Object.keys(after.ui)]);
  for (const k of keys) {
    if (['ui:formattedText', 'ui:required', 'ui:widget'].includes(k) || same(before.ui[k], after.ui[k])) continue;
    if (k === 'ui:multipleOption') {
      const opts = (e: UiEntry): string[] => ((e[k] as { options?: unknown[][] } | undefined)?.options ?? []).map((o) => plainText((o[1] as { formattedText?: unknown } | undefined)?.formattedText) || String(o[0]));
      out.push(`options: ${opts(before.ui).join(' | ') || 'none'} → ${opts(after.ui).join(' | ') || 'none'}`);
    } else out.push(`${k}: ${short(before.ui[k])} → ${short(after.ui[k])}`);
  }
  if (!same(own({ ...before.node, title: '' }), own({ ...after.node, title: '' })) && out.length === 0) out.push('its definition changed');
  return out;
}

const labelOfNode = (doc: FormDoc, n: SchemaNode): string => (getWidget(doc, n) === 'Header' ? String(doc.uiSchema[n.name]?.['ui:heading'] ?? n.title) : labelOf(doc, n.name) || n.title).slice(0, 90);

/** What differs between the form before and after: added, removed, modified and moved elements. */
export function diffDocs(before: FormDoc, after: FormDoc): Change[] {
  const b = index(before);
  const a = index(after);
  const out: Change[] = [];

  const added = [...a.keys()].filter((n) => !b.has(n));
  const removed = [...b.keys()].filter((n) => !a.has(n));
  const topAdded = added.filter((n) => !added.includes(a.get(n)?.parent ?? ''));
  const topRemoved = removed.filter((n) => !removed.includes(b.get(n)?.parent ?? ''));

  // elements gathered into a new group are part of that group, not moves of their own
  const gatheredBy = new Map<string, string>();
  const topOf = (name: string): string => {
    let cur = name;
    while (added.includes(a.get(cur)?.parent ?? '')) cur = a.get(cur)?.parent as string;
    return cur;
  };
  for (const x of added) for (const kid of a.get(x)?.node.properties ?? []) if (b.has(kid.name)) gatheredBy.set(kid.name, topOf(x));

  for (const g of topAdded) {
    const e = a.get(g) as Entry;
    out.push({
      id: `added:${g}`, alias: g, label: labelOfNode(after, e.node), widget: getWidget(after, e.node), kind: 'added', summary: [],
      gathered: [...gatheredBy.entries()].filter(([, by]) => by === g).map(([name]) => ({ alias: name, was: { parent: (b.get(name) as Entry).parent, index: (b.get(name) as Entry).index } })),
    });
  }
  for (const r of topRemoved) {
    const e = b.get(r) as Entry;
    const names = subtree(e.node);
    out.push({ id: `removed:${r}`, alias: r, label: labelOfNode(before, e.node), widget: getWidget(before, e.node), kind: 'removed', summary: [], was: { parent: e.parent, index: e.index }, before: { node: e.node, ui: Object.fromEntries(names.map((n) => [n, before.uiSchema[n]]).filter(([, u]) => u)) } });
  }

  const orders = new Map<string | null, Set<string>>();
  const parents = new Set([...b.values(), ...a.values()].map((e) => e.parent));
  parents.forEach((p) => {
    const kids = (doc: FormDoc, map: Map<string, Entry>): string[] => (p === null ? doc.schema.properties : (map.get(p)?.node.properties ?? [])).map((n) => n.name);
    orders.set(p, reordered(kids(before, b), kids(after, a)));
  });

  for (const [name, e] of a) {
    const was = b.get(name);
    if (!was) continue;
    const ui0 = before.uiSchema[name] ?? {};
    const ui1 = after.uiSchema[name] ?? {};
    const edited = !same(ui0, ui1) || !same(own(was.node), own(e.node));
    if (edited) {
      out.push({ id: `modified:${name}`, alias: name, label: labelOfNode(after, e.node), widget: getWidget(after, e.node), kind: 'modified', summary: describeChange({ node: was.node, ui: ui0 }, { node: e.node, ui: ui1 }), was: { parent: was.parent, index: was.index }, before: { node: own(was.node) as SchemaNode, ui: { [name]: ui0 } } });
    }
    const movedAway = was.parent !== e.parent && !gatheredBy.has(name);
    if (movedAway || orders.get(e.parent)?.has(name)) {
      out.push({ id: `moved:${name}`, alias: name, label: labelOfNode(after, e.node), widget: getWidget(after, e.node), kind: 'moved', summary: [movedAway ? `moved from ${was.parent ?? 'the top'} to ${e.parent ?? 'the top'}` : 'moved within its container'], was: { parent: was.parent, index: was.index } });
    }
  }
  return out;
}

/** Put one change back. A change that cannot be undone any more (the element is gone) leaves the form as it is. */
export function revertChange(doc: FormDoc, change: Change): FormDoc {
  const replaceOwn = (nodes: SchemaNode[], name: string, node: SchemaNode): SchemaNode[] =>
    nodes.map((n) => (n.name === name ? { ...node, ...(n.properties ? { properties: n.properties } : {}) } : n.properties ? { ...n, properties: replaceOwn(n.properties, name, node) } : n));
  const withoutNode = (nodes: SchemaNode[], names: Set<string>): SchemaNode[] => nodes.filter((n) => !names.has(n.name)).map((n) => (n.properties ? { ...n, properties: withoutNode(n.properties, names) } : n));

  if (change.kind === 'modified' && change.before) {
    if (!findNode(doc.schema.properties, change.alias)) return doc;
    return { ...doc, schema: { ...doc.schema, properties: replaceOwn(doc.schema.properties, change.alias, change.before.node) }, uiSchema: { ...doc.uiSchema, [change.alias]: change.before.ui[change.alias] } };
  }
  if (change.kind === 'moved' && change.was) {
    if (!findNode(doc.schema.properties, change.alias)) return doc;
    try {
      return moveNode(doc, change.alias, change.was.parent, change.was.index);
    } catch {
      return doc;
    }
  }
  if (change.kind === 'added') {
    let d = doc;
    for (const g of [...(change.gathered ?? [])].sort((x, y) => x.was.index - y.was.index)) {
      if (!findNode(d.schema.properties, g.alias)) continue;
      try {
        d = moveNode(d, g.alias, g.was.parent, g.was.index);
      } catch { /* it stays inside until the group goes */ }
    }
    const node = findNode(d.schema.properties, change.alias);
    if (!node) return d;
    const gone = new Set(subtree(node));
    return { ...d, schema: { ...d.schema, properties: withoutNode(d.schema.properties, gone) }, uiSchema: Object.fromEntries(Object.entries(d.uiSchema).filter(([k]) => !gone.has(k))) };
  }
  if (change.kind === 'removed' && change.before && change.was) {
    if (findNode(doc.schema.properties, change.alias)) return doc;
    const parent = change.was.parent && findNode(doc.schema.properties, change.was.parent) ? change.was.parent : (doc.schema.properties[0]?.name ?? null);
    const put = (list: SchemaNode[]): SchemaNode[] => [...list.slice(0, change.was?.index ?? list.length), change.before?.node as SchemaNode, ...list.slice(change.was?.index ?? list.length)];
    const into = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === parent ? { ...n, properties: put(n.properties ?? []) } : n.properties ? { ...n, properties: into(n.properties) } : n));
    return { ...doc, schema: { ...doc.schema, properties: parent === null ? put(doc.schema.properties) : into(doc.schema.properties) }, uiSchema: { ...doc.uiSchema, ...change.before.ui } };
  }
  return doc;
}
