import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useState } from 'react';
import { loadPdf } from './pdfStore';

export type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

interface Loaded {
  doc: PdfDoc;
  name: string;
}

let current: Promise<Loaded | null> | null = null;

/** The stored source PDF, opened once and shared by every embedded PDF widget. */
export function openStoredPdf(): Promise<Loaded | null> {
  if (!current) {
    current = (async () => {
      const stored = await loadPdf();
      if (!stored) return null;
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return { doc: await pdfjs.getDocument({ data: await stored.blob.arrayBuffer() }).promise, name: stored.name };
    })().catch(() => null);
  }
  return current;
}

/** The PDF was replaced or removed: the next reader opens the new one. */
export function forgetStoredPdf(): void {
  current = null;
  window.dispatchEvent(new Event('formbuilder:pdf-changed'));
}

if (typeof window !== 'undefined') window.addEventListener('formbuilder:pdf-forget', forgetStoredPdf);

export type StoredPdfState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; doc: PdfDoc; name: string };

export function useStoredPdf(): StoredPdfState {
  const [state, setState] = useState<StoredPdfState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    const read = () => {
      setState({ status: 'loading' });
      void openStoredPdf().then((p) => { if (live) setState(p ? { status: 'ready', doc: p.doc, name: p.name } : { status: 'none' }); });
    };
    read();
    window.addEventListener('formbuilder:pdf-changed', read);
    return () => {
      live = false;
      window.removeEventListener('formbuilder:pdf-changed', read);
    };
  }, []);
  return state;
}
