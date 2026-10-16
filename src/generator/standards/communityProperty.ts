import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { plainText, uniqueName, walk } from './util';

/** The sub-doc's own sentence that a married signer in a community property state needs the spouse's signature. */
export const COMMUNITY_SENTENCE = /married and live[s]? in a community property state|community property state[^.]*(both|spouse)[^.]*sign/i;
export const COMMUNITY_QUESTION = 'Are you married and living in a community property state?';
const REQUIRED_MSG = 'This field is required';

/**
 * When the sub-doc says a married subscriber in a community property state needs the spouse to sign, that is a question
 * for the investor ("Are you married and living in a community property state?", Yes / No), put right above the sub-doc's
 * own sentence. The sentence stays as it is, right under the question as an indented follow-up of "Yes" (the answers stay on one line).
 */
export const communityProperty: Standard = {
  id: 'community-property',
  title: 'Community property question where the sub-doc mentions it',
  source: 'rule',
  apply(ctx) {
    let found: { node: SchemaNode; parent: SchemaNode | null } | undefined;
    walk(ctx.doc.schema.properties, (n, parent) => {
      if (found || getWidget(ctx.doc, n) !== 'Paragraph') return;
      if (COMMUNITY_SENTENCE.test(plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']))) found = { node: n, parent };
    });
    if (!found) return;
    // already asked by the sub-doc itself
    let asked = false;
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) === 'Radio' && /community property/i.test(plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']))) asked = true;
    });
    if (asked) return;

    const { node: paragraph, parent } = found;
    const name = uniqueName(ctx, 'communitypropertystate');
    const yes = `yes_${name}`;
    const no = `no_${name}`;
    const question: SchemaNode = { name, type: 'string', title: COMMUNITY_QUESTION, enum: [yes, no] };
    const ui = {
      'ui:widget': 'Radio', 'ui:formattedText': `<p><strong>${COMMUNITY_QUESTION}</strong> <span style="color: rgb(219, 55, 55);">*</span></p>`,
      'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Inline', 'ui:required': REQUIRED_MSG,
      'ui:multipleOption': { options: [[yes, { formattedText: '<p>Yes</p>', blueprintMetadataMapping: '' }], [no, { formattedText: '<p>No</p>', blueprintMetadataMapping: '' }]] },
    };
    const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === paragraph.name ? [question, n] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
    // the sub-doc's sentence is the follow-up of "Yes": an independent, indented note right under the question (never a field below an option)
    ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) }, uiSchema: { ...ctx.doc.uiSchema, [name]: ui, [paragraph.name]: { ...ctx.doc.uiSchema[paragraph.name], 'ui:indentation': '24px' } } };
    ctx.log(`community-property: the question "${COMMUNITY_QUESTION}" (${name}) was added above the sub-doc's sentence in ${parent?.title ?? 'the form'}`);
    ctx.warn(`NEEDS RULE: ask ${name} only of individuals; show the note ${paragraph.name} only when Yes, and require the spouse's signature`);
  },
};
