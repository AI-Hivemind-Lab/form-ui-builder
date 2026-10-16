/** The PDF shown beside the form. PDFs are too big for localStorage, so the file lives in IndexedDB. */
export interface Anchor {
  page: number; // 0-based
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Anchors = Record<string, Anchor>;

const DB = 'formbuilder';
const STORE = 'files';
const KEY = 'current-pdf';
const ANCHORS_KEY = 'formbuilder:pdf-anchors';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = f(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export interface StoredPdf {
  name: string;
  blob: Blob;
}

export async function savePdf(file: File): Promise<void> {
  await run('readwrite', (s) => s.put({ name: file.name, blob: file } satisfies StoredPdf, KEY));
  window.dispatchEvent(new Event('formbuilder:pdf-forget'));
}

export async function loadPdf(): Promise<StoredPdf | null> {
  try {
    return ((await run('readonly', (s) => s.get(KEY))) as StoredPdf | undefined) ?? null;
  } catch {
    return null;
  }
}

const BLANK_KEY = 'blank-package';

/** The blank-draft package (a blank form exported from Form Builder with the annotated PDF added): kept so a package can be made again. */
export async function saveBlankPackage(file: File): Promise<void> {
  await run('readwrite', (s) => s.put({ name: file.name, blob: file } satisfies StoredPdf, BLANK_KEY));
}

export async function loadBlankPackage(): Promise<StoredPdf | null> {
  try {
    return ((await run('readonly', (s) => s.get(BLANK_KEY))) as StoredPdf | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function clearPdf(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(KEY));
    window.dispatchEvent(new Event('formbuilder:pdf-forget'));
  } catch {
    /* nothing stored */
  }
}

export function saveAnchors(anchors: Anchors): void {
  try {
    localStorage.setItem(ANCHORS_KEY, JSON.stringify(anchors));
  } catch {
    /* not critical */
  }
}

export function loadAnchors(): Anchors {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(ANCHORS_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Anchors) : {};
  } catch {
    return {};
  }
}
