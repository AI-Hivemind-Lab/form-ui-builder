import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { fileGroupParts, filesOf, type SupportingFile } from './fileGroup';
import { nodesOf, uniqueName } from './util';

const link = (url: string, text = url): string => `<a href="${url}" rel="noopener noreferrer" target="_blank">${text}</a>`;

/** Our standard tax forms setup: the W-9 and the W-8s, in a file group of their own. */
export const TAX_FORM_FILES: SupportingFile[] = [
  { description: 'IRS Form W-9', helpText: `<p>Available at ${link('https://www.irs.gov/pub/irs-pdf/fw9.pdf', 'www.irs.gov/pub/irs-pdf/fw9.pdf')}</p>` },
  {
    description: 'The appropriate IRS Form(s) W-8',
    helpText: `<p>Below are links to the IRS website for the most common W-8 forms:</p><ul>${[['W-8BEN', 'fw8ben'], ['W-8BEN-E', 'fw8bene'], ['W-8EXP', 'fw8exp'], ['W-8IMY', 'fw8imy'], ['W-8ECI', 'fw8eci']]
      .map(([form, file]) => `<li>Form ${form} - ${link(`https://www.irs.gov/pub/irs-pdf/${file}.pdf`)}</li>`).join('')}</ul><p>Please check with your tax advisor(s) on which form is appropriate for your situation.</p>`,
  },
];

/**
 * Every form asks for a W-9 or a W-8, so every form gets the standard "Tax Forms" file group (the W-9 and the W-8s with their help
 * texts). It stays in the hidden page at the top of the form, where a rule opens it. Turn this standard off for a form that must not
 * have it.
 */
export const taxForms: Standard = {
  id: 'tax-forms',
  title: 'Standard "Tax Forms" file group (W-9 and W-8) in the hidden page',
  source: 'rule',
  apply(ctx) {
    // A form that already has it (a copy of the group, or its own W-9 file) keeps what it has.
    const has = nodesOf(ctx.doc, 'FileGroup').some((n) => n.name === 'tax_forms' || filesOf(ctx.doc.uiSchema[n.name]).files.some((f) => /\bW-?9\b/i.test(f.description)));
    if (has) return;
    const name = uniqueName(ctx, 'tax_forms');
    const { node, ui } = fileGroupParts(name, 'Tax Forms', TAX_FORM_FILES);
    const top = ctx.doc.schema.properties;
    const hidden = top.find((n) => getWidget(ctx.doc, n) === 'Page' && ctx.doc.uiSchema[n.name]?.['ui:invisible']);
    let properties: SchemaNode[];
    if (hidden) {
      properties = top.map((n) => (n === hidden ? { ...n, properties: [...(n.properties ?? []), node] } : n));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties }, uiSchema: { ...ctx.doc.uiSchema, [name]: ui } };
    } else {
      const page = uniqueName(ctx, 'hidden');
      ctx.doc = {
        ...ctx.doc,
        schema: { ...ctx.doc.schema, properties: [{ name: page, type: 'object', title: 'Hidden', properties: [node] }, ...top] },
        uiSchema: { ...ctx.doc.uiSchema, [page]: { 'ui:widget': 'Page', 'ui:marginBottom': '12px', 'ui:pdfMapping': [], 'ui:signature': [], 'ui:invisible': true }, [name]: ui },
      };
    }
    ctx.log(`tax-forms: the standard "Tax Forms" file group (${name}: IRS Form W-9 and the appropriate IRS Form(s) W-8) is in the hidden page`);
  },
};
