import { useRef, useState, type ChangeEvent } from 'react';
import { EXPORT_FILE_NAME, buildExport, exportJsonText } from '../model/exportForm';
import { buildPackage } from '../model/packageExport';
import { loadBlankPackage, loadPdf, saveBlankPackage } from '../model/pdfStore';
import { cutPdfPages, readZip, writeZip } from '../model/zip';
import { parseFormJson } from '../model/loadForm';
import { claimForm } from '../model/persist';
import { useForm } from '../state/useFormStore';
import { InertButton } from './Inert';
import { Logo } from './Logo';

export function TopBar() {
  const { state, dispatch } = useForm();
  const fileRef = useRef<HTMLInputElement>(null);
  const blankRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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

  /** The whole package for Form Builder's import: the blank draft's system parts, our form, and each embedded PDF cut from the sub-doc. */
  async function exportPackage(blankFile?: File) {
    setBusy(true);
    try {
      if (blankFile) await saveBlankPackage(blankFile);
      const blank = blankFile ? { blob: blankFile } : await loadBlankPackage();
      if (!blank) {
        blankRef.current?.click(); // asked once; it is kept in the browser
        return;
      }
      const source = await loadPdf();
      if (!source) throw new Error('Add the sub-doc PDF first (the PDF button): the embedded PDFs are cut from it.');
      const result = await buildPackage({ form: buildExport(state.doc) as Record<string, unknown>, blank: await readZip(blank.blob), source: new Uint8Array(await source.blob.arrayBuffer()), cut: cutPdfPages });
      const fund = Object.values(state.doc.uiSchema).find((u) => u['ui:widget'] === 'Header' && typeof u['ui:subtitle'] === 'string')?.['ui:subtitle'] as string | undefined;
      const name = `${(fund ?? 'form').replace(/[\\/:*?"<>|]+/g, ' ').trim()} - package.zip`;
      const url = URL.createObjectURL(new Blob([writeZip(result.files) as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      dispatch({ type: 'notify', message: `Exported ${name}: ${Object.keys(result.files).length} files, ${result.notes.filter((n) => / pages \d/.test(n)).length} embedded PDFs cut from the sub-doc` });
    } catch (err) {
      dispatch({ type: 'notify', message: err instanceof Error ? err.message : 'Could not make the package' });
    } finally {
      setBusy(false);
    }
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
        <button type="button" className="btn btn--primary" disabled={busy} title="A zip for Form Builder's import: your blank draft's package with this form in it, and the embedded PDFs cut from the sub-doc" onClick={() => void exportPackage()}>
          {busy ? 'Making the package…' : 'Export package'}
        </button>
        <input ref={blankRef} type="file" accept=".zip,application/zip" hidden aria-label="Blank draft package" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void exportPackage(f); }} />
        <InertButton className="btn" label="Save and close">
          Save and close
        </InertButton>
      </div>
    </header>
  );
}
