import type { PageText } from './pdfText';

/**
 * The structure of the sub-doc, read from the PDF's own headings: where each section starts. The annotation does not always put
 * every field into a page (the annotator forgets, or the tool lets it slip); the headings say where the loose objects belong, and
 * what a page without a highlighted title is called.
 */

/** A place in the PDF: page (0-based) and height on it (0 to 1). */
export interface Place {
  page: number;
  top: number;
}

export const compare = (a: Place, b: Place): number => a.page - b.page || a.top - b.top;

export interface Heading {
  id: string;
  /** 0-based PDF page, and the height of the line. */
  page: number;
  top: number;
  text: string;
  /** "A." "B." of the questionnaire's own lettering, or a heading in capitals. */
  kind: 'lettered' | 'caps';
}

const FOOTER = /^(page\s+\d+|[A-Z]{1,4}\s*[–-]\s*\d+|\d+|[a-z_]+:\d+)$/i;
const LETTERED = /^([A-Z]|[IVX]{2,5})\.\s+(\S.{2,110})$/;
/** Words that make a line a sentence of body text, not a heading. */
const SENTENCE = /\b(should|must|shall|will|may|can|is|are|was|were|has|have|indicates|requires|complete|review|provide|answer|please)\b/i;
/** Verbs no capitals heading has. */
const STRONG_VERB = /\b(requires?|indicates?|should|must|shall|will|may|please)\b/i;
/** "IRA-EIN IRA-SSN": a column label made of abbreviations, not a section. */
const LABEL_ABBREVIATIONS = /\b[A-Z]{2,5}-[A-Z]{2,5}\b/;
const CAPS = /^[A-Z0-9][A-Z0-9 &,'’“”/().–-]{5,90}[A-Z0-9)”]$/;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The section headings of the PDF, in reading order. A lettered heading ("E. Supplemental Data for Entities") counts when its letter
 * is the next one after the section before it (so "A. Exempt Persons" inside section K does not); a heading in capitals counts unless it
 * is a footer, a title repeated on many pages, the fund's name, or a label with a colon.
 */
export function pdfHeadings(pages: PageText[] | null | undefined, fundName = ''): Heading[] {
  if (!pages || pages.length === 0) return [];
  // text printed on many pages (the running title, the fund's name) is not a heading of one place
  const seen = new Map<string, number>();
  pages.forEach((p) => new Set(p.lines.map((l) => norm(l.text))).forEach((t) => seen.set(t, (seen.get(t) ?? 0) + 1)));
  const fund = norm(fundName);
  const out: Omit<Heading, 'id'>[] = [];
  let letter = 'A'.charCodeAt(0) - 1;
  let roman = 0;
  const taken = new Set<string>();
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    const lines = [...p.lines].sort((a, b) => a.top - b.top);
    for (let i = 0; i < lines.length; i += 1) {
      let text = lines[i].text.replace(/\s+/g, ' ').trim();
      if (text.length < 4 || FOOTER.test(text) || /_{3,}/.test(text)) continue;
      // a lettered heading may end in a colon, and a parenthesis that opens on its line closes on the next ("... (Including Grantor Trusts and Single-Member" / "LLCs)")
      const open = (t: string): boolean => (t.match(/\(/g) ?? []).length > (t.match(/\)/g) ?? []).length;
      let probe = text.replace(/:$/, '');
      if (LETTERED.test(probe) && open(probe) && lines[i + 1] && lines[i + 1].top - lines[i].top < 0.03) {
        probe = `${probe} ${lines[i + 1].text.replace(/\s+/g, ' ').trim()}`.replace(/:$/, '');
        if (!open(probe)) i += 1;
      }
      const lettered = LETTERED.exec(probe);
      if (lettered && !/[.?!]$/.test(probe) && !open(probe)) {
        if (SENTENCE.test(probe)) continue;
        const mark = lettered[1];
        if (mark.length === 1 && mark.charCodeAt(0) === letter + 1) {
          letter += 1;
          out.push({ page: p.page, top: lines[i].top, text: probe, kind: 'lettered' });
        } else if (mark.length > 1 && ROMAN.indexOf(mark) === roman) {
          roman += 1;
          out.push({ page: p.page, top: lines[i].top, text: probe, kind: 'lettered' });
        }
        continue;
      }
      if (/[:,;]$/.test(text) || text.startsWith('(')) continue;
      if ((text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length || (text.match(/,/g) ?? []).length >= 2) continue; // a cut-off or a list, not a heading
      if (!CAPS.test(text) || /[a-z]/.test(text) || LABEL_ABBREVIATIONS.test(text) || STRONG_VERB.test(text)) continue;
      // a heading that runs on to the next line ("DIRECTIONS FOR THE COMPLETION" / "OF THE SUBSCRIPTION DOCUMENTS")
      for (let j = i + 1; j < lines.length && j <= i + 2; j += 1) {
        const next = lines[j].text.replace(/\s+/g, ' ').trim();
        if (lines[j].top - lines[j - 1].top > 0.03 || !CAPS.test(next) || /[a-z]/.test(next) || /[:,;]$/.test(next) || text.length + next.length > 100 || /\.$/.test(text)) break;
        text = `${text} ${next}`;
        i = j;
      }
      const key = norm(text);
      if ((seen.get(norm(lines[i].text)) ?? 0) >= 3 && taken.has(key)) continue; // a running title: only its first place counts
      if (key === fund || (fund && key.includes(fund) && key.length - fund.length < 8) || (!/\s/.test(text) && text.length < 8)) continue;
      if (/[.]$/.test(text) && text.split(' ').length > 8) continue; // a sentence in capitals
      taken.add(key);
      out.push({ page: p.page, top: lines[i].top, text, kind: 'caps' });
    }
  }
  return out.map((h, i) => ({ ...h, id: `h${i + 1}` }));
}

/**
 * The heading a place falls under: the last heading before it. An object's top is the top of its highlight, which sits a little above
 * the baseline of the heading line that is on the same row, so a heading just below the place still counts.
 */
export function governing(headings: Heading[], at: Place, strict = false): Heading | null {
  let hit: Heading | null = null;
  for (const h of headings) {
    if (compare(h, { page: at.page, top: at.top + 0.025 }) <= 0) hit = h;
    else break;
  }
  // a page that starts under a heading of the page before it: only when that heading is low on its page, so its section runs on
  if (strict && hit && hit.page < at.page && (at.page - hit.page > 1 || hit.top < 0.6)) return null;
  return hit;
}

/** "E. Supplemental Data for Entities" is "supplemental_data_for_entities" with its letter in front: how the DS names such a page. */
export function aliasOf(heading: string): string {
  const m = /^([A-Z]|[IVX]{2,5})\.\s+(.*)$/.exec(heading);
  const words = (m ? m[2] : heading).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48).replace(/_+$/, '');
  return (m && m[1].length === 1 ? `${m[1].toLowerCase()}_${words}` : words) || 'section';
}

/** A heading as a title: as printed. A heading in capitals is written in Title Case later, by the title standard (which knows the acronyms). */
export const headingTitle = (h: Heading): string => h.text;

// ------------------------------ what the plan says about loose objects and untitled pages ------------------------------
export type RunAction =
  /** Into a page the annotation has. */
  | { kind: 'page'; page: string }
  /** A page of its own, titled from a heading of the PDF (or with the words given). */
  | { kind: 'new'; title: string; headingId?: string }
  /** Nothing the investor fills: signature blocks and what the General Partner completes. */
  | { kind: 'hidden' };

export interface PageTitle {
  title: string;
  headingId?: string;
}

export interface StructurePlan {
  runs: Record<string, RunAction>;
  titles: Record<string, PageTitle>;
}

export interface RunFacts {
  id: string;
  count: number;
  /** PDF pages, 1-based, as printed. */
  fromPage: number;
  toPage: number;
  kinds: Record<string, number>;
  /** The first few objects: their alias and the text they carry. */
  sample: { name: string; text: string }[];
  /** The heading the run falls under. */
  heading: { id: string; text: string } | null;
  /** Only signature blocks and what the General Partner completes: the one kind of run that may be hidden. */
  hideable: boolean;
  action: RunAction;
}

export interface PageFacts {
  name: string;
  /** The title the build gives it now, and where that came from. */
  title: string;
  source: 'highlight' | 'paragraph' | 'heading' | 'alias';
  startPage: number;
  heading: { id: string; text: string } | null;
  /** Headings the page could be named after. */
  candidates: { id: string; text: string }[];
  /** The first words on the page, so what it is about can be seen. */
  firstTexts: string[];
  /** The heading the program picks when nothing else is said. */
  proposed: PageTitle | null;
}

export interface StructureFacts {
  headings: Heading[];
  /** Every page the annotation has: where loose objects may be put. */
  pageNames: string[];
  runs: RunFacts[];
  pages: PageFacts[];
}

/** An object outside every page. `signer` is true for the signature blocks and the fields the General Partner fills. */
export interface Loose {
  id: string;
  name: string;
  type: string;
  at: Place | null;
  text: string;
  signer: boolean;
}

export interface PlanPage {
  id: string;
  name: string;
  start: Place | null;
}

const SIGNER_ALIAS = /signature|^(date|name|title|position)_.*(sign|gp)|^acceptedamount|gpacceptance|_gp\b|^gp/i;
export const isSignerAlias = (alias: string, type: string): boolean => type === 'PdfSignatureFieldDTO' || SIGNER_ALIAS.test(alias);

/**
 * What the program does with the loose objects when nobody says otherwise: each run (neighbours under the same heading) goes into the
 * page that starts under that heading, else into a page of its own named after the heading; a run of only signature blocks is hidden.
 * Loose objects with no place on the PDF follow the object before them.
 */
export function defaultRuns(headings: Heading[], pages: PlanPage[], loose: Loose[]): { id: string; items: Loose[]; heading: Heading | null; hideable: boolean; action: RunAction }[] {
  const placed = loose.filter((l) => l.at).sort((a, b) => compare(a.at as Place, b.at as Place));
  const runs: { id: string; items: Loose[]; heading: Heading | null; hideable: boolean; action: RunAction }[] = [];
  placed.forEach((l) => {
    const h = governing(headings, l.at as Place);
    const last = runs[runs.length - 1];
    if (last && (last.heading?.id ?? null) === (h?.id ?? null)) last.items.push(l);
    else runs.push({ id: `r${runs.length + 1}`, items: [l], heading: h, hideable: false, action: { kind: 'hidden' } });
  });
  // the pages, by where they start
  const starts = pages.flatMap((p) => (p.start ? [{ name: p.name, at: p.start, heading: governing(headings, p.start, true) }] : [])).sort((a, b) => compare(a.at, b.at));
  runs.forEach((r) => {
    const acting = r.items.filter((i) => i.type !== 'PdfParagraphFieldDTO');
    r.hideable = acting.length > 0 && acting.every((i) => i.signer);
    if (r.hideable) {
      r.action = { kind: 'hidden' };
      return;
    }
    const first = r.items[0].at as Place;
    const sameHeading = r.heading ? starts.filter((s) => s.heading?.id === r.heading?.id) : [];
    const before = sameHeading.filter((s) => compare(s.at, first) <= 0).pop() ?? sameHeading[0];
    if (before) r.action = { kind: 'page', page: before.name };
    else if (r.heading) r.action = { kind: 'new', title: headingTitle(r.heading), headingId: r.heading.id };
    else {
      // before any heading: the page before it in the PDF, if there is one
      const prev = starts.filter((s) => compare(s.at, first) <= 0).pop();
      r.action = prev ? { kind: 'page', page: prev.name } : { kind: 'new', title: 'Additional Information' };
    }
  });
  return runs;
}


// ------------------------------ an alias as words ------------------------------
const CONNECTORS = new Set(['of', 'and', 'the', 'for', 'to', 'in', 'on', 'at', 'a', 'an', 'or', 'by', 'us', 'non', 'with', 'as']);

/** The words a document uses (lower-case, three letters or more): what an alias glued together out of words is read against. */
export function vocabularyOf(texts: string[]): Set<string> {
  const words = new Set<string>();
  texts.forEach((t) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).forEach((w) => words.add(w)));
  return words;
}

/** "sensitivepersonalinformation" is "sensitive personal information" when the document uses those words; null when it does not split. */
export function splitGlued(word: string, vocab: Set<string>): string[] | null {
  const w = word.toLowerCase();
  if (!/^[a-z]+$/.test(w) || w.length < 8 || vocab.has(w)) return null;
  const best: { score: number; from: number }[] = Array.from({ length: w.length + 1 }, () => ({ score: -1, from: -1 }));
  best[0] = { score: 0, from: -1 };
  for (let i = 1; i <= w.length; i += 1) {
    for (let j = Math.max(0, i - 24); j < i; j += 1) {
      const piece = w.slice(j, i);
      if (best[j].score < 0 || !(vocab.has(piece) || CONNECTORS.has(piece))) continue;
      const score = best[j].score + piece.length * piece.length;
      if (score > best[i].score) best[i] = { score, from: j };
    }
  }
  if (best[w.length].score < 0) return null;
  const out: string[] = [];
  for (let i = w.length; i > 0; i = best[i].from) out.unshift(w.slice(best[i].from, i));
  return out.length >= 2 ? out : null;
}
