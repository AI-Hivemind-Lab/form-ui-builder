export type NodeType = 'null' | 'string' | 'number' | 'object' | 'array';

export interface SchemaNode {
  name: string;
  type: NodeType;
  title: string;
  enum?: string[];
  /** Array nodes (MultipleCheckbox etc.) keep their option values, in order, under items.enum. */
  items?: { type?: string; enum?: string[] };
  format?: string;
  /** Starting value of an input field. */
  default?: unknown;
  properties?: SchemaNode[];
}

/** One uiSchema entry: a bag of `ui:*` keys. */
export type UiEntry = Record<string, unknown>;
export type UiSchema = Record<string, UiEntry>;

export interface FormDoc {
  schema: { type: 'object'; properties: SchemaNode[] };
  uiSchema: UiSchema;
  /** Namespace this doc was loaded from (used by export); defaults to "main". */
  namespace?: string;
  /** The raw loaded export, carried through so export can keep rules/libs. */
  source?: unknown;
}

/** Flat map keyed by field name. */
export type Values = Record<string, unknown>;

export interface Option {
  value: string;
  /** Plain-text label (rich markup stripped). */
  label: string;
  /** The option's raw rich label (`formattedText`), when it has one. */
  html?: string;
  /** Names of the fields shown below this option (Radio / MultipleCheckbox only). */
  fieldsBelow?: string[];
}
