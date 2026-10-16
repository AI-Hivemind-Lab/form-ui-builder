import { useEffect, type RefObject } from 'react';

export const ZOOMS = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const nearest = (z: number): number => ZOOMS.reduce((best, v) => (Math.abs(v - z) < Math.abs(best - z) ? v : best), ZOOMS[0]);
export const zoomIn = (z: number): number => ZOOMS.find((v) => v > z) ?? ZOOMS[ZOOMS.length - 1];
export const zoomOut = (z: number): number => [...ZOOMS].reverse().find((v) => v < z) ?? ZOOMS[0];
export const clampZoom = (z: number): number => (ZOOMS.includes(z) ? z : nearest(z));

/** − 100% + : zoom out, back to 100% (click the number), zoom in. */
export function ZoomControls({ zoom, onChange, label }: { zoom: number; onChange: (z: number) => void; label: string }) {
  return (
    <span className="zoom" role="group" aria-label={`Zoom ${label}`}>
      <button type="button" className="zoom__btn" aria-label={`Zoom out ${label}`} disabled={zoom <= ZOOMS[0]} onClick={() => onChange(zoomOut(zoom))}>−</button>
      <button type="button" className="zoom__value" title="Back to 100%" aria-label={`Zoom ${zoom}%, reset to 100%`} onClick={() => onChange(100)}>{zoom}%</button>
      <button type="button" className="zoom__btn" aria-label={`Zoom in ${label}`} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => onChange(zoomIn(zoom))}>+</button>
    </span>
  );
}

/** Ctrl / Cmd + scroll (and a trackpad pinch) over the pages zooms them instead of the whole browser page. */
export function useCtrlWheelZoom(ref: RefObject<HTMLElement>, zoom: number, onChange: (z: number) => void): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      onChange(e.deltaY < 0 ? zoomIn(zoom) : zoomOut(zoom));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, zoom, onChange]);
}
