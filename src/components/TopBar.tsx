import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { EXPORT_FILE_NAME, buildExport, exportJsonText } from '../model/exportForm';
import { buildPackage } from '../model/packageExport';
import { buildTransformScript, embeddedCutsOf } from '../model/transformScript';
import { loadBlankPackage, loadPdf, saveBlankPackage } from '../model/pdfStore';
import { checkBlankPackage, cutPdfPages, readZip, writeZip } from '../model/zip';
import { parseFormJson } from '../model/loadForm';
import { claimForm } from '../model/persist';
import { useForm } from '../state/useFormStore';
import { AccountMenu } from './AccountMenu';
import { InertButton } from './Inert';
import { Logo } from './Logo';

export function TopBar() {
  const { state, dispatch } = useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The blank draft (a blank form exported from Form Builder with the annotated PDF added) is kept in the browser; the dialog asks for it when there is none.
  const [blankName, setBlankName] = useState<string | null>(null);
  const [askBlank, setAskBlank] = useState(false);
  const [blankProblem, setBlankProblem] = useState<string | null>(null);
  // After the function is copied: what to do next in Form Builder (a dialog, since a toast is gone before the steps are read)
  const [guide, setGuide] = useState<{ how: 'copied' | 'downloaded'; pdfs: number } | null>(null);
  const zipMenu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    void loadBlankPackage().then((b) => setBlankName(b?.name ?? null));
  }, []);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const doc = parseFormJson(await file.text());
      claimForm();
      dispatch({ type: 'loadDoc', doc });
      dispatch({ type: 'notify', message: `Loaded “${file.name}”` });
    } catch (err) {
      dispatch({ type: 'notify', message: err instanceof Error ? err.message : 'Could not load file' });
    }
  }

  function exportForm() {
    const blob = new Blob([exportJsonText(state.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({ type: 'notify', message: `Exported ${EXPORT_FILE_NAME}` });
  }

  /**
   * The same form as a function for the transFORM extension: pasted in its "Transformation" box, it replaces the fields and widgets of the form
   * that is open in Form Builder and saves a new draft version of it, so no PDF is imported (nor duplicated).
   */
  async function copyForTransform() {
    const fund = Object.values(state.doc.uiSchema).find((u) => u['ui:widget'] === 'Header' && typeof u['ui:subtitle'] === 'string')?.['ui:subtitle'] as string | undefined;
    const { script, problems } = buildTransformScript(state.doc, fund ?? '');
    if (problems.length > 0) {
      dispatch({ type: 'notify', message: `Not safe to save in Form Builder: ${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}` });
      return;
    }
    const pdfs = embeddedCutsOf(state.doc.uiSchema as Record<string, Record<string, unknown>>).cuts.length;
    try {
      await navigator.clipboard.writeText(script);
      setGuide({ how: 'copied', pdfs });
    } catch {
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(fund ?? 'form').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - transFORM.js`;
      a.click();
      URL.revokeObjectURL(url);
      setGuide({ how: 'downloaded', pdfs });
    }
  }

  /** The whole package for Form Builder's import: the blank draft's system parts, our form, and each embedded PDF cut from the sub-doc. */
  async function exportPackage() {
    setBusy(true);
    try {
      const blank = await loadBlankPackage();
      if (!blank) {
        setBlankProblem(null);
        setAskBlank(true); // asked for in a dialog, with a button that opens the file chooser from a click of its own
        return;
      }
      await makePackage(blank.blob);
    } catch (err) {
      dispatch({ type: 'notify', message: err instanceof Error ? err.message : 'Could not make the package' });
    } finally {
      setBusy(false);
    }
  }

  /** A blank draft chosen here is checked, kept for the next export, and the package is made from it at once. */
  async function onBlank(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const problem = await checkBlankPackage(file);
      if (problem) {
        setBlankProblem(problem); // said in the dialog when it is open, so it is not hidden behind it
        dispatch({ type: 'notify', message: problem });
        return;
      }
      await saveBlankPackage(file);
      setBlankName(file.name);
      setAskBlank(false);
      await makePackage(file);
    } catch (err) {
      dispatch({ type: 'notify', message: err instanceof Error ? err.message : 'Could not make the package' });
    } finally {
      setBusy(false);
    }
  }

  async function makePackage(blankZip: Blob) {
    const source = await loadPdf();
    if (!source) throw new Error('Add the sub-doc PDF first (the PDF button): the embedded PDFs are cut from it.');
    const result = await buildPackage({ form: buildExport(state.doc) as Record<string, unknown>, blank: await readZip(blankZip), source: new Uint8Array(await source.blob.arrayBuffer()), cut: cutPdfPages });
    const fund = Object.values(state.doc.uiSchema).find((u) => u['ui:widget'] === 'Header' && typeof u['ui:subtitle'] === 'string')?.['ui:subtitle'] as string | undefined;
    const name = `${(fund ?? 'form').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - package.zip`;
    const url = URL.createObjectURL(new Blob([writeZip(result.files) as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({ type: 'notify', message: `Exported ${name}: ${Object.keys(result.files).length} files, ${result.notes.filter((n) => / pages \d/.test(n)).length} embedded PDFs cut from the sub-doc` });
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        <a className="btn topbar__home" href={location.pathname} onClick={(e) => { e.preventDefault(); location.hash = ''; }}>
          ← Home
        </a>
        <span className="topbar__brand"><Logo size={30} /><span>UI Builder</span></span>
      </div>
      <div className="topbar__actions">
        <button type="button" className="btn" aria-pressed={state.pdfOpen} onClick={() => dispatch({ type: 'togglePdf' })}>
          {state.pdfOpen ? 'Hide PDF' : 'PDF'}
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Load form JSON
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        <button type="button" className="btn" onClick={exportForm}>
          Export form JSON
        </button>
        <button type="button" className="btn btn--primary" title="Copies the form as a function for the patched transFORM extension: pasted in Form Builder, it replaces the fields and widgets of the form that holds the annotated PDF and makes its embedded PDFs. Nothing is imported, so no PDF is duplicated." onClick={() => void copyForTransform()}>
          Copy for transFORM
        </button>
        <details className="menu" ref={zipMenu}>
          <summary className="btn" title="The older way: a zip that Form Builder imports (it uploads the source PDF again)">Zip package</summary>
          <div className="menu__panel">
            <label className={`btn${busy ? ' btn--disabled' : ''}`} title={blankName ? `Blank draft kept: ${blankName}. Choose another to replace it and make the package from it.` : 'A blank form exported from Form Builder with the annotated PDF added. The package is made from it.'}>
              {blankName ? 'Replace blank draft ✓' : 'Add blank draft'}
              <input type="file" accept=".zip,application/zip" hidden disabled={busy} aria-label="Blank draft package" onChange={(e) => { zipMenu.current?.removeAttribute('open'); void onBlank(e); }} />
            </label>
            <button type="button" className="btn" disabled={busy} title="A zip for Form Builder's import: your blank draft's package with this form in it, and the embedded PDFs cut from the sub-doc. Importing it uploads the source PDF again." onClick={() => { zipMenu.current?.removeAttribute('open'); void exportPackage(); }}>
              {busy ? 'Making the package…' : 'Export package'}
            </button>
          </div>
        </details>
        <InertButton className="btn" label="Save and close">
          Save and close
        </InertButton>
        <AccountMenu />
      </div>
      {guide && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label="Apply it in Form Builder" onMouseDown={(e) => e.target === e.currentTarget && setGuide(null)}>
          <div className="modal__box">
            <h2 className="modal__title">{guide.how === 'copied' ? 'Copied. Now apply it in Form Builder' : 'Downloaded. Now apply it in Form Builder'}</h2>
            <ol className="modal__steps">
              <li>In Form Builder, open the form that already holds the annotated PDF and start editing it. The extension needs that editing session.</li>
              <li>Open the patched transFORM, clear its Transformation box and paste {guide.how === 'copied' ? 'the function (Ctrl/⌘ V)' : 'the contents of the downloaded file (open it, copy all)'}.</li>
              <li>Press Apply transformation and wait for “Transformation successful”{guide.pdfs > 0 ? `; it also cuts the ${guide.pdfs} embedded PDF${guide.pdfs === 1 ? '' : 's'} (“Embedded PDFs: ${guide.pdfs} cut”)` : ''}.</li>
              <li>Reload the form in Form Builder and check the pages.</li>
            </ol>
            <p>Applying again is safe: the fields are replaced, and cuts the form already has are kept, not made twice.{guide.pdfs > 0 ? ' The original (unpatched) extension would leave the embedded PDFs without their files; the patch is in docs/transform-extension.' : ''}</p>
            <div className="modal__actions">
              <button type="button" className="btn btn--primary" autoFocus onClick={() => setGuide(null)}>Done</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {askBlank && createPortal(
        <div className="modal" role="dialog" aria-modal="true" aria-label="Add the blank draft package" onMouseDown={(e) => e.target === e.currentTarget && setAskBlank(false)}>
          <div className="modal__box">
            <h2 className="modal__title">Add the blank draft package</h2>
            <p>Form Builder's import needs the ids and records only Form Builder makes. Take them from a blank draft:</p>
            <ol className="modal__steps">
              <li>In Form Builder, create a blank form for this fund and add the annotated PDF to it.</li>
              <li>Export it as a package (a zip).</li>
              <li>Choose that zip here. The package for import is made from it at once, and the zip is kept for the next export.</li>
            </ol>
            {blankProblem && <p className="modal__error" role="alert">{blankProblem}</p>}
            <div className="modal__actions">
              <label className="btn btn--primary">
                Choose the blank draft (.zip)
                <input type="file" accept=".zip,application/zip" hidden aria-label="Blank draft package (dialog)" onChange={(e) => void onBlank(e)} />
              </label>
              <button type="button" className="btn" onClick={() => setAskBlank(false)}>Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </header>
  );
}
