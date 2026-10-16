import type { Confidence, Evidence, InvestorTypeOption, SignerName } from './types';
import { SIGNER_NAMES } from './types';
import { cleanFileName, fileNameProblem } from './supportingDocs';

export class AiFormatError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string') throw new AiFormatError(`${what} must be text`);
  return v;
};
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const arr = (v: unknown, what: string): unknown[] => {
  if (!Array.isArray(v)) throw new AiFormatError(`${what} must be a list`);
  return v;
};
const obj = (v: unknown, what: string): Obj => {
  if (!isObj(v)) throw new AiFormatError(`${what} must be an object`);
  return v;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], what: string): T => {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new AiFormatError(`${what} must be one of: ${allowed.join(', ')}`);
  return v as T;
};

export { obj, arr, str, strOrNull, oneOf };

/** The model's text may wrap the JSON in prose or code fences; take the outermost object. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiFormatError('The answer has no JSON object');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiFormatError('The answer is not valid JSON');
  }
}

export function evidenceOf(v: unknown, what: string): Evidence {
  const o = obj(v, `${what}.evidence`);
  const quote = str(o.quote, `${what}.evidence.quote`).trim();
  if (quote === '') throw new AiFormatError(`${what} has no evidence quote`);
  const page = typeof o.page === 'number' && Number.isFinite(o.page) ? Math.round(o.page) : null;
  return { page, quote: quote.slice(0, 240) };
}

export const confidenceOf = (v: unknown): Confidence => (v === 'high' || v === 'medium' || v === 'low' ? v : 'low');

// ------------------------------ investor type ------------------------------
export interface RawInvestorType {
  found: boolean;
  source?: 'picklist' | 'signature-blocks' | 'instructions';
  selectionMode?: 'radio' | 'checkbox';
  existingGroupAlias?: string | null;
  individual?: InvestorTypeOption[];
  entity?: InvestorTypeOption[];
  unplaced?: string[];
  evidence?: Evidence;
  confidence?: Confidence;
}

export function validateInvestorType(raw: unknown, known: { groups: Map<string, string[]>; formPfGroups: Set<string> }): RawInvestorType {
  const o = obj(raw, 'answer');
  if (o.found === false) return { found: false };
  if (o.found !== true) throw new AiFormatError('found must be true or false');
  const existing = strOrNull(o.existingGroupAlias);
  if (existing && !known.groups.has(existing)) throw new AiFormatError(`existingGroupAlias "${existing}" is not one of the candidate groups`);
  if (existing && known.formPfGroups.has(existing)) throw new AiFormatError('The Form PF list, an entity-only list or a tax category list must never be used as the investor type question');
  const options = (v: unknown, what: string): InvestorTypeOption[] =>
    arr(v, what).map((x, i) => {
      const e = obj(x, `${what}[${i}]`);
      const optionAlias = strOrNull(e.optionAlias);
      if (optionAlias && (!existing || !known.groups.get(existing)?.includes(optionAlias))) throw new AiFormatError(`optionAlias "${optionAlias}" is not an option of ${existing ?? 'any candidate group'}`);
      return { label: str(e.label, `${what}[${i}].label`).trim(), optionAlias };
    });
  const individual = options(o.individual, 'individual');
  const entity = options(o.entity, 'entity');
  if (individual.length + entity.length === 0) throw new AiFormatError('found is true but no options were given');
  const seen = new Set<string>();
  [...individual, ...entity].forEach((x) => {
    const key = x.optionAlias ?? x.label.toLowerCase();
    if (seen.has(key)) throw new AiFormatError(`"${x.label}" is placed twice`);
    seen.add(key);
  });
  return {
    found: true,
    source: oneOf(o.source, ['picklist', 'signature-blocks', 'instructions'] as const, 'source'),
    selectionMode: oneOf(o.selectionMode, ['radio', 'checkbox'] as const, 'selectionMode'),
    existingGroupAlias: existing,
    individual,
    entity,
    unplaced: Array.isArray(o.unplaced) ? o.unplaced.filter((x): x is string => typeof x === 'string') : [],
    evidence: evidenceOf(o.evidence, 'answer'),
    confidence: confidenceOf(o.confidence),
  };
}

// ------------------------------ signatures ------------------------------
export interface RawSignature {
  signatureAlias: string;
  signerName: SignerName | null;
  role: 'LpSignature' | 'GpSignature';
  /** True when this one block is signed by every kind of investor (individuals and entities alike). */
  sharedByAllInvestors: boolean;
  evidence: Evidence | null;
  confidence: Confidence;
}
export interface RawSignatureField {
  fieldAlias: string;
  signatureAlias: string;
  type: 'Date' | 'Name' | 'Title' | 'Custom';
  description: string | null;
  evidence: Evidence | null;
  confidence: Confidence;
}

export function validateSignatures(raw: unknown, known: { signatures: Set<string>; fields: Set<string> }): { signatures: RawSignature[]; fields: RawSignatureField[] } {
  const o = obj(raw, 'answer');
  const signatures = arr(o.signatures ?? [], 'signatures').flatMap((x, i): RawSignature[] => {
    const e = obj(x, `signatures[${i}]`);
    const alias = str(e.signatureAlias, `signatures[${i}].signatureAlias`);
    if (!known.signatures.has(alias)) return []; // an alias we never offered is dropped, not trusted
    const name = e.signerName === null || e.signerName === undefined ? null : oneOf(e.signerName, SIGNER_NAMES, `signatures[${i}].signerName`);
    return [{
      signatureAlias: alias, signerName: name,
      role: name === 'General Partner Signatory' ? 'GpSignature' : oneOf(e.role ?? 'LpSignature', ['LpSignature', 'GpSignature'] as const, `signatures[${i}].role`),
      sharedByAllInvestors: e.sharedByAllInvestors === true && name !== 'General Partner Signatory',
      evidence: e.evidence ? evidenceOf(e.evidence, `signatures[${i}]`) : null, confidence: confidenceOf(e.confidence),
    }];
  });
  const fields = arr(o.fields ?? [], 'fields').flatMap((x, i): RawSignatureField[] => {
    const e = obj(x, `fields[${i}]`);
    const fieldAlias = str(e.fieldAlias, `fields[${i}].fieldAlias`);
    const signatureAlias = str(e.signatureAlias, `fields[${i}].signatureAlias`);
    if (!known.fields.has(fieldAlias) || !known.signatures.has(signatureAlias)) return [];
    if (e.type === null || e.type === undefined) return [];
    return [{
      fieldAlias, signatureAlias, type: oneOf(e.type, ['Date', 'Name', 'Title', 'Custom'] as const, `fields[${i}].type`),
      description: strOrNull(e.description), evidence: e.evidence ? evidenceOf(e.evidence, `fields[${i}]`) : null, confidence: confidenceOf(e.confidence),
    }];
  });
  return { signatures, fields };
}

// ------------------------------ duplicates and prefills ------------------------------
export interface RawDuplicates {
  merge: { primaryAlias: string; mergedAliases: string[]; reason: string; evidence: Evidence | null; confidence: Confidence }[];
  prefilled: { alias: string; sourceAlias: string; reason: string; evidence: Evidence | null; confidence: Confidence }[];
}

export function validateDuplicates(raw: unknown, known: Set<string>): RawDuplicates {
  const o = obj(raw, 'answer');
  const merge = arr(o.merge ?? [], 'merge').flatMap((x, i) => {
    const e = obj(x, `merge[${i}]`);
    const primaryAlias = str(e.primaryAlias, `merge[${i}].primaryAlias`);
    const merged = arr(e.mergedAliases ?? [], `merge[${i}].mergedAliases`).filter((a): a is string => typeof a === 'string' && known.has(a) && a !== primaryAlias);
    if (!known.has(primaryAlias) || merged.length === 0) return [];
    return [{ primaryAlias, mergedAliases: [...new Set(merged)], reason: strOrNull(e.reason) ?? '', evidence: e.evidence ? evidenceOf(e.evidence, `merge[${i}]`) : null, confidence: confidenceOf(e.confidence) }];
  });
  const prefilled = arr(o.prefilled ?? [], 'prefilled').flatMap((x, i) => {
    const e = obj(x, `prefilled[${i}]`);
    const alias = str(e.alias, `prefilled[${i}].alias`);
    const sourceAlias = str(e.sourceAlias, `prefilled[${i}].sourceAlias`);
    if (!known.has(alias) || !known.has(sourceAlias) || alias === sourceAlias) return [];
    return [{ alias, sourceAlias, reason: strOrNull(e.reason) ?? '', evidence: e.evidence ? evidenceOf(e.evidence, `prefilled[${i}]`) : null, confidence: confidenceOf(e.confidence) }];
  });
  return { merge, prefilled };
}

// ------------------------------ moving fields off a PDF page ------------------------------
export interface RawMove {
  aliases: string[];
  targetPage: string;
  wrapperTitle: string;
  reason: string;
  confidence: Confidence;
}

export function validateMoves(raw: unknown, known: { pages: Map<string, Set<string>>; targets: Set<string> }): RawMove[] {
  const o = obj(raw, 'answer');
  return arr(o.moves ?? [], 'moves').flatMap((x, i): RawMove[] => {
    const e = obj(x, `moves[${i}]`);
    const target = str(e.targetPage, `moves[${i}].targetPage`);
    const from = strOrNull(e.fromPage);
    const sourceFields = from ? known.pages.get(from) : undefined;
    if (!known.targets.has(target) || !sourceFields || target === from) return [];
    const aliases = arr(e.aliases ?? [], `moves[${i}].aliases`).filter((a): a is string => typeof a === 'string' && sourceFields.has(a));
    if (aliases.length === 0) return [];
    return [{ aliases, targetPage: target, wrapperTitle: strOrNull(e.wrapperTitle) ?? 'Subscriber Information', reason: strOrNull(e.reason) ?? '', confidence: confidenceOf(e.confidence) }];
  });
}

// ------------------------------ lists of aliases with a reason ------------------------------
export interface RawPick {
  alias: string;
  reason: string;
  confidence: Confidence;
}

export function validatePicks(raw: unknown, key: string, known: Set<string>): RawPick[] {
  const o = obj(raw, 'answer');
  return arr(o[key] ?? [], key).flatMap((x, i): RawPick[] => {
    const e = obj(x, `${key}[${i}]`);
    const alias = str(e.alias, `${key}[${i}].alias`);
    return known.has(alias) ? [{ alias, reason: strOrNull(e.reason) ?? '', confidence: confidenceOf(e.confidence) }] : [];
  });
}

export function validateAcronyms(raw: unknown, known: Set<string>): { word: string; reason: string; confidence: Confidence }[] {
  const o = obj(raw, 'answer');
  return arr(o.acronyms ?? [], 'acronyms').flatMap((x, i) => {
    const e = obj(x, `acronyms[${i}]`);
    const word = str(e.word, `acronyms[${i}].word`);
    return known.has(word) && e.isAcronym === true ? [{ word, reason: strOrNull(e.reason) ?? '', confidence: confidenceOf(e.confidence) }] : [];
  });
}

// ------------------------------ labels read from the PDF ------------------------------
export interface RawLabelPick {
  alias: string;
  /** Which of the offered printed texts is the label. Never free text. */
  index: number;
  confidence: Confidence;
}

/** The model only chooses among the texts it was shown, by number: it cannot write a label of its own. */
export function validateLabelPicks(raw: unknown, offered: Map<string, number>): RawLabelPick[] {
  const o = obj(raw, 'answer');
  return arr(o.labels ?? [], 'labels').flatMap((x, i): RawLabelPick[] => {
    const e = obj(x, `labels[${i}]`);
    const alias = str(e.alias, `labels[${i}].alias`);
    const count = offered.get(alias);
    if (count === undefined) return []; // an alias we never offered is dropped
    if (e.index === null || e.index === undefined) return [];
    if (typeof e.index !== 'number' || !Number.isInteger(e.index) || e.index < 0 || e.index >= count) throw new AiFormatError(`labels[${i}].index must be a number from 0 to ${count - 1}, or null`);
    return [{ alias, index: e.index, confidence: confidenceOf(e.confidence) }];
  });
}


export interface RawGroupLabelPick {
  alias: string;
  from: number;
  to: number;
  confidence: Confidence;
}

/** The model picks a run of the printed lines by number: it cannot write the question. */
export function validateGroupLabelPicks(raw: unknown, offered: Map<string, number>): RawGroupLabelPick[] {
  const o = obj(raw, 'answer');
  return arr(o.labels ?? [], 'labels').flatMap((x, i): RawGroupLabelPick[] => {
    const e = obj(x, `labels[${i}]`);
    const alias = str(e.alias, `labels[${i}].alias`);
    const count = offered.get(alias);
    if (count === undefined) return [];
    if (e.from === null || e.from === undefined || e.to === null || e.to === undefined) return [];
    const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < count;
    if (!ok(e.from) || !ok(e.to) || e.to < e.from) throw new AiFormatError(`labels[${i}] needs "from" and "to" line numbers from 0 to ${count - 1} ("to" not before "from"), or null`);
    if (e.to - e.from > 7) throw new AiFormatError(`labels[${i}]: a question is not more than 8 lines`);
    return [{ alias, from: e.from, to: e.to, confidence: confidenceOf(e.confidence) }];
  });
}

// ------------------------------ supporting documents ------------------------------
export interface RawSupportingGroup {
  paragraphAlias: string;
  groupName: string;
  confidence: Confidence;
  /** The investor may hand the documents in instead of completing the form or section the paragraph is in. */
  instead: boolean;
  files: { description: string; helpText: string[]; sourceQuote: string }[];
}

/** Names that are not document names make the model answer again (once); they are never fixed by hand. */
export function validateSupportingDocs(raw: unknown, known: Set<string>): RawSupportingGroup[] {
  const o = obj(raw, 'answer');
  return arr(o.groups ?? [], 'groups').flatMap((x, i): RawSupportingGroup[] => {
    const g = obj(x, `groups[${i}]`);
    const paragraphAlias = str(g.paragraphAlias, `groups[${i}].paragraphAlias`);
    if (!known.has(paragraphAlias)) return [];
    const groupName = cleanFileName(str(g.groupName, `groups[${i}].groupName`));
    if (!/^for\s+\S/i.test(groupName)) throw new AiFormatError(`groups[${i}].groupName must start with "For " (for example "For Natural Person")`);
    const files = arr(g.files ?? [], `groups[${i}].files`).map((f, j) => {
      const e = obj(f, `groups[${i}].files[${j}]`);
      const description = cleanFileName(str(e.description, `groups[${i}].files[${j}].description`));
      const problem = fileNameProblem(description);
      if (problem) throw new AiFormatError(`groups[${i}].files[${j}].description "${description.slice(0, 80)}" ${problem}`);
      const helpText = arr(e.helpText ?? [], `groups[${i}].files[${j}].helpText`).flatMap((h) => (typeof h === 'string' && h.trim() !== '' ? [h.trim()] : []));
      return { description, helpText, sourceQuote: strOrNull(e.sourceQuote)?.slice(0, 300) ?? '' };
    });
    return files.length === 0 ? [] : [{ paragraphAlias, groupName, confidence: confidenceOf(g.confidence), instead: g.instead === true, files }];
  });
}


// ------------------------------ embedded PDFs ------------------------------
export interface RawEmbeddedPdf {
  name: string;
  startPage: number;
  endPage: number;
  keepSignaturePage: boolean;
  confirm: 'agreement' | 'consent' | null;
  startHeading: string;
  endHeading: string;
  confidence: Confidence;
}

/** Page numbers must be real pages of the sub-doc; a document the model placed outside them makes it answer again. */
export function validateEmbeddedPdfs(raw: unknown, total: number): RawEmbeddedPdf[] {
  const o = obj(raw, 'answer');
  return arr(o.documents ?? [], 'documents').map((x, i) => {
    const d = obj(x, `documents[${i}]`);
    const name = cleanFileName(str(d.name, `documents[${i}].name`)).replace(/\.pdf$/i, '');
    if (name === '') throw new AiFormatError(`documents[${i}].name is empty`);
    const page = (v: unknown, what: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > total) throw new AiFormatError(`documents[${i}].${what} must be a page number from 1 to ${total}`);
      return v;
    };
    const startPage = page(d.startPage, 'startPage');
    const endPage = page(d.endPage, 'endPage');
    if (endPage < startPage) throw new AiFormatError(`documents[${i}] ends before it starts`);
    return { name, startPage, endPage, keepSignaturePage: d.keepSignaturePage === true, confirm: d.confirm === 'agreement' || d.confirm === 'consent' ? d.confirm : null, startHeading: strOrNull(d.startHeading)?.slice(0, 200) ?? '', endHeading: strOrNull(d.endHeading)?.slice(0, 200) ?? '', confidence: confidenceOf(d.confidence) };
  });
}


// ------------------------------ groups ------------------------------
export interface RawGroup {
  name: string;
  start: number;
  end: number;
  kind: 'section' | 'conditional';
  controlIndex: number | null;
  condition: string | null;
  confidence: Confidence;
}

/**
 * The ranges the model chose, checked for what only it can get wrong: numbers out of range, runs of one element, two groups that cross
 * each other (each pair must be apart or one inside the other), a condition whose control is inside its own group. It answers again on those.
 */
export function validateGroups(raw: unknown, count: number): RawGroup[] {
  const o = obj(raw, 'answer');
  const groups = arr(o.groups ?? [], 'groups').map((x, i): RawGroup => {
    const g = obj(x, `groups[${i}]`);
    const idx = (v: unknown, what: string): number => {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= count) throw new AiFormatError(`groups[${i}].${what} must be a position from 0 to ${count - 1}`);
      return v;
    };
    const name = str(g.name, `groups[${i}].name`).replace(/\s+/g, ' ').replace(/[\s.:;,]+$/, '').trim();
    if (name === '') throw new AiFormatError(`groups[${i}].name is empty`);
    const start = idx(g.start, 'start');
    const end = idx(g.end, 'end');
    if (end <= start) throw new AiFormatError(`groups[${i}] has to hold at least 2 elements (start ${start}, end ${end})`);
    const kind = g.kind === 'conditional' ? 'conditional' : 'section';
    const control = g.controlIndex === null || g.controlIndex === undefined ? null : idx(g.controlIndex, 'controlIndex');
    if (control !== null && control >= start && control <= end) throw new AiFormatError(`groups[${i}]: the element that opens a group (${control}) must be outside it`);
    return { name, start, end, kind, controlIndex: control, condition: strOrNull(g.condition)?.slice(0, 240) ?? null, confidence: confidenceOf(g.confidence) };
  });
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      const x = groups[a];
      const y = groups[b];
      const apart = x.end < y.start || y.end < x.start;
      const inside = (x.start >= y.start && x.end <= y.end) || (y.start >= x.start && y.end <= x.end);
      if (!apart && !inside) throw new AiFormatError(`groups "${x.name}" (${x.start}-${x.end}) and "${y.name}" (${y.start}-${y.end}) overlap: one has to hold the other`);
    }
  }
  return groups;
}
