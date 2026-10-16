import { primaryBox } from '../../model/pdfAnchors';
import { getWidget } from '../../model/schemaWalk';
import { removeNode } from '../../model/tree';
import type { SchemaNode } from '../../model/types';
import type { Standard, StandardContext } from './types';
import { appendTo, detach, firstAlias, labelOf, nodesOf, patchUi, uniqueName, walk } from './util';

interface Mapping {
  mapping: string;
  signatureType: string;
  isOptional: boolean;
  [k: string]: unknown;
}

const mappingsOf = (ctx: StandardContext, sig: string): Mapping[] => {
  const raw = ctx.doc.uiSchema[sig]?.['ui:signature'];
  return Array.isArray(raw) ? (raw as Mapping[]) : [];
};

/** The signature widgets with where they sit on the PDF. */
const signaturesWithPosition = (ctx: StandardContext): { node: SchemaNode; page: number; top: number }[] =>
  nodesOf(ctx.doc, 'Signature').flatMap((node) => {
    const a = primaryBox(ctx.doc, node, ctx.anchors);
    return a ? [{ node, page: a.page, top: a.top }] : [];
  });

/** A field the General Partner fills ("Accepted Capital Commitment") belongs to the GP signature on its page. */
export const gpFilledFields: Standard = {
  id: 'gp-filled-fields',
  title: 'GP-filled fields go into the GP signature',
  source: 'rule',
  apply(ctx) {
    const targets: { name: string; node: SchemaNode; alias: string; label: string }[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      const label = labelOf(ctx.doc, n.name);
      if (w === 'Signature' || !/accepted\s+(capital\s+)?(commitment|amount)/i.test(label)) return;
      const alias = firstAlias(ctx.doc, n.name);
      if (alias) targets.push({ name: n.name, node: n, alias, label });
    });
    for (const t of targets) {
      const at = primaryBox(ctx.doc, t.node, ctx.anchors);
      const sig = at ? signaturesWithPosition(ctx).filter((s) => s.page === at.page && s.top >= at.top - 0.01).sort((a, b) => a.top - b.top)[0] : undefined;
      if (!sig) {
        ctx.warn(`GP FIELD: ${t.name} ("${t.label}") is filled by the General Partner but no signature follows it on its PDF page; it was left where it is`);
        continue;
      }
      const description = t.label.replace(/:\s*$/, '');
      patchUi(ctx, sig.node.name, {
        'ui:signatureType': 'GpSignature',
        'ui:signatureSigner': 'General Partner Signatory',
        'ui:signature': [
          ...mappingsOf(ctx, sig.node.name),
          { mapping: t.alias, signatureType: 'Custom', isOptional: false, customTypeConfig: { isCustomized: true, description, isCommitmentAmount: true } },
        ],
      });
      ctx.doc = removeNode(ctx.doc, t.name);
      ctx.log(`gp-filled-fields: moved "${description}" (${t.alias}) into the signature ${sig.node.name}, now a General Partner signature`);
    }
  },
};

/** What a signer fills while signing: date, printed name, title. Recognised by alias, only inside the signature's block. */
const SIGNER_FIELD: { type: string; alias: RegExp }[] = [
  { type: 'Date', alias: /^(date|gpdate)_/i },
  { type: 'Name', alias: /^(signername|printname|gpname)_/i },
  { type: 'Name', alias: /^name_.*signature/i },
  { type: 'Title', alias: /^(signertitle|position|gptitle)_/i },
  { type: 'Title', alias: /^title_.*signature/i },
];

/** Date, name and title fields of a signer block become part of the signature widget. */
export const signatureFields: Standard = {
  id: 'signature-fields',
  title: "Signer's date, name and title go into the signature widget",
  source: 'hybrid',
  apply(ctx) {
    const sigs = signaturesWithPosition(ctx).sort((a, b) => a.page - b.page || a.top - b.top);
    const taken = new Set<string>();
    walk(ctx.doc.schema.properties, (n) => {
      const w = getWidget(ctx.doc, n);
      if (w === 'Signature' || !['TextBox', 'Date', 'TextArea'].includes(w)) return;
      const alias = firstAlias(ctx.doc, n.name);
      const kind = alias ? SIGNER_FIELD.find((k) => k.alias.test(alias)) : undefined;
      const a = primaryBox(ctx.doc, n, ctx.anchors);
      if (!alias || !kind || !a) return;
      // The signature whose block this field belongs to: the one the alias names (signername_indi_x goes with signature_indi_x,
      // wherever the printed name sits), else the first one below it on the same PDF page.
      const fieldSuffix = alias.replace(/^[a-z]+_/i, '');
      const parts = (x: string): string[] => x.split('_');
      // (aliases the annotation truncated still match: signature_x_agreemen with title_x_agreement)
      const sameName = (x: string, y: string): boolean => x === y || (Math.min(x.length, y.length) >= 8 && (x.startsWith(y) || y.startsWith(x)));
      const sameNames = sigs.filter((s) => s.page === a.page && sameName(s.node.name.replace(/^(gp)?signature_/i, ''), fieldSuffix));
      // else the one signature whose name words are all in the field's (signername_witness_spouse_indi_x for signature_witness_spouse_x)
      const wordMatches = sigs.filter((s) => s.page === a.page && parts(s.node.name.replace(/^(gp)?signature_/i, '')).every((w) => parts(fieldSuffix).includes(w)));
      const longest = Math.max(0, ...wordMatches.map((s) => parts(s.node.name).length));
      const named = sameNames.length > 0 ? sameNames : wordMatches.filter((s) => parts(s.node.name).length === longest);
      const below = sigs.find((s) => s.page === a.page && s.top >= a.top - 0.01);
      const prev = below ? sigs.filter((s) => s.page === a.page && s.top < below.top).pop() : undefined;
      // several equally good names: the nearest of them below the field
      const owner = named.length === 1 ? named[0] : named.length > 1 ? (named.find((s) => s.top >= a.top - 0.01) ?? named[named.length - 1]) : below;
      if (!owner || (named.length === 0 && prev && a.top <= prev.top)) return;
      const next = [...mappingsOf(ctx, owner.node.name), { mapping: alias, signatureType: kind.type, isOptional: false }];
      patchUi(ctx, owner.node.name, { 'ui:signature': next });
      taken.add(n.name);
      ctx.log(`signature-fields: ${alias} added to ${owner.node.name} as ${kind.type}`);
    });
    taken.forEach((name) => {
      ctx.doc = removeNode(ctx.doc, name);
    });
  },
};

/** Every signature widget sits in a group at the end of the page it belongs to. */
export const signatureGroups: Standard = {
  id: 'signature-groups',
  title: 'Signature widgets in a group at the end of their page',
  source: 'rule',
  apply(ctx) {
    for (const page of nodesOf(ctx.doc, 'Page')) {
      const sigs: SchemaNode[] = [];
      walk(page.properties ?? [], (n) => {
        if (getWidget(ctx.doc, n) === 'Signature') sigs.push(n);
      });
      if (sigs.length === 0) continue;
      const name = uniqueName(ctx, `${page.name}_signatures`);
      sigs.forEach((s) => detach(ctx, s.name));
      ctx.doc = { ...ctx.doc, uiSchema: { ...ctx.doc.uiSchema, [name]: { 'ui:widget': 'Group', 'ui:marginBottom': '12px', 'ui:enabledComment': true } } };
      appendTo(ctx, page.name, { name, type: 'object', title: 'Signatures', properties: sigs });
      ctx.log(`signature-groups: ${sigs.length} signature widget(s) of "${page.title}" now sit in the group "${name}" at the end of the page`);
    }
  },
};
