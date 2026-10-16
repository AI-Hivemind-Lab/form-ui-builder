import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import type { Standard } from './types';
import { plainText, uniqueName, walk } from './util';

export const ADDITIONAL_PAGES = /attach additional (pages|sheets)/i;
export const ADDITIONAL_PAGES_LABEL = 'Check this box if you would like to submit additional pages as a supporting document.';

/**
 * "(attach additional pages as necessary)" has no meaning in a smart form, so it becomes a checkbox right under that paragraph:
 * "Check this box if you would like to submit additional pages as a supporting document.", with an upload shown below it when it is
 * checked. The sub-doc's own sentence stays.
 */
export const additionalPages: Standard = {
  id: 'additional-pages',
  title: '"Attach additional pages" becomes a checkbox with an upload',
  source: 'rule',
  apply(ctx) {
    const targets: SchemaNode[] = [];
    walk(ctx.doc.schema.properties, (n) => {
      if (getWidget(ctx.doc, n) === 'Paragraph' && ADDITIONAL_PAGES.test(plainText(ctx.doc.uiSchema[n.name]?.['ui:formattedText']))) targets.push(n);
    });
    for (const p of targets) {
      const check = uniqueName(ctx, `${p.name}_additionalpages`);
      const files = `${check}_files`;
      const nodes: SchemaNode[] = [
        { name: check, type: 'array', title: 'Additional pages', items: { type: 'string', enum: ['yes'] } },
        { name: files, type: 'array', title: 'Additional pages (supporting document)', items: { type: 'string', enum: ['file1'] } },
      ];
      const put = (list: SchemaNode[]): SchemaNode[] => list.flatMap((n) => (n.name === p.name ? [n, ...nodes] : [n.properties ? { ...n, properties: put(n.properties) } : n]));
      ctx.doc = {
        ...ctx.doc,
        schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) },
        uiSchema: {
          ...ctx.doc.uiSchema,
          [check]: {
            'ui:widget': 'MultipleCheckbox', 'ui:formattedText': '', 'ui:pdfMapping': [], 'ui:enabledComment': true, 'ui:marginBottom': '12px', 'ui:fixedLayout': 'Default',
            'ui:multipleOption': { options: [['yes', { formattedText: `<p>${ADDITIONAL_PAGES_LABEL}</p>`, blueprintMetadataMapping: '', fieldsBelow: [files] }]] },
          },
          [files]: {
            'ui:widget': 'FileGroup', 'ui:formattedText': '', 'ui:marginBottom': '12px', 'ui:enabledComment': true,
            'ui:supportingFileGroup': { description: '', helpText: '', files: { file1: { description: 'Additional pages', helpText: '', blueprintMetadataMapping: '' } } },
          },
        },
      };
      ctx.log(`additional-pages: a checkbox and an upload for additional pages were added under "${plainText(ctx.doc.uiSchema[p.name]?.['ui:formattedText']).slice(0, 60)}" (${p.name})`);
    }
  },
};
