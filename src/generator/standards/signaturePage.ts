import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard, StandardContext } from './types';
import { nodesOf, patchUi, walk } from './util';

export const GENERAL_INFORMATION = 'General Information';
const SIGNATURE_PAGE = /\bsignatures?\s+(page|block)s?\b|^\s*(lp\s+|gp\s+|investor\s+|subscriber\s+)?signatures?\s*$/i;
const FILLABLE = ['TextBox', 'TextArea', 'Radio', 'MultipleCheckbox', 'Dropdown', 'Date', 'Country', 'State', 'Integer', 'Money', 'Percentage', 'CustomFormat', 'Email', 'Phone'];

const isEmptyGroup = (ctx: StandardContext, n: SchemaNode): boolean => getWidget(ctx.doc, n) === 'Group' && (n.properties ?? []).length === 0;

/**
 * Investors do not sign while they fill the form: they sign after they submit it. So a "Signature Page" is never a visible page of its own.
 * When it still holds the investor's basic information (type, name, address, commitment amount) it is the General Information page; a
 * page that holds nothing but signatures is hidden.
 */
export const signaturePage: Standard = {
  id: 'signature-page',
  title: 'No visible Signature page: General Information, or hidden',
  source: 'rule',
  apply(ctx) {
    let general = nodesOf(ctx.doc, 'Page').some((p) => p.title === GENERAL_INFORMATION);
    for (const page of nodesOf(ctx.doc, 'Page')) {
      const header = (page.properties ?? []).find((c) => getWidget(ctx.doc, c) === 'Header');
      const heading = header ? String(ctx.doc.uiSchema[header.name]?.['ui:heading'] ?? '') : '';
      if (!SIGNATURE_PAGE.test(page.title) && !SIGNATURE_PAGE.test(heading)) continue;
      let fillable = 0;
      walk(page.properties ?? [], (n) => {
        if (FILLABLE.includes(getWidget(ctx.doc, n)) && !ctx.doc.uiSchema[n.name]?.['ui:invisible']) fillable += 1;
      });
      if (fillable === 0) {
        patchUi(ctx, page.name, { 'ui:invisible': true });
        ctx.log(`signature-page: "${page.title}" holds only signatures, so it is a hidden page (investors sign after they submit the form)`);
        continue;
      }
      // only one page is the General Information page; a second signature page with fields (the questionnaire's own) is looked at, not renamed
      if (general) {
        ctx.warn(`SIGNATURE PAGE: "${page.title}" is a second signature page and still holds ${fillable} field(s): they may repeat the General Information page; check them`);
        continue;
      }
      general = true;
      // the empty group the signer's fields left behind goes
      const clean = (list: SchemaNode[]): SchemaNode[] => list.filter((n) => !isEmptyGroup(ctx, n)).map((n) => (n.properties ? { ...n, properties: clean(n.properties) } : n));
      const rename = (list: SchemaNode[]): SchemaNode[] =>
        list.map((n) => (n.name === page.name ? { ...n, title: GENERAL_INFORMATION, properties: clean(n.properties ?? []).map((c) => (header && c.name === header.name ? { ...c, title: GENERAL_INFORMATION } : c)) } : n.properties ? { ...n, properties: rename(n.properties) } : n));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: rename(ctx.doc.schema.properties) } };
      if (header) patchUi(ctx, header.name, { 'ui:heading': GENERAL_INFORMATION });
      ctx.log(`signature-page: "${page.title}" still holds the investor's information, so it is the "${GENERAL_INFORMATION}" page (investors sign after they submit the form)`);
    }
  },
};
