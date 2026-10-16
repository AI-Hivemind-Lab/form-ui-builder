/**
 * transFORM patch: make the embedded PDF files (the "cuts" of the source PDF) while saving.
 *
 * Copy this file to js/api/cutApi.js in the extension. UI Builder's function returns, next to the form, a list
 * `embeddedCuts: [{ name, start, end }]` (pages `start` to `end`, counted from 1, of the PDF the form holds). Form Builder makes such a cut
 * with POST cutFile and then lists it in `formData.embeddedPdf` and in the metadata's `pdfCuts`. This does the same before the form is saved.
 *
 * The three calls were read from what Form Builder sends when a Pdf widget's source pages are set:
 *   getFileInfoToCut {fileId, formId}                          -> {url, pageCount}
 *   cutFile          {fileId, formId, start, end, fileName}    -> {fileId}
 *   getPdfUrl        {fileId, password: null}                  -> {url, numberOfFiles}
 * Paths confirmed for production (portal.anduin.app) and Minas (portal-minas-tirith.anduin.dev): https://<host>/api/v3/<path>.
 */

export const CUT_PATHS = {
    info: 'form/getFileInfoToCut',
    cut: 'form/cutFile',
    check: 'files/getPdfUrl'
};

/** A function that posts `body` to the API path and gives back the answer's JSON (throws when the server says no). */
export function apiCaller(getFullAPIURL, hostname, authToken, fetchFn = fetch) {
    return async (path, body) => {
        const resp = await fetchFn(getFullAPIURL(hostname, path), {
            method: 'POST',
            headers: { accept: '*/*', authorization: `Bearer ${authToken}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
            credentials: 'include'
        });
        if (!resp.ok) throw new Error(`${path} failed: ${resp.status}`);
        return resp.json();
    };
}

async function stillThere(call, fileId) {
    try {
        const answer = await call(CUT_PATHS.check, { fileId, password: null });
        return Boolean(answer && answer.url);
    } catch {
        return false;
    }
}

/**
 * Makes each wanted cut that the form does not already have, then writes it into the form (embeddedPdf) and its metadata (pdfCuts).
 * A cut is kept as it is when the form already lists that name for the same pages of the same PDF and the file is still there, so
 * pressing Apply twice does not leave a second copy (the platform archives files, it never deletes them).
 * Nothing is made until every wanted cut has been checked against the page count.
 * @param {Object} transformed  the sandbox's answer: {formData, formModel, metadata, embeddedCuts}; formData and metadata are replaced
 * @param {(path: string, body: Object) => Promise<Object>} call
 * @param {(message: string) => void} say
 * @returns {Promise<{made: number, kept: number}>}
 */
export async function applyEmbeddedCuts(transformed, call, say = () => {}) {
    const wanted = transformed.embeddedCuts;
    if (!Array.isArray(wanted) || wanted.length === 0) return { made: 0, kept: 0 };
    const form = transformed.formData;
    const held = (form.uploadedPdf || [])[0];
    if (!held) throw new Error('The form holds no source PDF to cut the embedded PDFs from');
    const [sourceId, source] = held;
    const formId = transformed.formModel.formId;

    const info = await call(CUT_PATHS.info, { fileId: sourceId, formId });
    const names = new Set();
    for (const c of wanted) {
        if (typeof c.name !== 'string' || c.name.trim() === '') throw new Error('An embedded PDF has no file name');
        if (names.has(c.name)) throw new Error(`The embedded PDF "${c.name}" is wanted twice`);
        names.add(c.name);
        if (!Number.isInteger(c.start) || !Number.isInteger(c.end) || c.start < 1 || c.end < c.start || c.end > info.pageCount) {
            throw new Error(`"${c.name}": pages ${c.start} to ${c.end} are not inside the ${info.pageCount}-page PDF`);
        }
    }

    const cuts = { ...((transformed.metadata && transformed.metadata.pdfCuts) || {}) };
    const embedded = (form.embeddedPdf || []).map((e) => [e[0], e[1]]);
    let made = 0;
    let kept = 0;
    for (const c of wanted) {
        const at = embedded.findIndex((e) => e[0] === c.name);
        const had = cuts[c.name];
        const same = had && had.start === c.start && had.end === c.end && had.fileName === source.name;
        if (at >= 0 && same && (await stillThere(call, embedded[at][1]))) {
            kept++;
            continue;
        }
        say(`Cutting pages ${c.start} to ${c.end} as "${c.name}"...`);
        const answer = await call(CUT_PATHS.cut, { fileId: sourceId, formId, start: c.start, end: c.end, fileName: c.name });
        if (!answer || typeof answer.fileId !== 'string' || answer.fileId === '') throw new Error(`Cutting "${c.name}" gave no file`);
        if (at >= 0) embedded[at] = [c.name, answer.fileId];
        else embedded.push([c.name, answer.fileId]);
        cuts[c.name] = { fileName: source.name, start: c.start, end: c.end };
        made++;
    }
    transformed.formData = { ...form, embeddedPdf: embedded };
    transformed.metadata = { ...(transformed.metadata || {}), pdfCuts: cuts };
    return { made, kept };
}
