/**
 * Builds a Form Builder export (form-content.json) from a PDF's annotation_document_data.json.
 *
 * Reads only the annotation: nothing is invented and no PDF wording is typed in. Where the annotation falls short
 * (no highlighted text, a footnote with no text, a signature with no signer name) the result carries a warning.
 * Port of docs/digitization/entity-self-certification/generate_form_content.py; keep the two in step.
 */

import { cleanGlyphs } from './cleanText';
import type { PageText } from './pdfText';

interface AnnObj {
  id: string;
  __typename__: string;
  name: string;
  labelOf?: string;
  children?: string[];
  content?: [number, string];
  area?: { top: number; left: number; right?: number; bottom?: number };
  pageIndex?: number;
  isMultiline?: boolean;
  maxLength?: number;
  fileName?: string;
  /** An embedded file: the pages of the source PDF it is cut from (1-based, both included). */
  startPageIndex?: number;
  endPageIndex?: number;
}

type Pos = [number, number, number];
type Json = Record<string, unknown>;
interface Node {
  name: string;
  type: string;
  title: string;
  properties?: Node[];
  [k: string]: unknown;
}

export interface GeneratedForm {
  /** The export, ready for loadForm(). */
  form: Json;
  /** Where each annotated PDF field sits (page, 0-1 box), by alias, to highlight it in the PDF view. */
  anchors: Record<string, { page: number; left: number; top: number; right: number; bottom: number }>;
  warnings: string[];
  stats: { nodes: number; fieldsBelow: number; annotatedFields: number; unmappedFields: string[]; unknownMappings: string[] };
}

export class AnnotationError extends Error {}

// Optional only on an explicit marker. Conditional wording ("If Yes…", "Where…") is NOT optional: the field is
// required and a rule shows it later, so it is listed as needing a rule instead.
const OPTIONAL_TEXT = /\(optional\)|\boptional\b|\bif any\b|\bif applicable\b|\bif available\b|\bif known\b|\(\s*if\s[^)]*\)/i;
/** A question ("Is the Investor ..., if applicable, ...?") is not made optional by an "if applicable" inside it: only "(optional)" does. */
/** What one row of a repeatable is, from its heading, for the "Add another …" button ("contact", "owner"). Null keeps the default "row". */
export function itemNameOf(label: string): string | null {
  const t = label.replace(/\s+/g, ' ').trim();
  if (/contact person|\bcontacts?\b/i.test(t)) return 'contact';
  if (/individuals? and\/or entit(y|ies)|persons? and\/or entit(y|ies)/i.test(t)) return 'person or entity';
  if (/beneficial owner/i.test(t)) return 'beneficial owner';
  if (/controlling person/i.test(t)) return 'controlling person';
  if (/\bowners?\b/i.test(t)) return 'owner';
  if (/\bsigner|signator/i.test(t)) return 'signer';
  if (/\baccount/i.test(t)) return 'account';
  return null;
}

/** How far apart (page height) two tops can be and still be the same row. */
const ROW_TOLERANCE = 0.012;

const OPTIONAL_STRICT = /\(optional\)|\boptional\b/i;
const optionalIn = (text: string): boolean => {
  const t = text.replace(/FOOT_NOTE_HERE/g, '').replace(/[\s*]+$/, '');
  return (t.endsWith('?') ? OPTIONAL_STRICT : OPTIONAL_TEXT).test(text);
};
const CONDITIONAL_TEXT = /^(or\s+)?if\b|^where\b/i;
// A field that reads like a follow-up to the option next to it.
const FOLLOW_UP_TEXT = /^(please\s+)?(specify|describe)\b|^\(?please\s+specify|^if\b|^other\b/i;
// A date field by its own text: "Date of Birth", "Formation Date of Entity", "Date:".
const DATE_LABEL = /^\s*(?:[a-z]\)\s*|\d+[.)]\s*)?(?:date\s*(?:of\b|:|\(|$)|(?:formation|birth|execution|effective|closing|signing|issue)\s+date\b)/i;
const BOOLEAN_PREFIX = /^(yes|no|true|false)_/i;
// A block that only applies "if different from above" (an address) stays required, behind a gating checkbox.
const GATE_TEXT = /\bif different\b/i;
const NON_US_STATE_POSTAL = /^(state\s*\/\s*province|state|province|postal\s*code|post\s*code|zip)\b/i;
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
const REQUIRED_MSG = 'This field is required';

// A footnote digit the annotation left in a highlight: glued to the end of the text ("Entity:7", "Trustee8"),
// after sentence punctuation ("Section 4. 10"), or before a trailing colon ("GIIN 15:"); or glued between a
// closing bracket and a word ("(“TIN”)3or"). "page 7" or "CRS 2.0" are not touched.
const MARKERS = [
  /(?<=[A-Za-z.:)”])(\d{1,2})(?=\s*(?:<\/p>|$))/g,
  /(?<=[.:)”]) (\d{1,2})(?=\s*(?:<\/p>|$))/g,
  /(?<=[A-Za-z]) (\d{1,2})(?=:\s*(?:<\/p>|$))/g,
  /(?<=[)”])(\d{1,2})(?=[A-Za-z])/g,
];

const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plain = (h: string | null | undefined): string =>
  (h ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').replace(/FOOT_NOTE_HERE/g, '').trim();
const withStar = (h: string): string => (/<\/p>\s*$/.test(h) ? h.replace(/<\/p>\s*$/, `${STAR}</p>`) : h + STAR);
const boldFirstParagraph = (h: string): string => h.replace(/<p>(.*?)<\/p>/, '<p><strong>$1</strong></p>');

const cmp = (a: Pos, b: Pos): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const minPos = (ps: Pos[]): Pos | null => (ps.length === 0 ? null : ps.reduce((m, p) => (cmp(p, m) < 0 ? p : m)));
/** Python's round(x, 2) for the values we see here. */
const r2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Word's second-level bullets arrive as indented paragraphs that start with a typed "o" ("<p class="ql-indent-1">o Signed ...</p>")
 * after the list: they become nested list items of that list, so the indentation survives.
 */
export function nestBullets(html: string): string {
  if (!/<p class="ql-indent-\d">\s*[o•·]\s/.test(html)) return html;
  const item = '<li data-list="bullet" class="ql-indent-\\d">(?:(?!</li>)[\\s\\S])*</li>';
  const run = `(?:${item})+`;
  return html
    .replace(/<p class="ql-indent-(\d)">\s*[o•·]\s+([\s\S]*?)<\/p>/g, (_m, n: string, t: string) => `<li data-list="bullet" class="ql-indent-${n}"><span class="ql-ui" contenteditable="false"></span>${t.trim()}</li>`)
    // a run of nested items between two lists joins them into one list; at the end of a list it stays inside it
    .replace(new RegExp(`</ul>(${run})<ul>`, 'g'), '$1')
    .replace(new RegExp(`</ul>(${run})`, 'g'), '$1</ul>');
}

/** A page or section title has no colon at its end ("F. Tax Exempt Status:" is "F. Tax Exempt Status"). */
export const cleanTitle = (t: string): string => t.replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').replace(/[\s:]+$/, '').trim();

/** "investor_questionnaire_tax_exempt_status" as words, for a page the annotation never titled. */
export const humanizeAlias = (alias: string): string =>
  alias.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .map((w) => (w.length <= 3 && !['of', 'and', 'the', 'for', 'to', 'in', 'on', 'a', 'an', 'or'].includes(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const HEADING_NUMBERED = /^(?:[A-Z]|[IVXLC]{1,5}|\d{1,2})\.\s+[A-Z][^:]{2,100}$/;
const HEADING_CAPS = /^[A-Z][A-Z0-9 &,'’/().-]{5,90}$/;

/** The heading line printed on the PDF just above a position (page 0-based, top 0 to 1), when there is one. */
export function headingAbove(pages: PageText[] | null | undefined, page: number, top: number): string | null {
  const lines = (pages ?? []).find((p) => p.page === page)?.lines ?? [];
  const above = lines.filter((l) => l.top < top - 0.003 && top - l.top < 0.6);
  for (const re of [HEADING_NUMBERED, HEADING_CAPS]) {
    const hit = [...above].reverse().find((l) => re.test(l.text.trim()));
    if (hit) return hit.text.trim();
  }
  return null;
}

export interface BuildOptions {
  /** Not in the annotation. Every page heading carries it as its subtitle. */
  fundName?: string;
  /** The text of the PDF's pages, to find the heading of a page the annotation gives none. */
  pdfPages?: PageText[] | null;
}

export function annotationToForm(annotationJson: string, options: BuildOptions = {}): GeneratedForm {
  const fundName = (options.fundName ?? '').trim();
  let data: { fileName?: string; pdfObjectDTO?: AnnObj[] };
  try {
    data = JSON.parse(annotationJson);
  } catch {
    throw new AnnotationError('This file is not valid JSON.');
  }
  if (!data || !Array.isArray(data.pdfObjectDTO)) throw new AnnotationError('This does not look like an annotation file: "pdfObjectDTO" is missing.');
  // a box or bullet drawn in the PDF arrives as a symbol-font character inside the highlighted text: never keep it
  data.pdfObjectDTO.forEach((o) => {
    if (o.content && typeof o.content[1] === 'string') o.content = [o.content[0], cleanGlyphs(o.content[1])];
  });

  const objs = new Map<string, AnnObj>(data.pdfObjectDTO.map((o) => [o.id, o]));
  const all = [...objs.values()];
  const label = new Map<string, AnnObj>(all.filter((o) => o.__typename__ === 'PdfTextLabelDTO' && o.labelOf).map((o) => [o.labelOf as string, o]));
  if (!all.some((o) => o.__typename__ === 'PdfPageFieldDTO')) throw new AnnotationError('The annotation has no page object (PdfPageFieldDTO).');

  const warnings: string[] = [];
  let pageTitle: string | null = null; // set while building a page whose title paragraph was found

  const labelHtml = (o: AnnObj): string | null => {
    const l = label.get(o.id);
    if (!l || !l.content) return null;
    const [kind, text] = l.content;
    return kind === 2 ? text : `<p>${esc(text)}</p>`;
  };
  const paraHtml = (o: AnnObj): string => {
    const [kind, text] = o.content ?? [1, ''];
    return kind === 2 ? nestBullets(text) : `<p>${esc(text)}</p>`;
  };

  const footnoteWidget = (n: string, where: string): string => {
    // The annotation marks where a footnote goes (a digit glued to the text) but never carries its text.
    warnings.push(`FOOTNOTE TEXT MISSING: footnote ${n} on ${where} has a footnote widget with no text; its text is not in the annotation`);
    return '<span data-title="&lt;p&gt;&lt;/p&gt;">FOOT_NOTE_HERE</span>';
  };
  const fixMarkers = (name: string, h: string): string => MARKERS.reduce((acc, rx) => acc.replace(rx, (_m, d: string) => footnoteWidget(d, name)), h);

  /** The annotator's "paragraph" is the page title only when it reads like one: one short line, not a warning or a sentence of body text. */
  const readsLikeTitle = (html: string): boolean => {
    const text = cleanTitle(plain(html));
    return (html.match(/<p\b/g) ?? []).length <= 1 && text.length > 0 && text.length <= 100 && !/^\s*(warning|caution)\b/i.test(text) && !/[.!?]["”)]?\s+\S/.test(text);
  };

  // ------------------------------ positions ------------------------------
  const blockPositions = (ids: string[]): Pos[] =>
    ids.flatMap((c) => {
      const co = objs.get(c);
      return co && co.__typename__ === 'PdfTextBlockDTO' && co.area ? [[co.pageIndex ?? 0, r2(co.area.top), co.area.left] as Pos] : [];
    });
  const ownPos = (o: AnnObj): Pos | null => {
    if (o.area) return [o.pageIndex ?? 0, r2(o.area.top), o.area.left];
    // an embedded file sits where its pages start in the sub-doc, so the page that holds it keeps its place in the PDF's order
    if (o.__typename__ === 'PdfEmbeddedFileFieldDTO' && typeof o.startPageIndex === 'number') return [o.startPageIndex - 1, 0, 0]; // (numbered from 1, like the PDF's own pages)
    const ps = blockPositions(o.children ?? []);
    const l = label.get(o.id);
    if (l) ps.push(...blockPositions(l.children ?? []));
    return minPos(ps);
  };
  const realChildren = (o: AnnObj): AnnObj[] =>
    (o.children ?? []).flatMap((c) => {
      const co = objs.get(c);
      return co && co.__typename__ !== 'PdfTextBlockDTO' && co.__typename__ !== 'PdfTextLabelDTO' ? [co] : [];
    });
  const subtreePos = (o: AnnObj): Pos => {
    const ps: Pos[] = [];
    const own = ownPos(o);
    if (own) ps.push(own);
    realChildren(o).forEach((c) => ps.push(subtreePos(c)));
    return minPos(ps) ?? [99, 0, 0];
  };
  const atomPos = (o: AnnObj): Pos => {
    if (['PdfGroupFieldDTO', 'PdfRepeatableFieldDTO', 'PdfPageFieldDTO'].includes(o.__typename__)) return subtreePos(o);
    if (o.__typename__ === 'PdfRadioGroupFieldDTO' || o.__typename__ === 'PdfMultipleCheckboxesFieldDTO') {
      const lp = ownPos(o);
      if (label.has(o.id) && lp) return lp;
      return minPos(realChildren(o).map((c) => ownPos(c) as Pos)) ?? [99, 0, 0];
    }
    return ownPos(o) ?? [99, 0, 0];
  };
  const ownPosOrZero = (o: AnnObj): Pos => ownPos(o) ?? [99, 0, 0];
  const byPos = (f: (o: AnnObj) => Pos) => (a: AnnObj, b: AnnObj) => cmp(f(a), f(b));
  /**
   * Reading order: top to bottom, but things that start on the same row (within a hair of each other) read left to right. A table's
   * left cell ("Natural Persons:") then comes before the right cell it heads, even when the right cell's text starts a hair higher.
   */
  const readingOrder = (list: AnnObj[], f: (o: AnnObj) => Pos): AnnObj[] => {
    const sorted = [...list].sort(byPos(f));
    const out: AnnObj[] = [];
    let i = 0;
    while (i < sorted.length) {
      const start = f(sorted[i]);
      let j = i + 1;
      while (j < sorted.length && f(sorted[j])[0] === start[0] && f(sorted[j])[1] - start[1] < ROW_TOLERANCE) j += 1;
      out.push(...sorted.slice(i, j).sort((a, b) => f(a)[2] - f(b)[2]));
      i = j;
    }
    return out;
  };

  // ------------------------------ node builders ------------------------------
  const nodesUi: Record<string, Json> = {};
  const addUi = (name: string, ui: Json): void => {
    if (name in nodesUi) throw new AnnotationError(`Duplicate field name "${name}" in the annotation.`);
    nodesUi[name] = ui;
  };

  const labelText = (o: AnnObj): string => {
    const h = labelHtml(o);
    return h ? plain(h).replace(/^[\s.]+/, '') : '';
  };

  // Names under a group whose heading says it is optional; groups behind a gating checkbox.
  const optionalNames = new Set<string>();
  const gated = new Set<string>();
  const markOptionalGroups = (o: AnnObj, inherited = false): void => {
    const isGroup = o.__typename__ === 'PdfGroupFieldDTO';
    const opt = inherited || (isGroup && OPTIONAL_TEXT.test(labelText(o)));
    if (isGroup && GATE_TEXT.test(labelText(o))) gated.add(o.name);
    if (opt) optionalNames.add(o.name);
    realChildren(o).forEach((c) => markOptionalGroups(c, opt));
  };

  const isRequired = (o: AnnObj): boolean => {
    const text = labelText(o);
    return !optionalNames.has(o.name) && !optionalIn(text) && !NON_US_STATE_POSTAL.test(text);
  };

  // A list the annotator cut into several checkbox groups (A., B., C. …) under one lead-in paragraph: each box stays
  // optional, the paragraph before the list carries the asterisk, and a rule must force one choice.
  const splitMembers = new Set<string>();
  const starParagraphs = new Set<string>();
  const detectSplitLists = (kids: AnnObj[]): void => {
    let run: AnnObj[] = [];
    const flush = (): void => {
      if (run.length >= 2) {
        const lead = kids[kids.indexOf(run[0]) - 1];
        run.forEach((g) => splitMembers.add(g.name));
        const names = run.map((g) => g.name).join(', ');
        if (lead && lead.__typename__ === 'PdfParagraphFieldDTO') {
          starParagraphs.add(lead.name);
          warnings.push(`NEEDS RULE: at least one box must be checked among ${names} (one list split into ${run.length} groups; the asterisk is on ${lead.name})`);
        } else warnings.push(`NEEDS RULE: at least one box must be checked among ${names} (one list split into ${run.length} groups; no paragraph before it to carry the asterisk)`);
      }
      run = [];
    };
    for (const k of kids) {
      // Category headings end with a colon ("A. Individuals:"); a long lettered sentence is a question of its own.
      const m = k.__typename__ === 'PdfMultipleCheckboxesFieldDTO' && /:\s*$/.test(labelText(k)) ? /^([A-Z])\.\s/.exec(labelText(k)) : null;
      const prev = run.length > 0 ? /^([A-Z])\./.exec(labelText(run[run.length - 1])) : null;
      if (m && (run.length === 0 || (prev && m[1].charCodeAt(0) === prev[1].charCodeAt(0) + 1))) run.push(k);
      else {
        flush();
        if (m) run.push(k);
      }
    }
    flush();
  };
  const isGroupRequired = (g: AnnObj): boolean => !optionalNames.has(g.name) && !optionalIn(labelText(g)) && !splitMembers.has(g.name);

  const fieldLabelHtml = (o: AnnObj): string => {
    let h = labelHtml(o);
    if (h === null) {
      warnings.push(`LABEL MISSING: ${o.name} has no highlighted text (formattedText left empty)`);
      return '';
    }
    h = h.replace(/<p>\s*\.\s*/g, '<p>'); // ". Country of Tax Residence" artefact of a partly selected "2."
    h = fixMarkers(o.name, h);
    return isRequired(o) ? withStar(h) : h;
  };

  const textWidget = (o: AnnObj): { widget: string; type: string; extra: Json } => {
    const n = o.name;
    if (o.isMultiline) return { widget: 'TextArea', type: 'string', extra: {} };
    if (n.startsWith('dateofbirth') || DATE_LABEL.test(labelText(o))) return { widget: 'Date', type: 'string', extra: { format: 'date' } };
    if (n.startsWith('owenershippercentage') || /percent|percantage/i.test(n) || /\bpercentage\b/i.test(labelText(o))) return { widget: 'Percentage', type: 'number', extra: {} };
    if (/^(country_|countryoftaxresidence_|asa_country_|asa_jurisdiction_taxresidency)/.test(n)) return { widget: 'Country', type: 'string', extra: {} };
    // "State of Residency Where Investor Files its State Income Tax Returns" is one of the US states
    if (/^(\d+[.)]\s*)?state of (residen(cy|ce)|domicile)\b/i.test(labelText(o)) || /^stateofresidency/i.test(n)) return { widget: 'State', type: 'string', extra: {} };
    const format = customFormatOf(o);
    if (format) return { widget: 'CustomFormat', type: 'string', extra: { format } };
    return { widget: 'TextBox', type: 'string', extra: {} };
  };

  /** The Anduin format a text box should validate against, from its own words (alias only when it has no label). */
  const customFormatOf = (o: AnnObj): string | null => {
    const label = labelText(o);
    if (label) {
      if (/\biban\b/i.test(label)) return 'IBAN';
      if (/\b(swift|bic)\b/i.test(label) && !/\baba\b|\bchips\b/i.test(label)) return 'SWIFT';
      if (/\baba\b|\brouting\b/i.test(label) && !/\bswift\b|\bbic\b|\bchips\b/i.test(label)) return 'ABA';
      if (/\bgiin\b/i.test(label) && !/\bname\b/i.test(label)) return 'GIIN';
      if (/^\s*(\d+[.)]\s*|[a-z]\)\s*)?zip\b/i.test(label)) return 'USZIP';
      return null;
    }
    return /giin/i.test(o.name) && !/name/i.test(o.name) ? 'GIIN' : null;
  };

  // Fields that follow a Yes/No question and apply to one answer: independent fields, indented 24px under it.
  const indentNames = new Set<string>();

  const makeText = (o: AnnObj): Node => {
    const { widget, type, extra } = textWidget(o);
    const h = fieldLabelHtml(o);
    const ui: Json = { 'ui:widget': widget, 'ui:formattedText': h, 'ui:pdfMapping': [o.name], 'ui:enabledComment': true, 'ui:marginBottom': '12px' };
    if (isRequired(o)) ui['ui:required'] = REQUIRED_MSG;
    if (indentNames.has(o.name)) ui['ui:indentation'] = '24px';
    if (widget === 'CustomFormat' && typeof extra.format === 'string') ui['ui:customFormat'] = extra.format;
    if (extra.format === 'GIIN') ui['ui:placeholder'] = 'e.g. XXXXXX.XXXXX.XX.XXX';
    if (widget === 'Country') ui['ui:placeholder'] = 'Select country';
    addUi(o.name, ui);
    return { name: o.name, type, title: plain(h).slice(0, 120) || o.name, ...extra };
  };

  const makeParagraph = (o: AnnObj): Node => {
    const base = fixMarkers(o.name, paraHtml(o));
    const h = starParagraphs.has(o.name) ? withStar(base) : base;
    addUi(o.name, { 'ui:widget': 'Paragraph', 'ui:formattedText': h, 'ui:marginBottom': '12px' });
    return { name: o.name, type: 'null', title: plain(h).slice(0, 120) || o.name };
  };

  const counters: Record<string, number> = {};
  const genName = (prefix: string): string => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };

  /** A page heading. The fund name (not in the annotation) is its subtitle. */
  const makeHeader = (text: string, level: string): Node => {
    const name = genName('gen_header');
    const ui: Json = { 'ui:widget': 'Header', 'ui:formattedText': 'Header', 'ui:heading': text, 'ui:headerType': level, 'ui:marginBottom': '12px' };
    if (fundName) ui['ui:subtitle'] = fundName;
    else warnings.push('FUND NAME MISSING: page headings have no subtitle; the fund name is not in the annotation (enter it when building)');
    addUi(name, ui);
    return { name, type: 'null', title: text };
  };

  /** Optional checkbox in front of a required block that applies "if different from above". */
  const makeGate = (g: AnnObj, previous: string): Node => {
    const firstP = /<p>(.*?)<\/p>/.exec(labelHtml(g) ?? '');
    const subject = (plain(firstP ? firstP[1] : labelText(g)).split(GATE_TEXT)[0].replace(/^[ :-]+|[ :-]+$/g, '').toLowerCase()) || 'address';
    const sentence = `Check this box if the ${subject} is different from the ${previous || 'address'} above.`;
    const name = `${g.name}_different`;
    addUi(name, {
      'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:enabledComment': true, 'ui:marginBottom': '12px',
      'ui:multipleOption': { options: [['different', { formattedText: `<p>${esc(sentence)}</p>`, blueprintMetadataMapping: '' }]] },
    });
    warnings.push(`GATING CHECKBOX: added ${name} before ${g.name} ("${sentence}"); a rule must show ${g.name} only when it is checked`);
    return { name, type: 'array', title: subject, items: { type: 'string', enum: ['different'] } };
  };

  const makeSignature = (o: AnnObj): Node => {
    // Only what the annotation says: this field is a signature field. Signer name, role and the types of any
    // other fields signed with it are not in the annotation, so they are left unset and flagged.
    addUi(o.name, {
      'ui:widget': 'Signature', 'ui:formattedText': 'Signature', 'ui:marginBottom': '12px', 'ui:pdfMapping': [],
      'ui:signature': [{ mapping: o.name, signatureType: 'Signature', isOptional: false }],
    });
    warnings.push(`SIGNATURE: ${o.name} has no signer name; the types of any other fields signed with it (Date, Name, Title...) are not in the annotation, so only the signature field is mapped`);
    return { name: o.name, type: 'null', title: 'Signature' };
  };

  /** An option's text: its highlight, or for yes_/no_/true_/false_ aliases the word itself. */
  const booleanLabel = (r: AnnObj): string | null => {
    const m = BOOLEAN_PREFIX.exec(r.name);
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
  };
  const optionText = (r: AnnObj): string => {
    const h = labelHtml(r);
    return h !== null ? plain(h) : (booleanLabel(r) ?? '');
  };
  const optionHtml = (r: AnnObj): string => {
    const h = labelHtml(r);
    if (h === null) {
      const word = booleanLabel(r);
      if (word) return `<p>${word}</p>`;
      warnings.push(`LABEL MISSING: option ${r.name} has no highlighted text (formattedText left empty)`);
      return '';
    }
    return fixMarkers(r.name, h);
  };

  const makeRadio = (g: AnnObj, belowByOption: Map<string, string[]>): Node => {
    const rs = realChildren(g).sort(byPos((c) => ownPos(c) as Pos));
    let h = labelHtml(g);
    if (h === null) {
      warnings.push(`LABEL MISSING: radio group ${g.name} has no highlighted text (formattedText left empty)`);
      h = '';
    }
    const options = rs.map((r) => {
      const opt: Json = { formattedText: optionHtml(r), pdfMappings: [r.name], blueprintMetadataMapping: '' };
      const below = belowByOption.get(r.name);
      if (below && below.length > 0) opt.fieldsBelow = below;
      return [r.name, opt];
    });
    const required = isGroupRequired(g);
    const ui: Json = {
      'ui:widget': 'Radio', 'ui:formattedText': required && h ? withStar(h) : h, 'ui:pdfMapping': [g.name], 'ui:enabledComment': true,
      'ui:marginBottom': '12px', 'ui:clearable': false, 'ui:multipleOption': { options },
    };
    if (required) ui['ui:required'] = REQUIRED_MSG;
    addUi(g.name, ui);
    return { name: g.name, type: 'string', title: plain(h).slice(0, 120) || g.name, enum: rs.map((r) => r.name) };
  };

  /** A PDF embedded in the form (shown to the investor); the annotation names the file. */
  const makeEmbeddedPdf = (o: AnnObj): Node => {
    addUi(o.name, {
      'ui:widget': 'Pdf', 'ui:formattedText': '', 'ui:embeddedPdf': o.fileName ?? '', 'ui:height': '600pt',
      'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:pdfMapping': [o.name], 'ui:signature': [],
      // where it is cut from the sub-doc; the platform fills in fileId
      ...(typeof o.startPageIndex === 'number' && typeof o.endPageIndex === 'number' ? { 'ui:pdfCutInfo': { start: o.startPageIndex, end: o.endPageIndex, fileId: '', reviewingFileId: null } } : {}),
    });
    return { name: o.name, type: 'null', title: o.fileName ?? o.name };
  };

  const makeCheckboxGroup = (g: AnnObj, belowByOption: Map<string, string[]>): Node => {
    const cs = realChildren(g).sort(byPos((c) => ownPos(c) as Pos));
    let h = labelHtml(g);
    if (h === null) {
      // A lone checkbox is labelled by its one option, so only a group of several needs a label.
      if (cs.length > 1) warnings.push(`LABEL MISSING: checkbox group ${g.name} has no highlighted text (formattedText left empty)`);
      h = '';
    }
    const options = cs.map((r) => {
      const opt: Json = { formattedText: optionHtml(r), pdfMappings: [r.name], blueprintMetadataMapping: '' };
      const below = belowByOption.get(r.name);
      if (below && below.length > 0) opt.fieldsBelow = below;
      return [r.name, opt];
    });
    const required = isGroupRequired(g);
    const ui: Json = {
      'ui:widget': 'MultipleCheckbox', 'ui:formattedText': required && h ? withStar(h) : h, 'ui:pdfMapping': [g.name], 'ui:enabledComment': true,
      'ui:marginBottom': '12px', 'ui:multipleOption': { options },
    };
    if (required) ui['ui:required'] = REQUIRED_MSG;
    addUi(g.name, ui);
    return { name: g.name, type: 'array', title: plain(h).slice(0, 120) || g.name, items: { type: 'string', enum: cs.map((r) => r.name) } };
  };

  const makeRepeatable = (o: AnnObj): Node => {
    const kids = realChildren(o).sort(byPos(atomPos));
    // The annotation lists every row as flat fields; a column is the same name with a trailing _<n> removed.
    const columns = new Map<string, AnnObj[]>();
    kids.forEach((c) => {
      const key = c.name.replace(/_\d+$/, '');
      columns.set(key, [...(columns.get(key) ?? []), c]);
    });
    const children: Node[] = [];
    [...columns.values()].sort((x, y) => cmp(atomPos(x[0]), atomPos(y[0]))).forEach((pair) => {
      const first = pair[0]; // row 1 first (higher on the page); columns are in left-to-right order
      if (first.__typename__ === 'PdfRadioGroupFieldDTO' || first.__typename__ === 'PdfMultipleCheckboxesFieldDTO') {
        // a column of choices (Yes / No per row): the choice of row 1, mapped to the same choice of every row
        const node = makeGroup(first, new Map());
        const ui = nodesUi[first.name] as Json;
        ui['ui:pdfMapping'] = pair.map((p) => p.name);
        const options = (ui['ui:multipleOption'] as { options: [string, Json][] }).options;
        const rows = pair.map((p) => realChildren(p).sort(byPos(ownPosOrZero)));
        options.forEach(([, meta], k) => {
          meta.pdfMappings = rows.flatMap((r) => (r[k] ? [r[k].name] : []));
        });
        children.push(node);
        return;
      }
      const h = fieldLabelHtml(first);
      const { widget, type, extra } = textWidget(first);
      const ui: Json = { 'ui:widget': widget, 'ui:formattedText': h, 'ui:pdfMapping': pair.map((p) => p.name), 'ui:enabledComment': true, 'ui:marginBottom': '12px' };
      if (isRequired(first)) ui['ui:required'] = REQUIRED_MSG;
      if (widget === 'Country') ui['ui:placeholder'] = 'Select country';
      if (widget === 'CustomFormat' && typeof extra.format === 'string') ui['ui:customFormat'] = extra.format;
      addUi(first.name, ui);
      children.push({ name: first.name, type, title: plain(h).slice(0, 120), ...extra });
    });
    // A repeatable often has no label of its own (its rows are labelled), so a missing one is not a gap to report.
    const repLabel = labelHtml(o) ?? '';
    const itemName = itemNameOf(plain(repLabel));
    addUi(o.name, {
      'ui:widget': 'Repeatable', 'ui:formattedText': repLabel, 'ui:maxLength': o.maxLength ?? 1,
      'ui:enabledComment': true, 'ui:marginBottom': '12px', ...(itemName ? { 'ui:repeatableText': itemName } : {}),
    });
    return { name: o.name, type: 'array', title: plain(repLabel).slice(0, 120) || o.name, properties: children };
  };

  // ------------------------------ container building ------------------------------
  type Built = { node: Node } | { field: AnnObj; node: Node | null };

  /** The ordered nodes of a container, wiring fields below options by geometry. */
  const makeGroup = (g: AnnObj, below: Map<string, string[]>): Node => (g.__typename__ === 'PdfRadioGroupFieldDTO' ? makeRadio(g, below) : makeCheckboxGroup(g, below));

  const buildChildren = (container: AnnObj, depth: number): Node[] => {
    const kids = readingOrder(realChildren(container), atomPos);

    // Options of every radio / checkbox group in this container, in reading order. Options on one line
    // (Yes / No) cannot say which one a follow-up field belongs to, so those groups take no fields below.
    const OPTION_GROUPS = ['PdfRadioGroupFieldDTO', 'PdfMultipleCheckboxesFieldDTO'];
    const options: { pos: Pos; bottom: number; option: string; group: string; crowded: boolean }[] = [];
    const inlineGroups: AnnObj[] = [];
    kids.forEach((k) => {
      if (!OPTION_GROUPS.includes(k.__typename__)) return;
      const rs = realChildren(k).filter((r) => r.area);
      // Yes/No (and True/False) questions are always inline, so they never take fields below.
      const boolean = rs.length >= 2 && rs.every((r) => ['yes', 'no', 'true', 'false'].includes(optionText(r).toLowerCase().replace(/[^a-z]/g, '')));
      if (boolean) {
        inlineGroups.push(k);
        return;
      }
      // Several options on one line (a two-column list): the field belongs to the option to its left, but only a field
      // that reads like a follow-up ("Please specify", "If …") is trusted with it.
      rs.forEach((r) => {
        const crowded = rs.some((x) => x !== r && x.pageIndex === r.pageIndex && Math.abs((x.area?.top ?? 0) - (r.area?.top ?? 0)) < 0.01);
        options.push({ pos: ownPos(r) as Pos, bottom: r.area?.bottom ?? 0, option: r.name, group: k.name, crowded });
      });
    });
    options.sort((a, b) => cmp(a.pos, b.pos) || (a.option < b.option ? -1 : a.option > b.option ? 1 : 0));

    /** Nearest preceding option from ANOTHER group that this atom sits right of, on the same page and close below it. */
    const parentOption = (k: AnnObj): string | null => {
      const p = atomPos(k);
      let best: string | null = null;
      for (const o of options) {
        if (o.group === k.name || o.pos[0] !== p[0]) continue;
        const dy = p[1] - o.bottom;
        if (o.crowded && !FOLLOW_UP_TEXT.test(labelText(k))) continue;
        // an option on the same row to the left precedes the field even when the field's box starts a hair higher
        const precedes = cmp(o.pos, p) <= 0 || (Math.abs(o.pos[1] - p[1]) < 0.015 && o.pos[2] < p[2]);
        if (precedes && p[2] - o.pos[2] > 0.015 && dy >= -0.03 && dy <= 0.1) best = o.option;
      }
      return best;
    };

    const parentOf = new Map<string, string>();
    kids.forEach((k) => {
      if (['PdfTextFieldDTO', 'PdfRadioGroupFieldDTO', 'PdfMultipleCheckboxesFieldDTO', 'PdfParagraphFieldDTO', 'PdfRepeatableFieldDTO'].includes(k.__typename__)) {
        const po = parentOption(k);
        if (po) parentOf.set(k.name, po);
      }
    });
    // A text field right under inline options (Yes / No) that says "If Yes ..." or "If No ..." stays an independent field,
    // indented 24px under the question. It is not tagged below an option, because that would stack the options and
    // break the inline layout. A rule shows it later, so the condition is listed.
    const claimed = new Map<string, { group: AnnObj; dy: number }>();
    inlineGroups.forEach((g) => {
      const last = realChildren(g).filter((r) => r.area).sort((a, b) => (b.area?.bottom ?? 0) - (a.area?.bottom ?? 0))[0];
      kids.forEach((k) => {
        if (k.__typename__ !== 'PdfTextFieldDTO' || k.pageIndex !== last?.pageIndex) return;
        const dy = (k.area?.top ?? 9) - (last?.area?.bottom ?? 0);
        if (dy < -0.03 || dy > 0.1) return;
        const best = claimed.get(k.name);
        if (!best || dy < best.dy) claimed.set(k.name, { group: g, dy });
      });
    });
    claimed.forEach(({ group }, fieldName) => {
      const field = kids.find((k) => k.name === fieldName) as AnnObj;
      const m = /^\s*if\s+(?:[^,“"]*?answered\s+)?[“"']?(yes|no|true|false)\b/i.exec(labelText(field));
      if (!m) return;
      indentNames.add(fieldName);
      const question = plain(labelHtml(group) ?? '').slice(0, 70) || group.name;
      warnings.push(`NEEDS RULE: ${fieldName} applies only when "${question}" is ${m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()}`);
    });

    detectSplitLists(kids);
    // Conditional wording is not optional: it stays required, and the condition is listed for a rule.
    kids.forEach((k) => {
      if (!['PdfTextFieldDTO', 'PdfRadioGroupFieldDTO', 'PdfMultipleCheckboxesFieldDTO', 'PdfGroupFieldDTO', 'PdfRepeatableFieldDTO'].includes(k.__typename__)) return;
      const text = labelText(k);
      if (CONDITIONAL_TEXT.test(text) && !parentOf.has(k.name) && !indentNames.has(k.name)) warnings.push(`NEEDS RULE: ${k.name} applies only when: "${text.slice(0, 90)}"`);
    });

    const built: Built[] = [];
    let prevHeading = ''; // heading of the previous group, for gating sentences
    for (const k of kids) {
      const t = k.__typename__;
      if (t === 'PdfGroupFieldDTO') {
        if (gated.has(k.name)) built.push({ node: makeGate(k, prevHeading) });
        buildGroup(k, depth).forEach((n) => built.push({ node: n }));
        const firstP = /<p>(.*?)<\/p>/.exec(labelHtml(k) ?? '');
        prevHeading = firstP ? plain(firstP[1]).toLowerCase() : prevHeading;
        continue;
      }
      let node: Node | null;
      if (t === 'PdfParagraphFieldDTO') {
        if (k.name === 'paragraph' && depth === 1 && kids.indexOf(k) === 0 && readsLikeTitle(paraHtml(k))) {
          // the form title: the page heading; the TOC name must match it
          pageTitle = cleanTitle(plain(paraHtml(k)));
          built.push({ node: makeHeader(pageTitle, 'Heading1') });
          continue;
        }
        node = makeParagraph(k);
      } else if (t === 'PdfTextFieldDTO') node = makeText(k);
      else if (t === 'PdfRadioGroupFieldDTO' || t === 'PdfMultipleCheckboxesFieldDTO') node = null; // built below once the below-lists are complete
      else if (t === 'PdfEmbeddedFileFieldDTO') node = makeEmbeddedPdf(k);
      else if (t === 'PdfRepeatableFieldDTO') node = makeRepeatable(k);
      else if (t === 'PdfSignatureFieldDTO') node = makeSignature(k);
      else {
        warnings.push(t === 'PdfPageFieldDTO' ? `UNSUPPORTED: page ${k.name} sits inside another page and was skipped; put pages in a group of pages instead` : `UNSUPPORTED: ${t} ${k.name} was skipped`);
        continue;
      }
      built.push({ field: k, node });
    }

    // second pass: radios are built once to place them, then rebuilt with the below-lists complete
    const belowByOption = new Map<string, string[]>();
    for (const item of built) {
      if ('field' in item && OPTION_GROUPS.includes(item.field.__typename__)) item.node = makeGroup(item.field, belowByOption);
    }
    for (const item of built) {
      if ('field' in item) {
        const po = parentOf.get(item.field.name);
        if (po) belowByOption.set(po, [...(belowByOption.get(po) ?? []), item.field.name]);
      }
    }
    const out: Node[] = [];
    for (const item of built) {
      if ('field' in item) {
        if (OPTION_GROUPS.includes(item.field.__typename__)) {
          delete nodesUi[item.field.name];
          item.node = makeGroup(item.field, belowByOption);
        }
        if (item.node) out.push(item.node);
      } else out.push(item.node);
    }
    return out;
  };

  /** Address block rule: country first, then a US field and a non-US field for state and for postal code.
   *  Both variants map to the same PDF field; rules choose which one shows. */
  const splitAddress = (children: Node[], groupName: string): Node[] => {
    const by: Record<string, Node> = {};
    for (const n of children) {
      const ui = nodesUi[n.name];
      const text = plain(String(ui['ui:formattedText'] ?? '')).replace(/[ *]+$/, '').trim().toLowerCase();
      if (ui['ui:widget'] === 'Country' && text === 'country') by.country = n;
      else if (/^address\b/.test(text)) by.street = n;
      else if (/^city\b/.test(text)) by.city = n;
      else if (/^(state\b|province\b)/.test(text)) by.state = n;
      else if (/^(postal\s*code|post\s*code|zip)/.test(text)) by.post = n;
    }
    if (!['country', 'street', 'city', 'state', 'post'].every((k) => k in by)) return children;
    const req = 'ui:required' in nodesUi[by.street.name];
    const usVariant = (src: Node, widget: string, text: string, extra: Json, format?: string): Node => {
      const name = `${src.name}_us`;
      const h = `<p>${text}</p>`;
      const ui: Json = {
        'ui:widget': widget, 'ui:formattedText': req ? withStar(h) : h, 'ui:pdfMapping': [...(nodesUi[src.name]['ui:pdfMapping'] as string[])],
        'ui:enabledComment': true, 'ui:marginBottom': '12px', ...extra,
      };
      if (req) ui['ui:required'] = REQUIRED_MSG;
      addUi(name, ui);
      return { name, type: 'string', title: text, ...(format ? { format } : {}) };
    };
    const st = usVariant(by.state, 'State', 'U.S. States/Territories', {});
    const zp = usVariant(by.post, 'CustomFormat', 'ZIP Code', { 'ui:customFormat': 'USZIP' }, 'USZIP');
    const used = new Set(Object.values(by));
    // The layout of the Anduin address block: Country at half width, then rows of two (70% / 30%): street and city,
    // the US state and ZIP, the non-US state and postal code.
    const row = (suffix: string, title: string, fields: Node[]): Node => {
      const name = `${groupName}_${suffix}`;
      addUi(name, { 'ui:widget': 'Group', 'ui:dynamicLayout': { sectionsWidth: [70, 30], gutter: 8 }, 'ui:indentation': '16px', 'ui:marginBottom': '12px', 'ui:enabledComment': true });
      fields.forEach((f) => Object.assign(nodesUi[f.name], { 'ui:marginBottom': '0px' }));
      return { name, type: 'object', title, properties: fields };
    };
    Object.assign(nodesUi[by.country.name], { 'ui:indentation': '16px', 'ui:width': '50%' });
    return [by.country, row('row_street_city', 'Street and city', [by.street, by.city]), row('row_us_state_zip', 'US state and ZIP code', [st, zp]), row('row_state_postal', 'State/Province and postal code', [by.state, by.post]), ...children.filter((n) => !used.has(n))];
  };

  const buildGroup = (g: AnnObj, depth: number): Node[] => {
    const children = splitAddress(buildChildren(g, depth + 1), g.name);
    const lab = labelHtml(g);
    const ui: Json = { 'ui:widget': 'Group', 'ui:marginBottom': depth === 1 ? '20px' : '12px', 'ui:enabledComment': true };
    if (lab) ui['ui:formattedText'] = boldFirstParagraph(lab); // a group's heading is its own formattedText, not a Header
    addUi(g.name, ui);
    const title = lab ? plain(lab).slice(0, 120) : g.name;
    return [{ name: g.name, type: 'object', title: title || g.name, properties: children }];
  };

  // ------------------------------ interleaved siblings ------------------------------
  // A group that wraps only part of a run of questions (the heading and question c, while questions a and b sit beside
  // it) would put them out of order. A sibling that lies between a group's first and last object on the PDF belongs
  // inside it, so it is moved in; the PDF order then holds.
  const lastPos = (o: AnnObj): Pos => {
    const ps: Pos[] = [];
    const own = ownPos(o);
    if (own) ps.push(own);
    realChildren(o).forEach((c) => ps.push(lastPos(c)));
    return ps.reduce((m, p) => (cmp(p, m) > 0 ? p : m), ps[0] ?? [0, 0, 0]);
  };
  const repairInterleaving = (): void => {
    for (const container of all.filter((o) => ['PdfPageFieldDTO', 'PdfGroupFieldDTO'].includes(o.__typename__))) {
      for (let pass = 0; pass < 5; pass += 1) {
        const kids = realChildren(container);
        let moved = false;
        for (const g of kids.filter((k) => k.__typename__ === 'PdfGroupFieldDTO')) {
          const lo = subtreePos(g);
          const hi = lastPos(g);
          const inside = kids.filter((s) => s !== g && s.__typename__ !== 'PdfPageFieldDTO' && cmp(lo, atomPos(s)) < 0 && cmp(atomPos(s), hi) < 0);
          if (inside.length === 0) continue;
          container.children = (container.children ?? []).filter((id) => !inside.some((s) => s.id === id));
          g.children = [...(g.children ?? []), ...inside.map((s) => s.id)];
          warnings.push(`REORDERED: ${inside.map((s) => s.name).join(', ')} sit between the heading and the content of the group ${g.name} in the PDF, so they were moved into it to keep the PDF order`);
          moved = true;
        }
        if (!moved) break;
      }
    }
  };
  repairInterleaving();

  // ------------------------------ top level ------------------------------
  const referenced = new Set(all.flatMap((o) => o.children ?? []));
  const roots = all
    .filter((o) => o.__typename__ !== 'PdfTextBlockDTO' && o.__typename__ !== 'PdfTextLabelDTO' && !referenced.has(o.id))
    .sort(byPos(atomPos));

  /** A page: its heading (the fund name as subtitle) then its content. */
  const buildPage = (p: AnnObj, synthetic?: string): Node => {
    pageTitle = null;
    const content = buildChildren(p, 1);
    const lab = labelHtml(p);
    const heading = pageTitle as string | null; // set when the page has its own title paragraph
    let title = heading ?? (lab ? plain(lab) : '');
    if (heading === null && !synthetic) {
      if (lab) {
        title = cleanTitle(title);
        content.unshift(makeHeader(title, 'Heading1')); // the TOC name matches the page heading
      } else {
        // No highlighted title: the page's own first paragraph if it reads like a heading, else the heading printed on the PDF
        // above the page's first object, else the alias as words. Never the raw alias in the TOC.
        const first = content[0];
        const firstText = first && nodesUi[first.name]?.['ui:widget'] === 'Paragraph' ? plain(String(nodesUi[first.name]['ui:formattedText'] ?? '')) : '';
        const start = subtreePos(p);
        // a page that holds only an embedded file is named after the document: "Form of Subscription Agreement - Privacy Notice.pdf" is "Privacy Notice"
        const only = realChildren(p).length === 1 ? realChildren(p)[0] : null;
        const embeddedName = only?.__typename__ === 'PdfEmbeddedFileFieldDTO' && only.fileName ? cleanTitle(only.fileName.replace(/\.pdf$/i, '').split(/\s+[-–—]\s+/).pop() ?? '') : '';
        let source: string;
        if (firstText && firstText.length <= 100 && (HEADING_NUMBERED.test(firstText.replace(/:\s*$/, '')) || HEADING_CAPS.test(firstText.replace(/:\s*$/, '')))) {
          title = cleanTitle(firstText);
          delete nodesUi[first.name];
          content.shift();
          source = 'its first paragraph';
        } else if (embeddedName) {
          title = embeddedName;
          source = 'the name of its embedded file';
        } else {
          const printed = start[0] < 99 ? headingAbove(options.pdfPages, start[0], start[1] + 0.02) : null;
          title = cleanTitle(printed ?? humanizeAlias(p.name));
          source = printed ? 'the PDF' : 'its alias';
        }
        content.unshift(makeHeader(title, 'Heading1'));
        warnings.push(`PAGE HEADING GUESSED: page ${p.name} has no highlighted title; its heading "${title}" came from ${source} (highlight the title in the annotation to set it)`);
      }
    }
    title = synthetic ?? (cleanTitle(title) || p.name);
    addUi(p.name, { 'ui:widget': 'Page', 'ui:marginBottom': '12px', 'ui:pdfMapping': [], 'ui:signature': [] });
    return { name: p.name, type: 'object', title, properties: content };
  };

  const hasPageBelow = (o: AnnObj): boolean => realChildren(o).some((c) => c.__typename__ === 'PdfPageFieldDTO' || hasPageBelow(c));

  /** Objects that sit outside every page of the annotation; they are parked in the hidden page, not given a page of their own. */
  const strays: AnnObj[] = [];
  /**
   * One level of the form's page structure: pages, and groups of pages (sections). Anything else at this level
   * is outside every page; it goes, in reading order, into the hidden page and is flagged.
   */
  const buildPageLevel = (items: AnnObj[]): Node[] => {
    const out: Node[] = [];
    let loose: AnnObj[] = [];
    const flushLoose = (): void => {
      if (loose.length === 0) return;
      const pagesSeen = loose.map((o) => atomPos(o)[0]).filter((n) => n < 99);
      const span = pagesSeen.length > 0 ? ` (PDF pages ${Math.min(...pagesSeen) + 1}–${Math.max(...pagesSeen) + 1})` : '';
      loose.forEach((o) => markOptionalGroups(o));
      warnings.push(`UNASSIGNED: ${loose.length} objects${span} are not inside any page in the annotation; they were moved into the hidden page (group them under a page in the annotation to show them)`);
      strays.push(...loose);
      loose = [];
    };
    for (const r of [...items].sort(byPos(atomPos))) {
      if (r.__typename__ === 'PdfPageFieldDTO') {
        flushLoose();
        markOptionalGroups(r);
        out.push(buildPage(r));
      } else if (r.__typename__ === 'PdfGroupFieldDTO' && hasPageBelow(r)) {
        // A group of pages: a section of the table of contents. Its heading is its TOC name, not text on a page.
        flushLoose();
        const lab = labelHtml(r);
        if (lab === null) warnings.push(`LABEL MISSING: section ${r.name} (a group of pages) has no highlighted text; its name is its alias`);
        addUi(r.name, { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true });
        out.push({ name: r.name, type: 'object', title: cleanTitle(lab ? plain(lab).slice(0, 120) : '') || r.name, properties: buildPageLevel(realChildren(r)) });
      } else loose.push(r);
    }
    flushLoose();
    return out;
  };
  const pageNodes = buildPageLevel(roots);
  if (strays.length > 0) {
    const synth: AnnObj = { id: 'synthetic:hidden', __typename__: 'PdfPageFieldDTO', name: 'hidden', children: strays.map((o) => o.id) };
    objs.set(synth.id, synth);
    const hidden = buildPage(synth, 'Hidden');
    Object.assign(nodesUi.hidden, { 'ui:invisible': true });
    pageNodes.unshift(hidden);
  }

  // top-level File node (the PDF template), as in real exports
  const fileName = data.fileName ?? 'form.pdf';
  addUi('file0', { 'ui:widget': 'File', 'ui:fileName': fileName });
  const fileNode: Node = { name: 'file0', type: 'null', title: fileName };

  const schema = { type: 'object', properties: [fileNode, ...pageNodes] };
  const form: Json = {
    namespaceFormSchemaMap: { main: { schema, uiSchema: nodesUi } },
    rules: [], defaultNamespace: 'main', libs: [], triggerRuleByProperty: false, gaiaLogicVersion: 200, cueFieldSchemas: [],
  };

  // ------------------------------ self-check ------------------------------
  const allNodes = new Set<string>();
  const collect = (ns: Node[]): void =>
    ns.forEach((n) => {
      if (allNodes.has(n.name)) throw new AnnotationError(`Duplicate node "${n.name}" in the generated form.`);
      allNodes.add(n.name);
      collect(n.properties ?? []);
    });
  collect(schema.properties);
  const FIELD_TYPES = ['PdfTextFieldDTO', 'PdfRadioFieldDTO', 'PdfCheckboxFieldDTO', 'PdfSignatureFieldDTO', 'PdfEmbeddedFileFieldDTO'];
  const annFields = new Set(all.filter((o) => FIELD_TYPES.includes(o.__typename__)).map((o) => o.name));
  const mapped = new Set<string>();
  const below: string[] = [];
  for (const v of Object.values(nodesUi)) {
    ((v['ui:pdfMapping'] as string[] | undefined) ?? []).forEach((m) => mapped.add(m));
    const opts = ((v['ui:multipleOption'] as { options?: [string, Json][] } | undefined)?.options ?? []);
    opts.forEach((o) => {
      ((o[1].pdfMappings as string[] | undefined) ?? []).forEach((m) => mapped.add(m));
      below.push(...((o[1].fieldsBelow as string[] | undefined) ?? []));
    });
    ((v['ui:signature'] as { mapping: string }[] | undefined) ?? []).forEach((s) => mapped.add(s.mapping));
  }
  if (below.length !== new Set(below).size) throw new AnnotationError('A field below belongs to two options.');
  const radioGroups = new Set(all.filter((o) => ['PdfRadioGroupFieldDTO', 'PdfMultipleCheckboxesFieldDTO'].includes(o.__typename__)).map((o) => o.name));

  const anchors: GeneratedForm['anchors'] = {};
  all.forEach((o) => {
    if (['PdfTextFieldDTO', 'PdfRadioFieldDTO', 'PdfCheckboxFieldDTO', 'PdfSignatureFieldDTO'].includes(o.__typename__) && o.area && o.area.right !== undefined && o.area.bottom !== undefined) {
      anchors[o.name] = { page: o.pageIndex ?? 0, left: o.area.left, top: o.area.top, right: o.area.right, bottom: o.area.bottom };
    }
  });

  return {
    form,
    anchors,
    warnings: [...new Set(warnings)], // radios are built twice; report each once
    stats: {
      nodes: allNodes.size,
      fieldsBelow: below.length,
      annotatedFields: annFields.size,
      unmappedFields: [...annFields].filter((n) => !mapped.has(n)).sort(),
      unknownMappings: [...mapped].filter((n) => !annFields.has(n) && !radioGroups.has(n)).sort(),
    },
  };
}
