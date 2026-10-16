import type { Dispatch } from 'react';
import { findParentName } from '../model/addField';
import { findNode, getWidget } from '../model/schemaWalk';
import type { FormDoc } from '../model/types';
import type { Action } from '../state/formReducer';

/** Open the page that holds `name` and select it. */
export function reveal(doc: FormDoc, name: string, dispatch: Dispatch<Action>): void {
  const node = findNode(doc.schema.properties, name);
  if (!node) return;
  if (getWidget(doc, node) === 'Page') {
    dispatch({ type: 'setPage', name });
    dispatch({ type: 'select', name });
    return;
  }
  let cur = findParentName(doc, name);
  while (cur && getWidget(doc, findNode(doc.schema.properties, cur)!) !== 'Page') cur = findParentName(doc, cur);
  if (cur) dispatch({ type: 'setPage', name: cur });
  dispatch({ type: 'select', name });
}
