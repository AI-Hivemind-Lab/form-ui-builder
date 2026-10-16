/**
 * Supporting documents: what the investor uploads when the sub-doc makes them submit something. The AI reads the paragraphs and names
 * each document; these functions are the rules around it, so the AI cannot skip one by itself or write a name we never accept.
 */

/**
 * The sub-doc itself says the document is not certain: "may be required", "may request", "upon request", "if requested". Those are not
 * built (the LP dashboard list would be very long). Only these words skip a document; nothing the AI thinks about it does.
 */
export const MAY_BE_REQUIRED = /\bmay\b[^.;]{0,60}\b(request(ed)?|require[ds]?|ask(ed)?)\b|\bupon (such )?request\b|\bif (so )?requested\b/i;

/** A file name never ends with punctuation: the paragraph's own full stop, colon, semicolon or comma is left out. */
export const cleanFileName = (s: string): string => s.replace(/\s+/g, ' ').replace(/[\s.,;:?!]+$/, '').trim();

/**
 * Why a file name is not a name: it must read as the document itself ("Birth certificate", "Copy of a form of address verification"),
 * never a sentence, an order or an instruction to the investor. No length limit: some documents have long, legitimate names.
 */
export function fileNameProblem(name: string): string | null {
  if (name === '') return 'is empty';
  if (/^(please|provide|submit|attach|upload|deliver|furnish|each|every|if|for each|the investor|investors?|you|your)\b/i.test(name)) return 'starts like an instruction or a sentence, not like a document';
  if (/\b(must|shall|should|will be required|is required|are required)\b/i.test(name)) return 'says what the investor must do; a file name is only the document';
  return null;
}

/** "For Natural Person" -> "natural_person"; the page decides the ending (the AML page: _aml). */
export function groupAlias(groupName: string, pageTitle: string): string {
  const slug = groupName.replace(/^for\s+/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'documents';
  return `${slug}${/aml|kyc|anti[- ]money|know your/i.test(pageTitle) ? '_aml' : '_docs'}`;
}
