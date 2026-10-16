import { anchorsFor } from '../../model/pdfAnchors';
import type { Anchors } from '../../model/pdfStore';
import { belowMap } from '../../model/fieldsBelow';
import { getWidget, isInvisible } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode } from '../../model/types';
import type { PageText } from '../pdfText';
import { childrenOf, isFixed, startNumber } from '../grouping';
import { labelOf, nodesOf, plainText } from '../standards/util';

export interface GroupItem {
  i: number;
  alias: string;
  widget: string;
  label: string;
  /** The question number the label starts with. */
  number: number | null;
  /** A heading, PDF or signature: never in a group. */
  fixed: boolean;
  /** Shown under an option of the element at this position: always in the same group as it. */
  belowOf: number | null;
  invisible: boolean;
  /** For an existing group or repeatable: how many elements it holds and the first labels. */
  size?: number;
  first?: string[];
}

export interface GroupPageFacts {
  page: string;
  title: string;
  items: GroupItem[];
  /** The text of the sub-doc pages the page's fields are on. */
  pdf: { page: number; text: string }[];
}

const short = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function itemsOf(doc: FormDoc, list: SchemaNode[]): GroupItem[] {
  const below = belowMap(doc);
  return list.map((n, i): GroupItem => {
    const widget = getWidget(doc, n);
    const label = widget === 'Header' ? String(doc.uiSchema[n.name]?.['ui:heading'] ?? n.title) : labelOf(doc, n.name) || n.title;
    const owner = below.get(n.name)?.parent;
    const at = owner ? list.findIndex((x) => x.name === owner) : -1;
    const kids = n.properties ?? [];
    return {
      i, alias: n.name, widget, label: short(plainText(label), 120), number: isFixed(doc, n) ? null : startNumber(labelOf(doc, n.name)), fixed: isFixed(doc, n),
      belowOf: at >= 0 ? at : null, invisible: isInvisible(doc, n.name),
      ...(kids.length > 0 && ['Group', 'Repeatable'].includes(widget) ? { size: kids.length, first: kids.slice(0, 3).map((k) => short(labelOf(doc, k.name) || k.title, 50)) } : {}),
    };
  });
}

/** Pages with enough to organise, as the AI is shown them: the elements in order, and the sub-doc text around them. */
export function groupPageFacts(doc: FormDoc, anchors: Anchors, pdf: PageText[] | null): GroupPageFacts[] {
  return nodesOf(doc, 'Page')
    .filter((p) => !isInvisible(doc, p.name))
    .flatMap((p): GroupPageFacts[] => {
      const list = childrenOf(doc, p.name);
      if (list.filter((n) => !isFixed(doc, n)).length < 4) return [];
      const onPages = new Set<number>();
      list.forEach((n) => {
        const walk = (x: SchemaNode): void => {
          anchorsFor(doc, x, anchors).forEach((a) => onPages.add(a.page + 1));
          (x.properties ?? []).forEach(walk);
        };
        walk(n);
      });
      const pages = [...onPages].sort((a, b) => a - b).slice(0, 4);
      return [{ page: p.name, title: p.title, items: itemsOf(doc, list), pdf: pdf ? pages.flatMap((n) => { const t = pdf.find((x) => x.page === n - 1); return t ? [{ page: n, text: t.text.slice(0, 1600) }] : []; }) : [] }];
    });
}
