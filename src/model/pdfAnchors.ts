import { findNode, uiOf } from './schemaWalk';
import type { Anchors, Anchor } from './pdfStore';
import type { FormDoc, SchemaNode } from './types';

/** Every PDF field alias a form field is mapped to: its own mapping, its options' mappings, its signature mapping. */
export function aliasesOf(doc: FormDoc, node: SchemaNode): string[] {
  const ui = uiOf(doc, node.name);
  const out: string[] = [];
  const mapping = ui['ui:pdfMapping'];
  if (Array.isArray(mapping)) mapping.forEach((m) => typeof m === 'string' && out.push(m));
  const options = (ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  if (Array.isArray(options)) {
    options.forEach((o) => {
      const maps = Array.isArray(o) ? (o[1] as { pdfMappings?: unknown } | null | undefined)?.pdfMappings : undefined;
      if (Array.isArray(maps)) maps.forEach((m) => typeof m === 'string' && out.push(m));
    });
  }
  const sig = ui['ui:signature'];
  if (Array.isArray(sig)) sig.forEach((s) => typeof (s as { mapping?: unknown })?.mapping === 'string' && out.push((s as { mapping: string }).mapping));
  // A Repeatable's template fields carry the mappings.
  if (node.properties && getsMappingsFromChildren(ui)) node.properties.forEach((c) => out.push(...aliasesOf(doc, c)));
  return [...new Set(out)];
}

const getsMappingsFromChildren = (ui: Record<string, unknown>): boolean => ui['ui:widget'] === 'Repeatable';

/** The PDF boxes to highlight for a form field (empty when the form was not built from an annotation). */
export function anchorsFor(doc: FormDoc, node: SchemaNode, anchors: Anchors): Anchor[] {
  return aliasesOf(doc, node).flatMap((a) => (anchors[a] ? [anchors[a]] : []));
}

/**
 * Where a form field sits on the PDF: the earliest of its boxes (page, then height). One answer for every part of the program that
 * asks. A choice (Yes/No, checkboxes) has no box of its own, so its place is that of its options; a signature's is its signature box.
 */
export function boxOf(doc: FormDoc, node: SchemaNode, anchors: Anchors): Anchor | null {
  const boxes = anchorsFor(doc, node, anchors);
  if (boxes.length === 0) return null;
  return boxes.reduce((m, b) => (b.page < m.page || (b.page === m.page && b.top < m.top) ? b : m));
}

/** The same, for a field named by its alias in the form. */
export function boxOfName(doc: FormDoc, name: string, anchors: Anchors): Anchor | null {
  const node = findNode(doc.schema.properties, name);
  return node ? boxOf(doc, node, anchors) : null;
}

/**
 * The box of the field itself, for the question it asks (the text around it, which page its question is on): its own mapping first, then
 * its first option, then its signature. A field merged from several PDF places has its main one first; boxOf would give the earliest.
 */
export function primaryBox(doc: FormDoc, node: SchemaNode, anchors: Anchors): Anchor | null {
  const ui = uiOf(doc, node.name);
  const own = Array.isArray(ui['ui:pdfMapping']) ? (ui['ui:pdfMapping'] as unknown[]) : [];
  const options = Array.isArray((ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options) ? ((ui['ui:multipleOption'] as { options: unknown[] }).options) : [];
  const fromOptions = options.flatMap((o) => (Array.isArray(o) ? (((o[1] as { pdfMappings?: unknown } | null)?.pdfMappings as unknown[] | undefined) ?? []) : []));
  const sig = Array.isArray(ui['ui:signature']) ? (ui['ui:signature'] as { mapping?: unknown }[]).map((s) => s.mapping) : [];
  for (const a of [...own, ...fromOptions, ...sig]) if (typeof a === 'string' && anchors[a]) return anchors[a];
  return node.properties ? boxOf(doc, node, anchors) : null;
}

/** The same, for a field named by its alias in the form. */
export function primaryBoxOfName(doc: FormDoc, name: string, anchors: Anchors): Anchor | null {
  const node = findNode(doc.schema.properties, name);
  return node ? primaryBox(doc, node, anchors) : null;
}
