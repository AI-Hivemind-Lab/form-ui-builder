import { findParentName } from './addField';
import { isFieldBelow } from './fieldsBelow';
import { getWidget, isInvisible, uiOf } from './schemaWalk';
import type { FormDoc, SchemaNode } from './types';

/** Widgets that show their own formattedText as a label or text. */
const NEEDS_LABEL_EXCLUDED = new Set(['Page', 'Group', 'Header', 'Signature', 'File', 'FileGroup', 'Pdf', 'AnchorLink', 'Repeatable']);
const CHOICE = new Set(['Radio', 'Dropdown', 'MultipleCheckbox', 'MultipleSuggest']);

const textOf = (html: unknown): string =>
  typeof html === 'string' ? html.replace(/<[^>]*>/g, '').replace(/FOOT_NOTE_HERE/g, '').replace(/&nbsp;/g, ' ').trim() : '';

/** A footnote widget whose tooltip has no text. */
const hasEmptyFootnote = (html: unknown): boolean =>
  typeof html === 'string' && [...html.matchAll(/<span[^>]*data-title="([^"]*)"[^>]*>\s*FOOT_NOTE_HERE/g)].some((m) => textOf(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')) === '');

/** A field shown under an option of a choice (or inside a group under one): the option is what labels it. */
function labelledByOption(doc: FormDoc, node: SchemaNode): boolean {
  for (let cur: string | null | undefined = node.name, hops = 0; cur && hops < 4; cur = findParentName(doc, cur), hops += 1) if (isFieldBelow(doc, cur)) return true;
  return false;
}

/** Things that look unfinished on one widget, in plain words. */
export function warningsFor(doc: FormDoc, node: SchemaNode): string[] {
  const ui = uiOf(doc, node.name);
  const widget = getWidget(doc, node);
  const out: string[] = [];
  const opts = (ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  // A lone checkbox is labelled by its one option ("Check this box if ...").
  const loneCheckbox = widget === 'MultipleCheckbox' && Array.isArray(opts) && opts.length === 1 && textOf((opts[0] as [unknown, { formattedText?: unknown }])?.[1]?.formattedText) !== '';
  if (!NEEDS_LABEL_EXCLUDED.has(widget) && !loneCheckbox && textOf(ui['ui:formattedText']) === '' && !labelledByOption(doc, node) && !isInvisible(doc, node.name)) out.push('Missing label');
  if (hasEmptyFootnote(ui['ui:formattedText'])) out.push('Footnote has no text');
  if (widget === 'Signature' && !(typeof ui['ui:signatureSigner'] === 'string' && ui['ui:signatureSigner'].trim())) out.push('Missing signer name');
  const options = (ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  if (CHOICE.has(widget) && Array.isArray(options)) {
    const bad = options.filter((o) => Array.isArray(o) && textOf((o[1] as { formattedText?: unknown } | null | undefined)?.formattedText) === '');
    if (bad.length > 0) out.push(`${bad.length} option${bad.length === 1 ? '' : 's'} missing a label`);
    if (options.some((o) => Array.isArray(o) && hasEmptyFootnote((o[1] as { formattedText?: unknown } | null | undefined)?.formattedText))) out.push('Option footnote has no text');
  }
  return out;
}

export const warningKey = (name: string, message: string): string => `${name}|${message}`;

/** warningsFor minus the ones the user chose to ignore. */
export function visibleWarnings(doc: FormDoc, node: SchemaNode, ignored: readonly string[]): string[] {
  return warningsFor(doc, node).filter((m) => !ignored.includes(warningKey(node.name, m)));
}

export interface FieldWarning {
  name: string;
  title: string;
  messages: string[];
}

/** Every widget with something to fix, in form order. */
export function allWarnings(doc: FormDoc, ignored: readonly string[] = []): FieldWarning[] {
  const out: FieldWarning[] = [];
  const visit = (nodes: SchemaNode[]) =>
    nodes.forEach((n) => {
      const messages = visibleWarnings(doc, n, ignored);
      if (messages.length > 0) out.push({ name: n.name, title: n.title, messages });
      if (n.properties) visit(n.properties);
    });
  visit(doc.schema.properties);
  return out;
}
