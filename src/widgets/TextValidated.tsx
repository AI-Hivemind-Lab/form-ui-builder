import { useMemo } from 'react';
import { formatPatternOf } from '../model/format';
import { resolveEmailDraft, resolvePatternDraft, resolvePhoneDraft } from '../model/draft';
import { DraftField } from './DraftField';
import { uiString, type WidgetProps } from './shared';

export function Email(p: WidgetProps) {
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolveEmailDraft} errorText="Not a valid email address, so it was not saved" inputMode="email" placeholder={uiString(p.ui['ui:placeholder'])} />;
}

export function Phone(p: WidgetProps) {
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolvePhoneDraft} errorText="Not a valid phone number, so it was not saved" inputMode="tel" placeholder={uiString(p.ui['ui:placeholder'])} />;
}

/** Validates against `ui:pattern` (a regex) when set; a missing or invalid pattern accepts any text. */
export function CustomFormat(p: WidgetProps) {
  const { pattern, error } = formatPatternOf(p.ui, p.node.format);
  const resolve = useMemo(() => resolvePatternDraft(pattern), [pattern]);
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolve} errorText={error} placeholder={uiString(p.ui['ui:placeholder'])} />;
}
