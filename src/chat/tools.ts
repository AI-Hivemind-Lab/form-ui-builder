import { buildNewField, canContain, canSwitchTo, insertNode, switchWidget, validateName } from '../model/addField';
import { buildLabelHtml, getOptions, setOptions, setRequired } from '../model/editOps';
import { escapeHtml } from '../model/html';
import { findNode, getWidget, isInvisible } from '../model/schemaWalk';
import { moveNode, positionOf, removeNode, nodeLabel } from '../model/tree';
import type { FormDoc, Option, SchemaNode, UiEntry } from '../model/types';
import { belowMap } from '../model/fieldsBelow';
import { allWarnings, warningsFor } from '../model/warnings';
import { getWidgetDef, WIDGET_CATALOG } from '../model/widgetCatalog';
import { closeRange, resolveRange, wrapSiblings } from '../generator/grouping';
import { labelOf, plainText } from '../generator/standards/util';
import type { StandardContext } from '../generator/standards/types';
import type { ToolDef } from './types';

/** What a tool can reach: the form (read and edited), the selection, and the source PDF (read only). */
export interface ToolEnv {
  doc: FormDoc;
  selection: string | null;
  pdf?: {
    pageText(page: number): Promise<string | null>;
    pageImage(page: number): Promise<string | null>;
    pageCount(): Promise<number | null>;
  };
}

export interface ToolResult {
  /** What the model is told. */
  output: unknown;
  /** The form after the tool, when it changed it. */
  doc?: FormDoc;
  /** A picture of a PDF page, shown to the model with the result. */
  image?: { page: number; url: string };
}

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

const OPTION = {
  type: 'object',
  properties: {
    value: { type: 'string', description: 'The option value (an alias-like id, stays the same when the label changes).' },
    label: { type: 'string', description: 'The text the investor sees.' },
    fields_below: { type: 'array', items: { type: 'string' }, description: 'Aliases of fields shown under this option (they must be siblings of the choice).' },
  },
  required: ['value', 'label'],
};

export const TOOLS: ToolDef[] = [
  fn('get_form_outline', 'The structure of the form. Without "page": every page with its title and how many elements it holds. With "page": its elements as a tree (alias, widget, label, flags).',
    { page: { type: 'string', description: 'A page (or group) alias to open.' }, depth: { type: 'integer', description: 'How many levels to show (default 3).' } }),
  fn('search_form', 'Find elements by words in their alias, label or option text. Returns up to 25.', { query: { type: 'string' } }, ['query']),
  fn('get_widget', 'Everything about one element: widget type, label, required, its ui settings, options, where it sits and its children.', { alias: { type: 'string' } }, ['alias']),
  fn('update_widget', 'Change an element. Give only what changes. "ui" sets Form Builder ui:* keys (null removes a key). "options" replaces the options of a choice.',
    {
      alias: { type: 'string' },
      label: { type: 'string', description: 'New label as plain text (the required star is kept).' },
      label_html: { type: 'string', description: 'New label as simple HTML (<p>, <strong>, <em>, <ul><li>, <a>) when formatting matters.' },
      title: { type: 'string', description: 'The name shown in the table of contents.' },
      required: { type: 'boolean' },
      widget: { type: 'string', description: 'Switch the element to another widget type.' },
      ui: { type: 'object', description: 'ui:* keys to set; null deletes the key. Example {"ui:indentation": "24px", "ui:wellType": "Info"}.' },
      options: { type: 'array', items: OPTION },
    }, ['alias']),
  fn('add_widget', 'Add a new element. "parent" is the page or group it goes in; "after" the sibling it follows (omit to put it last).',
    {
      widget: { type: 'string', description: `One of: ${WIDGET_CATALOG.map((w) => w.id).join(', ')}` },
      parent: { type: 'string', description: 'Alias of the page or group (or null for the top level, for a new page).' },
      after: { type: 'string' },
      alias: { type: 'string', description: 'Optional alias (letters, digits, _).' },
      label: { type: 'string' },
      label_html: { type: 'string' },
      title: { type: 'string' },
      required: { type: 'boolean' },
      ui: { type: 'object' },
      options: { type: 'array', items: OPTION },
    }, ['widget', 'parent']),
  fn('delete_widget', 'Delete an element and everything inside it.', { alias: { type: 'string' } }, ['alias']),
  fn('move_widget', 'Move an element into another container, or to another place in its own.', { alias: { type: 'string' }, parent: { type: 'string', description: 'Alias of the new container (null for the top level).' }, after: { type: 'string', description: 'Sibling to follow; omit to put it last.' } }, ['alias', 'parent']),
  fn('group_widgets', 'Put a run of neighbouring elements (from first to last, in order) in one new Group. The group has only a name in the table of contents.',
    { from_alias: { type: 'string' }, to_alias: { type: 'string' }, name: { type: 'string', description: 'Name in the table of contents.' }, alias: { type: 'string' } }, ['from_alias', 'to_alias', 'name']),
  fn('get_pdf_page_text', 'The text of one page of the source PDF (the sub-doc), by page number from 1.', { page: { type: 'integer' } }, ['page']),
  fn('get_pdf_page_image', 'A picture of one page of the source PDF. Costs more than the text: use it only when the layout matters (checkboxes, tables, signature blocks).', { page: { type: 'integer' } }, ['page']),
];

// ------------------------------ reading ------------------------------
const labelFor = (doc: FormDoc, n: SchemaNode): string => {
  const w = getWidget(doc, n);
  return (w === 'Header' ? String(doc.uiSchema[n.name]?.['ui:heading'] ?? n.title) : w === 'Page' ? n.title : labelOf(doc, n.name) || n.title).replace(/\s+/g, ' ').slice(0, 100);
};

function line(doc: FormDoc, n: SchemaNode, depth: number, below: Map<string, { parent: string }>): string {
  const ui = doc.uiSchema[n.name] ?? {};
  const flags = [ui['ui:required'] ? '*' : '', isInvisible(doc, n.name) ? 'hidden' : '', below.has(n.name) ? `below ${below.get(n.name)?.parent}` : '', n.properties?.length ? `${n.properties.length} children` : ''].filter(Boolean).join(', ');
  return `${'  '.repeat(depth)}${n.name} [${getWidget(doc, n)}] ${labelFor(doc, n)}${flags ? `  (${flags})` : ''}`;
}

function outline(doc: FormDoc, page: string | undefined, maxDepth: number): unknown {
  if (!page) return { pages: doc.schema.properties.map((p) => ({ alias: p.name, widget: getWidget(doc, p), title: p.title, children: p.properties?.length ?? 0, hidden: isInvisible(doc, p.name) })) };
  const root = findNode(doc.schema.properties, page);
  if (!root) return { error: `There is no element "${page}". Use get_form_outline without a page, or search_form.` };
  const below = belowMap(doc);
  const lines: string[] = [];
  const visit = (list: SchemaNode[], depth: number): void => {
    for (const n of list) {
      if (lines.length >= 250) return;
      lines.push(line(doc, n, depth, below));
      if (n.properties && depth + 1 < maxDepth) visit(n.properties, depth + 1);
    }
  };
  lines.push(line(doc, root, 0, below));
  visit(root.properties ?? [], 1);
  return { outline: lines.join('\n'), truncated: lines.length >= 250 };
}

function search(doc: FormDoc, query: string): unknown {
  const q = query.toLowerCase().trim();
  if (q === '') return { error: 'Give some words to look for.' };
  const hits: { alias: string; widget: string; label: string; page: string | null }[] = [];
  const visit = (list: SchemaNode[], page: string | null): void => {
    for (const n of list) {
      const w = getWidget(doc, n);
      const opts = getOptions(doc.uiSchema[n.name], n).map((o) => o.label).join(' ');
      if (`${n.name} ${labelFor(doc, n)} ${opts}`.toLowerCase().includes(q) && hits.length < 25) hits.push({ alias: n.name, widget: w, label: labelFor(doc, n), page });
      if (n.properties) visit(n.properties, w === 'Page' ? n.name : page);
    }
  };
  visit(doc.schema.properties, null);
  return { matches: hits };
}

function widgetInfo(doc: FormDoc, alias: string): unknown {
  const node = findNode(doc.schema.properties, alias);
  if (!node) return { error: `There is no element "${alias}". Try search_form.` };
  const ui = doc.uiSchema[alias] ?? {};
  const pos = positionOf(doc, alias);
  return {
    alias, widget: getWidget(doc, node), title: node.title, type: node.type, label: plainText(ui['ui:formattedText']), required: Boolean(ui['ui:required']), hidden: isInvisible(doc, alias),
    parent: pos?.parent ?? null, index: pos?.index ?? null,
    below_of: belowMap(doc).get(alias) ?? null,
    options: getOptions(ui, node).map((o) => ({ value: o.value, label: o.label, fields_below: o.fieldsBelow ?? [] })),
    children: (node.properties ?? []).map((c) => ({ alias: c.name, widget: getWidget(doc, c), label: labelFor(doc, c) })),
    schema: { type: node.type, enum: node.enum, items: node.items, format: node.format },
    ui,
    warnings: warningsFor(doc, node),
  };
}

// ------------------------------ editing ------------------------------
const stripUnsafe = (html: string): string => html.replace(/<\s*(script|style|iframe|object)[\s\S]*?<\s*\/\s*\1\s*>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');

function syncOptions(doc: FormDoc, alias: string, options: Option[]): FormDoc {
  const node = findNode(doc.schema.properties, alias) as SchemaNode;
  const widget = getWidget(doc, node);
  const values = options.map((o) => o.value);
  const next: SchemaNode = widget === 'MultipleCheckbox' || widget === 'MultipleSuggest' ? { ...node, items: { type: 'string', enum: values } } : { ...node, enum: values };
  const swap = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === alias ? { ...next, ...(n.properties ? { properties: n.properties } : {}) } : n.properties ? { ...n, properties: swap(n.properties) } : n));
  return { ...doc, schema: { ...doc.schema, properties: swap(doc.schema.properties) }, uiSchema: setOptions(doc.uiSchema, alias, options) };
}

interface Edit {
  label?: string;
  label_html?: string;
  title?: string;
  required?: boolean;
  ui?: Record<string, unknown>;
  options?: { value: string; label: string; fields_below?: string[] }[];
}

/** The edits every update and add share, applied to one element of `doc`. */
function applyEdit(doc: FormDoc, alias: string, e: Edit): { doc: FormDoc; changed: string[] } | { error: string } {
  let d = doc;
  const changed: string[] = [];
  const node = findNode(d.schema.properties, alias) as SchemaNode;
  const widget = getWidget(d, node);
  if (e.title !== undefined) {
    const t = e.title;
    const swap = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === alias ? { ...n, title: t } : n.properties ? { ...n, properties: swap(n.properties) } : n));
    d = { ...d, schema: { ...d.schema, properties: swap(d.schema.properties) } };
    changed.push('title');
  }
  if (e.label_html !== undefined || e.label !== undefined) {
    const required = Boolean(d.uiSchema[alias]?.['ui:required']);
    const html = e.label_html !== undefined ? stripUnsafe(e.label_html) : widget === 'Paragraph' ? `<p>${escapeHtml(e.label ?? '')}</p>` : buildLabelHtml(e.label ?? '', required);
    d = { ...d, uiSchema: { ...d.uiSchema, [alias]: { ...d.uiSchema[alias], 'ui:formattedText': html } } };
    changed.push('label');
  }
  if (e.ui) {
    const next: UiEntry = { ...d.uiSchema[alias] };
    for (const [k, v] of Object.entries(e.ui)) {
      if (!k.startsWith('ui:')) return { error: `"${k}" is not a ui:* key.` };
      if (k === 'ui:widget') return { error: 'Switch the widget with the "widget" argument.' };
      if (v === null) delete next[k];
      else next[k] = v;
      changed.push(k);
    }
    d = { ...d, uiSchema: { ...d.uiSchema, [alias]: next } };
  }
  if (e.options) {
    if (!['Radio', 'Dropdown', 'MultipleCheckbox', 'MultipleSuggest'].includes(widget)) return { error: `${alias} is a ${widget}: it has no options.` };
    const values = e.options.map((o) => o.value);
    if (new Set(values).size !== values.length) return { error: 'Two options have the same value.' };
    d = syncOptions(d, alias, e.options.map((o) => ({ value: o.value, label: o.label, ...(o.fields_below ? { fieldsBelow: o.fields_below } : {}) })));
    changed.push('options');
  }
  if (e.required !== undefined) {
    d = { ...d, uiSchema: setRequired(d.uiSchema, alias, e.required) };
    changed.push('required');
  }
  return { doc: d, changed };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function update(doc: FormDoc, a: Record<string, unknown>): ToolResult {
  const alias = str(a.alias) ?? '';
  const node = findNode(doc.schema.properties, alias);
  if (!node) return { output: { error: `There is no element "${alias}". Try search_form.` } };
  let d = doc;
  const changed: string[] = [];
  const widget = str(a.widget);
  if (widget && widget !== getWidget(d, node)) {
    if (!getWidgetDef(widget)) return { output: { error: `Unknown widget "${widget}".` } };
    if (!canSwitchTo(d, alias, widget)) return { output: { error: `${alias} cannot become a ${widget}.` } };
    const sw = switchWidget(node, d.uiSchema[alias] ?? {}, widget);
    const swap = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === alias ? { ...sw.node, ...(n.properties ? { properties: n.properties } : {}) } : n.properties ? { ...n, properties: swap(n.properties) } : n));
    d = { ...d, schema: { ...d.schema, properties: swap(d.schema.properties) }, uiSchema: { ...d.uiSchema, [alias]: sw.ui } };
    changed.push('widget');
  }
  const r = applyEdit(d, alias, { label: str(a.label), label_html: str(a.label_html), title: str(a.title), required: typeof a.required === 'boolean' ? a.required : undefined, ui: a.ui && typeof a.ui === 'object' ? (a.ui as Record<string, unknown>) : undefined, options: Array.isArray(a.options) ? (a.options as Edit['options']) : undefined });
  if ('error' in r) return { output: r };
  if (changed.length + r.changed.length === 0) return { output: { ok: true, note: 'Nothing to change.' } };
  return { doc: r.doc, output: { ok: true, alias, changed: [...changed, ...r.changed] } };
}

function add(doc: FormDoc, a: Record<string, unknown>): ToolResult {
  const widget = str(a.widget) ?? '';
  if (!getWidgetDef(widget)) return { output: { error: `Unknown widget "${widget}". Use one of: ${WIDGET_CATALOG.map((w) => w.id).join(', ')}.` } };
  const parent = a.parent === null || a.parent === undefined || a.parent === 'null' ? null : String(a.parent);
  if (parent !== null && !findNode(doc.schema.properties, parent)) return { output: { error: `There is no container "${parent}".` } };
  if (parent !== null && !canContain(doc, parent, widget)) return { output: { error: `"${parent}" cannot contain a ${widget}.` } };
  const after = a.after === null || a.after === undefined ? null : String(a.after);
  const built = buildNewField(doc, widget);
  let node = built.node;
  const alias = str(a.alias);
  if (alias) {
    const problem = validateName(doc, alias);
    if (problem) return { output: { error: problem } };
    node = { ...node, name: alias };
  }
  let d: FormDoc;
  try {
    d = insertNode(doc, node, built.ui, { parent, after });
  } catch (e) {
    return { output: { error: e instanceof Error ? e.message : 'Could not add it.' } };
  }
  const r = applyEdit(d, node.name, { label: str(a.label), label_html: str(a.label_html), title: str(a.title), required: typeof a.required === 'boolean' ? a.required : undefined, ui: a.ui && typeof a.ui === 'object' ? (a.ui as Record<string, unknown>) : undefined, options: Array.isArray(a.options) ? (a.options as Edit['options']) : undefined });
  if ('error' in r) return { output: r };
  return { doc: r.doc, output: { ok: true, alias: node.name, widget } };
}

function remove(doc: FormDoc, alias: string): ToolResult {
  const node = findNode(doc.schema.properties, alias);
  if (!node) return { output: { error: `There is no element "${alias}".` } };
  const d = removeNode(doc, alias);
  return { doc: d, output: { ok: true, deleted: alias, children_deleted: (node.properties ?? []).length } };
}

function move(doc: FormDoc, a: Record<string, unknown>): ToolResult {
  const alias = str(a.alias) ?? '';
  if (!findNode(doc.schema.properties, alias)) return { output: { error: `There is no element "${alias}".` } };
  const parent = a.parent === null || a.parent === 'null' ? null : String(a.parent);
  const siblings = (parent === null ? doc.schema.properties : (findNode(doc.schema.properties, parent)?.properties ?? [])).filter((n) => n.name !== alias);
  const after = a.after === null || a.after === undefined ? null : String(a.after);
  let index = siblings.length;
  if (after !== null) {
    const at = siblings.findIndex((n) => n.name === after);
    if (at < 0) return { output: { error: `"${after}" is not in ${parent ?? 'the top level'}.` } };
    index = at + 1;
  }
  try {
    return { doc: moveNode(doc, alias, parent, index), output: { ok: true, alias, parent, index } };
  } catch (e) {
    return { output: { error: e instanceof Error ? e.message : 'It cannot be moved there.' } };
  }
}

function group(doc: FormDoc, a: Record<string, unknown>): ToolResult {
  const from = str(a.from_alias) ?? '';
  const to = str(a.to_alias) ?? '';
  const name = (str(a.name) ?? '').trim();
  if (name === '') return { output: { error: 'The group needs a name.' } };
  const range = resolveRange(doc, from, to);
  if (!range || range.to <= range.from) return { output: { error: `"${from}" and "${to}" are not two different neighbours in the same container (from first to last).` } };
  const list = findNode(doc.schema.properties, range.parent)?.properties ?? [];
  const closed = closeRange(doc, list, range.from, range.to);
  if (!closed || closed[0] !== range.from || closed[1] !== range.to) return { output: { error: 'That run would hold a heading, PDF or signature, or split a question from the fields shown under its options. Include those fields, or leave them out together.' } };
  const ctx: StandardContext = { doc, anchors: {}, texts: [], log: () => {}, warn: () => {} };
  const alias = str(a.alias)?.trim();
  if (alias) {
    const problem = validateName(doc, alias);
    if (problem) return { output: { error: problem } };
  }
  const made = wrapSiblings(ctx, range.parent, range.from, range.to, name, alias || name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'group');
  return { doc: ctx.doc, output: { ok: true, group: made, holds: range.to - range.from + 1 } };
}

/** Run one tool. Errors are answers, not exceptions: the model reads them and tries again. */
export async function runTool(name: string, args: Record<string, unknown>, env: ToolEnv): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_form_outline': return { output: outline(env.doc, str(args.page), typeof args.depth === 'number' ? Math.max(1, Math.min(8, args.depth)) : 3) };
      case 'search_form': return { output: search(env.doc, str(args.query) ?? '') };
      case 'get_widget': return { output: widgetInfo(env.doc, str(args.alias) ?? '') };
      case 'update_widget': return update(env.doc, args);
      case 'add_widget': return add(env.doc, args);
      case 'delete_widget': return remove(env.doc, str(args.alias) ?? '');
      case 'move_widget': return move(env.doc, args);
      case 'group_widgets': return group(env.doc, args);
      case 'get_pdf_page_text': {
        if (!env.pdf) return { output: { error: 'No source PDF is loaded in this browser. Ask the person to add it with the PDF button.' } };
        const page = Math.round(Number(args.page));
        const text = await env.pdf.pageText(page);
        return { output: text === null ? { error: `There is no page ${page}${(await env.pdf.pageCount()) ? ` (the PDF has ${await env.pdf.pageCount()} pages)` : ''}.` } : { page, text: text.slice(0, 6000) } };
      }
      case 'get_pdf_page_image': {
        if (!env.pdf) return { output: { error: 'No source PDF is loaded in this browser. Ask the person to add it with the PDF button.' } };
        const page = Math.round(Number(args.page));
        const url = await env.pdf.pageImage(page);
        return url ? { output: { page, note: 'The picture of the page follows.' }, image: { page, url } } : { output: { error: `Page ${page} could not be drawn.` } };
      }
      default: return { output: { error: `There is no tool "${name}".` } };
    }
  } catch (e) {
    return { output: { error: e instanceof Error ? e.message : 'The tool failed.' } };
  }
}

/** A few current facts about the form, given to the model with each question. */
export function formContext(doc: FormDoc, selection: string | null): string {
  const pages = doc.schema.properties.map((p) => `${p.name} (“${p.title}”, ${p.properties?.length ?? 0})`).join('; ');
  const sel = selection ? findNode(doc.schema.properties, selection) : undefined;
  const warnings = allWarnings(doc).length;
  return `Form pages: ${pages}.\n${sel ? `The person has selected: ${selection} [${getWidget(doc, sel)}] “${nodeLabel(doc, sel)}”.` : 'Nothing is selected.'}\nOpen warnings in the form: ${warnings}.`;
}

