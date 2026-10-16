import { useMemo, useState } from 'react';
import { anchorsOf, KIND_LABELS } from '../generator/ai/proposals';
import { useForm } from '../state/useFormStore';
import { reveal } from './reveal';

/** All the AI's proposals in one list at the top of the table of contents: go to each, accept the sure ones at once, or dismiss. */
export function ProposalsPanel() {
  const { state, dispatch } = useForm();
  const [open, setOpen] = useState(true);
  const { proposals, proposalNotes, doc } = state;
  const sure = useMemo(() => proposals.filter((d) => d.defaultAccepted), [proposals]);
  if (proposals.length === 0 && proposalNotes.length === 0) return null;
  return (
    <section className="aip" aria-label="AI proposals">
      <button type="button" className="aip__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="aip__spark" aria-hidden="true">✦</span>
        <span className="aip__title">AI proposals {proposals.length > 0 ? `(${proposals.length})` : ''}</span>
        <span className="aip__caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          {proposals.length > 0 && (
            <div className="aip__actions">
              <button type="button" className="aip__btn aip__btn--primary" disabled={sure.length === 0} onClick={() => dispatch({ type: 'acceptProposals', ids: sure.map((d) => d.id) })}>
                Accept the {sure.length} sure ones
              </button>
              <button type="button" className="aip__btn" onClick={() => dispatch({ type: 'dismissProposals', ids: proposals.map((d) => d.id) })}>Dismiss all</button>
            </div>
          )}
          <ul className="aip__list">
            {proposals.map((d) => {
              const target = anchorsOf(d, doc)[0];
              return (
                <li key={d.id} className="aip__item">
                  <button type="button" className="aip__go" disabled={!target} onClick={() => target && reveal(doc, target, dispatch)} title={d.detail}>
                    <span className="aip__kind">{KIND_LABELS[d.data.kind] ?? d.data.kind}</span>
                    <span className="aip__what">{d.title}</span>
                  </button>
                  <span className="aip__item-actions">
                    <button type="button" className="aip__icon aip__icon--ok" aria-label={`Accept: ${d.title}`} title="Accept" onClick={() => dispatch({ type: 'acceptProposals', ids: [d.id] })}>✓</button>
                    <button type="button" className="aip__icon" aria-label={`Dismiss: ${d.title}`} title="Dismiss" onClick={() => dispatch({ type: 'dismissProposals', ids: [d.id] })}>✕</button>
                  </span>
                </li>
              );
            })}
          </ul>
          {proposalNotes.length > 0 && (
            <details className="aip__notes">
              <summary>{proposalNotes.length} note{proposalNotes.length === 1 ? '' : 's'} from the AI</summary>
              <ul>{proposalNotes.map((n) => <li key={n}>{n}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
