import { getRows, maxItemsOf } from '../model/rows';
import { useForm } from '../state/useFormStore';
import { uiString, type WidgetProps } from './shared';

/** Rows of the Repeatable's child fields, up to `ui:maxLength`; the add button disables at the max. */
export function Repeatable({ node, renderChildren }: WidgetProps) {
  const { state, dispatch } = useForm();
  const rows = getRows(state.values, node.name);
  const max = maxItemsOf(state.doc, node.name);
  const itemName = uiString(state.doc.uiSchema[node.name]?.['ui:repeatableText']) || 'row';
  return (
    <div className="w-repeatable">
      {rows.map((_, index) => (
        <div className="w-repeatable__row" key={index}>
          <div className="w-repeatable__fields">{renderChildren?.({ rep: node.name, index })}</div>
          {rows.length > 1 && (
            <div className="w-repeatable__trash">
              <button
                type="button"
                aria-label={`Remove ${itemName} ${index + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'removeRow', rep: node.name, index });
                }}
              >
                🗑
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="w-repeatable__add"
        disabled={rows.length >= max}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'addRow', rep: node.name });
        }}
      >
        ⊕ Add another {itemName}
      </button>
    </div>
  );
}
