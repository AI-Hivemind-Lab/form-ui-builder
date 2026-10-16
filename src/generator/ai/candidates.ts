import { findParentName } from '../../model/addField';
import { aliasesOf, anchorsFor, primaryBox, primaryBoxOfName } from '../../model/pdfAnchors';
import type { Anchors } from '../../model/pdfStore';
import { findNode, getWidget } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../../model/types';
import { isInvisible } from '../../model/schemaWalk';
import { allWarnings } from '../../model/warnings';
import { widgetKind } from '../../model/widgetCatalog';
import type { PageText } from '../pdfText';
import { isConfirmationWidget } from '../standards/embeddedConfirmation';
import { isBooleanList } from '../standards/optionLayouts';
import { firstAlias, inNumberedQuestion, isNumbered, labelOf, nodesOf, plainText, walk } from '../standards/util';

/** Facts about the form, in the shape the AI is shown. Pages are 1-based, as printed. */
export interface OptionGroupCandidate {
  alias: string;
  label: string;
  numbered: boolean;
  page: number | null;
  parentLabel: string;
  /** True for the Form PF "For Reporting Purposes" list, which is never the investor type question. */
  formPf: boolean;
  /** True for a list that is only for entities, or only a tax category ("Entity: to assist the General Partner, check the category ..."): never the investor type question. */
  entityOnly: boolean;
  options: { alias: string; label: string }[];
}

export interface SignatureCandidate {
  alias: string;
  page: number | null;
  top: number | null;
  currentSigner: string | null;
  mapped: { alias: string; type: string }[];
}

export interface FieldCandidate {
  alias: string;
  label: string;
  page: number | null;
  top: number | null;
  parentLabel: string;
}

const pageOf = (doc: FormDoc, anchors: Anchors, name: string): number | null => {
  const a = primaryBoxOfName(doc, name, anchors);
  return a ? a.page + 1 : null;
};
const topOf = (doc: FormDoc, anchors: Anchors, name: string): number | null => {
  const a = primaryBoxOfName(doc, name, anchors);
  return a ? Math.round(a.top * 1000) / 1000 : null;
};
const parentLabelOf = (doc: FormDoc, name: string): string => {
  for (let cur = findParentName(doc, name); cur; cur = findParentName(doc, cur)) {
    const l = labelOf(doc, cur);
    if (l) return l.slice(0, 90);
  }
  return '';
};

/** A list that says it is for entities or for a tax category is not the list of investor types. */
export const ENTITY_ONLY = /^\s*entity\s*:|\bfor entities\b|tax filing|tax categor|tax classification/i;

export function optionGroupCandidates(doc: FormDoc, anchors: Anchors): OptionGroupCandidate[] {
  const out: OptionGroupCandidate[] = [];
  walk(doc.schema.properties, (n) => {
    const w = getWidget(doc, n);
    if (w !== 'Radio' && w !== 'MultipleCheckbox') return;
    const raw = (doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(raw) || raw.length < 4) return;
    const options = raw.flatMap((o) => (Array.isArray(o) && typeof o[0] === 'string' ? [{ alias: o[0], label: plainText((o[1] as { formattedText?: unknown } | null)?.formattedText) }] : []));
    const label = labelOf(doc, n.name);
    const parentLabel = parentLabelOf(doc, n.name);
    const a = primaryBox(doc, n, anchors);
    out.push({
      alias: n.name, label, numbered: isNumbered(label) || inNumberedQuestion(doc, n.name), page: a ? a.page + 1 : null, parentLabel,
      formPf: /form\s*pf|reporting purposes/i.test(`${label} ${parentLabel}`), entityOnly: ENTITY_ONLY.test(label) || ENTITY_ONLY.test(parentLabel), options,
    });
  });
  return out;
}

export function signatureCandidates(doc: FormDoc, anchors: Anchors): SignatureCandidate[] {
  return nodesOf(doc, 'Signature').map((n) => {
    const ui = doc.uiSchema[n.name] ?? {};
    const mapped = Array.isArray(ui['ui:signature']) ? (ui['ui:signature'] as { mapping: string; signatureType: string }[]).map((m) => ({ alias: m.mapping, type: m.signatureType })) : [];
    const signer = ui['ui:signatureSigner'];
    return { alias: n.name, page: pageOf(doc, anchors, n.name), top: topOf(doc, anchors, n.name), currentSigner: typeof signer === 'string' && signer.trim() ? signer : null, mapped };
  });
}

const isInput = (doc: FormDoc, n: SchemaNode): boolean => {
  const w = getWidget(doc, n);
  return widgetKind(w) === 'input' && !['Radio', 'MultipleCheckbox', 'Dropdown', 'MultipleSuggest'].includes(w);
};

const asField = (doc: FormDoc, anchors: Anchors, n: SchemaNode): FieldCandidate => ({
  alias: n.name, label: labelOf(doc, n.name).slice(0, 120), page: pageOf(doc, anchors, n.name), top: topOf(doc, anchors, n.name), parentLabel: parentLabelOf(doc, n.name),
});

/** Telephone, mobile and email boxes are required whoever the contact is. */
export const NEVER_OPTIONAL = /\b(tele?phone|phone|mobile|cell|e-?mail)\b|^(tel|telephone|phone|email)_/i;
const AMOUNT_FIELD = /commitment|amountof|\bamount\b/i;

/** Text fields that sit on the same PDF page just above a signature: what might be signed with it. */
export function fieldsNearSignature(doc: FormDoc, anchors: Anchors, sig: SignatureCandidate, others: SignatureCandidate[]): FieldCandidate[] {
  if (sig.page === null || sig.top === null) return [];
  const above = others.filter((o) => o.page === sig.page && o.top !== null && o.top < (sig.top as number)).map((o) => o.top as number);
  const floor = above.length > 0 ? Math.max(...above) : (sig.top as number) - 0.4;
  const out: FieldCandidate[] = [];
  walk(doc.schema.properties, (n) => {
    if (!isInput(doc, n)) return;
    const f = asField(doc, anchors, n);
    // A commitment amount on an investor's page is collected by the form already: it is never signed with the signature
    // (only the General Partner's accepted amount is, and a standard handles that one).
    if (AMOUNT_FIELD.test(`${f.alias} ${f.label}`)) return;
    if (f.page === sig.page && f.top !== null && f.top <= (sig.top as number) + 0.02 && f.top > floor) out.push(f);
  });
  return out.sort((a, b) => (a.top ?? 0) - (b.top ?? 0)).slice(0, 14);
}

/** Single text boxes that read like an address. */
export function addressCandidates(doc: FormDoc, anchors: Anchors): FieldCandidate[] {
  const out: FieldCandidate[] = [];
  walk(doc.schema.properties, (n, parent) => {
    const w = getWidget(doc, n);
    if (w !== 'TextBox' && w !== 'TextArea') return;
    const label = labelOf(doc, n.name);
    if (!/address/i.test(label) || /e-?mail|\bip\b|web/i.test(label)) return;
    // already a five-element block: a country field beside it, or beside the row it sits in
    const hasCountry = (list: SchemaNode[] | undefined): boolean => (list ?? []).some((c) => getWidget(doc, c) === 'Country');
    const grand = parent ? findParentName(doc, parent.name) : null;
    const grandNode = grand ? findNode(doc.schema.properties, grand) : undefined;
    if (hasCountry(parent?.properties) || hasCountry(grandNode?.properties)) return;
    out.push(asField(doc, anchors, n));
  });
  return out;
}

/** A field in the list for the optional-by-nature suggestions, with what the AI needs to judge it. */
export interface RequiredFieldCandidate extends FieldCandidate {
  /** The PDF's own lines just above the field, so the AI sees the question and answers it belongs to. */
  pdfAbove: string[];
}

/**
 * When a field sits right under a Yes / No question (with no question of its own in between), what it asks only applies when that
 * answer is Yes: it opens then, so it is required by default. Returns the question's label, or null.
 */
export function followsYesNoQuestion(doc: FormDoc, anchors: Anchors, node: SchemaNode): string | null {
  const parentName = findParentName(doc, node.name);
  const siblings = parentName ? findNode(doc.schema.properties, parentName)?.properties ?? [] : doc.schema.properties;
  const at = siblings.findIndex((s) => s.name === node.name);
  const mine = primaryBox(doc, node, anchors);
  for (let i = at - 1, steps = 0; i >= 0 && steps < 4; i -= 1, steps += 1) {
    const w = getWidget(doc, siblings[i]);
    if (w === 'Paragraph') continue;
    if (w !== 'Radio' && w !== 'MultipleCheckbox') {
      if (widgetKind(w) === 'input') continue; // another follow-up of the same question
      return null;
    }
    const options = ((doc.uiSchema[siblings[i].name]?.['ui:multipleOption'] as { options?: unknown[] } | undefined)?.options ?? []) as [string, { formattedText?: unknown; pdfMappings?: string[] }][];
    if (!isBooleanList(options.map((o) => plainText(o[1]?.formattedText)))) return null;
    // close below the answers on the PDF page, when the page is known
    const last = anchorsFor(doc, siblings[i], anchors).sort((a, b) => b.bottom - a.bottom)[0];
    if (mine && last && (mine.page !== last.page || mine.top - last.bottom > 0.2)) return null;
    return labelOf(doc, siblings[i].name);
  }
  return null;
}

/** Required text boxes, for the optional-by-nature suggestions. Follow-ups of a Yes / No question are never offered: they stay required. */
export function requiredFieldCandidates(doc: FormDoc, anchors: Anchors, pages?: PageText[] | null): RequiredFieldCandidate[] {
  const out: RequiredFieldCandidate[] = [];
  walk(doc.schema.properties, (n) => {
    const w = getWidget(doc, n);
    if ((w !== 'TextBox' && w !== 'TextArea') || !doc.uiSchema[n.name]?.['ui:required']) return;
    const label = labelOf(doc, n.name);
    // Contact details are never optional, not even a secondary contact's: the AI is not even shown them.
    if (!label || NEVER_OPTIONAL.test(`${label} ${n.name}`) || followsYesNoQuestion(doc, anchors, n)) return;
    const f = asField(doc, anchors, n);
    const lines = f.page !== null && f.top !== null ? (pages ?? []).find((p) => p.page === (f.page as number) - 1)?.lines ?? [] : [];
    const above = f.top === null ? [] : lines.filter((l) => l.top < (f.top as number) && (f.top as number) - l.top < 0.12).slice(-4).map((l) => l.text.slice(0, 160));
    out.push({ ...f, pdfAbove: above });
  });
  return out;
}

/** Text boxes that may repeat information asked elsewhere: names and commitments, and boxes with no label (prefills). */
export function duplicateCandidates(doc: FormDoc, anchors: Anchors): FieldCandidate[] {
  const out: FieldCandidate[] = [];
  // The name blocks (mergedname, entityname, ...) are mutually exclusive on purpose: they are never "the same information asked twice".
  const nameBlocks = new Set<string>();
  const blocks = findNode(doc.schema.properties, 'name_blocks');
  if (blocks) walk([blocks], (n) => nameBlocks.add(n.name));
  walk(doc.schema.properties, (n) => {
    if (nameBlocks.has(n.name)) return;
    const w = getWidget(doc, n);
    if (w !== 'TextBox' || !firstAlias(doc, n.name)) return;
    const label = labelOf(doc, n.name);
    if (label === '' || /subscriber name|name of (the )?(subscriber|investor)|investor name|full legal name|capital commitment|\bcommitment\b/i.test(label)) out.push(asField(doc, anchors, n));
  });
  return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.top ?? 0) - (b.top ?? 0)).slice(0, 60);
}

export interface MixedPage {
  page: string;
  title: string;
  fields: { alias: string; label: string; widget: string }[];
}

/** Pages that show a full-page PDF and also hold fillable fields. */
export function mixedPageCandidates(doc: FormDoc): MixedPage[] {
  const out: MixedPage[] = [];
  walk(doc.schema.properties, (page) => {
    if (getWidget(doc, page) !== 'Page') return;
    const kids = page.properties ?? [];
    if (!kids.some((c) => getWidget(doc, c) === 'Pdf' && doc.uiSchema[c.name]?.['ui:viewInModal'] !== true)) return;
    const fields: MixedPage['fields'] = [];
    walk(kids, (n) => {
      const w = getWidget(doc, n);
      // (the confirmation checkbox under the PDF stays with its PDF)
      if (widgetKind(w) === 'input' && !doc.uiSchema[n.name]?.['ui:invisible'] && !isConfirmationWidget(doc, n)) fields.push({ alias: n.name, label: labelOf(doc, n.name).slice(0, 120), widget: w });
    });
    if (fields.length > 0) out.push({ page: page.name, title: page.title, fields: fields.slice(0, 30) });
  });
  return out;
}

/** Visible pages a field could move to. */
export function targetPageCandidates(doc: FormDoc): { page: string; title: string }[] {
  const out: { page: string; title: string }[] = [];
  walk(doc.schema.properties, (n) => {
    if (getWidget(doc, n) !== 'Page' || doc.uiSchema[n.name]?.['ui:invisible']) return;
    if ((n.properties ?? []).some((c) => getWidget(doc, c) === 'Pdf' && doc.uiSchema[c.name]?.['ui:viewInModal'] !== true)) return;
    out.push({ page: n.name, title: n.title });
  });
  return out.slice(0, 40);
}

/** The pages (1-based) of the boxes where the subscriber's name is asked: the lead-in that lists the investor types sits there. */
export function nameQuestionPages(doc: FormDoc, anchors: Anchors): number[] {
  const pages: number[] = [];
  walk(doc.schema.properties, (n) => {
    if (getWidget(doc, n) !== 'TextBox') return;
    const alias = firstAlias(doc, n.name) ?? '';
    if (/^asa_fullname_investorname/i.test(alias) || /name of (the )?(investor|subscriber)|full (legal )?name of|(investor|subscriber)['’]?s? name/i.test(labelOf(doc, n.name))) {
      const p = pageOf(doc, anchors, n.name);
      if (p !== null) pages.push(p);
    }
  });
  return [...new Set(pages)].slice(0, 3);
}

/** Printed text near a field that has no label, and where it sits relative to the box. */
export interface PrintedText {
  text: string;
  where: 'left' | 'above';
}

export interface LabelCandidate {
  /** The widget with no label. */
  alias: string;
  /** 1-based page, as printed. */
  page: number;
  near: PrintedText[];
}

const cleanPrinted = (t: string): string => t.replace(/^[_\s.]+/, '').replace(/[_\s.]{2,}$/, '').replace(/\s+/g, ' ').trim();
const LABELISH = (t: string): boolean => /[A-Za-z]{2}/.test(t) && t.length <= 140;

/**
 * Fields the editor flags "Missing label", each with the text the PDF prints right beside (to the left) or just above its box.
 * `auto` has exactly one such text (nothing to choose), `ask` has several (the AI picks), `none` has no printed text nearby.
 * Fields on a hidden page, or inside something hidden, are not looked at.
 */
export function labelCandidates(doc: FormDoc, anchors: Anchors, pages: PageText[]): { auto: LabelCandidate[]; ask: LabelCandidate[]; none: string[] } {
  const auto: LabelCandidate[] = [];
  const ask: LabelCandidate[] = [];
  const none: string[] = [];
  for (const w of allWarnings(doc).filter((x) => x.messages.includes('Missing label'))) {
    let hidden = false;
    for (let cur: string | null | undefined = w.name; cur; cur = findParentName(doc, cur)) if (isInvisible(doc, cur)) hidden = true;
    const alias = firstAlias(doc, w.name);
    const node = findNode(doc.schema.properties, w.name);
    // (a choice is read by groupLabelCandidates: its question is above its boxes, not beside one)
    const a = node && !['Radio', 'MultipleCheckbox'].includes(getWidget(doc, node)) ? primaryBox(doc, node, anchors) : null;
    if (hidden || !alias || !a) continue;
    const lines = pages.find((p) => p.page === a.page)?.lines ?? [];
    // A line's top is its baseline, which sits at the bottom edge of the box it labels.
    const near: (PrintedText & { distance: number })[] = [];
    for (const line of lines) {
      const segments = line.segments ?? [{ left: 0, right: 1, text: line.text }];
      for (const seg of segments) {
        const text = cleanPrinted(seg.text);
        if (!LABELISH(text)) continue;
        // (a tall box, a text area, is labelled at its first line)
        const sameRow = line.top >= a.top - 0.004 && line.top <= Math.min(a.bottom, a.top + 0.03) + 0.008;
        if (sameRow && seg.right <= a.left + 0.012) near.push({ text, where: 'left', distance: a.left - seg.right });
        else if (!sameRow && line.top < a.top - 0.004 && a.top - line.top <= 0.045 && seg.right >= a.left - 0.01 && seg.left <= a.right) near.push({ text, where: 'above', distance: a.top - line.top });
      }
    }
    // The label is the nearest text to the left on the box's row (the texts further left belong to other columns); a label right
    // beside the box wins over one above it. Only when nothing is close on the row are the texts above offered.
    const lefts = near.filter((n) => n.where === 'left').sort((x, y) => x.distance - y.distance);
    const aboves = near.filter((n) => n.where === 'above').sort((x, y) => x.distance - y.distance);
    const chosen = lefts.length > 0 && lefts[0].distance <= 0.08 ? [lefts[0]] : [...lefts.slice(0, 1), ...aboves.slice(0, 2)];
    const seen = new Set<string>();
    const unique = chosen.filter((n) => (seen.has(n.text) ? false : (seen.add(n.text), true)));
    const cand: LabelCandidate = { alias: w.name, page: a.page + 1, near: unique.map(({ text, where }) => ({ text, where })) };
    if (unique.length === 0) none.push(w.name);
    else if (unique.length === 1) auto.push(cand);
    else ask.push(cand);
  }
  return { auto, ask, none };
}

export { pageOf };

// ------------------------------ questions printed above choices ------------------------------
export interface GroupLabelCandidate {
  alias: string;
  /** 1-based, as printed. */
  page: number;
  /** The printed lines above and beside the choices, nearest last. The question is some neighbouring lines of them. */
  lines: string[];
}

/**
 * A choice (Yes/No, checkboxes) whose question the annotation never highlighted: the question is printed above or to the left of its
 * boxes. The candidate is the printed lines in the window from the object above it down to its first row of boxes; the model picks the
 * run of lines that is the question, by number.
 */
export function groupLabelCandidates(doc: FormDoc, anchors: Anchors, pages: PageText[]): GroupLabelCandidate[] {
  const out: GroupLabelCandidate[] = [];
  const everyBox = Object.entries(anchors);
  for (const w of allWarnings(doc).filter((x) => x.messages.includes('Missing label'))) {
    const node = findNode(doc.schema.properties, w.name);
    if (!node || !['Radio', 'MultipleCheckbox'].includes(getWidget(doc, node))) continue;
    let hidden = false;
    for (let cur: string | null | undefined = w.name; cur; cur = findParentName(doc, cur)) if (isInvisible(doc, cur)) hidden = true;
    const own = aliasesOf(doc, node);
    const boxes = anchorsFor(doc, node, anchors);
    if (hidden || boxes.length === 0) continue;
    const page = boxes[0].page;
    const top = Math.min(...boxes.filter((b) => b.page === page).map((b) => b.top));
    const left = Math.min(...boxes.filter((b) => b.page === page).map((b) => b.left));
    // the object above: nothing printed between it and these boxes is another widget's text
    const above = everyBox.filter(([alias, a]) => !own.includes(alias) && a.page === page && a.bottom < top - 0.001).map(([, a]) => a.bottom);
    const from = Math.max(top - 0.16, above.length > 0 ? Math.max(...above) + 0.001 : 0);
    const text = pages.find((p) => p.page === page)?.lines ?? [];
    const lines = text
      .filter((l) => l.top >= from && l.top <= top + 0.012)
      .map((l) => (l.segments ?? [{ left: 0, right: 1, text: l.text }]).filter((s) => l.top < top - 0.004 || s.right <= left + 0.01).map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter((t) => /[A-Za-z]{2}/.test(t) && !/^(yes|no)$/i.test(t));
    if (lines.length > 0) out.push({ alias: w.name, page: page + 1, lines: lines.slice(-9) });
  }
  return out;
}

// ------------------------------ supporting documents ------------------------------
export interface SupportingDocCandidate {
  alias: string;
  /** The page of the form the paragraph is on. */
  pageTitle: string;
  /** The paragraph right above, usually the heading ("Natural Persons:"). */
  heading: string;
  /** The paragraph; a bullet list keeps its levels (two spaces per level). */
  text: string;
}

/** The text of a paragraph, a bullet list as indented lines. */
export function bulletText(html: unknown): string {
  if (typeof html !== 'string') return '';
  const items = [...html.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)];
  if (items.length === 0) return plainText(html);
  return items.map((m) => `${'  '.repeat(Number(/ql-indent-(\d)/.exec(m[1])?.[1] ?? 0))}- ${plainText(m[2])}`).join('\n');
}

const DOC_WORDS = /\b(copy|copies|certificate|certified|passport|driver|licen[sc]e|identification|resolution|agreement|statement|letter|form\s+w-?\d|IRS|documents?|documentation|proof|evidence|verification)\b/i;
const SUBMIT_WORDS = /\b(provide|submit|deliver|furnish|upload|attach|supply|enclose)\b/i;

/**
 * Paragraphs that may ask the investor to hand something in: a bullet list that names documents, or a sentence that says to provide /
 * submit / attach one. The AI decides which really do; this only keeps it from reading the whole form.
 */
export function supportingDocCandidates(doc: FormDoc): SupportingDocCandidate[] {
  const out: SupportingDocCandidate[] = [];
  const visit = (list: SchemaNode[], page: SchemaNode | null): void =>
    list.forEach((n, i) => {
      const widget = getWidget(doc, n);
      const here = widget === 'Page' ? n : page;
      if (widget === 'Paragraph' && !isInvisible(doc, n.name) && !(here && isInvisible(doc, here.name))) {
        const html = doc.uiSchema[n.name]?.['ui:formattedText'];
        const plain = plainText(html);
        const hasList = typeof html === 'string' && /<li\b/i.test(html);
        const next = list[i + 1];
        if (plain.length >= 25 && DOC_WORDS.test(plain) && (hasList || SUBMIT_WORDS.test(plain)) && !(next && getWidget(doc, next) === 'FileGroup')) {
          const before = list[i - 1];
          out.push({ alias: n.name, pageTitle: here?.title ?? '', heading: before && getWidget(doc, before) === 'Paragraph' ? plainText(doc.uiSchema[before.name]?.['ui:formattedText']).slice(0, 200) : '', text: bulletText(html).slice(0, 3000) });
        }
      }
      if (n.properties) visit(n.properties, here);
    });
  visit(doc.schema.properties, null);
  return out;
}
