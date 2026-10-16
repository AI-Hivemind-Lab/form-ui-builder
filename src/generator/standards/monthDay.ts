import { escapeHtml } from '../../model/html';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import type { Standard } from './types';
import { labelOf, plainText, uniqueName, walk } from './util';

export const MONTH_DAY = /\(\s*month\s*\/\s*day\s*\)/i;
/** "If the Investor’s tax year ends on a date other than December 31, please indicate such date below (Month/Day):" */
const OTHER_THAN_DEC31 = /\bif the (.+?)(['’]s) (tax year|fiscal year)\b.*?\bother than december 31\b/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const REQUIRED_MSG = 'This field is required';
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';

/**
 * A box whose label says "(Month/Day)" (a tax year end, a fiscal year) is two widgets in a two-column row, as in the FCL: a Month
 * dropdown (January to December) and a Day integer. The PDF has one box, so a hidden box keeps its mapping; a rule combines them.
 * The question's own asterisk goes: the month and the day below it already carry one. When the question is "if the year ends on a date
 * other than December 31", an optional checkbox "ends on December 31" lets the investor skip the two required fields.
 */
export const monthDay: Standard = {
  id: 'month-day',
  title: '"(Month/Day)" becomes a month dropdown and a day field',
  source: 'rule',
  apply(ctx) {
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const ui = ctx.doc.uiSchema[n.name] ?? {};
      if (['TextBox', 'TextArea'].includes(getWidget(ctx.doc, n)) && !ui['ui:invisible'] && Array.isArray(ui['ui:pdfMapping']) && MONTH_DAY.test(labelOf(ctx.doc, n.name))) targets.push(n);
    });
    for (const field of targets) {
      const ui = ctx.doc.uiSchema[field.name] ?? {};
      const required = Boolean(ui['ui:required']);
      const alias = (ui['ui:pdfMapping'] as string[]).slice();
      const html = String(ui['ui:formattedText'] ?? '').replace(MONTH_DAY, '').replace(/\s+(<\/(?:strong|span|em)>)/g, '$1').replace(/\s{2,}/g, ' ').replace(/\s+(<span[^>]*>\s*\*\s*<\/span>)/, '$1').replace(/\s*<span[^>]*>\s*\*\s*<\/span>/g, '').replace(/\s*\*\s*(<\/p>)?\s*$/, '$1');
      const group = uniqueName(ctx, `${field.name}_monthday`);
      const month = `${group}_month`;
      const day = `${group}_day`;
      const merged = `merged_${field.name}`;
      const skip = OTHER_THAN_DEC31.exec(plainText(html));
      const gate = skip ? `${group}_dec31` : '';
      const row = skip ? `${group}_row` : '';
      const monthEntry: UiEntry = { 'ui:widget': 'Dropdown', 'ui:formattedText': `<p>Month${required ? STAR : ''}</p>`, 'ui:placeholder': 'Month', 'ui:pdfMapping': [], 'ui:marginBottom': '0px', 'ui:enabledComment': true, ...(required ? { 'ui:required': REQUIRED_MSG } : {}) };
      const dayEntry: UiEntry = { 'ui:widget': 'Integer', 'ui:formattedText': `<p>Day${required ? STAR : ''}</p>`, 'ui:placeholder': 'Day', 'ui:disableSeparator': true, 'ui:pdfMapping': [], 'ui:marginBottom': '0px', 'ui:enabledComment': true, ...(required ? { 'ui:required': REQUIRED_MSG } : {}) };
      const mergedEntry: UiEntry = { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': alias, 'ui:invisible': true, 'ui:marginBottom': '12px', 'ui:enabledComment': true };
      const layout = { 'ui:widget': 'Group', 'ui:dynamicLayout': { sectionsWidth: [50, 50], gutter: 12 }, 'ui:marginBottom': '12px', 'ui:enabledComment': true };
      const entries: Record<string, UiEntry> = skip
        ? {
            [group]: { 'ui:widget': 'Group', 'ui:formattedText': html, 'ui:marginBottom': '12px', 'ui:enabledComment': true },
            [gate]: {
              'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
              'ui:multipleOption': { options: [['yes', { formattedText: `<p>Check this box if the ${skip[1]}${skip[2]} ${skip[3]} ends on December 31.</p>`, blueprintMetadataMapping: '' }]] },
            },
            [row]: layout, [month]: monthEntry, [day]: dayEntry, [merged]: mergedEntry,
          }
        : { [group]: { ...layout, 'ui:formattedText': html }, [month]: monthEntry, [day]: dayEntry, [merged]: mergedEntry };
      const { [field.name]: _gone, ...rest } = ctx.doc.uiSchema;
      void _gone;
      const monthNode: SchemaNode = { name: month, type: 'string', title: 'Month', enum: MONTHS };
      const dayNode: SchemaNode = { name: day, type: 'number', title: 'Day' };
      const mergedNode: SchemaNode = { name: merged, type: 'string', title: escapeHtml(merged) };
      const tree: SchemaNode = {
        name: group, type: 'object', title: field.title,
        properties: skip
          ? [
              { name: gate, type: 'array', title: 'Tax year ends on December 31', items: { type: 'string', enum: ['yes'] } },
              { name: row, type: 'object', title: 'Month and day', properties: [monthNode, dayNode] },
              mergedNode,
            ]
          : [monthNode, dayNode, mergedNode],
      };
      const swap = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === field.name ? [tree] : [n.properties ? { ...n, properties: swap(n.properties) } : n]));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) }, uiSchema: { ...rest, ...entries } };
      ctx.log(`month-day: "${labelOf(ctx.doc, group).slice(0, 60)}" (${field.name}) is now a Month dropdown and a Day field in two columns; the hidden box ${merged} keeps the PDF mapping`);
      ctx.warn(`NEEDS RULE: combine ${month} and ${day} into ${merged} in the format the PDF box expects (month/day)`);
      if (skip) ctx.warn(`NEEDS RULE: when ${gate} is checked, ${row} is hidden and ${month} and ${day} are not required (the tax year ends on December 31)`);
    }
  },
};
