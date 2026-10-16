import { findParentName } from '../model/addField';
import { belowMap } from '../model/fieldsBelow';
import { findNode, getWidget } from '../model/schemaWalk';
import type { FormDoc, SchemaNode, UiEntry } from '../model/types';
import type { StandardContext } from './standards/types';
import { labelOf, uniqueName } from './standards/util';

/**
 * Grouping: elements that belong together go in one Group widget, so the form is organised the way the investor reads it
 * (a question with everything attached to it, a section with its contacts). These are the mechanics, shared by the rule that groups
 * numbered questions and by the AI's proposals: how a run of neighbours is found, checked and wrapped.
 */

/** Widgets that are never put inside a group: they are the frame of the page, not its questions. */
export const FIXED_WIDGETS = new Set(['Header', 'Pdf', 'File', 'Signature', 'Page']);

export const childrenOf = (doc: FormDoc, parent: string): SchemaNode[] => findNode(doc.schema.properties, parent)?.properties ?? [];

/** The number a question starts with: "13. ..." or "13) ...". "12(b)." is not a new question, it belongs to 12. */
export function startNumber(label: string): number | null {
  const m = /^\s*(\d{1,3})\s*[.)]\s/.exec(label);
  return m ? Number(m[1]) : null;
}

export const isFixed = (doc: FormDoc, n: SchemaNode): boolean => FIXED_WIDGETS.has(getWidget(doc, n));

/** Index of the sibling that owns the field below it (a radio or checkbox option's fields below), among `list`. */
function ownerIndex(doc: FormDoc, list: SchemaNode[], name: string): number {
  const owner = belowMap(doc).get(name)?.parent;
  return owner ? list.findIndex((n) => n.name === owner) : -1;
}
/** Indexes of the siblings shown below an option of the element at `i`. */
function belowIndexes(doc: FormDoc, list: SchemaNode[], i: number): number[] {
  const out: number[] = [];
  belowMap(doc).forEach((owner, child) => {
    if (owner.parent === list[i].name) {
      const at = list.findIndex((n) => n.name === child);
      if (at >= 0) out.push(at);
    }
  });
  return out;
}

const MAX_GROWTH = 40;

/**
 * The run [from, to] closed over fields below: a radio goes with the boxes that open under its options, and those boxes with it.
 * Null when the run would hold a frame element (heading, PDF, signature) or has to grow too far.
 */
export function closeRange(doc: FormDoc, list: SchemaNode[], from: number, to: number): [number, number] | null {
  let lo = from;
  let hi = to;
  for (let guard = 0; guard < 20; guard += 1) {
    let nlo = lo;
    let nhi = hi;
    for (let i = lo; i <= hi; i += 1) {
      const linked = [ownerIndex(doc, list, list[i].name), ...belowIndexes(doc, list, i)].filter((x) => x >= 0);
      linked.forEach((x) => {
        nlo = Math.min(nlo, x);
        nhi = Math.max(nhi, x);
      });
    }
    if (nlo === lo && nhi === hi) break;
    lo = nlo;
    hi = nhi;
    if (hi - lo - (to - from) > MAX_GROWTH) return null;
  }
  for (let i = lo; i <= hi; i += 1) if (isFixed(doc, list[i])) return null;
  return [lo, hi];
}

/** A Group widget holding `members`: only a name in the table of contents, nothing the investor reads. */
export function wrapSiblings(ctx: StandardContext, parent: string, from: number, to: number, title: string, aliasBase: string, extra: UiEntry = {}): string {
  const alias = uniqueName(ctx, aliasBase);
  const swap = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => {
      if (n.name === parent) {
        const kids = n.properties ?? [];
        const group: SchemaNode = { name: alias, type: 'object', title, properties: kids.slice(from, to + 1) };
        return { ...n, properties: [...kids.slice(0, from), group, ...kids.slice(to + 1)] };
      }
      return n.properties ? { ...n, properties: swap(n.properties) } : n;
    });
  ctx.doc = {
    ...ctx.doc,
    schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) },
    uiSchema: { ...ctx.doc.uiSchema, [alias]: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true, ...extra } },
  };
  return alias;
}

/** The names from the top of the form down to `name` (itself included). */
function pathTo(doc: FormDoc, name: string): string[] | null {
  const path: string[] = [];
  for (let cur: string | null | undefined = name; cur; cur = findParentName(doc, cur)) path.unshift(cur);
  return path.length > 0 && findNode(doc.schema.properties, name) ? path : null;
}

/**
 * Where the run between two elements is now: their closest common container and the positions of the two children of it that hold
 * them. Works after other groups were built around either end (an end inside a group counts as that group).
 */
export function resolveRange(doc: FormDoc, fromAlias: string, toAlias: string): { parent: string; from: number; to: number } | null {
  const a = pathTo(doc, fromAlias);
  const b = pathTo(doc, toAlias);
  if (!a || !b) return null;
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k += 1;
  if (k === 0 || k >= a.length || k >= b.length) return null; // no shared container, or one holds the other
  const parent = a[k - 1];
  const list = childrenOf(doc, parent);
  const from = list.findIndex((n) => n.name === a[k]);
  const to = list.findIndex((n) => n.name === b[k]);
  return from >= 0 && to >= from ? { parent, from, to } : null;
}

/** Does the subtree of `root` hold `name`? */
export function holds(doc: FormDoc, root: string, name: string): boolean {
  return (pathTo(doc, name) ?? []).includes(root);
}

export const labelFor = (doc: FormDoc, n: SchemaNode): string => labelOf(doc, n.name) || n.title;
