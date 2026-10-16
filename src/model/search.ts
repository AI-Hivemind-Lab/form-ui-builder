import { findParentName } from './addField';
import { findNode, getWidget, uiOf } from './schemaWalk';
import { nodeLabel } from './tree';
import type { FormDoc, SchemaNode } from './types';

export type MatchedIn = 'alias' | 'text' | 'pdf';

export interface SearchHit {
  /** The widget's alias (its name in the schema). */
  name: string;
  widget: string;
  /** What the TOC shows for it. */
  label: string;
  /** The page that holds it (the page itself for a page). */
  page: string;
  /** Where the query was found. */
  matchedIn: MatchedIn[];
}

const plain = (html: unknown): string =>
  typeof html === 'string' ? html.replace(/<[^>]*>/g, ' ').replace(/FOOT_NOTE_HERE/g, ' ').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Everything a widget says to the user: its label, heading, and the text of each option. */
export function textOfWidget(doc: FormDoc, node: SchemaNode): string {
  const ui = uiOf(doc, node.name);
  const parts: string[] = [plain(ui['ui:formattedText']), typeof ui['ui:heading'] === 'string' ? ui['ui:heading'] : '', node.title];
  const options = (ui['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  if (Array.isArray(options)) options.forEach((o) => Array.isArray(o) && parts.push(plain((o[1] as { formattedText?: unknown } | null)?.formattedText)));
  return norm(parts.join(' '));
}

/**
 * Widgets whose alias, PDF mapping alias or text contains every word of the query (case and spacing ignored), in form order.
 * `where` narrows the search: only aliases, only text, or everything.
 */
export function searchWidgets(doc: FormDoc, query: string, where: 'all' | 'alias' | 'text' = 'all'): SearchHit[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const hits: SearchHit[] = [];
  const pageOf = (name: string): string => {
    for (let cur: string | null | undefined = name; cur; cur = findParentName(doc, cur)) {
      const node = findNode(doc.schema.properties, cur);
      if (node && getWidget(doc, node) === 'Page') return cur;
    }
    return '';
  };
  const visit = (nodes: SchemaNode[]): void =>
    nodes.forEach((node) => {
      const ui = uiOf(doc, node.name);
      const alias = norm(node.name);
      const mapping = norm((Array.isArray(ui['ui:pdfMapping']) ? (ui['ui:pdfMapping'] as unknown[]) : []).filter((m) => typeof m === 'string').join(' '));
      const text = textOfWidget(doc, node);
      const matches = (haystack: string): boolean => haystack !== '' && words.every((w) => haystack.includes(w));
      const matchedIn: MatchedIn[] = [];
      if (where !== 'text' && matches(alias)) matchedIn.push('alias');
      if (where !== 'text' && matches(mapping)) matchedIn.push('pdf');
      if (where !== 'alias' && matches(text)) matchedIn.push('text');
      if (matchedIn.length > 0) hits.push({ name: node.name, widget: getWidget(doc, node), label: nodeLabel(doc, node), page: pageOf(node.name), matchedIn });
      if (node.properties) visit(node.properties);
    });
  visit(doc.schema.properties);
  return hits;
}
