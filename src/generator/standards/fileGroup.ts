import type { SchemaNode, UiEntry } from '../../model/types';

/** One supporting document: its name (what an investor sees on the LP dashboard) and an optional help text (HTML). */
export interface SupportingFile {
  description: string;
  helpText: string;
}

/**
 * A FileGroup is the wrapper of the supporting documents an investor uploads: a group name, and one file item per document. Each file
 * item is like an option of a checkbox list (file1, file2, ...), so the schema node lists them as its items' enum.
 */
export function fileGroupParts(name: string, groupName: string, files: SupportingFile[]): { node: SchemaNode; ui: UiEntry } {
  const keys = files.map((_, i) => `file${i + 1}`);
  return {
    node: { name, type: 'array', title: groupName, items: { type: 'string', enum: keys } },
    ui: {
      'ui:widget': 'FileGroup', 'ui:formattedText': '', 'ui:marginBottom': '12px', 'ui:enabledComment': true,
      'ui:supportingFileGroup': { description: groupName, helpText: '', files: Object.fromEntries(files.map((f, i) => [keys[i], { description: f.description, helpText: f.helpText, blueprintMetadataMapping: '' }])) },
    },
  };
}

/** The group a file group node holds, for reading it back. */
export function filesOf(ui: UiEntry | undefined): { group: string; files: { key: string; description: string; helpText: string }[] } {
  const g = ui?.['ui:supportingFileGroup'] as { description?: unknown; files?: Record<string, { description?: unknown; helpText?: unknown }> } | undefined;
  return {
    group: typeof g?.description === 'string' ? g.description : '',
    files: Object.entries(g?.files ?? {}).map(([key, f]) => ({ key, description: typeof f?.description === 'string' ? f.description : '', helpText: typeof f?.helpText === 'string' ? f.helpText : '' })),
  };
}

/** "<ul><li>…</li></ul>" for several lines, "<p>…</p>" for one, '' for none. Lines are plain text. */
export function helpTextHtml(lines: string[]): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  return clean.length === 1 ? `<p>${esc(clean[0])}</p>` : `<ul>${clean.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

/** The investor does not upload at the form step: the documents are asked for in this step of the process, after the form is submitted. */
export const SUBMIT_PROCESS = 'Upload AML/KYC & Other documents';

/** "Copy of a void cheque" is "the copy of a void cheque" in a sentence; "IRS Form W-9" keeps its capitals. */
const inSentence = (name: string): string => (/^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

/**
 * The blue message under supporting documents (HTML). One document is named; several are the list above them (the paragraph that lists
 * them is already on the page, and repeating it makes the form long).
 */
export function submitMessageHtml(documents: string[]): string {
  const what = documents.length === 1 ? `the ${inSentence(documents[0].trim())}` : 'the list of documents above';
  const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${esc(`After completing the form, you will be asked to submit ${what} during the "${SUBMIT_PROCESS}" process.`)}</p>`;
}

/** An Info well with a message that comes with a widget; `name` must be free in the form. */
export function infoWell(name: string, html: string): { node: SchemaNode; ui: UiEntry } {
  return {
    node: { name, type: 'null', title: html.replace(/<[^>]+>/g, '') },
    ui: { 'ui:widget': 'Paragraph', 'ui:formattedText': html, 'ui:wellType': 'Info', 'ui:marginBottom': '12px' },
  };
}
