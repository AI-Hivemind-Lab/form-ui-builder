import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { aiConfigured, makeAsk } from './generator/ai/client';
import { findMissingContent } from './generator/ai/coverage';
import { planStructure } from './generator/ai/structure';
import { judgeForm } from './generator/ai/tasks';
import { titleWordsFrom } from './generator/ai/titleWords';
import { buildEmbeddedPages, type ProposalSet } from './generator/ai/proposals';
import { extractPdfText, renderPageImage } from './generator/pdfText';
import { buildForm } from './generator/buildForm';
import { pageOrderWarnings } from './generator/pageOrder';
import { STANDARDS } from './generator/standards';
import { loadForm, parseFormJson } from './model/loadForm';
import { claimForm, clearProposalSet, saveDoc, saveIgnored, saveProposalSet } from './model/persist';
import { clearBlankPackage, clearPdf, saveAnchors, savePdf, type Anchors } from './model/pdfStore';
import type { FormDoc } from './model/types';
import { AccountMenu } from './components/AccountMenu';
import { AnduinMark } from './components/Logo';

export const FORM_HASH = '#/form';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const JsonIcon = () => <Svg><path d="M8 4c-2 0-3 1-3 3v2c0 1.2-.6 2-2 3 1.4 1 2 1.8 2 3v2c0 2 1 3 3 3" /><path d="M16 4c2 0 3 1 3 3v2c0 1.2.6 2 2 3-1.4 1-2 1.8-2 3v2c0 2-1 3-3 3" /></Svg>;
const PdfIcon = () => <Svg><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 14h6M9 17h4" /></Svg>;
const CheckIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;

/** A file slot: click it or drop a file on it. The chosen file's name replaces the prompt. */
function DropSlot({ step, title, prompt, icon, accept, file, disabled, label, onFile, wide = false, optional = false }: {
  step: number; wide?: boolean; optional?: boolean; title: string; prompt: string; icon: ReactNode; accept: string; file: File | null; disabled: boolean; label: string; onFile: (f: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const ok = (f: File): boolean => accept.split(',').some((a) => (a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : f.type === a));
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && ok(f) && !disabled) onFile(f);
  };
  return (
    <div
      className={`drop${wide ? ' drop--wide' : ''}${file ? ' drop--done' : ''}${over ? ' drop--over' : ''}${disabled ? ' drop--disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <button type="button" className="drop__btn" disabled={disabled} onClick={() => input.current?.click()}>
        <span className="drop__icon">{file ? <CheckIcon /> : icon}</span>
        <span className="drop__step">Step {step}{optional ? ' · optional' : ''}</span>
        <span className="drop__title">{title}</span>
        <span className="drop__file">{file ? file.name : prompt}</span>
        <span className="drop__action">{file ? 'Change file' : 'Choose or drop a file'}</span>
      </button>
      <input ref={input} type="file" accept={accept} hidden aria-label={label} onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
    </div>
  );
}

/** The start page: load a form JSON, or build a form from an annotation JSON. The form opens in a new tab. */
export function Landing() {
  const formFileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [changes, setChanges] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>(() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem('formbuilder:standards-off') ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const toggleStandard = (id: string) =>
    setDisabled((d) => {
      const next = d.includes(id) ? d.filter((x) => x !== id) : [...d, id];
      try { localStorage.setItem('formbuilder:standards-off', JSON.stringify(next)); } catch { /* not critical */ }
      return next;
    });
  const [blocked, setBlocked] = useState(false);
  const [ai, setAi] = useState<{ configured: boolean; model: string | null }>({ configured: false, model: null });
  const [useAi, setUseAi] = useState(true);
  const [working, setWorking] = useState<string | null>(null);
  useEffect(() => {
    void aiConfigured().then(setAi);
  }, []);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [annotationFile, setAnnotationFile] = useState<File | null>(null);
  const [fundName, setFundName] = useState(() => localStorage.getItem('formbuilder:fund-name') ?? '');

  async function open(doc: FormDoc, okText: string, anchors: Anchors, proposals: ProposalSet | null = null) {
    if (!saveDoc(doc)) throw new Error('This form is too large to keep in the browser, so it cannot be opened.');
    claimForm(); // tabs still showing the previous form must not overwrite this one
    saveIgnored([]); // ignored warnings belong to the previous form
    saveAnchors(anchors);
    // the AI's proposals go with the form: they are accepted one by one on the widgets they are about
    if (proposals) saveProposalSet(proposals);
    else clearProposalSet();
    if (pdfFile) await savePdf(pdfFile);
    else await clearPdf(); // the previous form's PDF does not belong to this one
    await clearBlankPackage(); // nor does its blank draft (the editor asks for one only when a zip package is exported)
    const tab = window.open(`${location.pathname}${FORM_HASH}`, '_blank');
    setBlocked(tab === null);
    setMessage({ kind: 'ok', text: okText });
  }

  /** Load an existing form JSON. */
  async function onFormFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBlocked(false);
    setWarnings([]);
    setChanges([]);
    try {
      await open(parseFormJson(await file.text()), `Loaded “${file.name}”`, {});
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not read the file' });
    }
  }

  /** Build a form from the annotation JSON and the PDF, only when the user presses Run: both files are always needed. */
  async function runBuild() {
    if (!annotationFile || !pdfFile) {
      setMessage({ kind: 'error', text: 'Choose both files first: the annotation JSON and the PDF.' });
      return;
    }
    setBlocked(false);
    setWarnings([]);
    setChanges([]);
    setMessage(null);
    setWorking('Building the form…');
    try {
      const text = await annotationFile.text();
      try { localStorage.setItem('formbuilder:fund-name', fundName.trim()); } catch { /* not critical */ }
      // The PDF's text is read first: headings and question numbers the annotation lacks come from it, and the AI review reuses it.
      setWorking('Reading the PDF text…');
      const pages = await extractPdfText(pdfFile).catch(() => null);
      setWorking('Building the form…');
      let result = buildForm(text, { fundName, disabledStandards: disabled, pdfPages: pages });
      if (useAi && ai.configured) {
        // The AI settles what the program could only guess from the PDF's headings: where the objects the annotation left outside
        // every page go, and what the pages without a highlighted title are called. Then the form is built again with its answer.
        try {
          const plan = await planStructure(result.structure, makeAsk(), setWorking);
          if (plan) result = buildForm(text, { fundName, disabledStandards: disabled, pdfPages: pages, plan });
        } catch (err) {
          result = { ...result, warnings: [...result.warnings, `STRUCTURE: the AI could not read the structure of the PDF (${err instanceof Error ? err.message : 'failed'}); the program's reading of its headings was used`] };
        }
        setWorking('Building the form…');
      }
      setWarnings(result.warnings);
      setChanges(result.changes);
      const doc = loadForm(result.form);
      const loose = result.structure.runs;
      const placed = loose.filter((r) => r.action.kind !== 'hidden').reduce((n, r) => n + r.count, 0);
      const parked = loose.filter((r) => r.action.kind === 'hidden').reduce((n, r) => n + r.count, 0);
      const aliasTitled = result.structure.pages.filter((p) => p.source === 'alias').length;
      const structure = `${loose.length > 0 ? ` ${placed} object${placed === 1 ? '' : 's'} the annotation left outside every page ${placed === 1 ? 'was' : 'were'} put on pages by the PDF's headings${parked > 0 ? ` (${parked} signature object${parked === 1 ? '' : 's'} stay${parked === 1 ? 's' : ''} in the hidden page)` : ''}.` : ''}${aliasTitled > 0 ? ` ${aliasTitled} page${aliasTitled === 1 ? ' has' : 's have'} a title made from the alias: check ${aliasTitled === 1 ? 'it' : 'them'}.` : ''}`;
      const okText = `Built a form from “${annotationFile.name}”: ${result.stats.nodes} elements.${structure}`;
      if (useAi && ai.configured) {
        // The AI reviews the form and proposes changes; nothing is applied until the user accepts them, in the form.
        const judged = await judgeForm(
          { doc, anchors: result.anchors, pages, fundName, titleWords: titleWordsFrom(result.warnings, result.changes), pageImage: (i) => renderPageImage(pdfFile, i) },
          makeAsk(),
          setWorking,
        );
        setWorking(null);
        if (judged.log.length > 0) setChanges((c) => [...c, ...judged.log]);
        // Embedded PDF pages are built straight into the form, each on a page of its own, to be checked there (delete the ones not wanted).
        const settled = buildEmbeddedPages(doc, result.anchors, { decisions: judged.decisions, notes: judged.notes, texts: result.texts });
        if (settled.log.length > 0) setChanges((c) => [...c, ...settled.log]);
        const built = settled.doc;
        // the pages the AI added are placed too: say if any page is out of the sub-doc's order
        setWarnings((w) => [...w.filter((x) => !x.startsWith('PAGE ORDER')), ...pageOrderWarnings(built, result.anchors)]);
        // Last, a look at what the PDF prints and the form never shows (a note nobody highlighted, a section nobody annotated)
        let proposed = settled.set.decisions;
        let missingText = '';
        const notes = [...judged.notes];
        if (pages && pages.length > 0) {
          try {
            const missing = await findMissingContent({ doc: built, anchors: result.anchors, pages, fundName, texts: result.texts }, makeAsk(), setWorking);
            proposed = [...proposed, ...missing.decisions];
            notes.push(...missing.notes);
            const added = missing.decisions.filter((d) => d.data.kind === 'add-text').length;
            const pagesLeft = missing.decisions.filter((d) => d.data.kind === 'embedded-pdf').length;
            if (missing.found.uncovered > 0) missingText = ` ${missing.found.uncovered} of ${missing.found.checked} lines of the PDF are not on the form${added + pagesLeft > 0 ? `: ${added} text${added === 1 ? '' : 's'} and ${pagesLeft} page range${pagesLeft === 1 ? '' : 's'} are proposed` : ' (all left out on purpose)'}.`;
            setWorking(null);
          } catch (err) {
            setWorking(null);
            notes.push(`Content not on the form: the check failed (${err instanceof Error ? err.message : 'failed'}); nothing was added.`);
          }
        }
        const pdfPages = { length: settled.pages };
        const count = proposed.length;
        const investor = proposed.some((d) => d.data.kind === 'investor-type') ? ' The investor type question is proposed.' : '';
        const embedded = pdfPages.length > 0 ? ` ${pdfPages.length} embedded PDF page${pdfPages.length === 1 ? ' was' : 's were'} built as page${pdfPages.length === 1 ? '' : 's'} of their own: check them and delete any you do not want.` : '';
        const grouped = settled.groups > 0 ? ` ${settled.groups} group${settled.groups === 1 ? ' was' : 's were'} built to organise the pages: check the table of contents.` : '';
        await open(built, `${okText}${embedded}${grouped}${missingText} ${count === 0 ? 'The AI has no proposals' : `${count} AI proposal${count === 1 ? '' : 's'} wait in the form, on the fields they are about.`}${investor}`, result.anchors, { decisions: proposed, notes, texts: result.texts });
        return;
      }
      setWorking(null);
      await open(doc, okText, result.anchors);
    } catch (err) {
      setWorking(null);
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not build the form' });
    }
  }

  return (
    <main className="landing">
      <div className="landing__top">
        <div className="landing__lines" aria-hidden="true" />
        <div className="landing__arc landing__arc--a" aria-hidden="true" />
        <div className="landing__arc landing__arc--b" aria-hidden="true" />
        <div className="landing__arc landing__arc--c" aria-hidden="true" />
        <header className="landing__nav">
          <span className="landing__brand"><AnduinMark height={30} /><span className="landing__wordmark">UI Builder</span></span>
          <span className="landing__navright">
            <button type="button" className="landing__navlink" onClick={() => formFileRef.current?.click()}>Open an existing form <span aria-hidden="true">›</span></button>
            <AccountMenu buttonClassName="landing__navlink" />
          </span>
        </header>

        <div className="landing__hero">
        <section className="landing__copy">
          <span className="label landing__eyebrow">AI-assisted form digitization</span>
          <h1 className="landing__headline">Turn any <span className="nowrap">sub-doc</span> into a <span className="landing__accent">smart form</span> in minutes.</h1>
          <p className="landing__lead">Drop the annotation and the PDF. Our standards build the form, then an AI reviewer proposes the rest. You accept what you like, one change at a time.</p>
        </section>

        <div className="landing__card">
          <div className="landing__cardhead">
            <span className="label">Build a form</span>
            <h2>Annotation and PDF in, smart form out</h2>
            <p>That is all this needs. The form goes back into Form Builder with transFORM, so nothing is imported or uploaded twice. Nothing starts until you press Run.</p>
          </div>
          <section className="landing__panel" aria-label="Build a form">
            <div className="drops">
              <DropSlot step={1} title="Annotation JSON" prompt="annotation_document_data.json" icon={<JsonIcon />} accept=".json,application/json" file={annotationFile} disabled={working !== null} label="Annotation JSON file" onFile={setAnnotationFile} />
              <DropSlot step={2} title="Source PDF" prompt="The sub-doc PDF" icon={<PdfIcon />} accept="application/pdf,.pdf" file={pdfFile} disabled={working !== null} label="PDF file" onFile={setPdfFile} />
            </div>

            <label className="landing__field">
              <span className="landing__label">Fund name <em>shown under every page heading</em></span>
              <input className="w-input" value={fundName} onChange={(e) => setFundName(e.target.value)} placeholder="e.g. Valeas Demo Fund" />
            </label>

            <label className={`switch${ai.configured ? '' : ' switch--off'}`}>
              <input type="checkbox" checked={useAi && ai.configured} disabled={!ai.configured} onChange={(e) => setUseAi(e.target.checked)} />
              <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
              <span className="switch__text">
                <strong>Review with AI</strong>
                <small>{ai.configured ? `Proposes changes for you to accept · ${ai.model ?? 'model'}` : 'Not configured: see .env.example'}</small>
              </span>
            </label>

            <details className="landing__standards">
              <summary>Standards applied when building <span className="landing__count">{STANDARDS.length - disabled.filter((d) => STANDARDS.some((s) => s.id === d)).length} of {STANDARDS.length}</span></summary>
              <ul>
                {STANDARDS.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input type="checkbox" checked={!disabled.includes(s.id)} onChange={() => toggleStandard(s.id)} /> {s.title} <span className="landing__tag">{s.source}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>

            <button type="button" className="runbtn" disabled={!annotationFile || !pdfFile || working !== null} onClick={() => void runBuild()}>
              {working !== null ? <><span className="spinner" aria-hidden="true" /> Working…</> : <>Run build <span className="runbtn__arrow" aria-hidden="true">↗</span></>}
            </button>
            {!annotationFile || !pdfFile ? <p className="landing__need">Add both files to run the build.</p> : null}
          </section>

          <input ref={formFileRef} type="file" accept=".json,application/json" hidden onChange={(e) => void onFormFile(e)} aria-label="Form JSON file" />
          {message && (
            <p className={`landing__msg landing__msg--${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
          {blocked && (
            <p className="landing__msg">
              Your browser blocked the new tab. <a href={FORM_HASH} target="_blank" rel="noreferrer">Open the form</a>
            </p>
          )}
          {working && <p className="landing__msg landing__msg--work" role="status"><span className="spinner spinner--dark" aria-hidden="true" /> {working}</p>}
          {changes.length > 0 && (
            <details className="landing__changes">
              <summary>{changes.length} changes made by standards</summary>
              <ul>{changes.map((c) => <li key={c}>{c}</li>)}</ul>
            </details>
          )}
          {warnings.length > 0 && (
            <details className="landing__warnings">
              <summary>⚠ {warnings.length} things to review</summary>
              <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}
        </div>
      </div>

      </div>

      <section className="landing__how" aria-label="How it works">
        <div className="landing__how-inner">
          <span className="label">How it works</span>
          <h2>From a highlighted PDF to a form saved in Form Builder.</h2>
          <div className="landing__steps">
            <div className="step"><span className="step__n">01</span><strong>Prepare</strong><p>In Form Builder, make a blank form and add the annotated PDF. That stays the form's only copy of the PDF.</p></div>
            <div className="step"><span className="step__n">02</span><strong>Build</strong><p>Drop the annotation and the PDF here. Standards turn them into a smart form.</p></div>
            <div className="step"><span className="step__n">03</span><strong>Review</strong><p>Accept AI proposals while you scroll the form.</p></div>
            <div className="step"><span className="step__n">04</span><strong>Apply</strong><p>Copy for transFORM, paste it in the extension with the form open for editing. No import, no second PDF.</p></div>
          </div>
        </div>
      </section>
    </main>
  );
}
