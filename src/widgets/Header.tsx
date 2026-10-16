import { uiString, type WidgetProps } from './shared';

export function Header({ ui }: WidgetProps) {
  return (
    <div className="w-header">
      <div className="w-header__subtitle">{uiString(ui['ui:subtitle'])}</div>
      <h1 className="w-header__heading">{uiString(ui['ui:heading'])}</h1>
      <div className="w-header__rule" />
      {uiString(ui['ui:description']) && <p className="w-header__description">{uiString(ui['ui:description'])}</p>}
    </div>
  );
}
