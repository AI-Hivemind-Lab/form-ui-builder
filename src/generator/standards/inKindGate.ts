import { getWidget } from '../../model/schemaWalk';
import { widgetKind } from '../../model/widgetCatalog';
import { isFieldBelow } from '../../model/fieldsBelow';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { labelOf, uniqueName, walk } from './util';

export const IN_KIND = /distributions?\b[^.]*\bin[- ]?kind\b|\bin[- ]?kind distributions?/i;
export const IN_KIND_LABEL = 'Check this box if you would like to provide in-kind distribution instructions.';

/**
 * Distributions are paid in cash unless the investor asks for them in kind, so the in-kind block (the brokerage firm to credit) is
 * optional: someone choosing cash never fills it in. It sits behind an optional checkbox, and the block opens under that checkbox;
 * what is inside it stays required once it is open.
 */
export const inKindGate: Standard = {
  id: 'in-kind-gate',
  title: 'In-kind distribution block behind an optional checkbox',
  source: 'rule',
  apply(ctx) {
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) !== 'Group' || isFieldBelow(ctx.doc, n.name) || !IN_KIND.test(labelOf(ctx.doc, n.name))) return;
      let inputs = 0;
      walk(n.properties ?? [], (c) => {
        if (widgetKind(getWidget(ctx.doc, c)) === 'input') inputs += 1;
      });
      if (inputs >= 2) targets.push(n);
    });
    for (const group of targets) {
      const gate = uniqueName(ctx, `${group.name}_gate`);
      const node: SchemaNode = { name: gate, type: 'array', title: 'Provide in-kind distribution instructions', items: { type: 'string', enum: ['yes'] } };
      const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === group.name ? [node, n] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
      ctx.doc = {
        ...ctx.doc,
        schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) },
        uiSchema: {
          ...ctx.doc.uiSchema,
          [gate]: {
            'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
            'ui:multipleOption': { options: [['yes', { formattedText: `<p>${IN_KIND_LABEL}</p>`, blueprintMetadataMapping: '', fieldsBelow: [group.name] }]] },
          },
        },
      };
      ctx.log(`in-kind-gate: "${labelOf(ctx.doc, group.name).slice(0, 60)}" (${group.name}) opens under the optional checkbox ${gate}, so an investor choosing cash does not fill it in`);
    }
  },
};
