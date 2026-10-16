import { getWidget } from '../../model/schemaWalk';
import type { Standard } from './types';
import { patchUi, plainText, walk } from './util';

/** An option alias that says its answer: asa_yes_x, no_x, check_yes_x. */
const ANSWER_ALIAS = /^(?:[a-z]+_)?(yes|no|true|false)_/i;
const WORD: Record<string, string> = { yes: 'Yes', no: 'No', true: 'True', false: 'False' };

/** A Yes / No option the annotation left without text takes its label from its alias (asa_yes_… is "Yes", asa_no_… is "No"). */
export const yesNoLabels: Standard = {
  id: 'yes-no-labels',
  title: 'Unlabelled Yes / No options are labelled from their aliases',
  source: 'rule',
  apply(ctx) {
    let count = 0;
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      if (w !== 'Radio' && w !== 'MultipleCheckbox') return;
      const ui = ctx.doc.uiSchema[n.name] ?? {};
      const options = (ui['ui:multipleOption'] as { options?: unknown[] } | undefined)?.options;
      if (!Array.isArray(options) || options.length !== 2) return;
      const pairs = options as [string, Record<string, unknown>][];
      if (!pairs.every((o) => ANSWER_ALIAS.test(o[0]))) return;
      const words = pairs.map((o) => (ANSWER_ALIAS.exec(o[0]) as RegExpExecArray)[1].toLowerCase());
      if (new Set(words).size !== 2) return;
      if (!pairs.some((o) => plainText(o[1]?.formattedText) === '')) return;
      const next = pairs.map((o, i) => (plainText(o[1]?.formattedText) === '' ? [o[0], { ...o[1], formattedText: `<p>${WORD[words[i]]}</p>` }] : o));
      patchUi(ctx, n.name, { 'ui:multipleOption': { ...(ui['ui:multipleOption'] as object), options: next } });
      count += 1;
    });
    if (count > 0) ctx.log(`yes-no-labels: ${count} Yes / No question(s) had options without text; they are now labelled from their aliases`);
  },
};
