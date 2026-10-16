import { getWidget } from '../../model/schemaWalk';
import { widgetKind } from '../../model/widgetCatalog';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { detach, plainText, walk } from './util';

/** A heading that names a kind of investor, as in a "Type of Investor | Required Documentation" table. */
const INVESTOR_KIND = /^\s*(natural persons?|individuals?|corporations?|(private|public) corporation|partnerships?|limited liability compan(y|ies)|trusts?|employee benefit plan|non-profit|endowment|foundation|estates?|ira)\b/i;
const NUMBERED_TITLE = /^\s*([A-Z]|[IVXLC]{1,5}|\d{1,2})[.)]\s/;

/**
 * A page that only lists what each kind of investor must provide (the AML / background documentation table) depends on the investor
 * type alone. With no section number of its own it does not belong near the front: it goes to the end of the form, after the
 * numbered sections. Showing the block of each type only for that type is a rule, listed in the warnings.
 */
export const investorTypeTable: Standard = {
  id: 'investor-type-table',
  title: 'Per-investor-type documentation pages go to the end',
  source: 'rule',
  apply(ctx) {
    const pages: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) !== 'Page' || ctx.doc.uiSchema[n.name]?.['ui:invisible'] || NUMBERED_TITLE.test(n.title)) return;
      const kids = n.properties ?? [];
      let hasInput = false;
      walk(kids, (c) => {
        if (widgetKind(getWidget(ctx.doc, c)) === 'input') hasInput = true;
      });
      const kinds = kids.filter((c) => getWidget(ctx.doc, c) === 'Paragraph' && INVESTOR_KIND.test(plainText(ctx.doc.uiSchema[c.name]?.['ui:formattedText'])));
      if (!hasInput && kinds.length >= 3) pages.push(n);
    });
    for (const page of pages) {
      const top = ctx.doc.schema.properties;
      const last = top[top.length - 1];
      if (last?.name === page.name) continue; // already at the end
      const node = detach(ctx, page.name);
      if (!node) continue;
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: [...ctx.doc.schema.properties, node] } };
      ctx.log(`investor-type-table: the page "${page.title}" (${page.name}) lists requirements per investor type and has no section number, so it moved to the end of the form`);
      ctx.warn(`NEEDS RULE: on "${page.title}" (${page.name}) show the block of each investor type only when that type is chosen in the investor type question`);
    }
  },
};
