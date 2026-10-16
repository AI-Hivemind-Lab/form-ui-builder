import { allNames, findParentName } from './addField';
import { findNode, getWidget } from './schemaWalk';
import { subtreeNames } from './tree';
import type { FormDoc, SchemaNode, UiEntry } from './types';

/** Widgets there is only one of. */
const SINGLE = new Set(['File']);

type Option = [string, Record<string, unknown>];

const optionsOf = (ui: UiEntry | undefined): Option[] => {
  const raw = (ui?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  return Array.isArray(raw) ? (raw as Option[]) : [];
};

/** A copy of one entry: the PDF stays out of it (a PDF box feeds one field), and fields below its options point at the copies. */
function cloneUi(ui: UiEntry, rename: Map<string, string>): UiEntry {
  const copy = structuredClone(ui) as UiEntry;
  if (Array.isArray(copy['ui:pdfMapping'])) copy['ui:pdfMapping'] = [];
  if (Array.isArray(copy['ui:signature'])) copy['ui:signature'] = [];
  delete copy['ui:asaMapping'];
  const options = (copy['ui:multipleOption'] as { options?: Option[] } | undefined)?.options;
  if (Array.isArray(options)) {
    options.forEach((o) => {
      const meta = o[1] as { pdfMappings?: unknown; fieldsBelow?: unknown; blueprintMetadataMapping?: unknown } | null;
      if (!meta) return;
      delete meta.pdfMappings;
      if ('blueprintMetadataMapping' in meta) meta.blueprintMetadataMapping = '';
      if (Array.isArray(meta.fieldsBelow)) meta.fieldsBelow = (meta.fieldsBelow as string[]).flatMap((n) => (rename.has(n) ? [rename.get(n) as string] : []));
    });
  }
  return copy;
}

/**
 * A copy of a field right after it: with everything inside it, and the fields shown below its options (they sit next to it and go with
 * it). The copy has names of its own and no PDF mappings. Returns the new doc and the name of the copy, or null when the field cannot
 * be copied.
 */
export function duplicateNode(doc: FormDoc, name: string): { doc: FormDoc; name: string } | null {
  const node = findNode(doc.schema.properties, name);
  if (!node || SINGLE.has(getWidget(doc, node))) return null;
  const parentName = findParentName(doc, name);
  const parent = parentName ? findNode(doc.schema.properties, parentName) : undefined;
  const siblings = parent ? (parent.properties ?? []) : doc.schema.properties;
  const at = siblings.findIndex((s) => s.name === name);
  if (at < 0) return null;
  // what goes with it: the siblings its options show below them (and theirs, in turn)
  const group: SchemaNode[] = [node];
  for (let i = 0; i < group.length; i += 1) {
    const walk = (n: SchemaNode): void => {
      optionsOf(doc.uiSchema[n.name]).forEach((o) => {
        const below = (o[1] as { fieldsBelow?: unknown } | null)?.fieldsBelow;
        if (Array.isArray(below)) below.forEach((b) => { const s = siblings.find((x) => x.name === b); if (s && !group.includes(s)) group.push(s); });
      });
      (n.properties ?? []).forEach(walk);
    };
    walk(group[i]);
  }
  // names of their own
  const taken = allNames(doc);
  const rename = new Map<string, string>();
  const fresh = (base: string): string => {
    let candidate = `${base}_copy`;
    for (let i = 2; taken.has(candidate); i += 1) candidate = `${base}_copy_${i}`;
    taken.add(candidate);
    return candidate;
  };
  group.forEach((g) => subtreeNames(g).forEach((n) => rename.set(n, fresh(n))));
  const cloneNode = (n: SchemaNode, top: boolean): SchemaNode => ({
    ...structuredClone({ ...n, properties: undefined }),
    name: rename.get(n.name) as string,
    title: top && n.title ? `${n.title} (copy)` : n.title,
    ...(n.properties ? { properties: n.properties.map((c) => cloneNode(c, false)) } : {}),
  });
  const copies = group.map((g) => cloneNode(g, g === node));
  const uiSchema = { ...doc.uiSchema };
  group.forEach((g) => subtreeNames(g).forEach((n) => { if (doc.uiSchema[n]) uiSchema[rename.get(n) as string] = cloneUi(doc.uiSchema[n], rename); }));
  // right after the last of the set, in the original's order
  const last = Math.max(...group.map((g) => siblings.indexOf(g)));
  const ordered = [...group].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b)).map((g) => copies[group.indexOf(g)]);
  const put = (list: SchemaNode[]): SchemaNode[] => [...list.slice(0, last + 1), ...ordered, ...list.slice(last + 1)];
  const into = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => (n.name === parentName ? { ...n, properties: put(n.properties ?? []) } : n.properties ? { ...n, properties: into(n.properties) } : n));
  const properties = parentName ? into(doc.schema.properties) : put(doc.schema.properties);
  return { doc: { ...doc, schema: { ...doc.schema, properties }, uiSchema }, name: rename.get(name) as string };
}
