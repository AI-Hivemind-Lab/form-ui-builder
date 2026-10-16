import { escapeHtml } from '../../model/html';
import type { Anchor } from '../../model/pdfStore';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import type { PdfLine } from '../pdfText';
import type { Standard, StandardContext } from './types';
import { firstAlias, labelOf, patchUi, plainText, uniqueName, walk } from './util';

/** The alias of the one box where the investor writes their initials; every selection that asks for initials links to it. */
export const INITIALS_ALIAS = 'initials';
export const INITIALS_FOOTNOTE = 'If you are filling out the form on behalf of an entity, please enter the initials of the person filling out the form.';
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
const REQUIRED_MSG = 'This field is required';
/** An annotated PDF box for initials: "riskofloss_initials_riskacknowledgement_x", "initials_option_e". */
const INITIAL_BOX = /(^|_)initials?(_|$)/i;
/** Initials fit in a small box: at most this share of the page's width (the boxes of real PDFs are about 0.08). */
const MAX_BOX_WIDTH = 0.15;

/** The investor's initials: a required free text box, with a footnote for forms filled on behalf of an entity. */
export function initialsFieldParts(name: string): { node: SchemaNode; ui: UiEntry } {
  const note = `<span data-title="${escapeHtml(`<p>${INITIALS_FOOTNOTE}</p>`)}">FOOT_NOTE_HERE</span>`;
  return {
    node: { name, type: 'string', title: 'Initials' },
    ui: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>Initials${note}${STAR}</p>`, 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:required': REQUIRED_MSG },
  };
}

function insertAfter(ctx: StandardContext, target: string, nodes: SchemaNode[]): boolean {
  let done = false;
  const put = (list: SchemaNode[]): SchemaNode[] =>
    list.flatMap((n) => {
      if (n.name === target) {
        done = true;
        return [n, ...nodes];
      }
      return [n.properties ? { ...n, properties: put(n.properties) } : n];
    });
  const properties = put(ctx.doc.schema.properties);
  if (done) ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties } };
  return done;
}

/**
 * The initials box exists once in the form, right after the investor's name (General Information). It is made on the first need and
 * returns its alias. A form that already has one keeps it.
 */
export function ensureInitialsField(ctx: StandardContext): string {
  const existing = ctx.doc.uiSchema[INITIALS_ALIAS];
  if (existing && existing['ui:widget'] === 'TextBox') return INITIALS_ALIAS;
  const name = uniqueName(ctx, INITIALS_ALIAS);
  const { node, ui } = initialsFieldParts(name);
  ctx.doc = { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, [name]: ui } };
  // after the name question: the name block, else the first box that asks for the investor's name, else the top of the first page with fields
  let target: string | undefined;
  walk(ctx.doc.schema.properties, (n) => {
    if (target) return;
    if (n.name === 'name_blocks' || (getWidget(ctx.doc, n) === 'TextBox' && /^(full legal )?name of (the )?(investor|subscriber)|^(investor|subscriber)['’]?s? name|^entity investor name/i.test(labelOf(ctx.doc, n.name)))) target = n.name;
  });
  if (target && insertAfter(ctx, target, [node])) {
    ctx.log(`initials: the Initials box (${name}) sits right after the investor's name (${target})`);
    return name;
  }
  const page = ctx.doc.schema.properties.flatMap((n) => (n.properties ?? []).length > 0 ? [n, ...(n.properties ?? [])] : [n]).find((n) => getWidget(ctx.doc, n) === 'Page' && !ctx.doc.uiSchema[n.name]?.['ui:invisible'] && (n.properties ?? []).some((c) => ['TextBox', 'Group', 'Radio'].includes(getWidget(ctx.doc, c))));
  const first = page?.properties?.find((c) => getWidget(ctx.doc, c) !== 'Header');
  if (page && first) {
    const before = page.properties?.[(page.properties?.indexOf(first) ?? 0) - 1];
    if (before) insertAfter(ctx, before.name, [node]);
    ctx.log(`initials: the Initials box (${name}) sits at the top of "${page.title}": the investor's name was not found`);
  } else ctx.warn(`INITIALS: the form has selections that ask for initials but no page to put the Initials box on; add a free text box with the alias "${INITIALS_ALIAS}"`);
  return name;
}

// ------------------------------ what the PDF prints beside each box ------------------------------
interface Row {
  text: string;
  /** A blank the sentence has to fill ("CAD$____"): the box that fills it, and the words the PDF gives for it. */
  blank?: { name: string; label: string };
}

const BULLET = /^[•·▪◦–]\s*/;
const swapInitial = (t: string): string => t.replace(/\bInitial\b/g, 'Check').replace(/\binitial\b/g, 'check');
const joined = (parts: string[]): string => parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
const segmentsOf = (l: PdfLine): { left: number; right: number; text: string }[] => l.segments ?? [{ left: 0, right: 1, text: l.text }];

interface Box {
  node: SchemaNode;
  parent: SchemaNode | null;
  alias: string;
  at: Anchor | undefined;
}

/** The text the PDF prints left of the initials column, for the lines of one row; a blank in the sentence and its instruction are taken out. */
function readRow(lines: PdfLine[], column: number, blanks: { name: string; at: Anchor }[]): Row {
  const main: string[] = [];
  const rest: string[] = [];
  let used: { name: string; at: Anchor } | undefined;
  let open = false; // inside a "[ Instruction: ... ]" that started after the blank
  for (const line of lines) {
    for (const seg of segmentsOf(line)) {
      if (seg.right > column + 0.004) continue; // the initials column ("Your initials")
      const blank = blanks.find((b) => line.top >= b.at.top - 0.004 && line.top <= b.at.bottom + 0.012 && seg.left >= b.at.right - 0.03);
      if (blank) used = blank;
      if (open || blank) {
        rest.push(seg.text);
        if (/\[/.test(seg.text) && !/\]/.test(seg.text)) open = true;
        if (/\]/.test(seg.text)) open = false;
      } else main.push(seg.text);
    }
    // a line with nothing but the rest of an instruction that opened earlier
  }
  let text = joined(main).replace(BULLET, '').replace(/\[\s*instruction[^\]]*\]/gi, '').replace(/_{2,}/g, ' ');
  const instruction = /\[\s*instruction\s*:?([^\]]*)\]?/i.exec(rest.join(' '))?.[1]?.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  if (used) {
    text = text.replace(/\s+of\s+[A-Za-z]{0,3}\$\s*$/, '').replace(/\s+/g, ' ').trim();
    if (text !== '' && !/[.!?;:]$/.test(text)) text += '.';
  }
  return { text: text.trim(), ...(used && instruction ? { blank: { name: used.name, label: instruction[0].toUpperCase() + instruction.slice(1) } } : {}) };
}

/**
 * The PDF page text of the rows of one run of initial boxes, and the lead-in above them. A row is the lines from its box down to the next
 * box (the last row goes on while the lines follow each other closely); the lead-in is what sits between the section's heading and the
 * first box.
 */
function readRun(ctx: StandardContext, boxes: Box[], groupTitle: string, blanksIn: Box[]): { leadIn: string; rows: Row[] } | null {
  const first = boxes[0].at;
  const page = ctx.pdf?.find((p) => p.page === first?.page);
  if (!first || !page || boxes.some((b) => !b.at || b.at.page !== first.page)) return null;
  const lines = [...page.lines].sort((a, b) => a.top - b.top);
  const column = Math.min(...boxes.map((b) => (b.at as Anchor).left));
  const sorted = [...boxes].sort((a, b) => (a.at as Anchor).top - (b.at as Anchor).top);
  const blanks = blanksIn.flatMap((b) => (b.at && b.at.page === first.page ? [{ name: b.node.name, at: b.at }] : []));
  const starts = sorted.map((b) => (b.at as Anchor).top - 0.004);
  const rows: Row[] = sorted.map((_, i) => {
    const from = starts[i];
    let to = i + 1 < starts.length ? starts[i + 1] : Infinity;
    const inside = lines.filter((l) => l.top >= from && l.top < to);
    if (to === Infinity) {
      // the last row: while the lines follow each other closely
      const kept: PdfLine[] = [];
      inside.forEach((l) => {
        const prev = kept[kept.length - 1];
        if (!prev || l.top - prev.top <= 0.02) kept.push(l);
      });
      to = kept.length > 0 ? kept[kept.length - 1].top + 0.001 : from;
      return readRow(kept, column, blanks.filter((b) => b.at.top >= from - 0.01 && b.at.top < to));
    }
    return readRow(inside, column, blanks.filter((b) => b.at.top >= from - 0.01 && b.at.top < to));
  });
  // the lead-in: between the section's heading and the first box
  const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const headingAt = groupTitle ? lines.findIndex((l) => l.top < starts[0] && norm(l.text) === norm(groupTitle)) : -1;
  const above = lines.filter((l) => l.top < starts[0] && (headingAt < 0 ? true : l.top > lines[headingAt].top + 0.004));
  const lead: PdfLine[] = [];
  for (let i = above.length - 1; i >= 0; i -= 1) {
    const l = above[i];
    const next = lead[0] ?? { top: starts[0] };
    if (headingAt < 0 && next.top - l.top > 0.022) break;
    lead.unshift(l);
    if (headingAt < 0 && lead.length >= 6) break;
  }
  const leadIn = swapInitial(joined(lead.flatMap((l) => segmentsOf(l).filter((s) => s.right <= column + 0.004).map((s) => s.text))));
  return { leadIn: leadIn.replace(/[:\s]+$/, ''), rows };
}

const ONLY_ONE = /\b(initial|check|select|mark)\s+(only\s+)?(one|1)\b|\bonly one\b|\bone (box|statement|of the following) only\b/i;
const SEVERAL = /\bmore than one\b|\bone or more\b|\ball (that|which) apply\b/i;

/**
 * Some PDFs ask for initials next to a statement instead of a check mark. The form collects the investor's initials once (the Initials
 * box, right after their name) and shows each such list as an ordinary checkbox or radio group; the initials go to the box beside the
 * statement that is chosen. The group is linked to the Initials box ("Initial signature alias"), and each option is mapped to the
 * PDF box beside its statement.
 */
export const initialSelections: Standard = {
  id: 'initial-selections',
  title: 'Statements the PDF asks the investor to initial become checkboxes linked to one Initials box',
  source: 'rule',
  apply(ctx) {
    const found: { box: Box; suffix: string }[] = [];
    walk(ctx.doc.schema.properties, (n, parent) => {
      if (getWidget(ctx.doc, n) !== 'TextBox' || ctx.doc.uiSchema[n.name]?.['ui:invisible'] || n.name === INITIALS_ALIAS) return;
      const alias = firstAlias(ctx.doc, n.name);
      if (!alias || alias === INITIALS_ALIAS || !INITIAL_BOX.test(alias)) return;
      // an initials box is small; a wide box named "initial_..." is an ordinary field
      const where = ctx.anchors[alias];
      if (where && where.right - where.left > MAX_BOX_WIDTH) return;
      found.push({ box: { node: n, parent, alias, at: ctx.anchors[alias] }, suffix: alias.replace(/^.*?initials?_?/i, '') });
    });
    if (found.length === 0) return;
    // a run: neighbours in the same parent that ask for the same thing
    const runs: { parent: SchemaNode | null; suffix: string; boxes: Box[] }[] = [];
    found.forEach((f) => {
      const run = runs[runs.length - 1];
      const sibs = f.box.parent?.properties ?? ctx.doc.schema.properties;
      const last = run?.boxes[run.boxes.length - 1];
      if (run && last && run.parent?.name === f.box.parent?.name && run.suffix === f.suffix && sibs.indexOf(f.box.node) === sibs.indexOf(last.node) + 1) run.boxes.push(f.box);
      else runs.push({ parent: f.box.parent, suffix: f.suffix, boxes: [f.box] });
    });
    const initials = ensureInitialsField(ctx);
    for (const run of runs) {
      const list = (run.parent ? findIn(ctx.doc.schema.properties, run.parent.name)?.properties : ctx.doc.schema.properties) ?? [];
      const firstBox = run.boxes[0];
      const at = list.findIndex((c) => c.name === firstBox.node.name);
      const groupTitle = run.parent ? (labelOf(ctx.doc, run.parent.name) || run.parent.title) : '';
      // boxes of the same section that fill a blank in a statement
      const blankNodes: Box[] = (list.filter((c) => getWidget(ctx.doc, c) === 'TextBox' && !run.boxes.some((b) => b.node.name === c.name) && !INITIAL_BOX.test(firstAlias(ctx.doc, c.name) ?? '')).map((c) => ({ node: c, parent: run.parent, alias: firstAlias(ctx.doc, c.name) ?? c.name, at: ctx.anchors[firstAlias(ctx.doc, c.name) ?? ''] })));
      const read = readRun(ctx, run.boxes, groupTitle, blankNodes);
      const before = list[at - 1];
      const beforeText = before && getWidget(ctx.doc, before) === 'Paragraph' ? plainText(ctx.doc.uiSchema[before.name]?.['ui:formattedText']) : '';
      const leadParagraph = /\binitial/i.test(beforeText); // the annotation already has the lead-in
      if (leadParagraph && before) patchUi(ctx, before.name, { 'ui:formattedText': swapInitial(String(ctx.doc.uiSchema[before.name]?.['ui:formattedText'] ?? '')) });
      const leadIn = leadParagraph ? '' : (read?.leadIn ?? '');
      const options = run.boxes.map((b, i) => {
        const own = labelOf(ctx.doc, b.node.name);
        const text = own !== '' ? swapInitial(own.replace(/:\s*$/, '')) : (read?.rows[i]?.text ?? '');
        return { alias: b.alias, text };
      });
      const hint = `${leadIn} ${beforeText} ${options.map((o) => o.text).join(' ')}`;
      const radio = ONLY_ONE.test(hint) && !SEVERAL.test(hint);
      const name = uniqueName(ctx, `${radio ? 'initialsradio' : 'initialscheckbox'}_${run.suffix || run.boxes[0].alias.replace(/initials?_?/i, '')}`.replace(/_+$/, ''));
      const ui: UiEntry = {
        'ui:widget': radio ? 'Radio' : 'MultipleCheckbox', 'ui:formattedText': leadIn || leadParagraph ? (leadIn ? `<p>${escapeHtml(leadIn)}${STAR}</p>` : '') : '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px',
        'ui:fixedLayout': 'Default', 'ui:required': REQUIRED_MSG, 'ui:initialSignatureAlias': initials,
        'ui:multipleOption': { options: options.map((o) => [o.alias, { formattedText: o.text ? `<p>${escapeHtml(o.text)}</p>` : '', blueprintMetadataMapping: '', pdfMappings: [o.alias] }]) },
      };
      const node: SchemaNode = radio
        ? { name, type: 'string', title: leadIn || 'Initials', enum: options.map((o) => o.alias) }
        : { name, type: 'array', title: leadIn || 'Initials', items: { type: 'string', enum: options.map((o) => o.alias) } };
      // the blanks of the statements come right after the group, with the words the PDF gives them
      const blanks = (read?.rows ?? []).flatMap((r) => (r.blank ? [r.blank] : []));
      const gone = new Set(run.boxes.map((b) => b.node.name));
      const moved: SchemaNode[] = [];
      blanks.forEach((b) => {
        const n = list.find((c) => c.name === b.name);
        if (!n) return;
        gone.add(n.name);
        moved.push(n);
        if (labelOf(ctx.doc, n.name) === '') patchUi(ctx, n.name, { 'ui:formattedText': `<p>${escapeHtml(b.label)}${STAR}</p>`, 'ui:required': REQUIRED_MSG });
      });
      const swap = (nodes: SchemaNode[]): SchemaNode[] =>
        nodes.flatMap((n) => {
          if (n.name === firstBox.node.name) return [node, ...moved];
          if (gone.has(n.name)) return [];
          return [n.properties ? { ...n, properties: swap(n.properties) } : n];
        });
      const uiSchema = Object.fromEntries(Object.entries(ctx.doc.uiSchema).filter(([k]) => !run.boxes.some((b) => b.node.name === k)));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) }, uiSchema: { ...uiSchema, [name]: ui } };
      ctx.log(`initial-selections: ${run.boxes.length} initial box(es) (${run.boxes.map((b) => b.alias).join(', ')}) became the ${radio ? 'radio' : 'checkbox'} group ${name}, linked to the Initials box "${initials}"`);
      if (options.some((o) => o.text === '')) ctx.warn(`LABEL MISSING: option ${options.filter((o) => o.text === '').map((o) => o.alias).join(', ')} of ${name} has no text: the PDF text beside the initial box could not be read`);
      if (leadIn === '' && !leadParagraph) ctx.warn(`LABEL MISSING: ${name} has no lead-in text (the sentence that asks the investor to choose)`);
    }
  },
};

function findIn(list: SchemaNode[], name: string): SchemaNode | undefined {
  for (const n of list) {
    if (n.name === name) return n;
    const hit = n.properties ? findIn(n.properties, name) : undefined;
    if (hit) return hit;
  }
  return undefined;
}
