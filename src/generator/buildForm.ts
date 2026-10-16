import { buildExport } from '../model/exportForm';
import { loadForm } from '../model/loadForm';
import type { Anchors } from '../model/pdfStore';
import type { PageText } from './pdfText';
import { cleanGlyphs } from './cleanText';
import { annotationToForm, type GeneratedForm } from './annotationToForm';
import { runStandards } from './standards';
import type { StandardContext } from './standards/types';
import { pageOrderWarnings } from './pageOrder';
import { nodesOf, plainText, walk } from './standards/util';

export interface BuildFormOptions {
  fundName?: string;
  /** Ids of standards to skip. */
  disabledStandards?: string[];
  /** The text of the PDF's pages: headings and question numbers the annotation lacks are read from it. */
  pdfPages?: PageText[] | null;
}

export interface BuiltForm {
  form: Record<string, unknown>;
  anchors: Anchors;
  /** Things to look at. */
  warnings: string[];
  /** What the standards changed, one line each. */
  changes: string[];
  /** Every highlighted text and paragraph of the annotation, as plain text. */
  texts: string[];
  stats: GeneratedForm['stats'];
}

/** Every highlighted text and paragraph of the annotation, as plain text (for settling what is an acronym). */
function annotationTexts(annotationJson: string): string[] {
  const data = JSON.parse(annotationJson) as { pdfObjectDTO?: { __typename__: string; content?: [number, string] }[] };
  return (data.pdfObjectDTO ?? [])
    .filter((o) => (o.__typename__ === 'PdfTextLabelDTO' || o.__typename__ === 'PdfParagraphFieldDTO') && o.content)
    .map((o) => plainText(cleanGlyphs(o.content?.[1] ?? '')));
}

/** The importer's draft, then the standards. This is what the app builds from an annotation. */
export function buildForm(annotationJson: string, options: BuildFormOptions = {}): BuiltForm {
  const base = annotationToForm(annotationJson, { fundName: options.fundName, pdfPages: options.pdfPages });
  const changes: string[] = [];
  const extra: string[] = [];
  const ctx: StandardContext = {
    doc: loadForm(structuredClone(base.form)),
    anchors: base.anchors,
    texts: annotationTexts(annotationJson),
    pdf: options.pdfPages ?? null,
    log: (m) => changes.push(m),
    warn: (m) => extra.push(m),
  };
  runStandards(ctx, options.disabledStandards ?? []);

  // Warnings about things the standards moved or finished no longer apply; signature gaps are recomputed.
  const names = new Set(Object.keys(ctx.doc.uiSchema));
  const subject = /^(?:LABEL MISSING|NEEDS RULE): (?:option |radio group |checkbox group |repeatable |section )?(\S+)/;
  const warnings = base.warnings.filter((w) => {
    if (w.startsWith('SIGNATURE:')) return false;
    const m = subject.exec(w);
    return !m || names.has(m[1]);
  });
  nodesOf(ctx.doc, 'Signature').forEach((n) => {
    const signer = ctx.doc.uiSchema[n.name]?.['ui:signatureSigner'];
    if (!(typeof signer === 'string' && signer.trim())) warnings.push(`SIGNATURE: ${n.name} has no signer name`);
  });
  warnings.push(...extra);
  // the form's pages read in the sub-doc's order; anything else is said, not guessed
  warnings.push(...pageOrderWarnings(ctx.doc, base.anchors));

  let count = 0;
  walk(ctx.doc.schema.properties, () => {
    count += 1;
  });
  return { form: buildExport(ctx.doc) as Record<string, unknown>, anchors: base.anchors, warnings: [...new Set(warnings)], changes, texts: ctx.texts, stats: { ...base.stats, nodes: count } };
}
