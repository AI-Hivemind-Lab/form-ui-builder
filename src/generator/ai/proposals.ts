import { getAllPages, isInvisible } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../../model/types';
import type { Anchors } from '../../model/pdfStore';
import { applyDecisions, questionPage } from './apply';
import type { Decision } from './types';

/** What the AI proposed for a form, kept with it so the proposals can be accepted one by one while editing. */
export interface ProposalSet {
  decisions: Decision[];
  /** Things the AI skipped or could not do, for the person to read. */
  notes: string[];
  /** The annotation's texts (applying a change needs them). */
  texts: string[];
}

export const KIND_LABELS: Record<string, string> = {
  'investor-type': 'Investor type question',
  signature: 'Signer',
  'signature-field': 'Signed with a signature',
  address: 'Address',
  optional: 'Optional field',
  acronym: 'Capitals in titles',
  label: 'Label from the PDF',
  'merge-field': 'One field for several PDF places',
  'prefilled-field': 'Invisible, prefilled field',
  'move-fields': 'Move off a PDF page',
  'supporting-docs': 'Supporting documents',
  'embedded-pdf': 'Embedded PDF page',
  group: 'Group',
  'add-text': 'Text from the PDF',
};

/**
 * The widgets a proposal is shown on, in the form. A proposal with none (capitals in titles) is only in the list.
 * An investor type question has no widget yet unless it copies a list: it is shown on the page it would go to.
 */
export function anchorsOf(d: Decision, doc: FormDoc): string[] {
  const data = d.data;
  switch (data.kind) {
    case 'label':
    case 'optional':
    case 'address':
    case 'prefilled-field':
      return [data.alias];
    case 'signature':
      return [data.signatureAlias];
    case 'signature-field':
      return [data.fieldAlias];
    case 'merge-field':
      return [data.primaryAlias];
    case 'move-fields':
      return data.aliases.slice(0, 1);
    case 'supporting-docs':
      return [data.paragraphAlias];
    case 'group':
      return [data.fromAlias];
    case 'add-text':
      return [data.after ?? data.before ?? data.page ?? ''].filter(Boolean);
    case 'embedded-pdf': {
      // shown on the page it goes before (or the last page when it goes at the end)
      const pages = getAllPages(doc, true).filter((p) => !isInvisible(doc, p.name));
      const target = data.beforePage && pages.some((p) => p.name === data.beforePage) ? data.beforePage : pages[pages.length - 1]?.name;
      return target ? [target] : [];
    }
    case 'investor-type': {
      if (data.value.existingGroupAlias) return [data.value.existingGroupAlias];
      const page = questionPage({ doc, anchors: {}, texts: [], log: () => {}, warn: () => {} });
      return page ? [page.name] : [];
    }
    case 'acronym':
      return [];
  }
}

/** The first visible page, for a proposal that has nowhere else to show. */
export const firstVisiblePage = (doc: FormDoc): string | null => getAllPages(doc, true).find((p) => !isInvisible(doc, p.name))?.name ?? null;

/** The proposals shown on one widget. */
export const proposalsOn = (proposals: Decision[], doc: FormDoc, name: string): Decision[] => proposals.filter((d) => anchorsOf(d, doc).includes(name));

/**
 * What a proposal builds, as the widgets to draw: the nodes of the form AFTER the change that are new, changed, or moved (the topmost
 * ones: a new group is drawn whole). `removed` are the nodes the change takes away, for a line of text.
 */
export function previewNodes(before: FormDoc, after: FormDoc): { show: string[]; removed: string[] } {
  const parents = (doc: FormDoc): Map<string, string | null> => {
    const map = new Map<string, string | null>();
    const visit = (list: SchemaNode[], parent: string | null): void => list.forEach((n) => { map.set(n.name, parent); visit(n.properties ?? [], n.name); });
    visit(doc.schema.properties, null);
    return map;
  };
  const nodeOf = (doc: FormDoc): Map<string, SchemaNode> => {
    const map = new Map<string, SchemaNode>();
    const visit = (list: SchemaNode[]): void => list.forEach((n) => { map.set(n.name, n); visit(n.properties ?? []); });
    visit(doc.schema.properties);
    return map;
  };
  const was = parents(before);
  const wasNode = nodeOf(before);
  const now = parents(after);
  const looks = (doc: FormDoc, n: SchemaNode): string => JSON.stringify([doc.uiSchema[n.name] ?? null, n.title, n.enum ?? null, n.format ?? null]);
  const show: string[] = [];
  const visit = (list: SchemaNode[]): void =>
    list.forEach((n) => {
      const old = wasNode.get(n.name);
      const changed = !old || was.get(n.name) !== now.get(n.name) || looks(before, old) !== looks(after, n);
      if (changed) show.push(n.name);
      else visit(n.properties ?? []);
    });
  visit(after.schema.properties);
  const removed = [...was.keys()].filter((name) => !now.has(name));
  return { show, removed };
}

/**
 * Embedded PDF pages are never proposals on another page's content: they are built into the form as pages of their own (top level,
 * in sub-doc order), to be checked and deleted there. Takes them out of a proposal set and builds them.
 */
export function buildEmbeddedPages(doc: FormDoc, anchors: Anchors, set: ProposalSet): { doc: FormDoc; set: ProposalSet; log: string[]; built: number; pages: number; groups: number } {
  // embedded pages always; groups the AI is sure of (high or medium): the ones it is unsure of stay proposals
  const direct = (d: Decision): boolean => d.data.kind === 'embedded-pdf' || (d.data.kind === 'group' && d.confidence !== 'low');
  const chosen = set.decisions.filter(direct);
  if (chosen.length === 0) return { doc, set, log: [], built: 0, pages: 0, groups: 0 };
  const applied = applyDecisions(doc, anchors, set.texts, chosen);
  return {
    doc: applied.doc, set: { ...set, decisions: set.decisions.filter((d) => !direct(d)) }, log: applied.log, built: chosen.length,
    pages: chosen.filter((d) => d.data.kind === 'embedded-pdf').length, groups: chosen.filter((d) => d.data.kind === 'group').length,
  };
}
