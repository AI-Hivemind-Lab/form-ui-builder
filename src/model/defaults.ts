import { getWidget } from './schemaWalk';
import type { FormDoc, SchemaNode, Values } from './types';
import { widgetKind } from './widgetCatalog';

/** Starting values from each field's `default` (outside repeatable rows, which have no values of their own yet). */
export function collectDefaults(doc: FormDoc): Values {
  const out: Values = {};
  const visit = (nodes: SchemaNode[]): void =>
    nodes.forEach((n) => {
      const w = getWidget(doc, n);
      if (w === 'Repeatable') return;
      if (widgetKind(w) === 'input' && (typeof n.default === 'string' || typeof n.default === 'number')) out[n.name] = n.default;
      if (n.properties) visit(n.properties);
    });
  visit(doc.schema.properties);
  return out;
}
