import { getWidget } from '../../model/schemaWalk';
import type { Standard } from './types';
import { patchUi, plainText, walk } from './util';

const INFO_START = /^\s*(\*|\(?note\b|notes\b|please\b|important\b|if you\b|you must\b|you should\b|you will\b|after completing\b)/i;
const WARNING_START = /^\s*(warning\b|caution\b|important\b)/i;
const MAX_LENGTH = 600;
/**
 * A message that tells the investor what happens or what to do depending on an answer: "If the answer to the above question is “Yes”,
 * please contact our counsel", "If both questions above were answered “Yes” ...", "If you are ...". It starts with "If", speaks of
 * the answer, a question, the investor or "you", and says what to do or what will be required.
 */
const CONDITIONAL_MESSAGE = /^\s*if\b(?=[^.]{0,220}\b(answer(ed)?|questions?|you\b|your\b|investor|yes\b|no\b|checked)\b)(?=[\s\S]*\b(please|must|shall|should|will be required|is required|are required|contact|provide|complete|attach|submit|required)\b)/i;

/** The kind of well a message paragraph should be, or null when it is body text. */
export function wellFor(text: string): 'Info' | 'Warning' | null {
  const t = text.trim();
  if (t === '' || t.length > MAX_LENGTH) return null;
  if (WARNING_START.test(t)) return 'Warning';
  return INFO_START.test(t) || CONDITIONAL_MESSAGE.test(t) ? 'Info' : null;
}

/** Messages that instruct or inform are Info wells (Warning wells for cautions); body text stays plain. */
export const infoWells: Standard = {
  id: 'info-wells',
  title: 'Instructions and notices are Info wells',
  source: 'hybrid',
  apply(ctx) {
    const todo: { name: string; well: 'Info' | 'Warning' }[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) !== 'Paragraph' || ctx.doc.uiSchema[n.name]?.['ui:wellType']) return;
      const well = wellFor(plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']));
      if (well) todo.push({ name: n.name, well });
    });
    todo.forEach((t) => patchUi(ctx, t.name, { 'ui:wellType': t.well }));
    if (todo.length > 0) ctx.log(`info-wells: ${todo.length} message(s) became wells (${todo.filter((t) => t.well === 'Info').length} Info, ${todo.filter((t) => t.well === 'Warning').length} Warning)`);
  },
};
