import { belowMap } from '../../model/fieldsBelow';
import type { Standard } from './types';
import { patchUi } from './util';

export const BELOW_INDENT = '24px';

/**
 * A field shown below an option of a radio or checkbox is indented 24px, so it reads as belonging to the option. Form Builder draws no
 * indentation of its own for it, so the indentation is set on the field. One set on purpose (anything but 0px) stays.
 */
export const belowIndent: Standard = {
  id: 'below-indent',
  title: 'Fields below an option are indented 24px',
  source: 'rule',
  apply(ctx) {
    const todo = [...belowMap(ctx.doc).keys()].filter((name) => {
      const v = ctx.doc.uiSchema[name]?.['ui:indentation'];
      return ctx.doc.uiSchema[name] !== undefined && (v === undefined || v === '0px' || v === '');
    });
    todo.forEach((name) => patchUi(ctx, name, { 'ui:indentation': BELOW_INDENT }));
    if (todo.length > 0) ctx.log(`below-indent: ${todo.length} field(s) shown below an option are indented ${BELOW_INDENT}`);
  },
};
