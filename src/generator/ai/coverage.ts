import type { Anchors } from '../../model/pdfStore';
import type { FormDoc, SchemaNode } from '../../model/types';
import { coverage, placeOf, type Block } from '../coverage';
import type { PageText } from '../pdfText';
import { confirmationFor } from '../standards/embeddedConfirmation';
import { documentAcronyms, titleCase } from '../standards/titleCase';
import { pdfHeadings } from '../structure';
import { getWidget } from '../../model/schemaWalk';
import { askValidated, type Ask } from './client';
import { composeFileName, embeddedPdfFacts, pageToPrecede } from './embeddedPdfs';
import { COVERAGE_SYSTEM } from './prompts';
import type { Confidence, Decision } from './types';
import { AiFormatError, arr, confidenceOf, obj, oneOf, str, strOrNull } from './validate';
import { labelOf, walk } from '../standards/util';

interface RawCoverage {
  blocks: { id: string; action: 'add' | 'ignore'; reason: string; confidence: Confidence }[];
  pages: { id: string; action: 'embed' | 'ignore'; headingId: string | null; name: string | null; reason: string; confidence: Confidence }[];
}

/** What the model may say: only the blocks and page runs it was shown, and a name that is words. */
export function validateCoverage(raw: unknown, blocks: Set<string>, pages: Set<string>, headings: Set<string>): RawCoverage {
  const o = obj(raw, 'answer');
  return {
    blocks: arr(o.blocks ?? [], 'blocks').flatMap((x, i) => {
      const e = obj(x, `blocks[${i}]`);
      const id = str(e.id, `blocks[${i}].id`);
      if (!blocks.has(id)) return [];
      return [{ id, action: oneOf(e.action, ['add', 'ignore'] as const, `blocks[${i}].action`), reason: strOrNull(e.reason) ?? '', confidence: confidenceOf(e.confidence) }];
    }),
    pages: arr(o.pages ?? [], 'pages').flatMap((x, i) => {
      const e = obj(x, `pages[${i}]`);
      const id = str(e.id, `pages[${i}].id`);
      if (!pages.has(id)) return [];
      const action = oneOf(e.action, ['embed', 'ignore'] as const, `pages[${i}].action`);
      const headingId = strOrNull(e.headingId);
      if (headingId && !headings.has(headingId)) throw new AiFormatError(`pages[${i}].headingId "${headingId}" is not one of the headings`);
      const name = strOrNull(e.name);
      if (action === 'embed' && !headingId && (!name || /_/.test(name) || name.length < 3)) throw new AiFormatError(`pages[${i}] needs the headingId of a heading, or a name in plain words`);
      return [{ id, action, headingId, name, reason: strOrNull(e.reason) ?? '', confidence: confidenceOf(e.confidence) }];
    }),
  };
}

/** The label of the element a block sits under, so the model can see where the text is. */
function labelAbove(doc: FormDoc, name: string | null): string {
  if (!name) return '';
  let found = '';
  walk(doc.schema.properties, (n: SchemaNode) => {
    if (n.name === name) found = getWidget(doc, n) === 'Header' ? String(doc.uiSchema[n.name]?.['ui:heading'] ?? '') : labelOf(doc, n.name) || n.title;
  });
  return found.slice(0, 70);
}

export interface CoverageInputs {
  doc: FormDoc;
  anchors: Anchors;
  pages: PageText[];
  fundName?: string;
  texts: string[];
}

/**
 * Looks for what the PDF prints and the form never shows, and asks the model what to do with each piece: add it as a paragraph (word for
 * word), embed the pages it belongs to, or ignore it for a stated reason. Everything it finds is a proposal.
 */
export async function findMissingContent(inputs: CoverageInputs, ask: Ask, onProgress: (m: string) => void = () => {}): Promise<{ decisions: Decision[]; notes: string[]; found: { checked: number; uncovered: number } }> {
  const { doc, anchors, pages } = inputs;
  const fund = (inputs.fundName ?? '').trim();
  const cov = coverage(doc, anchors, pages);
  const notes: string[] = [];
  const decisions: Decision[] = [];
  if (cov.blocks.length === 0 && cov.pages.length === 0) return { decisions, notes, found: { checked: cov.checked, uncovered: cov.uncovered } };
  onProgress('Checking the PDF text that is not on the form…');
  const headings = pdfHeadings(pages, fund);
  const shownBlocks = cov.blocks.slice(0, 240);
  if (cov.blocks.length > shownBlocks.length) notes.push(`Content not on the form: ${cov.blocks.length - shownBlocks.length} more block(s) of PDF text were not checked (only the first ${shownBlocks.length} were).`);
  const place = new Map(shownBlocks.map((b) => [b.id, placeOf(doc, anchors, b.page, b.top)]));
  const view = (b: Block) => ({ id: b.id, page: b.page + 1, top: Math.round(b.top * 100) / 100, text: b.text.slice(0, 350), nearSignature: b.nearSignature, above: labelAbove(doc, place.get(b.id)?.after ?? null) });
  const rangeHeadings = headings.filter((h) => cov.pages.some((r) => h.page + 1 >= r.from && h.page + 1 <= r.to)).map((h) => ({ id: h.id, page: h.page + 1, text: h.text }));
  const chunks: Block[][] = [];
  for (let i = 0; i < shownBlocks.length; i += 40) chunks.push(shownBlocks.slice(i, i + 40));
  if (chunks.length === 0) chunks.push([]);
  const answers = await Promise.all(chunks.map((chunk, k) => askValidated(ask, `coverage:${k}`, COVERAGE_SYSTEM, JSON.stringify({ blocks: chunk.map(view), pages: k === 0 ? cov.pages : [], headings: k === 0 ? rangeHeadings : [] }),
    (raw) => validateCoverage(raw, new Set(chunk.map((b) => b.id)), new Set(k === 0 ? cov.pages.map((p) => p.id) : []), new Set(headings.map((h) => h.id)))).catch((e: unknown): RawCoverage => {
    // one part that fails does not lose the others
    notes.push(`Content not on the form: ${chunk.length > 0 ? `${chunk.length} block(s) of PDF text on pages ${chunk[0].page + 1}–${chunk[chunk.length - 1].page + 1}` : 'the page ranges'} could not be checked (${e instanceof Error ? e.message : 'failed'}).`);
    return { blocks: [], pages: [] };
  })));

  const ignored = new Map<string, number>();
  for (const a of answers.flatMap((x) => x.blocks)) {
    const b = shownBlocks.find((x) => x.id === a.id) as Block;
    if (a.action === 'ignore') {
      const why = (a.reason || 'not needed').toLowerCase().slice(0, 50);
      ignored.set(why, (ignored.get(why) ?? 0) + 1);
      continue;
    }
    const at = place.get(b.id) as ReturnType<typeof placeOf>;
    if (!at.after && !at.before && !at.page) {
      notes.push(`Content not on the form: the text on PDF page ${b.page + 1} "${b.text.slice(0, 60)}…" has no place on the form to go to; add it by hand.`);
      continue;
    }
    decisions.push({
      id: `text:${b.id}`, title: `Add the text on PDF page ${b.page + 1}: "${b.text.slice(0, 70)}${b.text.length > 70 ? '…' : ''}"`,
      detail: `The PDF prints this on page ${b.page + 1} and the form does not show it. It is added as a paragraph, word for word${a.reason ? ` (${a.reason})` : ''}.`,
      evidence: { page: b.page + 1, quote: b.text.slice(0, 200) }, confidence: a.confidence, defaultAccepted: a.confidence === 'high',
      data: { kind: 'add-text', text: b.text, pdfPage: b.page + 1, after: at.after, before: at.before, page: at.page },
    });
  }

  // whole pages that are nowhere on the form
  const facts = embeddedPdfFacts(doc, anchors, pages);
  const acronyms = documentAcronyms(inputs.texts);
  const source = Object.values(doc.uiSchema).find((u) => u['ui:widget'] === 'File' && typeof u['ui:fileName'] === 'string')?.['ui:fileName'] as string | undefined;
  for (const a of answers.flatMap((x) => x.pages)) {
    const range = cov.pages.find((p) => p.id === a.id) as (typeof cov.pages)[number];
    if (a.action === 'ignore') {
      ignored.set(`pages ${range.from}-${range.to}: ${(a.reason || 'not needed').toLowerCase().slice(0, 40)}`, 1);
      continue;
    }
    const h = a.headingId ? headings.find((x) => x.id === a.headingId) : undefined;
    const name = titleCase(h ? h.text : (a.name as string), acronyms).replace(/\s+/g, ' ').trim();
    const fileName = composeFileName(fund, name, source);
    decisions.push({
      id: `pdf:${range.from}-${range.to}`, title: `Embed "${name}" (sub-doc pages ${range.from} - ${range.to})`,
      detail: `Pages ${range.from} - ${range.to} of the PDF are nowhere on the form. A new page "${name}" would show them as "${fileName}".${a.reason ? ` ${a.reason}` : ''}`,
      evidence: { page: range.from, quote: range.lines[0] ?? name }, confidence: a.confidence, defaultAccepted: a.confidence === 'high',
      data: { kind: 'embedded-pdf', fileName, title: name, start: range.from, end: range.to, beforePage: pageToPrecede(facts, range.from), subtitle: fund, confirm: confirmationFor(name) },
    });
  }
  if (ignored.size > 0) notes.push(`Content not on the form, left out on purpose: ${[...ignored].map(([why, n]) => `${why} (${n})`).join('; ')}.`);
  return { decisions, notes, found: { checked: cov.checked, uncovered: cov.uncovered } };
}
