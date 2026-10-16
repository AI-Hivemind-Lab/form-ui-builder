import type { Anchors } from '../model/pdfStore';
import { getWidget } from '../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../model/types';
import { anchorsFor } from '../model/pdfAnchors';
import type { PageText } from './pdfText';
import { decodeEntities } from './annotationToForm';
import { nodesOf, plainText } from './standards/util';

/**
 * What the PDF prints that the form never shows. The annotation says what to build, but it can leave things out (a note nobody
 * highlighted, a section nobody annotated). Every line of the PDF is looked for in the words the investor will see on the form; what
 * is not there, nor in an embedded PDF, is listed here, in blocks of neighbouring lines.
 */

export interface Block {
  id: string;
  /** 0-based PDF page, and the height of the block's first and last line. */
  page: number;
  top: number;
  bottom: number;
  lines: string[];
  text: string;
  /** Sits next to a signature widget: usually a signer's block, which the form leaves to the signing step. */
  nearSignature: boolean;
}

export interface MissingPages {
  id: string;
  /** 1-based, both included. */
  from: number;
  to: number;
  /** The first uncovered lines of those pages. */
  lines: string[];
}

export interface Coverage {
  blocks: Block[];
  /** Whole pages that are nowhere on the form. */
  pages: MissingPages[];
  checked: number;
  uncovered: number;
}

const norm = (t: string): string => t.toLowerCase().replace(/[​­]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const isNoise = (t: string): boolean => /^(page\s+\d+(\s+of\s+\d+)?|\d+|[a-z_]*:\d+|[_\-. ]+|[□☐☑☒]+)$/i.test(t.trim()) || t.trim().length < 3 || !/[A-Za-z]{2}/.test(t);

/** Every word the investor can read on the form: labels, options, headings, notes, footnotes, supporting documents. Hidden parts do not count. */
export function formWords(doc: FormDoc): string {
  const parts: string[] = [];
  const visit = (list: SchemaNode[]): void =>
    list.forEach((n) => {
      const ui = doc.uiSchema[n.name] ?? {};
      if (ui['ui:invisible'] === true) return;
      const html = ui['ui:formattedText'];
      parts.push(plainText(html), typeof ui['ui:heading'] === 'string' ? ui['ui:heading'] : '', typeof ui['ui:subtitle'] === 'string' ? ui['ui:subtitle'] : '', n.title);
      // a footnote's text is in the tooltip of the widget that marks it
      if (typeof html === 'string') [...html.matchAll(/data-title="([^"]*)"/g)].forEach((m) => parts.push(plainText(decodeEntities(m[1]))));
      const options = (ui['ui:multipleOption'] as { options?: [string, { formattedText?: unknown }][] } | undefined)?.options;
      if (Array.isArray(options)) options.forEach((o) => {
        parts.push(plainText(o[1]?.formattedText));
        if (typeof o[1]?.formattedText === 'string') [...o[1].formattedText.matchAll(/data-title="([^"]*)"/g)].forEach((m) => parts.push(plainText(decodeEntities(m[1]))));
      });
      const group = ui['ui:supportingFileGroup'] as { description?: string; files?: Record<string, { description?: string; helpText?: string }> } | undefined;
      if (group) Object.values(group.files ?? {}).forEach((f) => parts.push(f.description ?? '', plainText(f.helpText)));
      visit(n.properties ?? []);
    });
  visit(doc.schema.properties);
  return parts.join(' ');
}

/** PDF pages (1-based) shown whole by an embedded PDF. */
function embeddedPages(doc: FormDoc): Set<number> {
  const out = new Set<number>();
  Object.entries(doc.uiSchema).forEach(([, ui]) => {
    const cut = ui['ui:pdfCutInfo'] as { start?: unknown; end?: unknown } | undefined;
    if (ui['ui:widget'] === 'Pdf' && typeof cut?.start === 'number' && typeof cut?.end === 'number') for (let p = cut.start; p <= cut.end; p += 1) out.add(p);
  });
  return out;
}

export function coverage(doc: FormDoc, anchors: Anchors, pages: PageText[]): Coverage {
  const corpus = norm(formWords(doc));
  const grams = new Set<string>();
  const words = corpus.split(' ');
  for (let i = 0; i + 2 < words.length; i += 1) grams.add(words.slice(i, i + 3).join(' '));
  const shown = embeddedPages(doc);
  // a line printed on many pages is a running header or footer
  const seen = new Map<string, number>();
  pages.forEach((p) => new Set(p.lines.map((l) => norm(l.text))).forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1)));
  const running = (t: string): boolean => (seen.get(norm(t)) ?? 0) >= Math.max(4, pages.length * 0.06);
  const signatures = nodesOf(doc, 'Signature').flatMap((n) => anchorsFor(doc, n, anchors));

  const covered = (text: string): boolean => {
    const w = norm(text).split(' ').filter(Boolean);
    if (w.length < 3) return corpus.includes(norm(text));
    let hit = 0;
    let n = 0;
    for (let i = 0; i + 2 < w.length; i += 1) {
      n += 1;
      if (grams.has(w.slice(i, i + 3).join(' '))) hit += 1;
    }
    return hit / n >= 0.6;
  };

  let checked = 0;
  let uncovered = 0;
  const perPage: { page: number; lines: { top: number; text: string }[]; total: number }[] = [];
  for (const p of pages) {
    if (shown.has(p.page + 1)) continue;
    const missing: { top: number; text: string }[] = [];
    let total = 0;
    for (const l of [...p.lines].sort((a, b) => a.top - b.top)) {
      const text = l.text.replace(/\s+/g, ' ').trim();
      if (isNoise(text) || running(text)) continue;
      total += 1;
      checked += 1;
      if (!covered(text)) {
        missing.push({ top: l.top, text });
        uncovered += 1;
      }
    }
    perPage.push({ page: p.page, lines: missing, total });
  }

  // pages that are nowhere on the form: most of their lines are missing
  const gone = new Set(perPage.filter((p) => p.total >= 8 && p.lines.length / p.total >= 0.7).map((p) => p.page));
  const ranges: MissingPages[] = [];
  [...gone].sort((a, b) => a - b).forEach((p) => {
    const last = ranges[ranges.length - 1];
    const lines = perPage.find((x) => x.page === p)?.lines.map((l) => l.text) ?? [];
    if (last && last.to === p) {
      last.to = p + 1;
      last.lines.push(...lines.slice(0, 3));
    } else ranges.push({ id: `pg${ranges.length + 1}`, from: p + 1, to: p + 1, lines: lines.slice(0, 8) });
  });

  // the rest: blocks of neighbouring lines (a gap of more than two lines starts a new block)
  const blocks: Block[] = [];
  for (const p of perPage.filter((x) => !gone.has(x.page))) {
    let current: Block | null = null;
    for (const l of p.lines) {
      if (current && l.top - current.bottom <= 0.034) {
        current.lines.push(l.text);
        current.bottom = l.top;
      } else {
        current = { id: `b${blocks.length + 1}`, page: p.page, top: l.top, bottom: l.top, lines: [l.text], text: '', nearSignature: false };
        blocks.push(current);
      }
    }
  }
  blocks.forEach((b) => {
    b.text = b.lines.join(' ').replace(/\s+/g, ' ').trim();
    b.nearSignature = signatures.some((s) => s.page === b.page && b.bottom >= s.top - 0.06 && b.top <= s.bottom + 0.06);
  });
  return { blocks: blocks.filter((b) => /[A-Za-z]{3}/.test(b.text)), pages: ranges, checked, uncovered };
}

// ------------------------------ where a block of text belongs on the form ------------------------------
export interface Place {
  /** The element of the page (a direct child of it) the text goes right after, or null. */
  after: string | null;
  /** The element it goes right before, when nothing above it on that PDF page is annotated. */
  before: string | null;
  /** The page of the form, when the text goes at the end of it because nothing on its PDF page is annotated. */
  page: string | null;
}

/**
 * Where text printed on a PDF page at a height belongs: after the element of the form that sits right above it on that PDF page,
 * else before the one right below it, else at the end of the form page that starts before it.
 */
export function placeOf(doc: FormDoc, anchors: Anchors, page: number, top: number): Place {
  const entries: { page: string; child: string; top: number; bottom: number }[] = [];
  const pagesOnForm: { name: string; start: { page: number; top: number } | null; embedded: boolean }[] = [];
  const visitPage = (p: SchemaNode): void => {
    let start: { page: number; top: number } | null = null;
    let embedded = false;
    (p.properties ?? []).forEach((c) => {
      if (getWidget(doc, c) === 'Pdf') embedded = true;
      const boxes: { page: number; top: number; bottom: number }[] = [];
      const collect = (n: SchemaNode): void => {
        boxes.push(...anchorsFor(doc, n, anchors));
        (n.properties ?? []).forEach(collect);
      };
      collect(c);
      boxes.forEach((b) => {
        if (!start || b.page < start.page || (b.page === start.page && b.top < start.top)) start = { page: b.page, top: b.top };
      });
      const here = boxes.filter((b) => b.page === page);
      if (here.length > 0) entries.push({ page: p.name, child: c.name, top: Math.min(...here.map((b) => b.top)), bottom: Math.max(...here.map((b) => b.bottom)) });
    });
    pagesOnForm.push({ name: p.name, start, embedded });
  };
  const walkPages = (list: SchemaNode[]): void => list.forEach((n) => {
    if (getWidget(doc, n) === 'Page') {
      if (doc.uiSchema[n.name]?.['ui:invisible'] !== true) visitPage(n);
    } else walkPages(n.properties ?? []);
  });
  walkPages(doc.schema.properties);
  const above = entries.filter((e) => e.bottom <= top + 0.012).sort((a, b) => b.bottom - a.bottom)[0];
  if (above) return { after: above.child, before: null, page: null };
  const below = entries.filter((e) => e.top > top).sort((a, b) => a.top - b.top)[0];
  if (below) return { after: null, before: below.child, page: null };
  const owner = pagesOnForm.filter((p) => !p.embedded && p.start && (p.start.page < page || (p.start.page === page && p.start.top <= top))).sort((a, b) => (a.start as { page: number }).page - (b.start as { page: number }).page).pop();
  return { after: null, before: null, page: owner?.name ?? null };
}

// ------------------------------ text the form lost ------------------------------
/** Whether enough word-triples of `text` are among the form's words: the same test the PDF lines are put through. */
function shownIn(words: string, grams: Set<string>, text: string): boolean {
  const w = norm(text).split(' ').filter(Boolean);
  if (w.length < 3) return words.includes(norm(text));
  let hit = 0;
  let n = 0;
  for (let i = 0; i + 2 < w.length; i += 1) {
    n += 1;
    if (grams.has(w.slice(i, i + 3).join(' '))) hit += 1;
  }
  return hit / n >= 0.6;
}
const gramsOf = (words: string): Set<string> => {
  const w = words.split(' ');
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i += 1) out.add(w.slice(i, i + 3).join(' '));
  return out;
};

/**
 * Highlighted texts of the annotation (labels, paragraphs) that the form does not show: they were meant to be on it. After the standards a few
 * go on purpose (a name merged into the name question, a signature page's title); the list is for a person to look at. With `before`, only
 * what a change took away: texts the form showed before and no longer shows.
 */
export function lostTexts(doc: FormDoc, texts: string[], before?: FormDoc): string[] {
  const now = norm(formWords(doc));
  const grams = gramsOf(now);
  const was = before ? norm(formWords(before)) : null;
  const wasGrams = was ? gramsOf(was) : null;
  return texts.filter((t) => {
    if (norm(t).length < 12) return false;
    if (shownIn(now, grams, t)) return false;
    return was !== null && wasGrams !== null ? shownIn(was, wasGrams, t) : true;
  });
}

const quoted = (t: string): string => `"${t.replace(/\s+/g, ' ').slice(0, 60)}"`;
export const lostWarning = (lost: string[], prefix: string, tail: string): string => `${prefix}: ${lost.length} ${tail}: ${lost.slice(0, 4).map(quoted).join('; ')}${lost.length > 4 ? '; …' : ''}`;
