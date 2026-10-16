import { setUiKey } from '../model/editOps';
import { useForm } from '../state/useFormStore';
import { RichHtml } from './RichHtml';

/** A widget's formattedText, editable right on the canvas; changes save when focus leaves. */
export function EditableHtml({ name, html, className }: { name: string; html: string; className?: string }) {
  const { state, dispatch } = useForm();
  return (
    <RichHtml
      className={className}
      html={html}
      onCommit={(next) => dispatch({ type: 'editDoc', uiSchema: setUiKey(state.doc.uiSchema, name, 'ui:formattedText', next) })}
    />
  );
}
