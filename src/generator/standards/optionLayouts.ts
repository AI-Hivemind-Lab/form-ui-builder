import { getWidget } from '../../model/schemaWalk';
import type { Standard } from './types';
import { patchUi, plainText, walk } from './util';

export const MAX_INLINE_OPTIONS = 6;
export const MAX_SHORT_LENGTH = 40;
const MAX_TWO_COLUMNS = 12;

/** Yes / No, True / False (two or more options, all of them boolean words). */
export const isBooleanList = (texts: string[]): boolean =>
  texts.length >= 2 && texts.every((t) => ['yes', 'no', 'true', 'false'].includes(t.toLowerCase().replace(/[^a-z]/g, '')));

/** The layout a group of options should have, from its option texts. */
export function layoutFor(texts: string[], hasFieldsBelow: boolean): 'Default' | 'Inline' | 'TwoColumns' | 'ThreeColumns' {
  if (hasFieldsBelow || texts.length === 0) return 'Default';
  if (isBooleanList(texts)) return 'Inline'; // Yes / No is always on one line
  if (texts.some((t) => t.length > MAX_SHORT_LENGTH)) return 'Default';
  if (texts.length <= MAX_INLINE_OPTIONS) return 'Inline';
  return texts.length <= MAX_TWO_COLUMNS ? 'TwoColumns' : 'ThreeColumns';
}

/** Short option lists sit on one line or in columns; long ones, or ones with fields below, stay stacked. */
export const optionLayouts: Standard = {
  id: 'option-layouts',
  title: 'Layout of option lists',
  source: 'rule',
  apply(ctx) {
    const changes: { name: string; layout: string }[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      if (w !== 'Radio' && w !== 'MultipleCheckbox') return;
      const options = (ctx.doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
      if (!Array.isArray(options)) return;
      const texts = options.map((o) => plainText((Array.isArray(o) ? (o[1] as { formattedText?: unknown } | null)?.formattedText : '') ?? ''));
      const below = options.some((o) => Array.isArray(o) && Array.isArray((o[1] as { fieldsBelow?: unknown } | null)?.fieldsBelow) && ((o[1] as { fieldsBelow: unknown[] }).fieldsBelow.length > 0));
      changes.push({ name: n.name, layout: layoutFor(texts, below) });
    });
    changes.forEach((c) => patchUi(ctx, c.name, { 'ui:fixedLayout': c.layout }));
    const count = (l: string) => changes.filter((c) => c.layout === l).length;
    if (changes.length > 0) {
      ctx.log(`option-layouts: ${changes.length} option list(s) set (Inline ${count('Inline')}, 2 columns ${count('TwoColumns')}, 3 columns ${count('ThreeColumns')}, Default ${count('Default')})`);
    }
  },
};
