import { getWidget } from '../../model/schemaWalk';
import { widgetKind } from '../../model/widgetCatalog';
import type { Standard } from './types';
import { patchUi, walk } from './util';

/**
 * Capitalise the first letter of a label: "please specify:" → "Please specify:". Numbering stays as it is
 * ("5. is the…" → "5. Is the…"), and an enumerator such as "a)" or "(i)" is not a word, so it is left alone.
 */
export function capitalizeLabel(html: string): string {
  const parts = html.split(/(<[^>]*>)/);
  const at = parts.findIndex((p, i) => i % 2 === 0 && p.trim() !== '');
  if (at < 0) return html;
  const text = parts[at];
  const m = /^(\s*(?:\d+[.)]\s*)?[(“"']*)([a-z])(.?)/.exec(text);
  if (!m) return html;
  const [, lead, letter, next] = m;
  if (/^[.)]$/.test(next)) return html; // an enumerator: "a)", "a.", "(i)"
  parts[at] = lead + letter.toUpperCase() + text.slice(lead.length + 1);
  return parts.join('');
}

/** Labels of input fields start with a capital letter. */
export const capitalizeLabels: Standard = {
  id: 'capitalize-labels',
  title: 'Labels start with a capital letter',
  source: 'rule',
  apply(ctx) {
    const done: string[] = [];
    const targets: { name: string; next: string }[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      // Radio and checkbox group labels are often the second half of a sentence; leave those as the PDF has them.
      if (widgetKind(w) !== 'input' || w === 'Radio' || w === 'MultipleCheckbox' || w === 'Dropdown' || w === 'MultipleSuggest') return;
      const html = ctx.doc.uiSchema[n.name]?.['ui:formattedText'];
      if (typeof html !== 'string') return;
      const next = capitalizeLabel(html);
      if (next !== html) targets.push({ name: n.name, next });
    });
    targets.forEach((t) => {
      patchUi(ctx, t.name, { 'ui:formattedText': t.next });
      done.push(t.name);
    });
    if (done.length > 0) ctx.log(`capitalize-labels: ${done.length} label(s) now start with a capital letter (${done.slice(0, 3).join(', ')}${done.length > 3 ? ', …' : ''})`);
  },
};
