export type Confidence = 'high' | 'medium' | 'low';

/** The signer names we allow, and nothing else. */
export const SIGNER_NAMES = [
  'Individual Signatory', 'Authorized Signatory', 'Joint Signatory', 'Spouse Signatory',
  'Custodian Signatory', 'Additional Signatory', 'Witness Signatory', 'General Partner Signatory',
] as const;
export type SignerName = (typeof SIGNER_NAMES)[number];

export interface Evidence {
  /** Page as printed in the PDF (1-based), when known. */
  page: number | null;
  quote: string;
}

export interface InvestorTypeOption {
  label: string;
  /** The alias of the matching option in the annotation, when the options come from a picklist there. */
  optionAlias: string | null;
}

export interface InvestorTypeData {
  source: 'picklist' | 'signature-blocks' | 'instructions';
  /** radio unless the sub-doc says to check all that apply; individuals are always radio. */
  selectionMode: 'radio' | 'checkbox';
  /** The annotated group holding the picklist, when there is one. */
  existingGroupAlias: string | null;
  individual: InvestorTypeOption[];
  entity: InvestorTypeOption[];
  /** Options the instructions do not place in either column. */
  unplaced: string[];
}

export type DecisionData =
  | { kind: 'investor-type'; value: InvestorTypeData }
  | { kind: 'signature'; signatureAlias: string; signerName: SignerName; role: 'LpSignature' | 'GpSignature'; sharedByAllInvestors?: boolean }
  | { kind: 'signature-field'; fieldAlias: string; signatureAlias: string; type: 'Date' | 'Name' | 'Title' | 'Custom'; description: string | null }
  | { kind: 'address'; alias: string }
  | { kind: 'optional'; alias: string }
  /** A label the PDF prints beside or above a box the annotation left unlabelled. */
  | { kind: 'label'; alias: string; text: string; source: 'pdf-text' | 'ai' }
  | { kind: 'acronym'; word: string }
  /** One UI field mapped to several PDF places that always show and hide together. */
  | { kind: 'merge-field'; primaryAlias: string; mergedAliases: string[] }
  /** A field that stays invisible and is prefilled from a visible one (a rule later). */
  | { kind: 'prefilled-field'; alias: string; sourceAlias: string }
  /** Documents the sub-doc makes the investor submit: a file group below the paragraph that lists them. */
  | { kind: 'supporting-docs'; paragraphAlias: string; groupName: string; files: { description: string; helpText: string[] }[]; /** The sub-doc lets the investor provide it instead of completing the form: an optional checkbox opens the upload, at the end of the page. */ instead?: boolean }
  /** A part of the sub-doc the investor only reads: a new page with the pages cut from the sub-doc PDF. */
  | { kind: 'embedded-pdf'; fileName: string; title: string; start: number; end: number; beforePage: string | null; subtitle: string; /** An agreement to confirm, a consent to give, or nothing (the file only informs). */ confirm?: 'agreement' | 'consent' | null }
  /** Neighbouring elements that belong together, in one group (a section, or what a condition shows). Found by position, built by alias. */
  | { kind: 'group'; name: string; fromAlias: string; toAlias: string; groupKind: 'section' | 'conditional'; /** The element whose answer shows a conditional group: it stays outside. */ controlAlias: string | null; condition: string | null; size: number }
  /** Text the PDF prints that the form never shows: a paragraph with the words as printed, right after the element above it on the PDF page. */
  | { kind: 'add-text'; text: string; pdfPage: number; after: string | null; before: string | null; page: string | null }
  /** Fillable fields that leave a full-page PDF page for another page. */
  | { kind: 'move-fields'; aliases: string[]; targetPage: string; wrapperTitle: string };

/** One thing the AI proposes. Nothing is applied until the user accepts it. */
export interface Decision {
  id: string;
  title: string;
  detail: string;
  evidence: Evidence | null;
  confidence: Confidence;
  defaultAccepted: boolean;
  data: DecisionData;
}
