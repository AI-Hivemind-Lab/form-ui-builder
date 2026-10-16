import { parseDateInput, parseEmail, parseInteger, parseNumber, parsePhone, parseYear, patternParser } from './format';

const isFilled = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '';

export type DraftResult = { kind: 'unchanged' } | { kind: 'set'; value: number | string } | { kind: 'invalid' };

/**
 * Decide what to do with the text a user typed into a field when they leave it.
 * Empty clears (or is a no-op if already empty); unparsable text is `invalid` and must never be saved.
 */
export function resolveWith<T extends string | number>(
  draft: string,
  current: unknown,
  parse: (text: string) => T | null,
): DraftResult {
  if (draft.trim() === '') return isFilled(current) ? { kind: 'set', value: '' } : { kind: 'unchanged' };
  const parsed = parse(draft);
  if (parsed === null) return { kind: 'invalid' };
  return parsed === current ? { kind: 'unchanged' } : { kind: 'set', value: parsed };
}

export const resolveNumberDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseNumber);
export const resolveDateDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseDateInput);
export const resolveIntegerDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseInteger);
export const resolveYearDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseYear);
export const resolveEmailDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseEmail);
export const resolvePhoneDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parsePhone);

export function resolvePatternDraft(pattern: unknown): (draft: string, current: unknown) => DraftResult {
  const parse = patternParser(pattern);
  return (draft, current) => resolveWith(draft, current, parse);
}
