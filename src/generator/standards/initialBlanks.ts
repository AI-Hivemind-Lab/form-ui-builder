import { escapeHtml } from '../../model/html';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import type { Standard } from './types';
import { ensureInitialsField } from './initials';
import { labelOf, patchUi, plainText, uniqueName } from './util';

const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
const REQUIRED_MSG = 'This field is required';
/** "(initial one blank below)": a paper convention. */
const INITIAL_ONE = /\(\s*initial\s+(any\s+)?one\b[^)]*\)/i;

const cleanOption = (label: string): string =>
  label.replace(/[\s_]+$/, '').replace(/^[\s_]+/, '').replace(/\s*;?\s*\bor\s*$/i, '').replace(/[;,]\s*$/, '').trim();

/**
 * "Initial one blank below" only works on paper: in the smart form the investor checks the box that applies, and the choices
 * exclude each other. A paragraph with that wording followed by the initial lines becomes one Radio, one option per line,
 * each option mapped to its line in the PDF.
 */
export const initialBlanks: Standard = {
  id: 'initial-blanks',
  title: '"Initial one blank" lines become a radio group',
  source: 'rule',
  apply(ctx) {
    let count = 0;
    const made: string[] = [];
    const visit = (list: SchemaNode[]): SchemaNode[] => {
      const out: SchemaNode[] = [];
      for (let i = 0; i < list.length; i += 1) {
        const n = list[i];
        const text = plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']);
        if (getWidget(ctx.doc, n) === 'Paragraph' && INITIAL_ONE.test(text)) {
          const run: SchemaNode[] = [];
          for (let j = i + 1; j < list.length; j += 1) {
            const c = list[j];
            const ui = ctx.doc.uiSchema[c.name] ?? {};
            const mapping = ui['ui:pdfMapping'];
            if (getWidget(ctx.doc, c) !== 'TextBox' || ui['ui:invisible'] || !Array.isArray(mapping) || mapping.length === 0 || labelOf(ctx.doc, c.name) === '') break;
            run.push(c);
          }
          if (run.length >= 2) {
            const name = uniqueName(ctx, `${n.name}_choice`);
            const label = text.replace(INITIAL_ONE, '(check one)').replace(/\s+/g, ' ').trim();
            const options = run.map((c) => [c.name, { formattedText: `<p>${escapeHtml(cleanOption(labelOf(ctx.doc, c.name)))}</p>`, blueprintMetadataMapping: '', pdfMappings: (ctx.doc.uiSchema[c.name]['ui:pdfMapping'] as string[]).slice() }]);
            const ui: UiEntry = {
              'ui:widget': 'Radio', 'ui:formattedText': `<p>${escapeHtml(label)}${STAR}</p>`, 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px',
              'ui:fixedLayout': 'Default', 'ui:required': REQUIRED_MSG, 'ui:multipleOption': { options },
            };
            const gone = new Set([n.name, ...run.map((c) => c.name)]);
            const rest = Object.fromEntries(Object.entries(ctx.doc.uiSchema).filter(([k]) => !gone.has(k)));
            ctx.doc = { ...ctx.doc, uiSchema: { ...rest, [name]: ui } };
            out.push({ name, type: 'string', title: label, enum: run.map((c) => c.name) });
            made.push(name);
            ctx.log(`initial-blanks: "${label.slice(0, 70)}" is now a radio group of ${run.length} options (${run.map((c) => c.name).join(', ')}); the initial lines are the options' PDF mappings`);
            i += run.length;
            continue;
          }
        }
        out.push(n.properties ? { ...n, properties: visit(n.properties) } : n);
      }
      return out;
    };
    const properties = visit(ctx.doc.schema.properties);
    if (properties.some((n, i) => n !== ctx.doc.schema.properties[i]) || properties.length !== ctx.doc.schema.properties.length) {
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties } };
      count += 1;
    }
    void count;
    // the investor's initials are collected once, in the Initials box; the radio is linked to it
    if (made.length > 0) {
      const initials = ensureInitialsField(ctx);
      made.forEach((m) => patchUi(ctx, m, { 'ui:initialSignatureAlias': initials }));
    }
  },
};
