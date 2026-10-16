import { toText, uiString, type WidgetProps } from './shared';

export function TextBox({ id, ui, value, onChange }: WidgetProps) {
  return <input id={id} className="w-input" placeholder={uiString(ui['ui:placeholder'])} value={toText(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ id, ui, value, onChange }: WidgetProps) {
  return (
    <textarea id={id} className="w-input w-textarea" rows={3} placeholder={uiString(ui['ui:placeholder'])} value={toText(value)} onChange={(e) => onChange(e.target.value)} />
  );
}
