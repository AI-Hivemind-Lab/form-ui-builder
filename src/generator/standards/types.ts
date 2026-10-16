import type { Anchors } from '../../model/pdfStore';
import type { FormDoc } from '../../model/types';
import type { PageText } from '../pdfText';

/** What a standard may read and change. `doc` is replaced, never mutated in place. */
export interface StandardContext {
  doc: FormDoc;
  /** Where each annotated PDF field sits, by alias. */
  anchors: Anchors;
  /** Every highlighted text and paragraph of the annotation, as plain text. */
  texts: string[];
  /** The text of the PDF pages (0-based), when the PDF was read. */
  pdf?: PageText[] | null;
  /** Records one change ("standard X changed Y") for the change log. */
  log: (message: string) => void;
  /** Something the user should look at. */
  warn: (message: string) => void;
}

export interface Standard {
  id: string;
  title: string;
  /** Who decides: a rule, the AI layer, or both. */
  source: 'rule' | 'ai' | 'hybrid';
  apply: (ctx: StandardContext) => void;
}
