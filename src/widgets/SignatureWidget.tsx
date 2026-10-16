import { WidgetIcon } from '../components/icons';
import { getSignatureMappings, mappingCaption, signatureTitle } from '../model/signature';
import type { WidgetProps } from './shared';

/** What the investor will sign after the digital form: the PDF annotations mapped to this widget. */
export function Signature({ ui }: WidgetProps) {
  const rows = getSignatureMappings(ui);
  return (
    <div className="w-sig">
      <div className="w-sig__head">
        <WidgetIcon id="Signature" />
        <span>{signatureTitle(ui)}</span>
      </div>
      {rows.length === 0 ? <div className="w-sig__empty">No PDF fields mapped</div> : null}
      {rows.map((m, i) => (
        <div className="w-sig__row" key={i}>
          <span className="w-sig__alias">
            {m.mapping || <em>unmapped</em>}
            {m.isOptional ? null : <span className="w-sig__star"> *</span>}
          </span>
          <span className="w-sig__type">{mappingCaption(m)}</span>
        </div>
      ))}
    </div>
  );
}
