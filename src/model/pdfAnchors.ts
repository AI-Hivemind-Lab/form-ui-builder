import { uiOf } from './schemaWalk';
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
