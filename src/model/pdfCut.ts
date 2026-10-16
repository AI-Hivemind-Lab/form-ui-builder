import type { FormDoc, UiEntry } from './types';

/** Where an embedded PDF is cut from the source sub-doc: pages start to end (1-based, both included). `fileId` is set by the platform. */
export interface PdfCut {
  start: number;
  end: number;
}

export const CUT_KEY = 'ui:pdfCutInfo';

export function cutOf(ui: UiEntry | undefined): PdfCut | null {
  const c = ui?.[CUT_KEY] as { start?: unknown; end?: unknown } | undefined;
  return c && typeof c.start === 'number' && typeof c.end === 'number' ? { start: c.start, end: c.end } : null;
}

/** The value stored under ui:pdfCutInfo; the file id stays whatever it was (blank until the platform gives one). */
export function withCut(ui: UiEntry | undefined, cut: PdfCut): Record<string, unknown> {
  const old = (ui?.[CUT_KEY] ?? {}) as Record<string, unknown>;
  return { fileId: '', reviewingFileId: null, ...old, start: cut.start, end: cut.end };
}

/** Why a range does not work for a PDF of `total` pages, or null when it does. */
export function cutProblem(cut: PdfCut, total: number | null): string | null {
  if (!Number.isInteger(cut.start) || !Number.isInteger(cut.end) || cut.start < 1 || cut.end < 1) return 'Pages start at 1';
  if (cut.end < cut.start) return 'The last page is before the first page';
  if (total !== null && cut.end > total) return `The PDF has only ${total} page${total === 1 ? '' : 's'}`;
  return null;
}

/** The name of the source sub-doc: the form's File widget. */
export function sourceFileName(doc: FormDoc): string {
  for (const ui of Object.values(doc.uiSchema)) if (ui['ui:widget'] === 'File' && typeof ui['ui:fileName'] === 'string') return ui['ui:fileName'];
  return '';
}
