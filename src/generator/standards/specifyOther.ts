import { isFieldBelow } from '../../model/fieldsBelow';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { labelOf, patchUi, plainText, walk } from './util';

/** specify_other_<question alias>: the box that says what "Other" is. */
const SPECIFY_ALIAS = /^specify_?other_(.+)$/i;
/** The box's own words: If "Other" was checked, please describe ... */
const OTHER_WORDS = /^\s*if\s+[“"'‘]?other[”"'’]?\s+(was|is)\s+(checked|selected|chosen)/i;

/**
 * The annotation names the "please specify" box after the question it belongs to (specify_other_sourceoffunds_x for the radio
 * sourceoffunds_x). When the importer did not tag it, it goes below the option "Other" of that question.
 */
export const specifyOther: Standard = {
  id: 'specify-other',
  title: '"Specify" box shown below the option "Other"',
  source: 'rule',
  apply(ctx) {
    const choices = new Map<string, SchemaNode>();
    const boxes: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      if (w === 'Radio' || w === 'MultipleCheckbox') choices.set(n.name, n);
      else if ((w === 'TextBox' || w === 'TextArea') && SPECIFY_ALIAS.test(n.name)) boxes.push(n);
    });
    const place = (box: SchemaNode, question: SchemaNode | undefined): void => {
      if (!question || isFieldBelow(ctx.doc, box.name)) return;
      const ui = ctx.doc.uiSchema[question.name] ?? {};
      const options = ((ui['ui:multipleOption'] as { options?: unknown[] } | undefined)?.options ?? []) as [string, Record<string, unknown>][];
      const other = options.find((o) => /^\s*other\b/i.test(plainText(o[1]?.formattedText)));
      if (!other) return;
      const next = options.map((o) => (o === other ? [o[0], { ...o[1], fieldsBelow: [...((o[1].fieldsBelow as string[] | undefined) ?? []), box.name] }] : o));
      patchUi(ctx, question.name, { 'ui:multipleOption': { ...(ui['ui:multipleOption'] as object), options: next } });
      if (plainText(ctx.doc.uiSchema[box.name]?.['ui:formattedText']) === '') patchUi(ctx, box.name, { 'ui:placeholder': 'Please specify' });
      ctx.log(`specify-other: ${box.name} is now shown below the option "Other" of ${question.name}`);
    };
    for (const box of boxes) place(box, choices.get((SPECIFY_ALIAS.exec(box.name) as RegExpExecArray)[1]));
    // a box that says so itself ("If "Other" was checked, please describe ...") goes with the nearest choice above it that has an "Other"
    const visit = (list: SchemaNode[]): void => {
      list.forEach((n, i) => {
        if (['TextBox', 'TextArea'].includes(getWidget(ctx.doc, n)) && OTHER_WORDS.test(labelOf(ctx.doc, n.name))) {
          const above = [...list.slice(0, i)].reverse().find((c) => ['Radio', 'MultipleCheckbox'].includes(getWidget(ctx.doc, c)));
          place(n, above);
        }
        if (n.properties) visit(n.properties);
      });
    };
    visit(ctx.doc.schema.properties);
  },
};
