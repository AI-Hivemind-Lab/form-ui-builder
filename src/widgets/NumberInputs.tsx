import { resolveIntegerDraft, resolveNumberDraft, resolveYearDraft, type DraftResult } from '../model/draft';
import { formatMoney, formatPercent } from '../model/format';
import { DraftField } from './DraftField';
import { toText, uiString, type WidgetProps } from './shared';

const show = (fmt: (n: number) => string) => (v: unknown) => (typeof v === 'number' ? fmt(v) : toText(v));
const edit = (v: unknown) => (typeof v === 'number' ? String(v) : toText(v));

function numeric(
  resolve: (draft: string, current: unknown) => DraftResult,
  fmt: (n: number) => string,
  errorText: string,
  inputMode: 'decimal' | 'numeric' = 'decimal',
) {
  return function NumericWidget(p: WidgetProps) {
    return (
      <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolve} display={show(fmt)} editText={edit} errorText={errorText} inputMode={inputMode} placeholder={uiString(p.ui['ui:placeholder'])} />
    );
  };
}

export const Money = numeric(resolveNumberDraft, formatMoney, 'Not a valid number, so it was not saved');
export const Percentage = numeric(resolveNumberDraft, formatPercent, 'Not a valid number, so it was not saved');
export const Float = numeric(resolveNumberDraft, String, 'Not a valid number, so it was not saved');
export const Integer = numeric(resolveIntegerDraft, String, 'Not a whole number, so it was not saved', 'numeric');
export const Year = numeric(resolveYearDraft, String, 'Not a 4-digit year, so it was not saved', 'numeric');
