import { getWidget } from '../../model/schemaWalk';
import type { FormDoc, SchemaNode, UiEntry } from '../../model/types';
import type { Standard, StandardContext } from './types';
import { infoWell } from './fileGroup';
import { nodesOf, plainText, uniqueName, walk } from './util';

const RED = '<span style="color: rgb(219, 55, 55);">'; // #db3737, the color of the required asterisk
export const AGREE_TEXT = 'I confirm that I have read, understand, and agree to the above.';
export const CONSENT_TEXT = 'By checking this box, you consent to the above.';
const REQUIRED_MSG = 'This field is required';

export const SIGN_TEXT = 'After completing the form, you will be asked to sign the document during the signature process.';

/** The blue message on a page whose document the investor signs: signing is a later step, after the form is submitted. */
export const signingNote = (name: string): { node: SchemaNode; ui: UiEntry } => infoWell(name, `<p>${SIGN_TEXT}</p>`);

export type Confirmation = 'agreement' | 'consent';

/** What the document itself is called: "Fund II Form of Subscription Agreement - Privacy Notice.pdf" is "Privacy Notice" (the fund's name says nothing about it). */
const documentName = (name: string): string => (name.replace(/\.pdf$/i, '').split(/\s+[-–—]\s+/).pop() ?? name).trim();
/** Documents that only inform: nobody agrees to a set of instructions, a notice or a guide. */
const INFORMS = /\b(instructions?|directions?|notices?|privacy|guide(?:lines)?|annex(?:es)?|schedules?)\b/i;

/** What an embedded file asks of the investor, from its name: terms and representations to agree to, or a consent to give. */
export function confirmationFor(...names: string[]): Confirmation | null {
  const text = names.map(documentName).join(' ');
  if (!INFORMS.test(text) && /\b(agreement|representations?|warrant(?:y|ies)|undertakings?)\b/i.test(text)) return 'agreement';
  if (/\bconsents?\b/i.test(text)) return 'consent';
  return null;
}

/** The checkbox under the embedded file: no label of its own, one option. The agreement is required, in bold red, with the red asterisk. */
export function confirmationParts(name: string, kind: Confirmation): { node: SchemaNode; ui: UiEntry } {
  const value = kind === 'agreement' ? 'agree' : 'consent';
  const html = kind === 'agreement' ? `<p>${RED}<strong>${AGREE_TEXT} *</strong></span></p>` : `<p>${CONSENT_TEXT}</p>`;
  return {
    node: { name, type: 'array', title: kind === 'agreement' ? 'Agreement confirmation' : 'Consent', items: { type: 'string', enum: [value] } },
    ui: {
      'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
      ...(kind === 'agreement' ? { 'ui:required': REQUIRED_MSG } : {}),
      'ui:multipleOption': { options: [[value, { formattedText: html, blueprintMetadataMapping: '' }]] },
    },
  };
}

/** The checkbox "I confirm that I have read, understand, and agree to the above." (or the consent one): it belongs under its PDF, wherever that page is. */
export const isConfirmationWidget = (doc: FormDoc, n: SchemaNode | undefined): boolean => {
  if (!n || getWidget(doc, n) !== 'MultipleCheckbox') return false;
  const options = (doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  const text = Array.isArray(options) && Array.isArray(options[0]) ? plainText((options[0][1] as { formattedText?: unknown } | null)?.formattedText) : '';
  return text.startsWith(AGREE_TEXT) || text === CONSENT_TEXT;
};
const isConfirmation = (ctx: StandardContext, n: SchemaNode | undefined): boolean => isConfirmationWidget(ctx.doc, n);

/**
 * Right under an embedded file that asks for an agreement (a subscription agreement, representations and warranties) there is a required
 * checkbox "I confirm that I have read, understand, and agree to the above."; under one that asks for consent, an optional checkbox
 * "By checking this box, you consent to the above." Files that only inform (directions, annexes, notices) get none.
 */
export const embeddedConfirmation: Standard = {
  id: 'embedded-confirmation',
  title: 'Agreement or consent checkbox under an embedded PDF',
  source: 'rule',
  apply(ctx) {
    const found: { pdf: SchemaNode; parent: SchemaNode; kind: Confirmation }[] = [];
    walk(ctx.doc.schema.properties, (n, parent) => {
      if (getWidget(ctx.doc, n) !== 'Pdf' || !parent) return;
      const siblings = parent.properties ?? [];
      if (isConfirmation(ctx, siblings[siblings.indexOf(n) + 1])) return;
      const kind = confirmationFor(String(ctx.doc.uiSchema[n.name]?.['ui:embeddedPdf'] ?? ''), n.title, getWidget(ctx.doc, parent) === 'Page' ? parent.title : '');
      if (kind) found.push({ pdf: n, parent, kind });
    });
    const signs = nodesOf(ctx.doc, 'Signature').length > 0;
    for (const { pdf, parent, kind } of found) {
      const name = uniqueName(ctx, `${pdf.name}_${kind === 'agreement' ? 'agreement' : 'consent'}`);
      const { node, ui } = confirmationParts(name, kind);
      // an agreement the investor signs says so, right under its checkbox
      const note = kind === 'agreement' && signs ? signingNote(uniqueName(ctx, `${pdf.name}_signing_note`)) : null;
      const added = note ? [node, note.node] : [node];
      const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === pdf.name ? [n, ...added] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) }, uiSchema: { ...ctx.doc.uiSchema, [name]: ui, ...(note ? { [note.node.name]: note.ui } : {}) } };
      ctx.log(`embedded-confirmation: a ${kind === 'agreement' ? 'required agreement' : 'consent'} checkbox (${name}) sits under the embedded PDF ${pdf.name} on "${parent.title}"${note ? ', with the message that the investor signs later' : ''}`);
    }
  },
};
