import type { Anchors } from '../../model/pdfStore';
import type { FormDoc } from '../../model/types';
import type { PageText } from '../pdfText';
import { groupLabelCandidates, labelCandidates, nameQuestionPages, addressCandidates, duplicateCandidates, fieldsNearSignature, mixedPageCandidates, optionGroupCandidates, requiredFieldCandidates, signatureCandidates, supportingDocCandidates, targetPageCandidates } from './candidates';
import { askValidated, askVoted, type Ask } from './client';
import { ACRONYM_SYSTEM, ADDRESS_SYSTEM, DUPLICATES_SYSTEM, INVESTOR_TYPE_SYSTEM, OPTIONAL_SYSTEM, PAGE_STRUCTURE_SYSTEM, SIGNATURE_SYSTEM, LABELS_SYSTEM, GROUP_LABELS_SYSTEM, SUPPORTING_DOCS_SYSTEM, EMBEDDED_PDFS_SYSTEM, GROUPING_SYSTEM } from './prompts';
import { childrenOf, closeRange } from '../grouping';
import { groupPageFacts } from './groupFacts';
import { composeFileName, embeddedPdfFacts, overlaps, pageToPrecede, trimSignaturePages } from './embeddedPdfs';
import { confirmationFor } from '../standards/embeddedConfirmation';
import { MAY_BE_REQUIRED } from './supportingDocs';
import type { Decision } from './types';
import { validateAcronyms, validateDuplicates, validateInvestorType, validateMoves, validatePicks, validateSignatures, validateLabelPicks, validateGroupLabelPicks, validateSupportingDocs, validateEmbeddedPdfs, validateGroups } from './validate';

export interface JudgeInputs {
  doc: FormDoc;
  anchors: Anchors;
  /** The PDF's text per page; null when no PDF was given. */
  pages: PageText[] | null;
  /** All-caps words from titles that nothing settled, with the titles they appear in. */
  titleWords: { word: string; titles: string[] }[];
  /** The fund's name: the first part of the name of each embedded PDF ("Fund - Subscription Agreement.pdf"). */
  fundName?: string;
  /** A page of the PDF as an image (0-based page), for judgments that need to see the layout. */
  pageImage?: (pageIndex: number) => Promise<string | null>;
}

export interface JudgeResult {
  decisions: Decision[];
  /** Things that went wrong or were skipped, in plain words. */
  notes: string[];
  /** What the AI layer chose not to build and why (for the change log): supporting documents the sub-doc says "may be required". */
  log: string[];
}

const MAX_PAGE_CHARS = 3500;
const pageBlock = (pages: PageText[], page1: number): { page: number; text: string } | null => {
  const p = pages.find((x) => x.page === page1 - 1);
  return p ? { page: page1, text: p.text.slice(0, MAX_PAGE_CHARS) } : null;
};
const unique = <T,>(xs: T[]): T[] => [...new Set(xs)];

async function guard(notes: string[], what: string, run: () => Promise<Decision[]>): Promise<Decision[]> {
  try {
    return await run();
  } catch (e) {
    notes.push(`${what}: ${e instanceof Error ? e.message : 'failed'}`);
    return [];
  }
}

/** One try in three that differs is a doubt; no majority is a guess. */
export function confidenceAfterVote(confidence: 'high' | 'medium' | 'low', agree: number, total: number): 'high' | 'medium' | 'low' {
  if (total <= 1 || agree === total) return confidence;
  if (agree * 2 <= total) return 'low';
  return confidence === 'high' ? 'medium' : confidence;
}

/** Ask the model for each judgment, with only the pages and facts that judgment needs. */
export async function judgeForm(inputs: JudgeInputs, ask: Ask, onProgress: (message: string) => void = () => {}): Promise<JudgeResult> {
  const { doc, anchors, pages } = inputs;
  const notes: string[] = [];
  const log: string[] = [];
  const sigs = signatureCandidates(doc, anchors);

  const investorType = async (): Promise<Decision[]> => {
    const all = optionGroupCandidates(doc, anchors);
    const groups = all.filter((g) => !g.entityOnly); // an entity-only list or a tax category list is never offered as the investor type
    const typeish = groups.filter((g) => /type of (subscriber|investor)|investor type|subscriber type|type of investor/i.test(`${g.label} ${g.parentLabel}`));
    // Without the PDF only a picklist already in the annotation can be used; the signature blocks and instructions need the text.
    if (!pages && typeish.length === 0) {
      notes.push('Investor type: skipped, because no PDF was given and the annotation has no type of subscriber picklist; the question has to be found in the document text. Attach the PDF and build again.');
      return [];
    }
    if (!pages) notes.push('Investor type: no PDF was given, so only the type picklist in the annotation was used. Attach the PDF to let the AI also read the signature blocks and instructions.');
    const wanted = pages
      ? unique([
        ...(typeish.length > 0 ? typeish : groups.filter((g) => !g.formPf)).slice(0, 3).map((g) => g.page ?? 0),
        // the page where the name is asked: the lead-in there often lists the investor types (even next to an entity-only list)
        ...nameQuestionPages(doc, anchors), ...all.filter((g) => g.entityOnly).map((g) => g.page ?? 0),
        1, 2, ...sigs.map((s) => s.page ?? 0).slice(0, 4),
      ]).filter((n) => n > 0)
      : [];
    const known = { groups: new Map(groups.map((g) => [g.alias, g.options.map((o) => o.alias)])), formPfGroups: new Set(all.filter((g) => g.formPf || g.entityOnly).map((g) => g.alias)) };
    onProgress('Looking for the investor type question…');
    const user = JSON.stringify({ candidates: groups, pages: pages ? wanted.flatMap((p) => pageBlock(pages, p) ?? []) : [] });
    // Asked three times: a borderline option (is a custodial account an individual?) can come out either way on one try.
    const columnKey = (list: { label: string }[] | undefined): string => (list ?? []).map((o) => o.label.toLowerCase().trim()).sort().join('|');
    const voted = await askVoted(ask, 'investor-type', INVESTOR_TYPE_SYSTEM, user, (raw) => validateInvestorType(raw, known),
      (a) => (a.found ? `${a.source}~${a.existingGroupAlias ?? ''}~${columnKey(a.individual)}~${columnKey(a.entity)}` : 'not-found'));
    const r = voted.best;
    const unanimous = voted.agree === voted.total;
    if (!r.found || !r.individual || !r.entity || !r.source || !r.selectionMode) {
      notes.push('Investor type: the AI found no investor type information in the pages it was given.');
      return [];
    }
    const existing = r.existingGroupAlias ? groups.find((g) => g.alias === r.existingGroupAlias) : undefined;
    const how = existing ? (existing.numbered ? 'a numbered list: the original stays, a copy goes to the top' : 'an unnumbered list: moved to the top') : 'not in the annotation: a new question';
    return [{
      id: 'investor-type', title: 'Investor type question',
      detail: `Found in ${r.source === 'picklist' ? 'a picklist' : r.source === 'signature-blocks' ? 'the signature blocks' : 'the instructions'} (${how}). ${r.individual.length} individual and ${r.entity.length} entity options, ${r.selectionMode === 'checkbox' ? 'entity types as checkboxes' : 'radio buttons'}${(r.unplaced ?? []).length > 0 ? `. Not placed (the document does not say): ${(r.unplaced ?? []).join(', ')}` : ''}.${unanimous ? '' : ` The AI did not give the same answer every time (${voted.agree} of ${voted.total} agree on this one): check the two columns.`}`,
      // when the tries disagreed the confidence is lowered, and a split with no majority is not ticked
      evidence: r.evidence ?? null, confidence: confidenceAfterVote(r.confidence ?? 'low', voted.agree, voted.total), defaultAccepted: confidenceAfterVote(r.confidence ?? 'low', voted.agree, voted.total) !== 'low',
      data: { kind: 'investor-type', value: { source: r.source, selectionMode: r.selectionMode, existingGroupAlias: r.existingGroupAlias ?? null, individual: r.individual, entity: r.entity, unplaced: r.unplaced ?? [] } },
    }];
  };

  const signatures = async (): Promise<Decision[]> => {
    const lacking = sigs.filter((s) => !s.currentSigner && s.page !== null);
    if (lacking.length === 0) return [];
    if (!pages) {
      notes.push('Signatures: skipped, because no PDF was given.');
      return [];
    }
    const out: Decision[] = [];
    for (const page of unique(lacking.map((s) => s.page as number))) {
      const block = pageBlock(pages, page);
      if (!block) continue;
      onProgress(`Reading the signature blocks on page ${page}…`);
      const here = sigs.filter((s) => s.page === page);
      const fields = here.flatMap((s) => fieldsNearSignature(doc, anchors, s, here).map((f) => ({ ...f, nearSignature: s.alias })));
      const known = { signatures: new Set(here.map((s) => s.alias)), fields: new Set(fields.map((f) => f.alias)) };
      const user = JSON.stringify({ page: block.page, text: block.text, signatures: here, fields });
      const image = inputs.pageImage ? await inputs.pageImage(page - 1) : null;
      const r = await askValidated(ask, `signatures-p${page}${image ? '-img' : ''}`, SIGNATURE_SYSTEM, user, (raw) => validateSignatures(raw, known), image ? [image] : undefined);
      r.signatures.forEach((s) => {
        if (!s.signerName) return;
        out.push({
          id: `sig:${s.signatureAlias}`, title: `Signer of ${s.signatureAlias}`,
          detail: `${s.signerName}${s.role === 'GpSignature' ? ' (General Partner signature)' : ''}${s.sharedByAllInvestors ? '. One block for every investor type: a second widget, Individual Signatory, is added for individuals (same lines: the name required, the title optional)' : ''}`,
          evidence: s.evidence, confidence: s.confidence, defaultAccepted: s.confidence === 'high',
          data: { kind: 'signature', signatureAlias: s.signatureAlias, signerName: s.signerName, role: s.role, sharedByAllInvestors: s.sharedByAllInvestors },
        });
      });
      r.fields.forEach((f) => {
        out.push({
          id: `sigfield:${f.fieldAlias}`, title: `${f.fieldAlias} is signed with ${f.signatureAlias}`, detail: `Type ${f.type}${f.description ? `: ${f.description}` : ''}. It moves into the signature widget.`,
          evidence: f.evidence, confidence: f.confidence, defaultAccepted: f.confidence === 'high',
          data: { kind: 'signature-field', fieldAlias: f.fieldAlias, signatureAlias: f.signatureAlias, type: f.type, description: f.description },
        });
      });
    }
    return out;
  };

  const duplicates = async (): Promise<Decision[]> => {
    const cands = duplicateCandidates(doc, anchors);
    if (cands.length < 2) return [];
    if (!pages) {
      notes.push('Duplicate fields: skipped, because no PDF was given and the layout has to be seen.');
      return [];
    }
    onProgress('Checking for information asked in several places…');
    const pageNums = unique(cands.map((c) => c.page ?? 0)).filter((p) => p > 0).slice(0, 3);
    const images = inputs.pageImage ? (await Promise.all(pageNums.slice(0, 2).map((p) => inputs.pageImage?.(p - 1) ?? null))).filter((x): x is string => Boolean(x)) : [];
    const user = JSON.stringify({ fields: cands, pages: pageNums.flatMap((p) => pageBlock(pages, p) ?? []) });
    const known = new Set(cands.map((c) => c.alias));
    const r = await askValidated(ask, `duplicates${images.length ? '-img' : ''}`, DUPLICATES_SYSTEM, user, (raw) => validateDuplicates(raw, known), images.length ? images : undefined);
    const label = (a: string) => cands.find((c) => c.alias === a)?.label || a;
    return [
      ...r.merge.map((m): Decision => ({
        id: `merge:${m.primaryAlias}`, title: `One field for "${label(m.primaryAlias)}"`, detail: `${m.mergedAliases.length} other place(s) in the PDF (${m.mergedAliases.join(', ')}) map to this field; their separate fields are removed. ${m.reason}`.trim(),
        evidence: m.evidence, confidence: m.confidence, defaultAccepted: m.confidence === 'high', data: { kind: 'merge-field', primaryAlias: m.primaryAlias, mergedAliases: m.mergedAliases },
      })),
      ...r.prefilled.map((p): Decision => ({
        id: `prefill:${p.alias}`, title: `${p.alias} stays invisible, prefilled from ${p.sourceAlias}`, detail: `${p.reason} A rule must copy the value.`.trim(),
        evidence: p.evidence, confidence: p.confidence, defaultAccepted: p.confidence === 'high', data: { kind: 'prefilled-field', alias: p.alias, sourceAlias: p.sourceAlias },
      })),
    ];
  };

  const pageStructure = async (): Promise<Decision[]> => {
    const mixed = mixedPageCandidates(doc);
    const targets = targetPageCandidates(doc);
    if (mixed.length === 0 || targets.length === 0) return [];
    onProgress('Deciding where fields on PDF pages should go…');
    const known = { pages: new Map(mixed.map((m) => [m.page, new Set(m.fields.map((f) => f.alias))])), targets: new Set(targets.map((t) => t.page)) };
    const moves = await askValidated(ask, 'page-structure', PAGE_STRUCTURE_SYSTEM, JSON.stringify({ pages: mixed, targets }), (raw) => validateMoves(raw, known));
    return moves.map((m): Decision => ({
      id: `move:${m.targetPage}:${m.aliases[0]}`, title: `Move ${m.aliases.length} field(s) to "${targets.find((t) => t.page === m.targetPage)?.title ?? m.targetPage}"`,
      detail: `${m.aliases.map((a) => mixed.flatMap((x) => x.fields).find((f) => f.alias === a)?.label || a).join('; ')}. They go at the beginning of that page in a group "${m.wrapperTitle}". ${m.reason}`.trim(),
      evidence: null, confidence: m.confidence, defaultAccepted: m.confidence === 'high', data: { kind: 'move-fields', aliases: m.aliases, targetPage: m.targetPage, wrapperTitle: m.wrapperTitle },
    }));
  };

  const addresses = async (): Promise<Decision[]> => {
    const cands = addressCandidates(doc, anchors);
    if (cands.length === 0) return [];
    onProgress('Checking which address boxes should be split…');
    const picks = await askValidated(ask, 'addresses', ADDRESS_SYSTEM, JSON.stringify({ fields: cands }), (raw) => validatePicks(raw, 'expand', new Set(cands.map((c) => c.alias))));
    return picks.map((p) => {
      const c = cands.find((x) => x.alias === p.alias);
      return {
        id: `address:${p.alias}`, title: `Split "${c?.label ?? p.alias}" into five elements`, detail: p.reason || 'Country, Address, City, State/Province and Postal code replace the single box; a hidden box keeps the PDF mapping.',
        evidence: null, confidence: p.confidence, defaultAccepted: p.confidence === 'high', data: { kind: 'address', alias: p.alias },
      } satisfies Decision;
    });
  };

  const labels = async (): Promise<Decision[]> => {
    if (!pages) {
      notes.push('Labels: skipped, because no PDF was given.');
      return [];
    }
    const { auto, ask: asks, none } = labelCandidates(doc, anchors, pages);
    const out: Decision[] = auto.map((c) => ({
      id: `label:${c.alias}`, title: `Label "${c.near[0].text}" for ${c.alias}`,
      detail: `The PDF prints "${c.near[0].text}" ${c.near[0].where === 'left' ? 'to the left of' : 'just above'} this box on page ${c.page}, and nothing else is near it.`,
      evidence: { page: c.page, quote: c.near[0].text }, confidence: 'high' as const, defaultAccepted: true,
      data: { kind: 'label' as const, alias: c.alias, text: c.near[0].text, source: 'pdf-text' as const },
    }));
    if (asks.length > 0) {
      onProgress('Reading the printed labels of fields without one…');
      const shown = asks.slice(0, 60);
      const offered = new Map(shown.map((c) => [c.alias, c.near.length]));
      const picks = await askValidated(ask, 'labels', LABELS_SYSTEM, JSON.stringify({ fields: shown.map((c) => ({ alias: c.alias, page: c.page, near: c.near.map((n, index) => ({ index, text: n.text, where: n.where })) })) }), (raw) => validateLabelPicks(raw, offered));
      picks.forEach((p) => {
        const c = shown.find((x) => x.alias === p.alias) as (typeof shown)[number];
        const text = c.near[p.index].text;
        out.push({
          id: `label:${p.alias}`, title: `Label "${text}" for ${p.alias}`,
          detail: `Several texts are printed near this box on page ${c.page}; the AI chose "${text}" (${c.near[p.index].where === 'left' ? 'to its left' : 'just above it'}).`,
          evidence: { page: c.page, quote: text }, confidence: p.confidence, defaultAccepted: p.confidence === 'high',
          data: { kind: 'label', alias: p.alias, text, source: 'ai' },
        });
      });
    }
    // the questions of Yes/No and checkbox groups that were never highlighted
    const groups = groupLabelCandidates(doc, anchors, pages).slice(0, 120);
    if (groups.length > 0) {
      onProgress('Reading the questions printed above choices without a label…');
      for (let at = 0; at < groups.length; at += 40) {
        const chunk = groups.slice(at, at + 40);
        const offered = new Map(chunk.map((g) => [g.alias, g.lines.length]));
        const picks = await askValidated(ask, `group-labels:${at}`, GROUP_LABELS_SYSTEM, JSON.stringify({ groups: chunk.map((g) => ({ alias: g.alias, page: g.page, lines: g.lines })) }), (raw) => validateGroupLabelPicks(raw, offered));
        picks.forEach((p) => {
          const g = chunk.find((x) => x.alias === p.alias) as (typeof chunk)[number];
          const text = g.lines.slice(p.from, p.to + 1).join(' ').replace(/\s+/g, ' ').trim();
          out.push({
            id: `label:${p.alias}`, title: `Question "${text.slice(0, 80)}" for ${p.alias}`,
            detail: `The PDF prints this above the boxes on page ${g.page}; the AI chose the lines (${p.from}–${p.to}) that are the question.`,
            evidence: { page: g.page, quote: text.slice(0, 200) }, confidence: p.confidence, defaultAccepted: p.confidence === 'high',
            data: { kind: 'label', alias: p.alias, text, source: 'ai' },
          });
        });
      }
    }
    if (none.length > 0) notes.push(`Labels: ${none.length} field(s) have no printed text near their box (${none.slice(0, 3).join(', ')}${none.length > 3 ? ', …' : ''}); reading a screenshot of the page is not built yet.`);
    return out;
  };

  const embeddedPdfs = async (): Promise<Decision[]> => {
    if (!pages || pages.length === 0) {
      notes.push('Embedded PDFs: skipped, because no PDF was given.');
      return [];
    }
    const facts = embeddedPdfFacts(doc, anchors, pages);
    onProgress('Finding the parts of the sub-doc the investor only reads…');
    const found = await askValidated(ask, 'embedded-pdfs', EMBEDDED_PDFS_SYSTEM, JSON.stringify(facts), (raw) => validateEmbeddedPdfs(raw, facts.total));
    const fund = (inputs.fundName ?? '').trim();
    if (found.length > 0 && fund === '') notes.push('Embedded PDFs: no fund name was entered, so the file names have only the document name. Enter the fund name and build again to get "Fund - Document.pdf".');
    const taken = [...facts.existing];
    const source = Object.values(doc.uiSchema).find((u) => u['ui:widget'] === 'File' && typeof u['ui:fileName'] === 'string')?.['ui:fileName'] as string | undefined;
    const out: Decision[] = [];
    for (const d of [...found].sort((a, b) => a.startPage - b.startPage)) {
      // a signature page at the end of the range is left out unless the document goes on after it or it carries other readable content
      const end = trimSignaturePages(d.startPage, d.endPage, facts.signaturePages, d.keepSignaturePage);
      const range = { start: d.startPage, end };
      const clash = taken.find((t) => overlaps(t, range));
      if (clash) {
        notes.push(`Embedded PDFs: "${d.name}" (pages ${range.start} - ${range.end}) was not proposed, because pages ${clash.start} - ${clash.end} are already embedded${clash.name ? ` ("${clash.name}")` : ''}.`);
        continue;
      }
      taken.push({ ...range, name: d.name });
      const fileName = composeFileName(fund, d.name, source);
      const left = end < d.endPage;
      out.push({
        id: `pdf:${range.start}-${range.end}`, title: `Embed "${d.name}" (sub-doc pages ${range.start} - ${range.end})`,
        detail: `A new page "${d.name}" with the pages ${range.start} - ${range.end} of the sub-doc, shown to the investor as "${fileName}".${left ? ` The signature page${d.endPage - end > 1 ? 's' : ''} at the end (${end + 1}${d.endPage > end + 1 ? ` - ${d.endPage}` : ''}) ${d.endPage - end > 1 ? 'are' : 'is'} left out.` : ''} You can change the pages in the properties of the PDF.`,
        evidence: { page: range.start, quote: [d.startHeading, d.endHeading].filter(Boolean).join(' … ') || d.name }, confidence: d.confidence, defaultAccepted: d.confidence !== 'low',
        data: { kind: 'embedded-pdf', fileName, title: d.name, start: range.start, end, beforePage: pageToPrecede(facts, range.start), subtitle: fund, confirm: d.confirm ?? confirmationFor(d.name) },
      });
    }
    return out;
  };

  const groups = async (): Promise<Decision[]> => {
    const facts = groupPageFacts(doc, anchors, pages);
    if (facts.length === 0) return [];
    onProgress('Organising the pages into groups…');
    const perPage = await Promise.all(facts.map(async (f): Promise<Decision[]> => {
      const list = childrenOf(doc, f.page);
      let raw;
      try {
        raw = await askValidated(ask, `grouping:${f.page}`, GROUPING_SYSTEM, JSON.stringify(f), (r) => validateGroups(r, list.length));
      } catch (e) {
        notes.push(`Groups on "${f.title}": ${e instanceof Error ? e.message : 'failed'}`);
        return [];
      }
      // a group is closed over the fields below its options; the ones that cannot be, or that then cross another, are left out
      const kept: { name: string; lo: number; hi: number; g: (typeof raw)[number] }[] = [];
      for (const g of [...raw].sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
        const closed = closeRange(doc, list, g.start, g.end);
        if (!closed) {
          notes.push(`Group "${g.name}" on "${f.title}" was not proposed: it would hold a heading, PDF or signature, or split a question from the boxes under its options.`);
          continue;
        }
        const [lo, hi] = closed;
        const crosses = kept.some((k) => !(hi < k.lo || k.hi < lo) && !((lo >= k.lo && hi <= k.hi) || (k.lo >= lo && k.hi <= hi)));
        const same = kept.some((k) => k.lo === lo && k.hi === hi);
        const controlInside = g.controlIndex !== null && g.controlIndex >= lo && g.controlIndex <= hi;
        if (crosses || same || controlInside) continue;
        kept.push({ name: g.name, lo, hi, g });
      }
      return kept.map(({ name, lo, hi, g }): Decision => ({
        id: `group:${list[lo].name}:${list[hi].name}`, title: `Group "${name}" (${hi - lo + 1} elements)`,
        detail: `${g.kind === 'conditional' ? `Shown only when: ${g.condition ?? 'the condition above holds'}. ` : ''}From "${f.items[lo].label.slice(0, 60)}" to "${f.items[hi].label.slice(0, 60)}" on "${f.title}".`,
        evidence: null, confidence: g.confidence, defaultAccepted: g.confidence !== 'low',
        data: { kind: 'group', name, fromAlias: list[lo].name, toAlias: list[hi].name, groupKind: g.kind, controlAlias: g.controlIndex === null ? null : list[g.controlIndex].name, condition: g.condition, size: hi - lo + 1 },
      }));
    }));
    return perPage.flat();
  };

  const supportingDocs = async (): Promise<Decision[]> => {
    const cands = supportingDocCandidates(doc).slice(0, 25);
    if (cands.length === 0) return [];
    onProgress('Looking for supporting documents the investor must submit…');
    const groups = await askValidated(ask, 'supporting-docs', SUPPORTING_DOCS_SYSTEM, JSON.stringify({ paragraphs: cands }), (raw) => validateSupportingDocs(raw, new Set(cands.map((c) => c.alias))));
    const out: Decision[] = [];
    for (const g of groups) {
      const heading = cands.find((c) => c.alias === g.paragraphAlias)?.heading ?? '';
      const kept: typeof g.files = [];
      for (const f of g.files) {
        // Only the sub-doc's own words skip a document: "may be required", "may request", "upon request", "if requested".
        const said = MAY_BE_REQUIRED.exec(`${heading} ${f.sourceQuote} ${f.helpText.join(' ')}`)?.[0];
        if (said) log.push(`Supporting document "${f.description}" (${g.groupName}) was not built: the sub-doc says "${said}"`);
        else kept.push(f);
      }
      if (kept.length === 0) continue;
      out.push({
        id: `docs:${g.paragraphAlias}`, title: `Supporting documents "${g.groupName}" (${kept.length} file${kept.length === 1 ? '' : 's'})`,
        detail: `${g.instead ? 'An optional checkbox and a file group at the end of the page (the investor may provide it instead of completing the form): ' : 'A file group below this paragraph: '}${kept.map((f) => f.description).join('; ')}.`,
        evidence: { page: null, quote: kept[0].sourceQuote || kept[0].description }, confidence: g.confidence, defaultAccepted: g.confidence !== 'low',
        data: { kind: 'supporting-docs', paragraphAlias: g.paragraphAlias, groupName: g.groupName, instead: g.instead, files: kept.map((f) => ({ description: f.description, helpText: f.helpText })) },
      });
    }
    notes.push(...log.filter((l) => l.startsWith('Supporting document')));
    return out;
  };

  const optional = async (): Promise<Decision[]> => {
    const cands = requiredFieldCandidates(doc, anchors, pages).slice(0, 400);
    if (cands.length === 0) return [];
    onProgress('Looking for fields that are optional by nature…');
    const picks = await askValidated(ask, 'optional', OPTIONAL_SYSTEM, JSON.stringify({ fields: cands }), (raw) => validatePicks(raw, 'optional', new Set(cands.map((c) => c.alias))));
    return picks.map((p) => {
      const c = cands.find((x) => x.alias === p.alias);
      return {
        id: `optional:${p.alias}`, title: `Make "${c?.label ?? p.alias}" optional`, detail: p.reason || 'Many people legitimately have nothing to enter here.',
        evidence: null, confidence: p.confidence, defaultAccepted: false, data: { kind: 'optional', alias: p.alias },
      } satisfies Decision;
    });
  };

  const acronyms = async (): Promise<Decision[]> => {
    if (inputs.titleWords.length === 0) return [];
    onProgress('Checking capitalised words in titles…');
    const picks = await askValidated(ask, 'acronyms', ACRONYM_SYSTEM, JSON.stringify({ words: inputs.titleWords }), (raw) => validateAcronyms(raw, new Set(inputs.titleWords.map((w) => w.word))));
    return picks.map((p) => ({
      id: `acronym:${p.word}`, title: `Keep "${p.word}" in capitals`, detail: p.reason || 'It is an acronym.', evidence: null, confidence: p.confidence,
      defaultAccepted: p.confidence !== 'low', data: { kind: 'acronym', word: p.word },
    } satisfies Decision));
  };

  const decisions = [
    ...(await guard(notes, 'Investor type', investorType)),
    ...(await guard(notes, 'Signatures', signatures)),
    ...(await guard(notes, 'Duplicate fields', duplicates)),
    ...(await guard(notes, 'Page structure', pageStructure)),
    ...(await guard(notes, 'Addresses', addresses)),
    ...(await guard(notes, 'Labels', labels)),
    ...(await guard(notes, 'Embedded PDFs', embeddedPdfs)),
    ...(await guard(notes, 'Supporting documents', supportingDocs)),
    ...(await guard(notes, 'Optional fields', optional)),
    ...(await guard(notes, 'Groups', groups)),
    ...(await guard(notes, 'Title capitals', acronyms)),
  ];
  return { decisions, notes, log };
}
