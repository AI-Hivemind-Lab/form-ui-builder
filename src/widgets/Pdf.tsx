import { useEffect, useRef, useState } from 'react';
import { cutOf, cutProblem } from '../model/pdfCut';
import { useStoredPdf, type PdfDoc } from '../model/pdfCache';
import { clampZoom, useCtrlWheelZoom, ZoomControls } from '../components/Zoom';
import { uiString, type WidgetProps } from './shared';

/** One page of the source PDF, drawn when it comes near the screen. */
function CutPage({ doc, pageNumber, width }: { doc: PdfDoc; pageNumber: number; width: number }) {
  const slot = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(1.3);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = slot.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && setNear(true)), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near || width < 50) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.style.display = 'block';
      const render = page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled) return;
      slot.current?.querySelectorAll('canvas').forEach((c) => c.remove());
      slot.current?.prepend(canvas);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, doc, pageNumber, width]);
  return (
    <div ref={slot} className="w-pdf__page" style={{ height: width * ratio, width }} data-pdf-page={pageNumber}>
      <span className="w-pdf__pageno">{pageNumber}</span>
    </div>
  );
}

/**
 * The embedded PDF the investor reads in the form: pages `start` to `end` of the source PDF (ui:pdfCutInfo), drawn from the PDF stored
 * in the browser. Changing the range in the properties changes the pages shown at once.
 */
export function Pdf({ node, ui }: WidgetProps) {
  const stored = useStoredPdf();
  const cut = cutOf(ui);
  const host = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [zoom, setZoom] = useState(100);
  useCtrlWheelZoom(host, zoom, (z) => setZoom(clampZoom(z)));
  const width = Math.round(fit * (zoom / 100));
  const name = uiString(ui['ui:embeddedPdf']) || node.title;
  const height = uiString(ui['ui:height']) || '600pt';
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const measure = () => setFit(Math.floor(el.clientWidth) - 18);
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(measure, 150);
    });
    ro.observe(el);
    measure();
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [stored.status, cut === null]);

  const total = stored.status === 'ready' ? stored.doc.numPages : null;
  const problem = cut ? cutProblem(cut, total) : null;
  const caption = cut ? `Pages ${cut.start} - ${cut.end}${stored.status === 'ready' ? ` of ${stored.name}` : ''}` : 'No source pages set';
  let body;
  if (!cut) body = <div className="w-pdf__msg">No source pages are set. Set “Source pages” in the properties to cut this PDF from the sub-doc.</div>;
  else if (stored.status === 'loading') body = <div className="w-pdf__msg">Loading the PDF…</div>;
  else if (stored.status === 'none') body = <div className="w-pdf__msg">Pages {cut.start} - {cut.end} of the sub-doc. Open the PDF panel and add the sub-doc PDF to see them here.</div>;
  else if (problem) body = <div className="w-pdf__msg w-pdf__msg--error">{problem}</div>;
  else body = Array.from({ length: cut.end - cut.start + 1 }, (_, i) => <CutPage key={cut.start + i} doc={stored.doc} pageNumber={cut.start + i} width={width} />);

  return (
    <div className="w-pdf">
      <div className="w-pdf__head">
        <strong title={name}>{name}</strong>
        <span className="w-pdf__caption">{caption}</span>
        {cut && stored.status === 'ready' && !problem && <ZoomControls zoom={zoom} onChange={(z) => setZoom(clampZoom(z))} label="the embedded PDF" />}
      </div>
      <div ref={host} className="w-pdf__scroll" style={{ height }}>{body}</div>
    </div>
  );
}
