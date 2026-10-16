import { escapeHtml } from '../../model/html';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import { NA_NOTE } from './naNotes';
import type { Standard } from './types';
import { firstAlias, labelOf, walk } from './util';

export const TAX_ID_LABEL = /^\s*(\d+[.)]\s*|[a-z]\)\s*)?(u\.?\s?s\.?\s+|foreign\s+)?(taxpayer\s*(id\b|identification)|tax\s*id\b|tin\b)/i;
const REQUIRED_MSG = 'This field is required';
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';

interface IdType {
  value: 'ssn' | 'ein' | 'itin';
  label: string;
  format: 'SSN' | 'EIN' | 'ITIN';
  placeholder: string;
}
const TYPES: IdType[] = [
  { value: 'ssn', label: 'Social Security Number', format: 'SSN', placeholder: '___-__-____' },
  { value: 'ein', label: 'Employer Identification Number', format: 'EIN', placeholder: '__-_______' },
  { value: 'itin', label: 'Individual Taxpayer Identification Number', format: 'ITIN', placeholder: '___-__-____' },
];

/** Which ID types the sub-doc asks for, from its own words. A bare "Taxpayer ID" gets SSN, EIN and ITIN. */
export function idTypesFor(label: string): IdType[] {
  const asked = [
    /social security|\bssn\b/i.test(label) ? 'ssn' : null,
    /\bein\b|employer identification/i.test(label) ? 'ein' : null,
    /\bitin\b|individual taxpayer identification/i.test(label) ? 'itin' : null,
  ].filter(Boolean);
  return asked.length === 0 ? TYPES : TYPES.filter((t) => asked.includes(t.value));
}

/**
 * A taxpayer ID is never one plain box: a radio of ID types, and the chosen type shows its own box with its own validation
 * (the Anduin tax ID setup). Only the types the sub-doc mentions, plus "Other" as an escape. A hidden box keeps the PDF mapping.
 */
export const taxId: Standard = {
  id: 'tax-id',
  title: 'Taxpayer ID as a radio of ID types',
  source: 'rule',
  apply(ctx) {
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) === 'TextBox' && TAX_ID_LABEL.test(labelOf(ctx.doc, n.name)) && firstAlias(ctx.doc, n.name)) targets.push(n);
    });
    for (const field of targets) {
      const alias = firstAlias(ctx.doc, field.name) as string;
      const ui = ctx.doc.uiSchema[field.name] ?? {};
      const required = Boolean(ui['ui:required']);
      const labelHtml = typeof ui['ui:formattedText'] === 'string' ? ui['ui:formattedText'] : `<p>${escapeHtml(field.title)}</p>`;
      const types = idTypesFor(labelOf(ctx.doc, field.name));
      const used = new Set<string>([...Object.keys(ctx.doc.uiSchema)]);
      walk(ctx.doc.schema.properties, (n) => used.add(n.name));
      const name = (base: string): string => {
        let n = base;
        for (let i = 1; used.has(n); i += 1) n = `${base}_${i}`;
        used.add(n);
        return n;
      };
      const radio = name(`${alias}_type`);
      const parts: { node: SchemaNode; ui: UiEntry }[] = [];
      const options: [string, Record<string, unknown>][] = [];
      for (const t of types) {
        const fieldName = name(`${alias}_${t.value}`);
        parts.push({
          node: { name: fieldName, type: 'string', title: t.label, format: t.format },
          ui: { 'ui:widget': 'CustomFormat', 'ui:formattedText': '', 'ui:customFormat': t.format, 'ui:placeholder': t.placeholder, 'ui:width': '25%', 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:pdfMapping': [], ...(required ? { 'ui:required': REQUIRED_MSG } : {}) },
        });
        options.push([t.value, { formattedText: `<p>${t.label}</p>`, blueprintMetadataMapping: '', fieldsBelow: [fieldName] }]);
      }
      // Other: a "Please specify" box and the orange note, so there is an escape for anyone without these IDs
      const otherGroup = name(`${alias}_other`);
      const specify = name(`${alias}_other_specify`);
      const note = name(`${alias}_other_note`);
      parts.push(
        { node: { name: otherGroup, type: 'object', title: 'Other', properties: [{ name: specify, type: 'string', title: 'Please specify' }, { name: note, type: 'null', title: NA_NOTE }] }, ui: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true } },
        { node: { name: specify, type: 'string', title: 'Please specify' }, ui: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:placeholder': 'Please specify', 'ui:marginBottom': '4px', 'ui:enabledComment': true, 'ui:pdfMapping': [], ...(required ? { 'ui:required': REQUIRED_MSG } : {}) } },
        { node: { name: note, type: 'null', title: NA_NOTE }, ui: { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p><span style="font-size: 11px; color: rgb(217, 130, 43);">${NA_NOTE}</span></p>`, 'ui:marginBottom': '0px' } },
      );
      options.push(['other', { formattedText: '<p>Other</p>', blueprintMetadataMapping: '', fieldsBelow: [otherGroup] }]);
      const merged = name(`merged_${alias}`);
      const radioNode: SchemaNode = { name: radio, type: 'string', title: field.title, enum: options.map((o) => o[0]) };
      const radioUi: UiEntry = {
        'ui:widget': 'Radio', 'ui:formattedText': required && !/\*\s*<\/span>/.test(labelHtml) ? labelHtml.replace(/<\/p>\s*$/, `${STAR}</p>`) : labelHtml,
        'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default', 'ui:multipleOption': { options },
        ...(required ? { 'ui:required': REQUIRED_MSG } : {}),
      };
      const mergedUi: UiEntry = { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': [alias], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:invisible': true };
      // the group holds specify + note, so they are not also top-level siblings
      const topLevel = parts.filter((p) => p.node.name !== specify && p.node.name !== note);
      const { [field.name]: _gone, ...rest } = ctx.doc.uiSchema;
      void _gone;
      const entries: Record<string, UiEntry> = { ...rest, [radio]: radioUi, [merged]: mergedUi };
      parts.forEach((p) => {
        entries[p.node.name] = p.ui;
      });
      const swap = (list: SchemaNode[]): SchemaNode[] =>
        list.flatMap((n) => (n.name === field.name ? [radioNode, ...topLevel.map((p) => p.node), { name: merged, type: 'string', title: merged }] : [n.properties ? { ...n, properties: swap(n.properties) } : n]));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) }, uiSchema: entries };
      ctx.log(`tax-id: "${labelOf(ctx.doc, radio).slice(0, 60)}" (${alias}) is now a radio of ${types.map((t) => t.format).join(', ')} and Other, with a validated box under each; the hidden box ${merged} keeps the PDF mapping`);
      ctx.warn(`NEEDS RULE: copy the chosen taxpayer ID of ${radio} into ${merged}`);
    }
  },
};
