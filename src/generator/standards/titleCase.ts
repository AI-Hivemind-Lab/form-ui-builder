import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard, StandardContext } from './types';

/** Words kept in capitals in titles. Further ones come from the document itself (see documentAcronyms). */
export const STARTING_ACRONYMS = ['LP', 'ERISA', 'FOIA', 'UBTI', 'IRA', 'AML', 'U.S.', 'GP'];

const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'as', 'per', 'vs']);
const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/**
 * All-caps words that the document itself writes in capitals inside ordinary mixed-case text, in at least two
 * places ("ERISA" in sentences, the fund's own abbreviations). One sentence of shouting is not enough.
 */
export function documentAcronyms(texts: string[]): Set<string> {
  const counts = new Map<string, number>();
  texts.forEach((t) => {
    if (!/[a-z]/.test(t)) return; // an all-caps text proves nothing
    new Set(t.match(/\b[A-Z]{2,}\b/g) ?? []).forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  });
  return new Set([...counts].filter(([, n]) => n >= 2).map(([w]) => w));
}

const isAllCaps = (s: string): boolean => /[A-Z]/.test(s) && !/[a-z]/.test(s);

/** Title Case for an all-caps title; a title that already has lower-case letters is left alone. */
const LABEL_WORDS = new Set(['exhibit', 'appendix', 'schedule', 'annex', 'section', 'part', 'item', 'article', 'attachment']);

/** Title Case for an all-caps title; a title that already has lower-case letters is left alone. */
export function titleCase(title: string, acronyms: Set<string>): string {
  if (!isAllCaps(title)) return title;
  const known = new Set([...STARTING_ACRONYMS, ...acronyms].map((a) => a.toUpperCase()));
  const words = title.split(/(\s+)/);
  const real = words.filter((w) => w.trim() !== '');
  let seen = 0;
  let previous = '';
  return words
    .map((w) => {
      if (w.trim() === '') return w;
      const first = seen === 0;
      const last = seen === real.length - 1;
      seen += 1;
      const m = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9.]*)$/.exec(w);
      const [, pre, core, post] = m ?? ['', '', w, ''];
      const before = previous;
      previous = core.toLowerCase();
      if (!core) return w;
      const bare = core.replace(/\.$/, '');
      if (known.has(core) || known.has(bare)) return pre + core + post;
      if (/\d/.test(core) || ROMAN.test(bare)) return pre + core + post; // "A-1", "VII."
      if (core.length === 1 && LABEL_WORDS.has(before)) return pre + core + post; // "EXHIBIT A"
      const lower = core.toLowerCase();
      if (!first && !last && SMALL_WORDS.has(lower)) return pre + lower + post;
      const cased = lower
        .split(/([-/])/)
        .map((part) => (known.has(part.toUpperCase()) && part.length > 1 ? part.toUpperCase() : part.replace(/^[a-z]/, (c) => c.toUpperCase())))
        .join('');
      return pre + cased + post;
    })
    .join('');
}

/** Short all-caps words in a title that nothing settles: possibly acronyms. */
export function unsettledShortWords(title: string, acronyms: Set<string>): string[] {
  const known = new Set([...STARTING_ACRONYMS, ...acronyms]);
  return (title.match(/\b[A-Z]{2,4}\b/g) ?? []).filter((w) => !known.has(w) && !SMALL_WORDS.has(w.toLowerCase()) && !ROMAN.test(w));
}

/** Page titles and section titles in Title Case (the heading at the top of a page is in capitals: see headingCaps). */
export const titleCaseTitles: Standard = {
  id: 'title-case',
  title: 'Title Case for page and section titles',
  source: 'hybrid',
  apply(ctx: StandardContext) {
    const acronyms = documentAcronyms(ctx.texts);
    const changed: string[] = [];
    const review = new Set<string>();
    const fix = (title: string): string => {
      const next = titleCase(title, acronyms);
      if (next !== title) {
        changed.push(`"${title}" → "${next}"`);
        unsettledShortWords(title, acronyms).forEach((w) => review.add(w));
      }
      return next;
    };
    const retitle = (n: SchemaNode): SchemaNode => {
      const w = getWidget(ctx.doc, n);
      const isSection = w === 'Group' && (n.properties ?? []).some((c) => getWidget(ctx.doc, c) === 'Page');
      return { ...n, title: w === 'Page' || isSection ? fix(n.title) : n.title, properties: n.properties?.map(retitle) };
    };
    const properties = ctx.doc.schema.properties.map(retitle);
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties } };
    changed.forEach((c) => ctx.log(`title-case: ${c}`));
    if (review.size > 0) ctx.warn(`TITLE CASE REVIEW: ${[...review].join(', ')} may be acronyms; the document does not say, so they were written in Title Case`);
  },
};
