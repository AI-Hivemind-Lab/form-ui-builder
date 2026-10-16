import { useMemo, useState } from 'react';
import { buildNewField, canContain, locationOptions, resolveInsertion, sameLocation, validateName } from '../model/addField';
import { labelText } from '../model/editOps';
import { widgetOf } from '../model/schemaWalk';
import { getWidgetDef } from '../model/widgetCatalog';
import { useForm } from '../state/useFormStore';
import { MetadataForm, type FieldValue } from './MetadataForm';

export function AddFieldPanel() {
  const { state, dispatch } = useForm();
  const { doc, activePage } = state;
  // The "+" of a tree row anchors the new field right below that row; otherwise the selection does.
  const selection = state.adding?.anchor ?? state.selection;
  const widgetId = state.adding?.widget ?? '';
  const def = getWidgetDef(widgetId);

  const [draft, setDraft] = useState<FieldValue>(() => buildNewField(doc, widgetId));
  const [name, setName] = useState(draft.node.name);
  // Locations depend on the draft's current widget: switching Group -> Repeatable changes where it may go.
  const draftWidget = widgetOf(draft.node, draft.ui);
  const options = useMemo(() => locationOptions(doc, draftWidget, selection, activePage), [doc, draftWidget, selection, activePage]);
  const defaultLoc = resolveInsertion(doc, draftWidget, selection, activePage);
  const [locId, setLocId] = useState(() => {
    const first = locationOptions(doc, widgetId, selection, activePage);
    const initial = resolveInsertion(doc, widgetId, selection, activePage);
    return (first.find((o) => sameLocation(o.loc, initial)) ?? first[0])?.id ?? '';
  });
  const effectiveId = options.some((o) => o.id === locId) ? locId : (options.find((o) => sameLocation(o.loc, defaultLoc)) ?? options[0])?.id ?? '';

  const nameError = validateName(doc, name);
  const loc = options.find((o) => o.id === effectiveId)?.loc ?? defaultLoc;
  const allowSwitch = (id: string) => id !== 'Repeatable' || loc.parent === null || canContain(doc, loc.parent, 'Repeatable');

  const submit = () => {
    if (nameError) return;
    const title = labelText(draft.ui, draft.node.title) || draft.node.title;
    dispatch({ type: 'addNode', node: { ...draft.node, name, title }, ui: draft.ui, loc });
  };

  return (
    <div className="drawer">
      <h3 className="drawer__title">Add {def?.label ?? widgetId}</h3>
      <div className="meta-form">
        <div className="meta-row">
          <label htmlFor="add-name">Name</label>
          <div className="meta-row__control">
            <input id="add-name" className={`w-input${nameError ? ' w-input--invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />
            {nameError && <div className="w-error">{nameError}</div>}
          </div>
        </div>
        <div className="meta-row">
          <label htmlFor="add-location">Location</label>
          <div className="meta-row__control">
            <select id="add-location" className="w-input w-select" value={effectiveId} onChange={(e) => setLocId(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      <MetadataForm value={draft} onChange={setDraft} isAllowed={allowSwitch} doc={doc} />
      <div className="drawer__actions">
        <button type="button" className="btn btn--primary" disabled={nameError !== null} onClick={submit}>Add field</button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'cancelAdd' })}>Cancel</button>
      </div>
    </div>
  );
}
