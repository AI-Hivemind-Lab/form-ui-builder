import { RichHtml } from '../components/RichHtml';
import { layoutClass, optionHtml, toText, uiString, type WidgetProps } from './shared';

export function Radio({ id, ui, value, onChange, options, renderBelow }: WidgetProps) {
  // Options that carry fields below read best stacked, so an Inline layout does not apply to them.
  const hasBelow = options.some((o) => (o.fieldsBelow?.length ?? 0) > 0);
  return (
    <div className={`w-radio${layoutClass(ui, hasBelow)}`} role="radiogroup">
      {options.map((o) => {
        const below = renderBelow?.(o);
        return (
          <div key={o.value} className="w-opt">
            <label className="w-radio__opt">
              <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span className="w-radio__dot" />
              <RichHtml className="w-opt__label" html={optionHtml(o)} />
            </label>
            {below ? <div className="w-opt__below">{below}</div> : null}
          </div>
        );
      })}
    </div>
  );
}

export function Dropdown({ id, ui, value, onChange, options }: WidgetProps) {
  return (
    <select id={id} className={`w-input w-select${toText(value) === '' ? ' w-select--empty' : ''}`} value={toText(value)} onChange={(e) => onChange(e.target.value)}>
      <option value="">{uiString(ui['ui:placeholder'])}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
