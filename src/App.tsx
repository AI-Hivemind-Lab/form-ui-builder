import { useEffect, useRef, useState } from 'react';
import { FORM_HASH, Landing } from './Landing';
import { buildEmbeddedPages, type ProposalSet } from './generator/ai/proposals';
import { adoptForm, FORM_ID_KEY, loadProposalSet, loadSavedDoc, ownsForm, saveDocIfOwner, saveIgnored, saveProposalSet } from './model/persist';
import { loadAnchors } from './model/pdfStore';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AddFieldPanel } from './components/AddFieldPanel';
import { ChatPanel } from './components/ChatPanel';
import { FormCanvas } from './components/FormCanvas';
import { PropertiesDrawer } from './components/PropertiesDrawer';
import { Toast } from './components/Toast';
import { ToolsPanel } from './components/ToolsPanel';
import { TocPanel } from './components/TocPanel';
import { PdfPanel } from './components/PdfPanel';
import { Splitter, useColumnWidths } from './components/Splitter';
import { ProposalIndexProvider } from './components/proposalIndex';
import { TopBar } from './components/TopBar';
import { FormProvider, useForm } from './state/useFormStore';

/** Keep the open form in browser storage so a refresh brings back the latest version, edits included. */
function usePersistDoc(): boolean {
  const { state, dispatch } = useForm();
  const [stale, setStale] = useState(false);
  const latest = useRef(state.doc);
  latest.current = state.doc;
  const tellOnce = () => setStale(true);
  // Save right away when leaving (Home, closing the tab) so the last edits are not lost to the delay below.
  useEffect(() => {
    const flush = () => void saveDocIfOwner(latest.current);
    window.addEventListener('pagehide', flush);
    const onStorage = (e: StorageEvent) => {
      if (e.key === FORM_ID_KEY && !ownsForm()) tellOnce();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('storage', onStorage);
      flush();
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const result = saveDocIfOwner(state.doc);
      if (result === 'superseded') tellOnce();
      else if (result === 'failed') dispatch({ type: 'notify', message: 'Could not save to the browser (storage full); export your form to keep it' });
    }, 400);
    return () => clearTimeout(t);
  }, [state.doc, dispatch]);
  return stale;
}

function Shell() {
  const { state } = useForm();
  const stale = usePersistDoc();
  const { dispatch } = useForm();
  // The three columns can be dragged wider or narrower; the widths are kept in the browser.
  const [rightTab, setRightTab] = useState<'properties' | 'assistant'>('properties');
  const columns = useColumnWidths();
  const setWidth = columns.set;
  const width = (selector: string): number => document.querySelector(selector)?.getBoundingClientRect().width ?? 0;
  // Cmd/Ctrl+Z undoes the last change, except while typing in a box (the browser's own undo handles that).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      dispatch({ type: 'undo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);
  useEffect(() => saveIgnored(state.ignoredWarnings, true), [state.ignoredWarnings]);
  // What is left of the AI's proposals survives a refresh: accepting or dismissing one is saved.
  useEffect(() => saveProposalSet({ decisions: state.proposals, notes: state.proposalNotes, texts: state.aiTexts } satisfies ProposalSet, true), [state.proposals, state.proposalNotes, state.aiTexts]);
  // Bring the selected field into view (after adding one, or picking it in the tree).
  useEffect(() => {
    if (!state.selection) return;
    document.querySelector(`.canvas [data-field="${CSS.escape(state.selection)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [state.selection, state.activePage]);
  return (
    <ProposalIndexProvider>
    <div className="app">
      <TopBar />
      {stale && (
        <div className="stale" role="alert">
          A different form was loaded in another tab, so changes in this tab are no longer saved.
          <button type="button" className="btn" onClick={() => location.reload()}>Reload to see the latest form</button>
        </div>
      )}
      <div className={`layout${state.pdfOpen ? ' layout--pdf' : ''}`} style={columns.style}>
        <div className="card">
          <TocPanel />
          <Splitter column="toc" grows={1} label="Resize the table of contents" measure={() => width('.toc')} onResize={setWidth} />
          <FormCanvas />
        </div>
        <Splitter column={state.pdfOpen ? 'pdf' : 'right'} grows={-1} label={state.pdfOpen ? 'Resize the PDF' : 'Resize the properties'} measure={() => width(state.pdfOpen ? '.pdfpanel' : '.right')} onResize={setWidth} />
        {state.pdfOpen && <PdfPanel />}
        {state.pdfOpen && <Splitter column="right" grows={-1} label="Resize the properties" measure={() => width('.right')} onResize={setWidth} />}
        <aside className="right">
          <div className="right__tabs" role="tablist">
            <button type="button" role="tab" aria-selected={rightTab === 'properties'} className={`right__tab${rightTab === 'properties' ? ' right__tab--on' : ''}`} onClick={() => setRightTab('properties')}>Properties</button>
            <button type="button" role="tab" aria-selected={rightTab === 'assistant'} className={`right__tab${rightTab === 'assistant' ? ' right__tab--on' : ''}`} onClick={() => setRightTab('assistant')}>
              <span aria-hidden="true">✦</span> Assistant{state.botChanges.length > 0 && <span className="right__badge" title="Changes to review">{state.botChanges.length}</span>}
            </button>
          </div>
          {rightTab === 'assistant' ? <ChatPanel /> : state.adding ? <AddFieldPanel key={state.adding.widget} /> : state.selection ? <PropertiesDrawer /> : <ToolsPanel />}
        </aside>
      </div>
      <Toast />
    </div>
    </ProposalIndexProvider>
  );
}

/** The editor reads the stored form once, when it opens, and owns it from then on (see model/persist). */
function Editor() {
  const [saved0] = useState(() => {
    const doc = loadSavedDoc();
    if (doc) adoptForm();
    return doc;
  });
  const [proposals0] = useState(() => loadProposalSet<ProposalSet>());
  const [anchors] = useState(() => loadAnchors());
  // A form saved with embedded PDF pages still waiting as proposals (an older build) gets them built as pages of their own.
  const [{ saved, proposals }] = useState(() => {
    if (!saved0 || !proposals0 || !proposals0.decisions.some((d) => d.data.kind === 'embedded-pdf')) return { saved: saved0, proposals: proposals0 };
    const r = buildEmbeddedPages(saved0, anchors, proposals0);
    return { saved: r.doc, proposals: r.set };
  });
  // The editor needs a saved form; without one the landing page is shown.
  if (!saved) return <Landing />;
  return (
    <FormProvider initialDoc={saved} initialProposals={proposals} anchors={anchors}>
      <Shell />
    </FormProvider>
  );
}

export default function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Leaving the editor unmounts it, so coming back from Home reads the latest stored form.
  return <ErrorBoundary>{hash === FORM_HASH ? <Editor /> : <Landing />}</ErrorBoundary>;
}
