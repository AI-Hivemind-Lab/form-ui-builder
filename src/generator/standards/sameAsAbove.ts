import { getWidget } from '../../model/schemaWalk';
import { widgetKind } from '../../model/widgetCatalog';
import { isFieldBelow } from '../../model/fieldsBelow';
import type { SchemaNode } from '../../model/types';
import type { Standard, StandardContext } from './types';
import { labelOf, uniqueName } from './util';

/** A block of boxes that asks for a contact's details has at least this many boxes in common with the one it repeats. */
const SHARED_BOXES = 3;

/** Only contact people are offered as "same as above": a list of authorized signers is a different thing even when its boxes look alike. */
const CONTACT = /\bcontact\b/i;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "Contact Person(s) for Financial Information and Reporting (including quarterly ...):" -> "Contact Person(s) for Financial Information and Reporting". */
export function shortName(label: string): string {
  return label
    .replace(/^\s*(\d+[.)]|[a-z]\))\s*/i, '')
    .replace(/\s+\((?!s\))[^)]*\)/g, '')
    .replace(/[\s:.,;]+$/, '')
    .trim();
}

interface Block {
  node: SchemaNode;
  label: string;
  /** Input boxes by normalized label. */
  boxes: Map<string, SchemaNode>;
}

function blockOf(ctx: StandardContext, node: SchemaNode): Block | null {
  const widget = getWidget(ctx.doc, node);
  if ((widget !== 'Group' && widget !== 'Repeatable') || isFieldBelow(ctx.doc, node.name)) return null;
  const label = shortName(labelOf(ctx.doc, node.name));
  if (label === '') return null;
  const boxes = new Map<string, SchemaNode>();
  (node.properties ?? []).forEach((c) => {
    if (widgetKind(getWidget(ctx.doc, c)) !== 'input' || ctx.doc.uiSchema[c.name]?.['ui:invisible']) return;
    const key = norm(labelOf(ctx.doc, c.name));
    if (key !== '') boxes.set(key, c);
  });
  return boxes.size >= SHARED_BOXES && CONTACT.test(label) ? { node, label, boxes } : null;
}

/**
 * When one section asks for the same details as an earlier one (another contact person: name, address, telephone, email), the investor
 * should not type them twice. An optional checkbox above the later section says "same as the one above"; a rule then prefills it from
 * the earlier section. The checkbox is optional, nothing is hidden, so nobody is blocked.
 */
export const sameAsAbove: Standard = {
  id: 'same-as-above',
  title: 'Optional "same as above" checkbox on a repeated block of contact details',
  source: 'rule',
  apply(ctx) {
    const found: { target: Block; source: Block; parent: string | null }[] = [];
    const scan = (list: SchemaNode[], parent: string | null): void => {
      const blocks: Block[] = [];
      list.forEach((n) => {
        const b = blockOf(ctx, n);
        if (b) {
          const source = [...blocks].reverse().find((p) => [...b.boxes.keys()].filter((k) => p.boxes.has(k)).length >= SHARED_BOXES);
          if (source) found.push({ target: b, source, parent });
          blocks.push(b);
        }
        if (n.properties) scan(n.properties, n.name);
      });
    };
    scan(ctx.doc.schema.properties, null);

    for (const { target, source } of found) {
      const gate = uniqueName(ctx, `${target.node.name}_same_as_above`);
      const plural = /\(s\)/.test(target.label);
      const sentence = `Check this box if the ${target.label} ${plural ? 'is(are)' : 'is'} the same as the ${source.label} above.`;
      const node: SchemaNode = { name: gate, type: 'array', title: `Same as ${source.label}`, items: { type: 'string', enum: ['yes'] } };
      const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === target.node.name ? [node, n] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
      ctx.doc = {
        ...ctx.doc,
        schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) },
        uiSchema: {
          ...ctx.doc.uiSchema,
          [gate]: {
            'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
            'ui:multipleOption': { options: [['yes', { formattedText: `<p>${sentence}</p>`, blueprintMetadataMapping: '' }]] },
          },
        },
      };
      const pairs = [...target.boxes.entries()].filter(([k]) => source.boxes.has(k)).map(([k, t]) => `${t.name} from ${source.boxes.get(k)!.name}`);
      const repeated = getWidget(ctx.doc, target.node) === 'Repeatable' || getWidget(ctx.doc, source.node) === 'Repeatable';
      ctx.log(`same-as-above: an optional checkbox ${gate} above "${target.label}" lets the investor reuse "${source.label}"`);
      ctx.warn(`NEEDS RULE: when ${gate} is checked, prefill ${pairs.join(', ')}${repeated ? ' (one contact for each contact of the section above)' : ''}; the investor may still edit them`);
    }
  },
};
