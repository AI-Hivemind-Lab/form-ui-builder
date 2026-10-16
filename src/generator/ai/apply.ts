import { escapeHtml } from '../../model/html';
import { setRequired } from '../../model/editOps';
import type { Anchors } from '../../model/pdfStore';
import { findNode, getAllPages, getWidget, isInvisible } from '../../model/schemaWalk';
import { findParentName } from '../../model/addField';
import { removeNode } from '../../model/tree';
import type { FormDoc, SchemaNode, UiEntry } from '../../model/types';
import type { StandardContext } from '../standards/types';
import { capitalizeLabel } from '../standards/capitalize';
import { nameBlockRuleNote } from '../standards/subscriberName';
import { followUpsOf, normalizeYesNo } from '../standards/yesNo';
import { fileGroupParts, helpTextHtml, infoWell, submitMessageHtml } from '../standards/fileGroup';
import { firstAlias, inNumberedQuestion, isNumbered, labelOf, patchUi, uniqueName, walk } from '../standards/util';
import { holds, resolveRange, wrapSiblings } from '../grouping';
import { confirmationParts, signingNote } from '../standards/embeddedConfirmation';
import { REVIEW_SENTENCE } from '../standards/pdfPages';
import { lostTexts, lostWarning } from '../coverage';
import { emptyPages } from '../standards/emptyPages';
import { groupAlias } from './supportingDocs';
import { wellFor } from '../standards/wells';
import type { Decision, InvestorTypeData } from './types';

const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
const REQUIRED_MSG = 'This field is required';
const star = (h: string): string => (/<\/p>\s*$/.test(h) ? h.replace(/<\/p>\s*$/, `${STAR}</p>`) : h + STAR);
const bold = (text: string): string => `<p><strong>${escapeHtml(text)}</strong></p>`;
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'option';

export interface ApplyResult {
  doc: FormDoc;
  log: string[];
  warnings: string[];
}

// ------------------------------ tree helpers ------------------------------
function replaceNode(ctx: StandardContext, name: string, replacements: SchemaNode[]): void {
  const swap = (list: SchemaNode[]): SchemaNode[] =>
    list.flatMap((n) => (n.name === name ? replacements : [n.properties ? { ...n, properties: swap(n.properties) } : n]));
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) } };
}

/** Insert nodes into `parent` (null = top) at `index`. */
function insertAt(ctx: StandardContext, parent: string | null, index: number, nodes: SchemaNode[]): void {
  const put = (list: SchemaNode[]): SchemaNode[] => [...list.slice(0, index), ...nodes, ...list.slice(index)];
  const into = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => (n.name === parent ? { ...n, properties: put(n.properties ?? []) } : n.properties ? { ...n, properties: into(n.properties) } : n));
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: parent === null ? put(ctx.doc.schema.properties) : into(ctx.doc.schema.properties) } };
}

function addUi(ctx: StandardContext, entries: Record<string, UiEntry>): void {
  ctx.doc = { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, ...entries } };
}

/** A fresh node name that is free in the form and in this batch. */
function namer(ctx: StandardContext): (base: string) => string {
  const used = new Set(Object.keys(ctx.doc.uiSchema));
  walk(ctx.doc.schema.properties, (n) => used.add(n.name));
  return (base) => {
    let name = base;
    for (let i = 1; used.has(name); i += 1) name = `${base}_${i}`;
    used.add(name);
    return name;
  };
}

const textField = (name: string, label: string, required: boolean, extra: UiEntry = {}): { node: SchemaNode; ui: UiEntry } => {
  const html = `<p>${escapeHtml(label)}</p>`;
  const ui: UiEntry = { 'ui:widget': 'TextBox', 'ui:formattedText': required ? star(html) : html, 'ui:enabledComment': true, 'ui:marginBottom': '12px', ...extra };
  if (required) ui['ui:required'] = REQUIRED_MSG;
  return { node: { name, type: 'string', title: label }, ui };
};

const hiddenMerged = (name: string, pdfAliases: string | string[]): { node: SchemaNode; ui: UiEntry } => ({
  node: { name, type: 'string', title: name },
  ui: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': Array.isArray(pdfAliases) ? pdfAliases : [pdfAliases], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:invisible': true },
});

const mappingOf = (ctx: StandardContext, name: string): string[] => {
  const m = ctx.doc.uiSchema[name]?.['ui:pdfMapping'];
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string') : [];
};

/** Where moved fields land on a page: the "Subscriber Information" wrapper at the start of that page, created on first use. */
type Wrappers = Map<string, string>;

function wrapperFor(ctx: StandardContext, wrappers: Wrappers, pageName: string, title: string): string | null {
  const existing = wrappers.get(pageName) ?? existingWrapper(ctx, pageName, title);
  if (existing) {
    wrappers.set(pageName, existing);
    return existing;
  }
  const page = findNode(ctx.doc.schema.properties, pageName);
  if (!page) return null;
  const name = namer(ctx)('subscriber_information');
  addUi(ctx, { [name]: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true, 'ui:formattedText': bold(title) } });
  const header = (page.properties ?? []).findIndex((c) => getWidget(ctx.doc, c) === 'Header');
  // an investor type question already put at the top of the page goes first inside the new wrapper
  const typeQuestion = (page.properties ?? []).find((c) => c.name === 'investor_type');
  const inner = typeQuestion ? [typeQuestion] : [];
  if (typeQuestion) ctx.doc = removeKeepingUi(ctx.doc, typeQuestion.name);
  insertAt(ctx, pageName, header + 1, [{ name, type: 'object', title, properties: inner }]);
  wrappers.set(pageName, name);
  return name;
}

/** A "Subscriber Information" group an earlier change already made on this page (changes can be accepted one at a time). */
function existingWrapper(ctx: StandardContext, pageName: string, title: string): string | null {
  const page = findNode(ctx.doc.schema.properties, pageName);
  const hit = (page?.properties ?? []).find((c) => getWidget(ctx.doc, c) === 'Group' && /^subscriber_information/.test(c.name) && (c.title === title || labelOf(ctx.doc, c.name) === title));
  return hit?.name ?? null;
}

// ------------------------------ merging, prefilling and moving ------------------------------
/** The field that stands for an alias: the node itself, or the hidden box that took over its PDF mapping (name blocks, addresses, tax IDs). */
function holderOf(ctx: StandardContext, alias: string): string | null {
  if (findNode(ctx.doc.schema.properties, alias)) return alias;
  const found = Object.entries(ctx.doc.uiSchema).find(([n, ui]) => Array.isArray(ui['ui:pdfMapping']) && (ui['ui:pdfMapping'] as unknown[]).includes(alias) && findNode(ctx.doc.schema.properties, n));
  return found ? found[0] : null;
}

function applyMerge(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'merge-field' }>): void {
  const primaryName = holderOf(ctx, d.primaryAlias);
  if (!primaryName) return;
  const extra = d.mergedAliases.filter((a) => findNode(ctx.doc.schema.properties, a)).flatMap((a) => mappingOf(ctx, a));
  patchUi(ctx, primaryName, { 'ui:pdfMapping': [...new Set([...mappingOf(ctx, primaryName), ...extra])] });
  d.mergedAliases.forEach((a) => {
    if (a !== primaryName && findNode(ctx.doc.schema.properties, a)) ctx.doc = removeNode(ctx.doc, a);
  });
  ctx.log(`ai: ${primaryName} is one field mapped to ${1 + d.mergedAliases.length} PDF places (${extra.join(', ')} merged in)`);
}

function applyPrefilled(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'prefilled-field' }>): void {
  if (!findNode(ctx.doc.schema.properties, d.alias)) return;
  patchUi(ctx, d.alias, { 'ui:invisible': true });
  ctx.log(`ai: ${d.alias} is invisible and prefilled from ${d.sourceAlias}`);
  ctx.warn(`NEEDS RULE: prefill ${d.alias} from ${d.sourceAlias}`);
}

function applyMoves(ctx: StandardContext, wrappers: Wrappers, d: Extract<Decision['data'], { kind: 'move-fields' }>): void {
  const wrapper = wrapperFor(ctx, wrappers, d.targetPage, d.wrapperTitle);
  if (!wrapper) return;
  const moved: SchemaNode[] = [];
  // a question travels with the fields shown below its options (a note under "Yes", a "Please specify" box)
  const below = (alias: string): string[] => {
    const options = (ctx.doc.uiSchema[alias]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
    if (!Array.isArray(options)) return [];
    return options.flatMap((o) => {
      const list = Array.isArray(o) ? (o[1] as { fieldsBelow?: unknown } | null | undefined)?.fieldsBelow : undefined;
      return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string').flatMap((n) => [n, ...below(n)]) : [];
    });
  };
  // ...and with the indented follow-ups right under a Yes / No question
  const siblingsOf = (alias: string): SchemaNode[] => {
    let found: SchemaNode[] = [];
    const visit = (list: SchemaNode[]): void => {
      if (list.some((n) => n.name === alias)) found = list;
      else list.forEach((n) => n.properties && visit(n.properties));
    };
    visit(ctx.doc.schema.properties);
    return found;
  };
  [...new Set(d.aliases.flatMap((a) => [a, ...followUpsOf(ctx, siblingsOf(a), a), ...below(a)]))].forEach((a) => {
    const node = findNode(ctx.doc.schema.properties, a);
    if (!node) return;
    ctx.doc = removeKeepingUi(ctx.doc, a);
    moved.push(node);
  });
  if (moved.length === 0) return;
  const target = findNode(ctx.doc.schema.properties, wrapper);
  insertAt(ctx, wrapper, (target?.properties ?? []).length, moved);
  ctx.log(`ai: ${moved.length} field(s) moved to "${findNode(ctx.doc.schema.properties, d.targetPage)?.title ?? d.targetPage}" (group "${d.wrapperTitle}")`);
}

/** Take a node out of the tree but keep its ui entry (it is going somewhere else). */
function removeKeepingUi(doc: FormDoc, name: string): FormDoc {
  const strip = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === name ? [] : [n.properties ? { ...n, properties: strip(n.properties) } : n]));
  return { ...doc, schema: { ...doc.schema, properties: strip(doc.schema.properties) } };
}


// ------------------------------ the simple decisions ------------------------------
function applySignature(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'signature' }>): void {
  if (!findNode(ctx.doc.schema.properties, d.signatureAlias)) return;
  patchUi(ctx, d.signatureAlias, { 'ui:signatureSigner': d.signerName, 'ui:signatureType': d.role });
  ctx.log(`ai: ${d.signatureAlias} is signed by "${d.signerName}"${d.role === 'GpSignature' ? ' (General Partner)' : ''}`);
  if (d.sharedByAllInvestors && d.role === 'LpSignature') addIndividualSigner(ctx, d.signatureAlias);
}

/**
 * One signature block signed by every kind of investor: the block keeps the entity signer (Authorized Signatory) and a second widget,
 * Individual Signatory, maps the same PDF lines. The name stays required for the individual; the title is optional (an individual
 * has none to give).
 */
function addIndividualSigner(ctx: StandardContext, alias: string): void {
  const original = findNode(ctx.doc.schema.properties, alias);
  const ui = ctx.doc.uiSchema[alias];
  if (!original || !ui) return;
  const entries = (Array.isArray(ui['ui:signature']) ? (ui['ui:signature'] as { signatureType?: string; isOptional?: boolean }[]) : []);
  const individual = entries.map((e) => (e.signatureType === 'Title' ? { ...e, isOptional: true } : { ...e }));
  const name = namer(ctx)(`${alias}_individual`);
  addUi(ctx, { [name]: { ...ui, 'ui:signatureSigner': 'Individual Signatory', 'ui:signatureType': 'LpSignature', 'ui:signature': individual } });
  const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === alias ? [{ ...original, name, title: original.title }, n] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) } };
  ctx.log(`ai: ${alias} is also signed by an "Individual Signatory" (${name}): same lines, the name required and the title optional`);
  ctx.warn(`NEEDS RULE: show ${name} for individual investors and ${alias} for entities; both map the same PDF signature`);
}

function applySignatureField(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'signature-field' }>): void {
  const sig = ctx.doc.uiSchema[d.signatureAlias];
  const pdfAlias = firstAlias(ctx.doc, d.fieldAlias);
  if (!sig || !pdfAlias || !findNode(ctx.doc.schema.properties, d.fieldAlias)) return;
  const entry: Record<string, unknown> = { mapping: pdfAlias, signatureType: d.type, isOptional: false };
  if (d.type === 'Custom') entry.customTypeConfig = { isCustomized: true, description: d.description ?? labelOf(ctx.doc, d.fieldAlias) };
  patchUi(ctx, d.signatureAlias, { 'ui:signature': [...(Array.isArray(sig['ui:signature']) ? (sig['ui:signature'] as unknown[]) : []), entry] });
  ctx.doc = removeNode(ctx.doc, d.fieldAlias);
  ctx.log(`ai: ${pdfAlias} is signed with ${d.signatureAlias} as ${d.type}`);
}

/** A box the annotation left unlabelled gets the words the PDF prints for it (with the red star when it is required). */
function applyLabel(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'label' }>): void {
  const node = findNode(ctx.doc.schema.properties, d.alias);
  if (!node || labelOf(ctx.doc, d.alias) !== '') return; // someone labelled it meanwhile
  // the printed words, with the form's own rule that a label starts with a capital ("email:" is "Email:")
  const html = capitalizeLabel(`<p>${escapeHtml(d.text)}</p>`);
  patchUi(ctx, d.alias, { 'ui:formattedText': ctx.doc.uiSchema[d.alias]?.['ui:required'] ? star(html) : html });
  const title = html.replace(/<[^>]*>/g, '').slice(0, 120);
  const retitle = (list: SchemaNode[]): SchemaNode[] => list.map((n) => (n.name === d.alias ? { ...n, title } : n.properties ? { ...n, properties: retitle(n.properties) } : n));
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: retitle(ctx.doc.schema.properties) } };
  ctx.log(`ai: ${d.alias} is labelled "${d.text}", as printed on the PDF${d.source === 'ai' ? ' (the AI chose among nearby texts)' : ''}`);
}

function applyOptional(ctx: StandardContext, alias: string): void {
  if (!ctx.doc.uiSchema[alias]?.['ui:required']) return;
  ctx.doc = { ...ctx.doc, uiSchema: setRequired(ctx.doc.uiSchema, alias, false) };
  ctx.log(`ai: "${labelOf(ctx.doc, alias)}" (${alias}) is optional`);
}

function applyAcronym(ctx: StandardContext, word: string): void {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  const fix = (t: string): string => t.replace(re, word.toUpperCase());
  const retitle = (n: SchemaNode): SchemaNode => ({ ...n, title: getWidget(ctx.doc, n) === 'Page' || getWidget(ctx.doc, n) === 'Group' ? fix(n.title) : n.title, properties: n.properties?.map(retitle) });
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: ctx.doc.schema.properties.map(retitle) } };
  walk(ctx.doc.schema.properties, (n) => {
    const h = ctx.doc.uiSchema[n.name]?.['ui:heading'];
    if (typeof h === 'string') patchUi(ctx, n.name, { 'ui:heading': fix(h) });
  });
  ctx.log(`ai: "${word}" stays in capitals in titles`);
}

/** One postal address box becomes Country, Address, City, State, ZIP, Province, Postal code; a hidden box keeps the PDF mapping. */
function applyAddress(ctx: StandardContext, alias: string): void {
  const node = findNode(ctx.doc.schema.properties, alias);
  const pdfAlias = mappingOf(ctx, alias);
  if (!node || pdfAlias.length === 0) return;
  const required = Boolean(ctx.doc.uiSchema[alias]?.['ui:required']);
  const label = labelOf(ctx.doc, alias).replace(/:\s*$/, '');
  const name = namer(ctx);
  const parts: { node: SchemaNode; ui: UiEntry }[] = [];
  const country = name(`${alias}_country`);
  parts.push({ node: { name: country, type: 'string', title: 'Country' }, ui: { 'ui:widget': 'Country', 'ui:formattedText': required ? star('<p>Country</p>') : '<p>Country</p>', 'ui:placeholder': 'Select country', 'ui:enabledComment': true, 'ui:marginBottom': '12px', ...(required ? { 'ui:required': REQUIRED_MSG } : {}) } });
  const street = textField(name(`${alias}_street`), 'Address', required);
  const city = textField(name(`${alias}_city`), 'City / Town', required);
  parts.push(street, city);
  const stateUs = name(`${alias}_state_us`);
  parts.push({ node: { name: stateUs, type: 'string', title: 'U.S. States/Territories' }, ui: { 'ui:widget': 'State', 'ui:formattedText': required ? star('<p>U.S. States/Territories</p>') : '<p>U.S. States/Territories</p>', 'ui:enabledComment': true, 'ui:marginBottom': '12px', ...(required ? { 'ui:required': REQUIRED_MSG } : {}) } });
  const province = textField(name(`${alias}_province`), 'State / Province', false);
  parts.push(province);
  const zipUs = name(`${alias}_zip_us`);
  parts.push({ node: { name: zipUs, type: 'string', title: 'ZIP Code', format: 'USZIP' }, ui: { 'ui:widget': 'CustomFormat', 'ui:customFormat': 'USZIP', 'ui:formattedText': required ? star('<p>ZIP Code</p>') : '<p>ZIP Code</p>', 'ui:enabledComment': true, 'ui:marginBottom': '12px', ...(required ? { 'ui:required': REQUIRED_MSG } : {}) } });
  const postal = textField(name(`${alias}_postal`), 'Postal Code', false);
  parts.push(postal);
  const merged = hiddenMerged(name(`merged_${alias}`), pdfAlias);
  parts.push(merged);
  const group = name(`${alias}_address`);
  const { [alias]: _gone, ...rest } = ctx.doc.uiSchema;
  void _gone;
  ctx.doc = { ...ctx.doc, uiSchema: rest };
  // The layout of the Anduin address block: Country at half width, then rows of two (70% / 30%).
  const byName = (n: string) => parts.find((p) => p.node.name === n) as { node: SchemaNode; ui: UiEntry };
  const countryPart = byName(country);
  Object.assign(countryPart.ui, { 'ui:indentation': '16px', 'ui:width': '50%' });
  const rowOf = (suffix: string, title: string, fields: { node: SchemaNode; ui: UiEntry }[]): { node: SchemaNode; ui: UiEntry } => {
    fields.forEach((f) => Object.assign(f.ui, { 'ui:marginBottom': '0px' }));
    return {
      node: { name: name(`${alias}_${suffix}`), type: 'object', title, properties: fields.map((f) => f.node) },
      ui: { 'ui:widget': 'Group', 'ui:dynamicLayout': { sectionsWidth: [70, 30], gutter: 8 }, 'ui:indentation': '16px', 'ui:marginBottom': '12px', 'ui:enabledComment': true },
    };
  };
  const rows = [rowOf('row_street_city', 'Street and city', [street, city]), rowOf('row_us_state_zip', 'US state and ZIP code', [byName(stateUs), byName(zipUs)]), rowOf('row_state_postal', 'State/Province and postal code', [province, postal])];
  addUi(ctx, {
    [group]: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true, 'ui:formattedText': bold(label) },
    ...Object.fromEntries(parts.map((p) => [p.node.name, p.ui])),
    ...Object.fromEntries(rows.map((r) => [r.node.name, r.ui])),
  });
  replaceNode(ctx, alias, [{ name: group, type: 'object', title: label, properties: [countryPart.node, ...rows.map((r) => r.node), merged.node] }]);
  ctx.log(`ai: "${label}" (${alias}) is now a five-element address; the hidden box ${merged.node.name} keeps the PDF mapping`);
  ctx.warn(`NEEDS RULE: combine the five address elements of "${label}" into ${merged.node.name}`);
}

// ------------------------------ investor type ------------------------------
export { termUsed } from '../standards/subscriberName';

/** Where the question goes: the first visible page with fillable questions that does not show a full-page PDF. */
export function questionPage(ctx: StandardContext): SchemaNode | undefined {
  const visible = getAllPages(ctx.doc, true).filter((p) => !isInvisible(ctx.doc, p.name));
  const hasPdf = (p: SchemaNode) => (p.properties ?? []).some((c) => getWidget(ctx.doc, c) === 'Pdf' && ctx.doc.uiSchema[c.name]?.['ui:viewInModal'] !== true);
  const fillable = (p: SchemaNode) => {
    let n = 0;
    walk(p.properties ?? [], (c) => {
      if (['TextBox', 'TextArea', 'Radio', 'MultipleCheckbox', 'Dropdown', 'Date', 'Country'].includes(getWidget(ctx.doc, c))) n += 1;
    });
    return n > 0;
  };
  // the page that collects the subscriber's general information, when the form has one
  const general = visible.find((p) => !hasPdf(p) && fillable(p) && /general information|investor information|subscriber information/i.test(p.title));
  return general ?? visible.find((p) => !hasPdf(p) && fillable(p)) ?? visible.find((p) => !hasPdf(p)) ?? visible[0];
}

function applyInvestorType(ctx: StandardContext, data: InvestorTypeData, wrappers: Wrappers): void {
  const page = questionPage(ctx);
  if (!page) {
    ctx.warn('INVESTOR TYPE: the form has no visible page to put the question on');
    return;
  }
  const existingNode = data.existingGroupAlias ? findNode(ctx.doc.schema.properties, data.existingGroupAlias) : undefined;
  const existingUi = existingNode ? ctx.doc.uiSchema[existingNode.name] : undefined;
  const existingOptions = ((existingUi?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options ?? []) as [string, Record<string, unknown>][];
  // a list that is a numbered question, or one half of one, is copied: moving it would take its answers out of the question
  const numbered = existingNode ? isNumbered(labelOf(ctx.doc, existingNode.name)) || inNumberedQuestion(ctx.doc, existingNode.name) : false;
  const reuse = Boolean(existingNode) && !numbered;
  const name = namer(ctx);
  const used = new Set<string>();
  const optionsOf = (list: InvestorTypeData['individual']): [string, Record<string, unknown>][] =>
    list.map((o) => {
      const original = o.optionAlias ? existingOptions.find((e) => e[0] === o.optionAlias) : undefined;
      if (reuse && original) {
        used.add(original[0]);
        return [original[0], { ...original[1] }];
      }
      let value = `investor_type_${slug(o.label)}`;
      for (let i = 1; used.has(value) || existingOptions.some((e) => e[0] === value); i += 1) value = `investor_type_${slug(o.label)}_${i}`;
      used.add(value);
      return [value, { formattedText: `<p>${escapeHtml(o.label)}</p>`, blueprintMetadataMapping: '' }];
    });
  const individual = optionsOf(data.individual);
  const entity = optionsOf(data.entity);
  const nodes: { node: SchemaNode; ui: UiEntry }[] = [];
  const widgetFor = (base: string, label: string, options: [string, Record<string, unknown>][], checkbox: boolean) => {
    const n = name(base);
    const ui: UiEntry = {
      'ui:widget': checkbox ? 'MultipleCheckbox' : 'Radio', 'ui:formattedText': `<p>${escapeHtml(label)}</p>`, 'ui:pdfMapping': [], 'ui:enabledComment': true,
      'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default', 'ui:multipleOption': { options },
    };
    if (!checkbox) ui['ui:clearable'] = false;
    const node: SchemaNode = checkbox ? { name: n, type: 'array', title: label, items: { type: 'string', enum: options.map((o) => o[0]) } } : { name: n, type: 'string', title: label, enum: options.map((o) => o[0]) };
    nodes.push({ node, ui });
  };
  if (individual.length > 0) widgetFor('investor_type_individual', 'Individual', individual, false);
  if (entity.length > 0) widgetFor('investor_type_entity', 'Entity', entity, data.selectionMode === 'checkbox');
  if (nodes.length === 0) return;
  const group = name('investor_type'); // the heading carries an asterisk: one choice is needed across the two lists
  if (reuse && existingNode) ctx.doc = removeNode(ctx.doc, existingNode.name);
  addUi(ctx, {
    [group]: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true, 'ui:formattedText': `<p><strong>Please indicate if you are a:</strong>${STAR}</p>`, 'ui:dynamicLayout': { sectionsWidth: [50, 50], gutter: 12 } },
    ...Object.fromEntries(nodes.map((x) => [x.node.name, x.ui])),
  });
  const groupNode: SchemaNode = { name: group, type: 'object', title: 'Investor type', properties: nodes.map((x) => x.node) };
  const wrapper = wrappers.get(page.name) ?? existingWrapper(ctx, page.name, 'Subscriber Information');
  if (wrapper) insertAt(ctx, wrapper, 0, [groupNode]); // the same group as the moved fields, the question first
  else {
    const body = findNode(ctx.doc.schema.properties, page.name)?.properties ?? [];
    insertAt(ctx, page.name, body.findIndex((c) => getWidget(ctx.doc, c) === 'Header') + 1, [groupNode]);
  }
  ctx.log(`ai: investor type question added at the top of "${page.title}" (${data.individual.length} individual and ${data.entity.length} entity options${reuse ? `, moved from ${existingNode?.name}` : existingNode ? `, copied from the numbered list ${existingNode.name}` : ''})`);
  if (existingNode && !reuse) {
    // The numbered original keeps its place (and the PDF numbering) but is disabled; it is prefilled from the new question.
    patchUi(ctx, existingNode.name, { 'ui:disable': true });
    ctx.warn(`NEEDS RULE: prefill the numbered list ${existingNode.name} (disabled) from the new investor type question`);
  }
  ctx.warn('NEEDS RULE: require at least one choice across the two investor type lists; choosing in one list does not clear the other yet');
  data.unplaced.forEach((u) => ctx.warn(`INVESTOR TYPE: "${u}" is not placed in either column because the document does not say where it belongs`));
}

// ------------------------------ supporting documents ------------------------------
/** A file group right below the paragraph that lists the documents; one file item per document. */
function applySupportingDocs(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'supporting-docs' }>): void {
  const paragraph = findNode(ctx.doc.schema.properties, d.paragraphAlias);
  if (!paragraph || d.files.length === 0) return;
  let pageTitle = '';
  for (let cur = findParentName(ctx.doc, d.paragraphAlias); cur; cur = findParentName(ctx.doc, cur)) {
    const n = findNode(ctx.doc.schema.properties, cur);
    if (n && getWidget(ctx.doc, n) === 'Page') pageTitle = n.title;
  }
  const name = uniqueName(ctx, groupAlias(d.groupName, pageTitle));
  const { node, ui } = fileGroupParts(name, d.groupName, d.files.map((f) => ({ description: f.description, helpText: helpTextHtml(f.helpText) })));
  const noteName = uniqueName({ ...ctx, doc: { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, [name]: ui } } }, `${name}_note`);
  const note = infoWell(noteName, submitMessageHtml(d.files.map((f) => f.description)));
  if (!d.instead) {
    const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === d.paragraphAlias ? [n, node, note.node] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) }, uiSchema: { ...ctx.doc.uiSchema, [name]: ui, [noteName]: note.ui } };
    ctx.log(`ai: supporting documents "${d.groupName}" (${name}), ${d.files.length} file(s), below ${d.paragraphAlias}`);
    return;
  }
  // The sub-doc lets the investor hand the document in instead of completing the form: an optional checkbox, then the upload and the
  // message under it, all at the end of the page (before its signatures).
  const page = pageOf(ctx, d.paragraphAlias);
  if (!page) return;
  const checkName = uniqueName(ctx, `${name}_instead`);
  const docs = d.files.length === 1 ? `the ${/^[A-Z][a-z]/.test(d.files[0].description) ? d.files[0].description[0].toLowerCase() + d.files[0].description.slice(1) : d.files[0].description}` : 'the documents listed above';
  const check: SchemaNode = { name: checkName, type: 'array', title: 'Provide documents instead', items: { type: 'string', enum: ['instead'] } };
  const kids = page.properties ?? [];
  const lastIsSignatures = kids.length > 0 && kids[kids.length - 1].name.endsWith('_signatures');
  const at = lastIsSignatures ? kids.length - 1 : kids.length;
  insertAt(ctx, page.name, at, [check, node, note.node]);
  addUi(ctx, {
    [name]: ui,
    [noteName]: note.ui,
    [checkName]: {
      'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
      'ui:multipleOption': { options: [['instead', { formattedText: `<p>${escapeHtml(`Check this box if you would like to provide ${docs} instead of completing the form above.`)}</p>`, blueprintMetadataMapping: '', fieldsBelow: [name, noteName] }]] },
    },
  });
  ctx.log(`ai: supporting documents "${d.groupName}" (${name}) may replace the form on "${page.title}": an optional checkbox (${checkName}) opens them at the end of the page`);
  ctx.warn(`NEEDS RULE: when ${checkName} is checked, the fields above it on "${page.title}" are not required`);
}

/** The page a widget is on. */
function pageOf(ctx: StandardContext, alias: string): SchemaNode | null {
  for (let cur = findParentName(ctx.doc, alias); cur; cur = findParentName(ctx.doc, cur)) {
    const n = findNode(ctx.doc.schema.properties, cur);
    if (n && getWidget(ctx.doc, n) === 'Page') return n;
  }
  return null;
}

// ------------------------------ embedded PDFs ------------------------------
/** A new page for a part of the sub-doc the investor reads: its heading, the review sentence, and the pages cut from the sub-doc PDF. */
function applyEmbeddedPdf(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'embedded-pdf' }>): void {
  const page = uniqueName(ctx, slug(d.title) || 'embedded_pdf');
  const header = uniqueName(ctx, 'gen_header');
  const note = uniqueName(ctx, 'pdf_review_note');
  const pdf = uniqueName(ctx, `${page}_pdf`);
  // an agreement or a consent asks the investor to confirm it, right under the file
  const confirmName = d.confirm ? uniqueName(ctx, `${pdf}_${d.confirm}`) : '';
  const confirmation = d.confirm ? confirmationParts(confirmName, d.confirm) : null;
  // an agreement the investor signs says so (they sign after they submit the form)
  const signs = d.confirm === 'agreement' && Object.values(ctx.doc.uiSchema).some((u) => u['ui:widget'] === 'Signature');
  const signNote = signs ? signingNote(uniqueName(ctx, `${pdf}_signing_note`)) : null;
  const nodes: SchemaNode[] = [
    { name: header, type: 'null', title: d.title.toUpperCase() },
    { name: note, type: 'null', title: REVIEW_SENTENCE },
    { name: pdf, type: 'null', title: d.fileName },
    ...(confirmation ? [confirmation.node] : []),
    ...(signNote ? [signNote.node] : []),
  ];
  const ui: Record<string, UiEntry> = {
    [page]: { 'ui:widget': 'Page', 'ui:marginBottom': '12px', 'ui:pdfMapping': [], 'ui:signature': [] },
    [header]: { 'ui:widget': 'Header', 'ui:formattedText': 'Header', 'ui:heading': d.title.toUpperCase(), 'ui:headerType': 'Heading1', 'ui:marginBottom': '12px', ...(d.subtitle ? { 'ui:subtitle': d.subtitle } : {}) },
    [note]: { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p>${REVIEW_SENTENCE}</p>`, 'ui:wellType': 'Default', 'ui:marginBottom': '12px' },
    [pdf]: {
      'ui:widget': 'Pdf', 'ui:formattedText': '', 'ui:embeddedPdf': d.fileName, 'ui:height': '600pt', 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:pdfMapping': [], 'ui:signature': [],
      'ui:pdfCutInfo': { start: d.start, end: d.end, fileId: '', reviewingFileId: null },
    },
    ...(confirmation ? { [confirmName]: confirmation.ui } : {}),
    ...(signNote ? { [signNote.node.name]: signNote.ui } : {}),
  };
  const node: SchemaNode = { name: page, type: 'object', title: d.title, properties: nodes };
  const top = ctx.doc.schema.properties;
  const at = d.beforePage ? top.findIndex((n) => n.name === d.beforePage) : -1;
  const properties = at >= 0 ? [...top.slice(0, at), node, ...top.slice(at)] : [...top, node];
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties }, uiSchema: { ...ctx.doc.uiSchema, ...ui } };
  ctx.log(`ai: new page "${d.title}" with the pages ${d.start} - ${d.end} of the sub-doc as the PDF "${d.fileName}"`);
}

// ------------------------------ text the form never showed ------------------------------
/** A paragraph with the words the PDF prints, as printed, where they sit on the PDF page (after the element above, else before the one below). */
function applyAddText(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'add-text' }>): void {
  const text = d.text.replace(/\s+/g, ' ').trim();
  if (text === '') return;
  const name = uniqueName(ctx, 'paragraph_pdf');
  const well = wellFor(text);
  const ui: UiEntry = { 'ui:widget': 'Paragraph', 'ui:formattedText': `<p>${escapeHtml(text)}</p>`, 'ui:marginBottom': '12px', ...(well ? { 'ui:wellType': well } : {}) };
  const node: SchemaNode = { name, type: 'null', title: text.slice(0, 120) };
  const place = (list: SchemaNode[], parentIsPage: boolean): SchemaNode[] | null => {
    const at = d.after ? list.findIndex((n) => n.name === d.after) : d.before ? list.findIndex((n) => n.name === d.before) : -1;
    if (at >= 0) return [...list.slice(0, d.after ? at + 1 : at), node, ...list.slice(d.after ? at + 1 : at)];
    if (parentIsPage) {
      const last = list.length > 0 && list[list.length - 1].name.endsWith('_signatures') ? list.length - 1 : list.length; // before the page's signatures
      return [...list.slice(0, last), node, ...list.slice(last)];
    }
    return null;
  };
  let done = false;
  const visit = (list: SchemaNode[]): SchemaNode[] =>
    list.map((n) => {
      if (done) return n;
      const isPage = getWidget(ctx.doc, n) === 'Page';
      const target = d.page ? n.name === d.page : (n.properties ?? []).some((c) => c.name === d.after || c.name === d.before);
      if (target && n.properties) {
        const next = place(n.properties, isPage);
        if (next) {
          done = true;
          return { ...n, properties: next };
        }
      }
      return n.properties ? { ...n, properties: visit(n.properties) } : n;
    });
  const properties = visit(ctx.doc.schema.properties);
  if (!done) {
    ctx.warn(`TEXT NOT ADDED: the PDF page ${d.pdfPage} text "${text.slice(0, 60)}…" has no place on the form: the elements around it are not there any more`);
    return;
  }
  ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties }, uiSchema: { ...ctx.doc.uiSchema, [name]: ui } };
  ctx.log(`ai: the PDF text on page ${d.pdfPage} that the form did not show was added as the paragraph ${name}: "${text.slice(0, 70)}"`);
}

// ------------------------------ groups ------------------------------
/**
 * A group around the run of neighbours between two elements. The run is found by its two ends where the elements are NOW, so it works
 * after other groups were built around either end, and the biggest groups are built first so the ones inside them find their place.
 */
function applyGroup(ctx: StandardContext, d: Extract<Decision['data'], { kind: 'group' }>): void {
  const range = resolveRange(ctx.doc, d.fromAlias, d.toAlias);
  if (!range || range.to <= range.from) return;
  const list = findNode(ctx.doc.schema.properties, range.parent)?.properties ?? [];
  // the element that opens a group never goes inside it (the rule that shows it would depend on itself)
  if (d.controlAlias && list.slice(range.from, range.to + 1).some((n) => n.name === d.controlAlias || holds(ctx.doc, n.name, d.controlAlias as string))) {
    ctx.warn(`GROUP NOT BUILT: "${d.name}" would hold ${d.controlAlias}, the element that opens it`);
    return;
  }
  if (range.from === 0 && range.to === list.length - 1 && findNode(ctx.doc.schema.properties, range.parent) && getWidget(ctx.doc, findNode(ctx.doc.schema.properties, range.parent) as SchemaNode) === 'Group') return; // it would only wrap a group's whole content
  const alias = wrapSiblings(ctx, range.parent, range.from, range.to, d.name, slug(d.name) || 'group');
  ctx.log(`ai: group "${d.name}" (${alias}) holds ${range.to - range.from + 1} elements, from ${d.fromAlias} to ${d.toAlias}`);
  if (d.groupKind === 'conditional') ctx.warn(`NEEDS RULE: show ${alias} only when ${d.condition ?? 'the condition above holds'}${d.controlAlias ? ` (${d.controlAlias})` : ''}`);
}

// ------------------------------ entry point ------------------------------
/** Apply the accepted decisions, in a fixed order, to the form. */
export function applyDecisions(doc: FormDoc, anchors: Anchors, texts: string[], decisions: Decision[]): ApplyResult {
  const log: string[] = [];
  const warnings: string[] = [];
  const ctx: StandardContext = { doc, anchors, texts, log: (m) => log.push(m), warn: (m) => warnings.push(m) };
  const of = <K extends Decision['data']['kind']>(kind: K) => decisions.filter((d) => d.data.kind === kind).map((d) => d.data as Extract<Decision['data'], { kind: K }>);
  of('label').forEach((d) => applyLabel(ctx, d));
  of('signature').forEach((d) => applySignature(ctx, d));
  of('signature-field').forEach((d) => applySignatureField(ctx, d));
  const wrappers: Wrappers = new Map();
  of('merge-field').forEach((d) => applyMerge(ctx, d));
  of('prefilled-field').forEach((d) => applyPrefilled(ctx, d));
  of('move-fields').forEach((d) => applyMoves(ctx, wrappers, d));
  of('address').forEach((d) => applyAddress(ctx, d.alias));
  of('optional').forEach((d) => applyOptional(ctx, d.alias));
  of('acronym').forEach((d) => applyAcronym(ctx, d.word));
  of('supporting-docs').forEach((d) => applySupportingDocs(ctx, d));
  of('embedded-pdf').forEach((d) => applyEmbeddedPdf(ctx, d));
  of('add-text').forEach((d) => applyAddText(ctx, d));
  [...of('group')].sort((a, b) => b.size - a.size).forEach((d) => applyGroup(ctx, d)); // grouping runs last: the biggest groups first
  const type = of('investor-type')[0];
  if (type) {
    applyInvestorType(ctx, type.value, wrappers);
    nameBlockRuleNote(ctx);
  }
  normalizeYesNo(ctx); // whatever was moved or built, a Yes / No question stays on one line with indented follow-ups
  emptyPages.apply(ctx); // a change that moved everything off a page leaves no page with only its heading
  // a proposal must not take words off the form: what the form showed before and no longer shows is said
  const lost = decisions.length > 0 ? lostTexts(ctx.doc, texts, doc) : [];
  if (lost.length > 0) warnings.push(lostWarning(lost, 'TEXT LOST', 'text(s) the form showed are gone after this change'));
  return { doc: ctx.doc, log, warnings };
}
