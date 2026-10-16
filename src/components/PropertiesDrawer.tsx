import { canSwitchTo, replaceNode } from '../model/addField';
import { findNode, uiOf } from '../model/schemaWalk';
import { useForm } from '../state/useFormStore';
import { MetadataForm, type FieldValue } from './MetadataForm';

export function PropertiesDrawer() {
  const { state, dispatch } = useForm();
  const { doc, selection } = state;
  const node = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (!node) return null;

  const onChange = (next: FieldValue) =>
    dispatch({
      type: 'editDoc',
      schema: next.node === node ? undefined : replaceNode(doc.schema, next.node),
      uiSchema: { ...doc.uiSchema, [next.node.name]: next.ui },
    });

  return (
    <div className="drawer">
      <div className="drawer__tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" className="drawer__tab drawer__tab--active">Properties</button>
        <button type="button" role="tab" aria-selected="false" className="drawer__tab" title="Not in prototype">Rules</button>
        <button type="button" role="tab" aria-selected="false" className="drawer__tab" title="Not in prototype">ASA</button>
      </div>
      <button type="button" className="drawer__back" onClick={() => dispatch({ type: 'select', name: null })}>
        ← Back to tools
      </button>
      <MetadataForm value={{ node, ui: uiOf(doc, node.name) }} onChange={onChange} isAllowed={(id) => canSwitchTo(doc, node.name, id)} doc={doc} />
      <div className="drawer__actions">
        <button type="button" className="btn btn--danger" onClick={() => dispatch({ type: 'removeNode', name: node.name })}>
          Delete field
        </button>
      </div>
      <div className="drawer__info">
        <div>Name: <code>{node.name}</code></div>
        <div>Schema type: <code>{node.type}</code></div>
      </div>
    </div>
  );
}
