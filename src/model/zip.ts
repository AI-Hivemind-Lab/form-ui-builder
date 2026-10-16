import { unzipSync, zipSync } from 'fflate';
import { cutPdfPages } from './pdfCutter';
import type { Files } from './packageExport';

/** The files of a zip, by name (folders are left out; a package is flat). */
export async function readZip(file: Blob): Promise<Files> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  return Object.fromEntries(Object.entries(entries).filter(([name]) => !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store')));
}

/** A zip of the files. PDFs are already compressed, so they are stored. */
export function writeZip(files: Files): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [name, [data, { level: /\.pdf$/i.test(name) ? 0 : 6 }] as [Uint8Array, { level: 0 | 6 }]])));
}

export { cutPdfPages };

/** What a person is told when a zip is not a blank-draft package from Form Builder; null when it is one. */
export async function checkBlankPackage(file: Blob): Promise<string | null> {
  try {
    const files = await readZip(file);
    const missing = ['form_data.json', 'record_data.json', 'form_metadata.json'].filter((n) => !files[n]);
    if (missing.length > 0) return `That zip is not a package exported from Form Builder (it has no ${missing.join(', ')}). In Form Builder, create a blank form, add the annotated PDF to it, export it as a package, and use that zip.`;
    return null;
  } catch {
    return 'That file could not be read as a zip.';
  }
}
