import { useForm } from '../state/useFormStore';
import { ToggleRow } from './Inert';

export function ToolsPanel() {
  const { state, dispatch } = useForm();
  return (
    <div className="tools">
      <ToggleRow label="Show alias" checked={state.showAlias} onToggle={() => dispatch({ type: 'toggleAlias' })} />
      <ToggleRow label="Show invisible pages & fields" checked={state.showInvisible} onToggle={() => dispatch({ type: 'toggleInvisible' })} />
      {state.ignoredWarnings.length > 0 && (
        <button type="button" className="btn tools__restore" onClick={() => dispatch({ type: 'restoreWarnings' })}>
          Restore {state.ignoredWarnings.length} ignored warning{state.ignoredWarnings.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
