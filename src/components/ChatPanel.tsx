import { useEffect, useMemo, useRef, useState } from 'react';
import { runTurn } from '../chat/agent';
import type { Change } from '../chat/changes';
import { Markdown } from '../chat/markdown';
import { browserPdfTools } from '../chat/pdfTools';
import { clearConversation, currentFormId, loadConversation, saveConversation, type Conversation, type ShownMessage } from '../chat/store';
import { findNode } from '../model/schemaWalk';
import { nodeLabel } from '../model/tree';
import { useForm } from '../state/useFormStore';
import { reveal } from './reveal';

const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SUGGESTIONS = ['Make the Fax boxes optional', 'Which fields are on PDF page 36?', 'Put the contact blocks in one group called Contact Information'];

const KIND_LABEL: Record<Change['kind'], string> = { added: 'Added', modified: 'Changed', removed: 'Removed', moved: 'Moved' };

/** What the assistant changed, to accept or put back: each change shows what it was and what it is now. */
function ReviewChanges() {
  const { state, dispatch } = useForm();
  const changes = state.botChanges;
  const [open, setOpen] = useState(true);
  if (changes.length === 0) return null;
  const go = (alias: string) => reveal(state.doc, alias, dispatch);
  return (
    <section className="rev" aria-label="Changes to review">
      <header className="rev__head">
        <button type="button" className="rev__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="rev__count">{changes.length}</span> change{changes.length === 1 ? '' : 's'} to review
          <span className="rev__caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        </button>
        <span className="rev__all">
          <button type="button" className="btn rev__btn" onClick={() => dispatch({ type: 'botRevert', id: 'all' })}>Put all back</button>
          <button type="button" className="btn btn--primary rev__btn" onClick={() => dispatch({ type: 'botAccept', id: 'all' })}>Accept all</button>
        </span>
      </header>
      {open && (
        <ul className="rev__list">
          {changes.map((c) => (
            <li key={c.id} className={`rev__row rev__row--${c.kind}`}>
              <div className="rev__top">
                <span className={`rev__kind rev__kind--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                {c.kind === 'removed' ? <span className="rev__label">{c.label}</span> : <button type="button" className="rev__label rev__label--link" onClick={() => go(c.alias)}>{c.label || c.alias}</button>}
              </div>
              <div className="rev__alias">{c.alias}</div>
              {c.summary.map((line, i) => <div key={i} className="rev__line">{line}</div>)}
              {c.kind === 'added' && (c.gathered?.length ?? 0) > 0 && <div className="rev__line">holds {c.gathered?.length} elements that were already in the form</div>}
              {c.kind === 'removed' && <div className="rev__line">was in {c.was?.parent ?? 'the top level'}</div>}
              <div className="rev__actions">
                <button type="button" className="rev__act" onClick={() => dispatch({ type: 'botAccept', id: c.id })}>✓ Accept</button>
                <button type="button" className="rev__act rev__act--back" onClick={() => dispatch({ type: 'botRevert', id: c.id })}>↺ Put back</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The assistant: a conversation that changes the form as it goes. */
export function ChatPanel() {
  const { state, dispatch } = useForm();
  const formId = useMemo(currentFormId, []);
  const [conv, setConv] = useState<Conversation>(() => loadConversation(formId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [working, setWorking] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const docRef = useRef(state.doc);
  const selRef = useRef(state.selection);
  const end = useRef<HTMLDivElement>(null);
  if (!busy) docRef.current = state.doc;
  selRef.current = state.selection;

  useEffect(() => {
    fetch('/api/chat/status').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then((s: { configured: boolean; model: string | null }) => setStatus(s)).catch(() => setStatus({ configured: false, model: null }));
  }, []);
  useEffect(() => {
    saveConversation(formId, conv);
  }, [formId, conv]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [conv.shown.length, streamText, working, busy]);

  const selected = state.selection ? findNode(state.doc.schema.properties, state.selection) : undefined;

  async function send(text: string) {
    const t = text.trim();
    if (t === '' || busy) return;
    setError(null);
    setInput('');
    setBusy(true);
    setStreamText('');
    setWorking('Thinking…');
    const asked: ShownMessage = { id: uid(), role: 'user', text: t };
    setConv((c) => ({ ...c, shown: [...c.shown, asked] }));
    dispatch({ type: 'botStart' });
    const ctrl = new AbortController();
    abort.current = ctrl;
    const base = conv.api;
    try {
      const r = await runTurn(base, t, {
        getDoc: () => docRef.current,
        setDoc: (d) => { docRef.current = d; dispatch({ type: 'botSetDoc', doc: d }); },
        getSelection: () => selRef.current,
        pdf: browserPdfTools(),
        onText: setStreamText,
        onTool: (name, args) => { setStreamText(''); setWorking(toolLine(name, args)); },
      }, ctrl.signal);
      const reply = [...r.added].reverse().find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim() !== '');
      const text2 = reply && reply.role === 'assistant' ? (reply.content as string) : 'Done.';
      setConv((c) => ({ shown: [...c.shown, { id: uid(), role: 'assistant', text: r.stopped ? `${text2}\n\nI stopped here: that took more steps than I allow in one go. Tell me to continue if there is more.` : text2 }], api: [...base, ...r.added] }));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setConv((c) => ({ ...c, shown: [...c.shown, { id: uid(), role: 'note', text: 'Stopped. What was already changed is in the review list.' }] }));
      else setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      dispatch({ type: 'botEnd' });
      setBusy(false);
      setStreamText('');
      setWorking('');
      abort.current = null;
    }
  }

  if (status && !status.configured) {
    return <div className="chat chat--off"><h3>Assistant</h3><p>The assistant is not set up on this server. It needs the AI service settings (see <code>.env.example</code>).</p></div>;
  }

  return (
    <div className="chat">
      <header className="chat__head">
        <h3><span className="chat__spark" aria-hidden="true">✦</span> Assistant</h3>
        {conv.shown.length > 0 && !busy && <button type="button" className="chat__clear" onClick={() => { clearConversation(formId); setConv({ shown: [], api: [] }); setError(null); }}>New conversation</button>}
      </header>
      <div className="chat__scroll">
        {conv.shown.length === 0 && !busy && (
          <div className="chat__empty">
            <p>Ask me to change the form and I do it right here: labels, required fields, options, groups, new fields. Everything I change is highlighted so you can accept it or put it back.</p>
            <div className="chat__chips">{SUGGESTIONS.map((s) => <button key={s} type="button" className="chat__chip" onClick={() => void send(s)}>{s}</button>)}</div>
          </div>
        )}
        {conv.shown.map((m) => (
          <div key={m.id} className={`chat__msg chat__msg--${m.role}`}>
            {m.role === 'assistant' ? <Markdown text={m.text} onElement={(a) => reveal(state.doc, a, dispatch)} /> : <p>{m.text}</p>}
          </div>
        ))}
        {busy && streamText !== '' && <div className="chat__msg chat__msg--assistant"><Markdown text={streamText} onElement={(a) => reveal(state.doc, a, dispatch)} /></div>}
        {busy && <div className="chat__working" role="status"><span className="spinner spinner--dark" aria-hidden="true" /> {working}</div>}
        {error && <div className="chat__error" role="alert">{error}</div>}
        <div ref={end} />
      </div>
      <ReviewChanges />
      <form className="chat__composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        {selected && <div className="chat__selected" title={state.selection ?? ''}>Selected: {nodeLabel(state.doc, selected).slice(0, 60)}</div>}
        <textarea
          className="w-input w-textarea chat__input" rows={2} value={input} placeholder="Ask for a change…" aria-label="Message to the assistant" disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
        />
        <div className="chat__send">
          <span className="chat__hint">{status?.model ? `Uses ${status.model}` : ''}</span>
          {busy
            ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button>
            : <button type="submit" className="btn btn--primary" disabled={input.trim() === ''}>Send</button>}
        </div>
      </form>
    </div>
  );
}

/** One line for what the assistant is doing right now. */
function toolLine(name: string, args: Record<string, unknown>): string {
  const a = typeof args.alias === 'string' ? ` ${args.alias}` : '';
  switch (name) {
    case 'get_form_outline': return 'Looking at the form…';
    case 'search_form': return `Searching for “${String(args.query ?? '')}”…`;
    case 'get_widget': return `Reading${a}…`;
    case 'update_widget': return `Changing${a}…`;
    case 'add_widget': return 'Adding a field…';
    case 'delete_widget': return `Deleting${a}…`;
    case 'move_widget': return `Moving${a}…`;
    case 'group_widgets': return 'Grouping…';
    case 'get_pdf_page_text': return `Reading PDF page ${String(args.page ?? '')}…`;
    case 'get_pdf_page_image': return `Looking at PDF page ${String(args.page ?? '')}…`;
    default: return 'Working…';
  }
}
