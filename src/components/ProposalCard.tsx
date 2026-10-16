import { useMemo, useRef } from 'react';
import { applyDecisions } from '../generator/ai/apply';
import { KIND_LABELS, previewNodes } from '../generator/ai/proposals';
import type { Decision } from '../generator/ai/types';
import type { FormDoc } from '../model/types';
import { useForm } from '../state/useFormStore';
import { ProposalPreview } from './ProposalPreview';

const Check = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Cross = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;

/** One AI proposal, on the widget it is about: the result drawn as it would look, with a check to accept and a cross to dismiss. */
export function ProposalCard({ decision: d }: { decision: Decision }) {
  const { state, dispatch } = useForm();
  const result = useMemo(() => {
    try {
      const applied = applyDecisions(state.doc, state.anchors, state.aiTexts, [d]);
      return { after: applied.doc, ...previewNodes(state.doc, applied.doc) };
    } catch {
      return null; // a proposal that cannot be drawn is still described in words
    }
  }, [state.doc, state.anchors, state.aiTexts, d]);
  // a preview host is remounted when the form it draws changes (its store is created once)
  const version = useRef<{ after: FormDoc | null; n: number }>({ after: null, n: 0 });
  if (result && version.current.after !== result.after) version.current = { after: result.after, n: version.current.n + 1 };
  return (
    <div className={`proposal proposal--${d.confidence}`} role="note" data-proposal={d.id} onClick={(e) => e.stopPropagation()}>
      <div className="proposal__top">
        <span className="proposal__spark" aria-hidden="true">✦</span>
        <div className="proposal__head">
          <span className="proposal__kind">AI suggests · {KIND_LABELS[d.data.kind] ?? d.data.kind}</span>
          <span className={`proposal__conf proposal__conf--${d.confidence}`}>{d.confidence}</span>
        </div>
        <div className="proposal__actions">
          <button type="button" className="proposal__icon proposal__icon--ok" aria-label={`Accept: ${d.title}`} title="Accept" onClick={() => dispatch({ type: 'acceptProposals', ids: [d.id] })}><Check /></button>
          <button type="button" className="proposal__icon proposal__icon--no" aria-label={`Dismiss: ${d.title}`} title="Dismiss" onClick={() => dispatch({ type: 'dismissProposals', ids: [d.id] })}><Cross /></button>
        </div>
      </div>
      <strong className="proposal__title">{d.title}</strong>
      {result && <ProposalPreview key={version.current.n} after={result.after} show={result.show} anchors={state.anchors} />}
      {result && result.removed.length > 0 && <p className="proposal__removed">Takes away: {result.removed.slice(0, 6).join(', ')}{result.removed.length > 6 ? `, and ${result.removed.length - 6} more` : ''}</p>}
      <p className="proposal__detail">{d.detail}</p>
      {d.evidence && <p className="proposal__evidence">{d.evidence.page ? `p. ${d.evidence.page}: ` : ''}“{d.evidence.quote}”</p>}
    </div>
  );
}
