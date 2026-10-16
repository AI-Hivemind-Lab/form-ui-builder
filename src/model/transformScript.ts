import { buildExport } from './exportForm';
import { safeFileName } from './packageExport';
import type { FormDoc } from './types';

/**
 * The transFORM Chrome extension changes a form that is open for editing in Form Builder without importing anything: it reads the form
 * (POST /api/v3/form/getForm), runs a JavaScript function on its `formData`, keeps from the answer only `schema` and `uiSchema` of the form's
 * namespace, and saves a new draft version of the SAME form (POST /api/v3/form/saveForm). The PDFs the form already holds are not touched, so
 * nothing is uploaded twice. This turns our form into such a function: paste it in the extension's "Transformation" box.
 */

export interface TransformScript {
  script: string;
  /** What would crash or confuse the save, found before anything is sent. */
  problems: string[];
}

interface Node {
  name?: string;
  type?: string;
  items?: unknown;
  properties?: unknown;
}

export interface EmbeddedCut {
  name: string;
  start: number;
  end: number;
}

/** The embedded PDFs the form asks for: one per file name, with the pages (counted from 1) of the PDF the form holds. */
export function embeddedCutsOf(uiSchema: Record<string, Record<string, unknown>>): { cuts: EmbeddedCut[]; problems: string[] } {
  const cuts: EmbeddedCut[] = [];
  const problems: string[] = [];
  for (const [key, ui] of Object.entries(uiSchema)) {
    if (ui['ui:widget'] !== 'Pdf') continue;
    const name = typeof ui['ui:embeddedPdf'] === 'string' ? ui['ui:embeddedPdf'].trim() : '';
    const cut = ui['ui:pdfCutInfo'] as { start?: unknown; end?: unknown } | undefined;
    if (name === '' || !cut) continue; // nothing to cut: shown empty, as in the editor
    if (!Number.isInteger(cut.start) || !Number.isInteger(cut.end) || (cut.start as number) < 1 || (cut.end as number) < (cut.start as number)) {
      problems.push(`${key}: its source pages ${String(cut.start)} to ${String(cut.end)} are not a page range`);
      continue;
    }
    const start = cut.start as number;
    const end = cut.end as number;
    const same = cuts.find((c) => c.name === name);
    if (!same) cuts.push({ name, start, end });
    else if (same.start !== start || same.end !== end) problems.push(`${key}: the file "${name}" is also used with pages ${same.start} to ${same.end}, not ${start} to ${end}`);
  }
  return { cuts, problems };
}

/** The structure the Form Builder server needs to read a form: an array without `items` crashes it (a NullPointerException on save). */
export function saveProblems(schema: unknown, uiSchema: Record<string, Record<string, unknown>>): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  const visit = (nodes: unknown, path: string): void => {
    if (!Array.isArray(nodes)) return;
    (nodes as Node[]).forEach((n) => {
      const here = `${path}/${n.name ?? '?'}`;
      if (typeof n.name !== 'string' || n.name === '') problems.push(`${here}: a node has no name`);
      else if (names.has(n.name)) problems.push(`${here}: the name "${n.name}" is used twice`);
      else names.add(n.name);
      if (n.type === 'array' && (typeof n.items !== 'object' || n.items === null || Array.isArray(n.items))) problems.push(`${here}: an array needs "items" (the server crashes without it)`);
      if (n.type === 'array' && n.items && typeof n.items === 'object') visit((n.items as Node).properties, `${here}/items`);
      visit(n.properties, here);
    });
  };
  visit((schema as { properties?: unknown })?.properties, '');
  Object.keys(uiSchema).forEach((k) => {
    if (!names.has(k)) problems.push(`uiSchema has "${k}" but the schema has no such field`);
  });
  problems.push(...embeddedCutsOf(uiSchema).problems);
  return problems;
}

/** The function to paste into transFORM's "Transformation" box. */
export function buildTransformScript(doc: FormDoc, fundName = ''): TransformScript {
  const form = buildExport(doc) as { defaultNamespace?: string; namespaceFormSchemaMap: Record<string, { schema: unknown; uiSchema: Record<string, Record<string, unknown>> }> };
  const ns = doc.namespace ?? form.defaultNamespace ?? 'main';
  const ours = form.namespaceFormSchemaMap[ns];
  for (const ui of Object.values(ours.uiSchema)) if (ui['ui:widget'] === 'Pdf' && typeof ui['ui:embeddedPdf'] === 'string') ui['ui:embeddedPdf'] = safeFileName(ui['ui:embeddedPdf']); // (as in the package)
  const problems = saveProblems(ours.schema, ours.uiSchema);
  const data = JSON.stringify({ schema: ours.schema, uiSchema: ours.uiSchema, embeddedCuts: embeddedCutsOf(ours.uiSchema).cuts }).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029'); // (line separators end a line of JavaScript)
  const safeFund = fundName.replace(/[^A-Za-z0-9 ,.&()'-]/g, ' ').trim();
  const made = safeFund === '' ? '' : ` for ${safeFund}`;
  const script = `function (jsonData) {
  // Made by UI Builder${made}: replaces the form's fields and widgets with the ones built from the annotated PDF.
  // The PDFs the form already holds, its rules and everything else stay as they are.
  // embeddedCuts lists the embedded PDFs (pages of the PDF the form holds): the patched transFORM makes them while saving, the original ignores the list.
  const ours = ${data};
  const ns = (jsonData.form && jsonData.form.defaultNamespace) || ${JSON.stringify(ns)};
  // the File widget must name the annotated PDF this form holds
  const held = jsonData.uploadedPdf && jsonData.uploadedPdf[0] && jsonData.uploadedPdf[0][1] && jsonData.uploadedPdf[0][1].name;
  if (held) {
    const retitle = (list) => (list || []).forEach((n) => {
      if (ours.uiSchema[n.name] && ours.uiSchema[n.name]['ui:widget'] === 'File') n.title = held;
      retitle(n.properties);
    });
    Object.keys(ours.uiSchema).forEach((k) => { if (ours.uiSchema[k]['ui:widget'] === 'File') ours.uiSchema[k]['ui:fileName'] = held; });
    retitle(ours.schema.properties);
  }
  const maps = (jsonData.form && jsonData.form.namespaceFormSchemaMap) || {};
  return {
    ...jsonData,
    form: {
      ...jsonData.form,
      namespaceFormSchemaMap: { ...maps, [ns]: { ...(maps[ns] || {}), schema: ours.schema, uiSchema: ours.uiSchema } },
    },
    embeddedCuts: ours.embeddedCuts,
  };
}
`;
  return { script, problems };
}
