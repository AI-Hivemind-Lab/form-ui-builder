import { childrenOf, closeRange, isFixed, startNumber, wrapSiblings } from '../grouping';
import type { Standard } from './types';
import { labelOf, nodesOf } from './util';

/**
 * A numbered question and everything that belongs to it (its boxes below an option, its follow-up sentences and boxes, its notes) is
 * one group: from the question "13." up to the one before the next number, "14.". It is only done where the numbers follow each other;
 * a jump (5 to 13) means something unnumbered sits in between, which takes judgement and is left to the AI. A question with nothing
 * attached stays as it is.
 */
export const numberedGroups: Standard = {
  id: 'numbered-groups',
  title: 'A numbered question and what belongs to it in one group',
  source: 'rule',
  apply(ctx) {
    for (const page of nodesOf(ctx.doc, 'Page')) {
      if (ctx.doc.uiSchema[page.name]?.['ui:invisible']) continue;
      const list = childrenOf(ctx.doc, page.name);
      const starts = list.flatMap((n, i) => {
        const num = isFixed(ctx.doc, n) ? null : startNumber(labelOf(ctx.doc, n.name));
        return num === null ? [] : [{ i, num }];
      });
      // from the last pair to the first, so the positions of the earlier ones do not move
      for (let k = starts.length - 2; k >= 0; k -= 1) {
        const a = starts[k];
        const b = starts[k + 1];
        if (b.num !== a.num + 1) continue;
        let end = b.i - 1;
        for (let i = a.i + 1; i <= end; i += 1) if (isFixed(ctx.doc, list[i])) { end = i - 1; break; }
        if (end <= a.i) continue; // nothing attached
        const closed = closeRange(ctx.doc, list, a.i, end);
        if (!closed || closed[0] !== a.i || closed[1] !== end) continue;
        const alias = wrapSiblings(ctx, page.name, a.i, end, `Question ${a.num}`, `question_${a.num}`);
        ctx.log(`numbered-groups: question ${a.num} and the ${end - a.i} element(s) after it on "${page.title}" are the group ${alias}`);
      }
    }
  },
};
