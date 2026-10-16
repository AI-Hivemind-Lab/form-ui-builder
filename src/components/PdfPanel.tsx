import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { findNode } from '../model/schemaWalk';
import { aliasesOf, anchorsFor } from '../model/pdfAnchors';
import { reveal } from './reveal';
import { clampZoom, useCtrlWheelZoom, ZoomControls } from './Zoom';
import { clearPdf, loadAnchors, loadPdf, savePdf, type Anchor } from '../model/pdfStore';
import { useForm } from '../state/useFormStore';

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

/** The source PDF beside the form. Selecting a field scrolls to it and outlines its box. */
export function PdfPanel() {
  const { state, dispatch } = useForm();
  const [name, setName] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [status, setStatus] = useState<'loading' | 'empty' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [zoom, setZoomState] = useState(() => {
    try { return clampZoom(Number(localStorage.getItem('formbuilder:pdf-zoom')) || 100); } catch { return 100; }
  });
  const setZoom = useCallback((z: number) => {
    setZoomState(z);
    try { localStorage.setItem('formbuilder:pdf-zoom', String(z)); } catch { /* not critical */ }
  }, []);
  // the pages are drawn at the panel's width times the zoom
  const width = Math.round(fit * (zoom / 100));
  const fileRef = useRef<HTMLInputElement>(null);
  const anchors = useMemo(() => loadAnchors(), []);
  // the shape of a page, so every page has its height before it is drawn (the page number and jumping need it)
  const [ratio, setRatio] = useState(1.3);
  const [current, setCurrent] = useState(1);
  const [jump, setJump] = useState('1');

  // which form widget each PDF field belongs to: clicking a field in the PDF goes to it
  const owners = useMemo(() => {
    const map = new Map<string, { name: string; title: string }>();
    const visit = (nodes: typeof state.doc.schema.properties) =>
      nodes.forEach((n) => {
        aliasesOf(state.doc, n).forEach((a) => map.set(a, { name: n.name, title: n.title })); // deeper nodes come later and win
        if (n.properties) visit(n.properties);
      });
    visit(state.doc.schema.properties);
    return map;
  }, [state.doc]);

  const load = async (blob: Blob | null, fileName?: string) => {
    if (!blob) {
      setStatus('empty');
      return;
    }
    try {
      setStatus('loading');
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
      const first = await doc.getPage(1);
      const v = first.getViewport({ scale: 1 });
      setRatio(v.height / v.width);
      setPdf(doc);
      setName(fileName ?? null);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the PDF');
      setStatus('error');
    }
  };

  useEffect(() => {
    void loadPdf().then((stored) => load(stored?.blob ?? null, stored?.name));
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => setFit(Math.floor(el.clientWidth) - 24), 200);
    });
    ro.observe(el);
    setFit(Math.floor(el.clientWidth) - 24);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, []);

  // Draw every page at the panel's width.
  useEffect(() => {
    const host = pagesRef.current;
    if (!pdf || !host || width < 100) return;
    let cancelled = false;
    host.querySelectorAll('canvas').forEach((c) => c.remove());
    void (async () => {
      for (let n = 1; n <= pdf.numPages; n += 1) {
        const page = await pdf.getPage(n);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${Math.floor((base.height * width) / base.width)}px`;
        const slot = host.querySelector<HTMLElement>(`[data-pdf-page="${n - 1}"]`);
        if (!slot) continue;
        slot.style.height = canvas.style.height;
        slot.prepend(canvas);
        await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, width]);

  // The boxes for the selected field.
  const boxes: Anchor[] = useMemo(() => {
    const node = state.selection ? findNode(state.doc.schema.properties, state.selection) : undefined;
    return node ? anchorsFor(state.doc, node, anchors) : [];
  }, [state.selection, state.doc, anchors]);

  useEffect(() => {
    if (boxes.length === 0 || !pdf) return;
    const first = boxes.reduce((m, b) => (b.page < m.page || (b.page === m.page && b.top < m.top) ? b : m));
    const slot = pagesRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${first.page}"]`);
    const scroller = scrollRef.current;
    if (slot && scroller) scroller.scrollTo({ top: slot.offsetTop + first.top * slot.offsetHeight - 80, behavior: 'smooth' });
  }, [boxes, pdf, width]);

  const goTo = useCallback((n: number) => {
    const total = pdf?.numPages ?? 1;
    const page = Math.max(1, Math.min(total, Math.round(n) || 1));
    const slot = pagesRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${page - 1}"]`);
    if (slot && scrollRef.current) scrollRef.current.scrollTo({ top: slot.offsetTop - 8, behavior: 'smooth' });
    setCurrent(page);
    setJump(String(page));
  }, [pdf]);

  // zooming keeps the same place of the document in view
  const before = useRef<{ zoom: number; top: number; height: number; left: number; width: number } | null>(null);
  const changeZoom = useCallback((z: number) => {
    const sc = scrollRef.current;
    if (sc) before.current = { zoom, top: sc.scrollTop, height: sc.scrollHeight, left: sc.scrollLeft, width: sc.scrollWidth };
    setZoom(z);
  }, [zoom, setZoom]);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    const b = before.current;
    if (!sc || !b) return;
    before.current = null;
    sc.scrollTop = (b.top / b.height) * sc.scrollHeight;
    sc.scrollLeft = (b.left / b.width) * sc.scrollWidth;
  }, [zoom]);
  useCtrlWheelZoom(scrollRef, zoom, changeZoom);

  // the page in view follows the scrolling
  const onScroll = () => {
    const scroller = scrollRef.current;
    const host = pagesRef.current;
    if (!scroller || !host || !pdf) return;
    const line = scroller.scrollTop + scroller.clientHeight * 0.35;
    const slots = host.querySelectorAll<HTMLElement>('[data-pdf-page]');
    let page = 1;
    for (const slot of slots) {
      if (slot.offsetTop <= line) page = Number(slot.dataset.pdfPage) + 1;
      else break;
    }
    if (page !== current) {
      setCurrent(page);
      setJump(String(page));
    }
  };
  const onJumpKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') goTo(Number(jump));
    else if (e.key === 'ArrowUp') { e.preventDefault(); goTo(current - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); goTo(current + 1); }
  };

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await savePdf(file);
    await load(file, file.name);
  }

  return (
    <section className="pdfpanel" aria-label="PDF">
      <header className="pdfpanel__head">
        <strong className="pdfpanel__name" title={name ?? ''}>{name ?? 'PDF'}</strong>
        <span className="pdfpanel__tools">
          {status === 'ready' && <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Replace</button>}
          {status === 'ready' && (
            <button type="button" className="btn" onClick={async () => { await clearPdf(); setPdf(null); setName(null); setStatus('empty'); }}>Remove</button>
          )}
          <button type="button" className="btn" aria-label="Close PDF" onClick={() => dispatch({ type: 'togglePdf' })}>✕</button>
        </span>
      </header>
      {status === 'ready' && pdf && (
        <div className="pdfpanel__pager">
          <button type="button" className="pdfpanel__step" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>‹</button>
          <input
            className="pdfpanel__jump" inputMode="numeric" aria-label="Page number" value={jump}
            onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={onJumpKey} onBlur={() => goTo(Number(jump))} onFocus={(e) => e.currentTarget.select()}
          />
          <span className="pdfpanel__total">/ {pdf.numPages}</span>
          <button type="button" className="pdfpanel__step" aria-label="Next page" disabled={current >= pdf.numPages} onClick={() => goTo(current + 1)}>›</button>
          <ZoomControls zoom={zoom} onChange={changeZoom} label="the PDF" />
        </div>
      )}
      <div className="pdfpanel__scroll" ref={scrollRef} onScroll={onScroll}>
        {status === 'loading' && <p className="pdfpanel__msg">Loading PDF…</p>}
        {status === 'error' && <p className="pdfpanel__msg pdfpanel__msg--error">{error}</p>}
        {status === 'empty' && (
          <div className="pdfpanel__msg">
            <p>No PDF yet. Add the PDF this form was built from to compare them side by side.</p>
            <button type="button" className="btn btn--primary" onClick={() => fileRef.current?.click()}>Choose PDF…</button>
          </div>
        )}
        {status === 'ready' && pdf && (
          <div ref={pagesRef} className="pdfpanel__pages">
            {Array.from({ length: pdf.numPages }, (_, i) => (
              <div key={i} className="pdfpanel__page" data-pdf-page={i} style={width > 0 ? { height: width * ratio, width } : undefined}>
                {Object.entries(anchors).filter(([alias, a]) => a.page === i && owners.has(alias)).map(([alias, a]) => (
                  <button
                    key={alias} type="button" className="pdfpanel__hit" title={`Go to: ${owners.get(alias)?.title || owners.get(alias)?.name}`}
                    style={{ left: `${a.left * 100}%`, top: `${a.top * 100}%`, width: `${(a.right - a.left) * 100}%`, height: `${(a.bottom - a.top) * 100}%` }}
                    onClick={() => reveal(state.doc, (owners.get(alias) as { name: string }).name, dispatch)}
                  />
                ))}
                {boxes.filter((b) => b.page === i).map((b, j) => (
                  <div key={j} className="pdfpanel__box" style={{ left: `${b.left * 100}%`, top: `${b.top * 100}%`, width: `${(b.right - b.left) * 100}%`, height: `${(b.bottom - b.top) * 100}%` }} />
                ))}
                <span className="pdfpanel__pageno">{i + 1}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={onPick} aria-label="PDF file" />
    </section>
  );
}
