import { escapeHtml } from '../../model/html';
import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode, UiEntry } from '../../model/types';
import type { Standard } from './types';
import { labelOf, plainText, walk } from './util';

const REQUIRED_MSG = 'This field is required';
/** Boxes the sub-doc repeats for the same name on its signature pages (annotation aliases like asa_fullname_investorname_generalinfo_0). */
const JOINT_TYPE = /joint|tenants?\b/i;
const NATURAL_TYPE = /^\s*(an?\s+)?(individual|natural person)\s*$/i;
const ENTITY_NAME_ALIAS = /^fulllegalname_entity_/i;
const NAME_COPY_ALIAS = /fullname_investorname|^fulllegalname_entity_|^(nameofinvestor|investorname)_/i;
/** "[Name of Investor]": the investor's name printed again above a signature. */
const BRACKET_NAME = /^\[?\s*name of (the )?(investor|subscriber)\s*\]?$/i;
/** "1." or "a)" at the start of a question. */
const NUMBERED = /^\s*(\d+[.)]|[a-z]\))\s*/;
const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';
const star = (h: string): string => (/<\/p>\s*$/.test(h) ? h.replace(/<\/p>\s*$/, `${STAR}</p>`) : h + STAR);

/** The question that asks for the subscriber's name ("1. Name of Subscriber:", "Subscriber Name:", "Full legal name"). */
export const NAME_LABEL = /^(\d+[.)]\s*|[a-z]\)\s*)?((full (legal )?)?name of (the )?(subscriber|investor)|(subscriber|investor)(['’]s)? (full )?(legal )?name)/i;

/** Subscriber or Investor: whichever the sub-doc itself uses more. */
export function termUsed(texts: string[]): 'Subscriber' | 'Investor' {
  const count = (re: RegExp) => texts.reduce((n, t) => n + (t.match(re)?.length ?? 0), 0);
  return count(/\binvestors?\b/gi) > count(/\bsubscribers?\b/gi) ? 'Investor' : 'Subscriber';
}

interface Part {
  node: SchemaNode;
  ui: UiEntry;
}

/**
 * The name of the person subscribing depends on who they are, so it is never one plain box (the Anduin investor names setup):
 * a natural person gives first / middle / last / suffix, joint tenants one box with the format note, any other individual
 * one box, an entity one box. "mergedname" is only for the natural person: a hidden box right below the four, which a rule later fills
 * with the combined name. It never holds an entity's name. Each block maps to the PDF fields of its own kind.
 * Which block shows for which investor type is a rule, not built here.
 */
export const subscriberName: Standard = {
  id: 'subscriber-name',
  title: 'Subscriber name as blocks per investor kind',
  source: 'hybrid',
  apply(ctx) {
    const candidates: SchemaNode[] = [];
    const copies: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const ui = ctx.doc.uiSchema[n.name] ?? {};
      if (getWidget(ctx.doc, n) !== 'TextBox') return;
      const mapping = ui['ui:pdfMapping'];
      if (!Array.isArray(mapping) || mapping.length === 0) return;
      const label = labelOf(ctx.doc, n.name);
      if (!ui['ui:invisible'] && (NAME_LABEL.test(label) || /^subscriber name/i.test(label) || (label !== '' && /^asa_fullname_investorname/i.test(String(mapping[0]))))) candidates.push(n);
      // the same name printed again on a signature page: same value, so it only needs the PDF mapping
      else if (NAME_COPY_ALIAS.test(String(mapping[0])) && (label === '' || NAME_LABEL.test(label) || BRACKET_NAME.test(label))) copies.push(n);
    });
    if (candidates.length === 0) return;
    // The numbered question is the real one; any other labelled "Subscriber Name" line is the same information.
    const target = candidates.find((n) => /^\s*\d+[.)]/.test(labelOf(ctx.doc, n.name))) ?? candidates[0];
    const folded = [...candidates.filter((n) => n !== target), ...copies];

    const term = termUsed(ctx.texts);
    const original = target.name;
    const originalUi = ctx.doc.uiSchema[original] ?? {};
    const mappingOf = (n: SchemaNode): string[] => ((ctx.doc.uiSchema[n.name]?.['ui:pdfMapping'] as unknown[]) ?? []).filter((m): m is string => typeof m === 'string');
    const allAliases = [...new Set([...mappingOf(target), ...folded.flatMap(mappingOf)])];
    // the entity's own name lines on the signature pages belong to the entity block only; the subscriber name line is shared by everyone
    const entityAliases = allAliases.filter((a) => ENTITY_NAME_ALIAS.test(a));
    const nameAliases = allAliases.filter((a) => !ENTITY_NAME_ALIAS.test(a));
    const required = Boolean(originalUi['ui:required']);
    // the question's own wording heads the blocks; a box labelled just "Name of Individual or Entity" has no heading to keep
    const originalLabel = labelOf(ctx.doc, original);
    const heading = NAME_LABEL.test(originalLabel) || /^subscriber name/i.test(originalLabel) ? (typeof originalUi['ui:formattedText'] === 'string' ? (originalUi['ui:formattedText'] as string) : `<p>${escapeHtml(target.title)}</p>`) : '';
    // A joint block only when the types the sub-doc lists include joint tenancy; a block for other individuals (an IRA) only when they
    // include those. The types are listed in the name question's own lead-in or in a "Type of Subscriber" list, not anywhere in the text.
    const typeTexts: string[] = [];
    let leadIn: SchemaNode | null = null;
    walk(ctx.doc.schema.properties, (n, parent) => {
      if (n === target) {
        const siblings = parent?.properties ?? ctx.doc.schema.properties;
        const before = siblings[siblings.indexOf(n) - 1];
        if (before && getWidget(ctx.doc, before) === 'Paragraph') {
          const lead = plainText(ctx.doc.uiSchema[before.name]?.['ui:formattedText']);
          typeTexts.push(lead);
          if (NUMBERED.test(lead) && NAME_LABEL.test(lead)) leadIn = before;
        }
      }
      const w = getWidget(ctx.doc, n);
      if ((w === 'Radio' || w === 'MultipleCheckbox') && /type of (subscriber|investor)|(investor|subscriber) type/i.test(labelOf(ctx.doc, n.name))) {
        const options = (ctx.doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
        if (Array.isArray(options)) options.forEach((o) => Array.isArray(o) && typeTexts.push(plainText((o[1] as { formattedText?: unknown } | null)?.formattedText)));
      }
    });
    const hasJoint = typeTexts.some((t) => /joint tenan|tenants? in common|\bjtwros\b/i.test(t));
    const hasOther = typeTexts.some((t) => /individual retirement/i.test(t) || /\bIRA\b/.test(t));

    const used = new Set<string>(Object.keys(ctx.doc.uiSchema));
    walk(ctx.doc.schema.properties, (n) => used.add(n.name));
    const name = (base: string): string => {
      let n = base;
      for (let i = 1; used.has(n); i += 1) n = `${base}_${i}`;
      used.add(n);
      return n;
    };
    const group = (base: string, title: string, extra: UiEntry = {}): { name: string; ui: UiEntry; title: string } => ({ name: name(base), title, ui: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true, ...extra } });
    const text = (base: string, title: string, label: string, isRequired: boolean, extra: UiEntry = {}): Part => {
      const html = `<p>${escapeHtml(label)}</p>`;
      return {
        node: { name: name(base), type: 'string', title },
        ui: { 'ui:widget': 'TextBox', 'ui:formattedText': isRequired ? star(html) : html, 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', ...(isRequired ? { 'ui:required': REQUIRED_MSG } : {}), ...extra },
      };
    };

    const first = text('firstname', 'First name', 'First name', required, { 'ui:marginBottom': '0px' });
    const middle = text('middlename', 'Middle name', 'Middle name', false, { 'ui:marginBottom': '0px' });
    const last = text('lastname', 'Last name', 'Last name', required, { 'ui:marginBottom': '0px' });
    const suffix = text('suffix', 'Suffix', 'Suffix', false, { 'ui:placeholder': 'Sr., Jr., II, III, IV, Esq., CPA', 'ui:width': '33%', 'ui:indentation': '16px', 'ui:marginBottom': '0px' });
    const note = `Joint ${term}s should enter their names in the format "Name 1 and Name 2 JTWROS/TIC/TBE". E.g. James Smith and Pauline Jones JTWROS.`;
    const jointLabel = `<p><strong>Print Full Name of ${term}(s)</strong>${required ? STAR : ''}</p><p><span style="color: rgb(79, 111, 137); font-size: 11px;">${escapeHtml(note)}</span></p>`;
    const joint = text('jointname', `Joint ${term.toLowerCase()} names`, '', required, { 'ui:formattedText': jointLabel, 'ui:marginBottom': '4px', 'ui:pdfMapping': nameAliases });
    const other = text('otherindividualsname', `Other individual ${term.toLowerCase()} name`, `Full Legal Name of ${term}`, required, { 'ui:pdfMapping': nameAliases });
    // The number of the question (on its lead-in or its own heading) is the number the entity's box carries: an entity never sees the
    // individual's block, and the next question would otherwise start at 2.
    const number = NUMBERED.exec(leadIn ? plainText(ctx.doc.uiSchema[(leadIn as SchemaNode).name]?.['ui:formattedText']) : originalLabel)?.[1] ?? '';
    const entity = text('entityname', `Entity ${term.toLowerCase()} name`, `${number ? `${number} ` : ''}Full Legal Name of ${term}`, required, { 'ui:pdfMapping': [...nameAliases, ...entityAliases] });
    const merged: Part = {
      node: { name: name('mergedname'), type: 'string', title: 'Merged name' },
      ui: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:pdfMapping': nameAliases, 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:invisible': true },
    };

    const row = group('name_individual', 'First / middle / last', { 'ui:dynamicLayout': { sectionsWidth: [33, 33, 34], gutter: 8 }, 'ui:indentation': '16px', 'ui:marginBottom': '12px' });
    const natural = group('name_natural_person', 'Natural person', { 'ui:indentation': '0px', 'ui:marginBottom': '20px' });
    const jointGroup = group('name_joint_tenants', 'Joint tenants / tenants in common');
    // A numbered heading belongs to the individual's blocks, because the entity's box carries the number itself.
    const headingMoves = NUMBERED.test(plainText(heading));
    const individuals = group('name_individuals', "Individual's names", headingMoves ? { 'ui:formattedText': heading } : {});
    const blocks = group('name_blocks', 'Name', heading && !headingMoves ? { 'ui:formattedText': heading } : {});

    const parts = [first, middle, last, suffix, ...(hasJoint ? [joint] : []), ...(hasOther ? [other] : []), entity, merged];
    const entries: Record<string, UiEntry> = { [blocks.name]: blocks.ui, [individuals.name]: individuals.ui, [natural.name]: natural.ui, [row.name]: row.ui, ...(hasJoint ? { [jointGroup.name]: jointGroup.ui } : {}) };
    parts.forEach((p) => {
      entries[p.node.name] = p.ui;
    });
    const movedLead = leadIn as SchemaNode | null;
    const tree: SchemaNode = {
      name: blocks.name, type: 'object', title: target.title,
      properties: [
        {
          name: individuals.name, type: 'object', title: individuals.title,
          properties: [
            ...(movedLead ? [movedLead] : []),
            { name: natural.name, type: 'object', title: natural.title, properties: [{ name: row.name, type: 'object', title: row.title, properties: [first.node, middle.node, last.node] }, suffix.node, merged.node] },
            ...(hasJoint ? [{ name: jointGroup.name, type: 'object', title: jointGroup.title, properties: [joint.node] } as SchemaNode] : []),
            ...(hasOther ? [other.node] : []),
          ],
        },
        entity.node,
      ],
    };
    const gone = new Set([original, ...folded.map((n) => n.name)]);
    const rest = Object.fromEntries(Object.entries(ctx.doc.uiSchema).filter(([k]) => !gone.has(k)));
    const swap = (list: SchemaNode[]): SchemaNode[] =>
      list.flatMap((n) => (n.name === original ? [tree] : gone.has(n.name) || n === movedLead ? [] : [n.properties ? { ...n, properties: swap(n.properties) } : n]));
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: swap(ctx.doc.schema.properties) }, uiSchema: { ...rest, ...entries } };
    ctx.log(`subscriber-name: "${labelOf(ctx.doc, blocks.name).slice(0, 60)}" (${original}) became name blocks (natural person, ${hasJoint ? 'joint tenants, ' : ''}${hasOther ? 'other individual, ' : ''}entity); the hidden box ${merged.node.name} sits below the four natural-person boxes; the blocks map to the PDF name fields of their own kind${folded.length > 0 ? ` of ${1 + folded.length} PDF places (${folded.map((n) => n.name).join(', ')} are not in the form any more)` : ''}`);
    ctx.warn(`NEEDS RULE: show ${[natural.name, ...(hasJoint ? [jointGroup.name] : []), ...(hasOther ? [other.node.name] : []), entity.node.name].join(', ')} by investor type (the investor type question comes from the AI review: it reuses, moves or copies the sub-doc's own type list)`);
    ctx.warn(`NEEDS RULE: combine first, middle, last name and suffix into ${merged.node.name}`);
  },
};

/**
 * Once an investor type question exists, say exactly which answers open which name block. The blocks map to the same Name of
 * Subscriber line and are mutually exclusive.
 */
export function nameBlockRuleNote(ctx: Parameters<Standard['apply']>[0]): void {
  const has = (n: string): boolean => Object.prototype.hasOwnProperty.call(ctx.doc.uiSchema, n);
  if (!has('name_natural_person') || !has('investor_type_individual')) return;
  const typeOptions = (column: string): { value: string; label: string }[] => {
    const raw = (ctx.doc.uiSchema[column]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
    return Array.isArray(raw) ? raw.flatMap((o) => (Array.isArray(o) && typeof o[0] === 'string' ? [{ value: o[0], label: plainText((o[1] as { formattedText?: unknown } | null)?.formattedText) }] : [])) : [];
  };
  const individualOptions = typeOptions('investor_type_individual');
  const names = (list: { value: string; label: string }[]): string => list.map((o) => `${o.label} (${o.value})`).join(', ') || 'none';
  const jointOptions = individualOptions.filter((o) => JOINT_TYPE.test(o.label));
  const naturalOptions = individualOptions.filter((o) => NATURAL_TYPE.test(o.label));
  const otherOptions = individualOptions.filter((o) => !jointOptions.includes(o) && !naturalOptions.includes(o));
  const clauses = [
    `show name_natural_person when investor_type_individual is ${names(has('name_joint_tenants') || has('otherindividualsname') ? naturalOptions : individualOptions)}`,
    ...(has('name_joint_tenants') ? [`name_joint_tenants when it is ${names(jointOptions)}`] : []),
    ...(has('otherindividualsname') ? [`otherindividualsname when it is ${names(otherOptions)}`] : []),
    'entityname when investor_type_entity has any choice',
  ];
  ctx.warn(`NEEDS RULE: ${clauses.join('; ')}. Each maps to the Name of Subscriber line, so only one shows at a time`);
}
