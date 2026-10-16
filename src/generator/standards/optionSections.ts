import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import type { Standard } from './types';
import { labelOf, plainText, uniqueName, walk } from './util';

const REQUIRED_MSG = 'This field is required';
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
/** A heading the PDF prints above part of a list of choices: "FOR INDIVIDUALS:", "FOR ENTITIES:". */
const HEADING = /^FOR\s+[A-Z][A-Z ,&/-]*:?$/;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

type Option = [string, Record<string, unknown> | null];

/**
 * One list of choices can cover two kinds of investor, with the PDF heading each half ("FOR INDIVIDUALS:" over (i), "FOR ENTITIES:" over
 * (ii) to (vi)) while the annotation only highlighted one of the headings. The form then showed every choice under the last heading.
 * Each half becomes its own list under its own heading, in the order of the PDF. The PDF has ONE group field for all the choices, so every
 * half maps to it (the halves are mutually exclusive, shown by investor type), and each choice keeps the mapping of its own checkbox.
 */
export const optionSections: Standard = {
  id: 'option-sections',
  title: 'A list of choices under several PDF headings becomes one list per heading',
  source: 'rule',
  apply(ctx) {
    if (!ctx.pdf || ctx.pdf.length === 0) return;
    const lines = ctx.pdf.flatMap((p) => p.lines.map((l) => l.text));
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      const options = (ctx.doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
      if ((w === 'MultipleCheckbox' || w === 'Radio') && Array.isArray(options) && options.length >= 3) targets.push(n);
    });

    for (const node of targets) {
      const ui = ctx.doc.uiSchema[node.name] ?? {};
      const options = (ui['ui:multipleOption'] as { options: Option[] }).options;
      // where each choice starts in the PDF, and the heading above it
      const heads: (string | null)[] = [];
      let from = 0;
      let heading: string | null = null;
      let seenAt = -1;
      for (const opt of options) {
        const key = norm(plainText(opt[1]?.formattedText)).slice(0, 24);
        if (key.length < 8) break;
        let at = -1;
        for (let i = from; i < lines.length; i += 1) {
          if (HEADING.test(lines[i])) heading = lines[i];
          if (norm(lines[i]).startsWith(key)) {
            at = i;
            break;
          }
        }
        if (at < 0) break;
        // a heading far above the first choice is another section's
        const near = lines.slice(Math.max(0, at - 3), at).some((l) => HEADING.test(l));
        heads.push(heads.length === 0 && !near ? null : heading);
        from = at + 1;
        seenAt = at;
      }
      void seenAt;
      if (heads.length !== options.length || heads.some((h) => h === null)) continue;
      const order = heads.filter((h, i) => i === 0 || h !== heads[i - 1]) as string[];
      if (order.length < 2 || new Set(order).size !== order.length) continue;

      const required = Boolean(ui['ui:required']);
      const own = norm(labelOf(ctx.doc, node.name));
      const keeper = order.find((h) => norm(h) === own) ?? order[0];
      const parts = order.map((h) => {
        const subset = options.filter((_, i) => heads[i] === h);
        const name = h === keeper ? node.name : uniqueName(ctx, `${node.name}_${h.toLowerCase().replace(/^for\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`);
        const values = subset.map((o) => o[0]);
        const html = `<p>${h}${required ? STAR : ''}</p>`;
        const partUi: UiEntry = { ...ui, 'ui:formattedText': html, 'ui:multipleOption': { ...(ui['ui:multipleOption'] as object), options: subset } };
        if (required) partUi['ui:required'] = REQUIRED_MSG;
        const schemaNode: SchemaNode = node.items ? { ...node, name, items: { ...node.items, enum: values } } : { ...node, name, enum: values };
        return { name, ui: partUi, schemaNode, heading: h };
      });
      const swap = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === node.name ? parts.map((p) => p.schemaNode) : [n.properties ? { ...n, properties: swap(n.properties) } : n]));
      ctx.doc = {
        ...ctx.doc,
        schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) },
        uiSchema: { ...ctx.doc.uiSchema, ...Object.fromEntries(parts.map((p) => [p.name, p.ui])) },
      };
      ctx.log(`option-sections: "${labelOf(ctx.doc, node.name)}" (${node.name}) was one list under ${order.length} PDF headings; now ${parts.map((p) => `${p.name} (${p.heading})`).join(' and ')}`);
      ctx.warn(`NEEDS RULE: show ${parts.map((p) => `${p.name} (${p.heading})`).join(' or ')} by investor type; only the list that applies is required`);
    }
  },
};
