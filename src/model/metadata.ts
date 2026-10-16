import type { UiEntry } from './types';
import { SIGNER_ROLES } from './signature';
import { getWidgetDef, type WidgetDef } from './widgetCatalog';

export type Control =
  | 'html-text' | 'required' | 'visible' | 'text' | 'integer' | 'px' | 'width'
  | 'enum' | 'options' | 'string-list' | 'bool' | 'json' | 'format' | 'page-range' | 'file-group';

export interface MetaDef {
  key: string;
  label: string;
  control: Control;
  applies: (w: WidgetDef | undefined) => boolean;
  presets?: string[];
  enumValues?: { value: string; label: string }[];
  /** Placeholder / displayed default when the key is absent. */
  defaultText?: string;
  /** Value shown (and assumed) for an enum when the key is absent. */
  defaultValue?: string;
}

export const MARGIN_PRESETS = ['0px', '4px', '8px', '12px', '16px', '24px', '32px', '48px'];
export const INDENT_PRESETS = ['0px', '12px', '24px', '36px', '48px'];
export const WIDTH_PRESETS = ['Auto', '25%', '50%', '75%', '100%'];

const idOf = (w: WidgetDef | undefined): string => w?.id ?? '';
const is = (...ids: string[]) => (w: WidgetDef | undefined) => ids.includes(idOf(w));
const not = (...ids: string[]) => (w: WidgetDef | undefined) => !ids.includes(idOf(w));
const hasValue = (w: WidgetDef | undefined) => (w?.kind ?? 'input') === 'input';
const valueOrRepeatable = (w: WidgetDef | undefined) => hasValue(w) || idOf(w) === 'Repeatable';

const NOT_SET = { value: '', label: 'Not set' };

/** In display order. Rows hide when `applies` is false. */
export const METADATA: MetaDef[] = [
  { key: 'ui:formattedText', label: 'Label', control: 'html-text', applies: not('Header', 'Page', 'Signature', 'FileGroup') },
  {
    key: 'ui:headerType', label: 'Header type', control: 'enum', applies: is('Header'),
    enumValues: [NOT_SET, { value: 'Heading1', label: 'Heading 1' }, { value: 'Heading2', label: 'Heading 2' }],
  },
  { key: 'ui:subtitle', label: 'Subtitle', control: 'text', applies: is('Header') },
  { key: 'ui:heading', label: 'Heading', control: 'text', applies: is('Header') },
  { key: 'ui:description', label: 'Description', control: 'text', applies: is('Header') },
  { key: 'ui:embeddedPdf', label: 'Embedded PDF', control: 'text', applies: is('Pdf') },
  { key: 'ui:pdfCutInfo', label: 'Source pages', control: 'page-range', applies: is('Pdf') },
  { key: 'ui:height', label: 'Height', control: 'text', applies: is('Pdf'), defaultText: '600pt' },
  { key: 'ui:viewInModal', label: 'View in modal', control: 'bool', applies: is('Pdf') },
  { key: 'ui:fileName', label: 'File name', control: 'text', applies: is('File') },
  { key: 'ui:signingGuideline', label: 'Signing guideline', control: 'json', applies: is('File') },
  { key: 'ui:href', label: 'Link URL', control: 'text', applies: is('AnchorLink') },
  { key: 'ui:pattern', label: 'Format pattern (regex)', control: 'text', applies: is('CustomFormat') },
  { key: 'ui:customFormat', label: 'Format', control: 'format', applies: is('CustomFormat') },
  { key: 'ui:validationError', label: 'Validation error', control: 'text', applies: is('CustomFormat') },
  { key: 'ui:placeholder', label: 'Placeholder', control: 'text', applies: hasValue },
  { key: 'ui:subdivisionOf', label: 'Subdivision of', control: 'text', applies: is('State') },
  {
    key: 'ui:wellType', label: 'Well type', control: 'enum', applies: is('Paragraph'),
    enumValues: [NOT_SET, { value: 'Default', label: 'Default' }, { value: 'Info', label: 'Info' }, { value: 'Warning', label: 'Warning' }],
  },
  {
    key: 'ui:signatureType', label: 'Signer role', control: 'enum', applies: is('Signature'),
    enumValues: SIGNER_ROLES.map((r) => ({ ...r })), defaultValue: 'LpSignature',
  },
  { key: 'ui:signatureSigner', label: 'Signer', control: 'text', applies: is('Signature'), defaultText: 'Individual Signatory' },
  { key: 'ui:uniqueSignerEmail', label: 'Unique signer email', control: 'bool', applies: is('Signature') },
  { key: 'ui:supportingFileGroup', label: 'Supporting files', control: 'file-group', applies: is('FileGroup') },
  { key: 'ui:dynamicLayout', label: 'Dynamic layout', control: 'json', applies: is('Group') },
  { key: 'ui:maxLength', label: 'Max number of items', control: 'integer', applies: is('Repeatable'), defaultText: '1' },
  { key: 'ui:repeatableText', label: 'Item name', control: 'text', applies: is('Repeatable'), defaultText: 'row' },
  { key: 'ui:required', label: 'Required', control: 'required', applies: valueOrRepeatable },
  { key: 'ui:multipleOption', label: 'Options', control: 'options', applies: is('Radio', 'Dropdown', 'MultipleCheckbox', 'MultipleSuggest') },
  { key: 'ui:initialSignatureAlias', label: 'Initial signature alias', control: 'text', applies: is('Radio', 'MultipleCheckbox'), defaultText: 'initials' },
  {
    key: 'ui:fixedLayout', label: 'Layout', control: 'enum', applies: is('Radio', 'MultipleCheckbox'),
    enumValues: [
      { value: 'Default', label: 'Default' }, { value: 'Inline', label: 'Inline' },
      { value: 'TwoColumns', label: '2 columns' }, { value: 'ThreeColumns', label: '3 columns' },
    ],
    defaultValue: 'Default',
  },
  { key: 'ui:clearable', label: 'Clearable', control: 'bool', applies: is('Radio') },
  { key: 'ui:pdfMapping', label: 'PDF Mapping', control: 'string-list', applies: not('Header', 'Page', 'Group', 'Signature') },
  { key: 'ui:asaMapping', label: 'Anduin Standard Alias Mapping', control: 'string-list', applies: not('Page', 'Group') },
  { key: 'ui:signature', label: 'Signature', control: 'string-list', applies: not('Header', 'Page', 'Group') },
  { key: 'ui:width', label: 'Width', control: 'width', applies: not('Page', 'Group', 'Header') },
  { key: 'ui:marginBottom', label: 'Margin bottom', control: 'px', presets: MARGIN_PRESETS, applies: () => true },
  { key: 'ui:indentation', label: 'Indentation', control: 'px', presets: INDENT_PRESETS, applies: () => true },
  { key: 'ui:enabledComment', label: 'Enable Commenting', control: 'bool', applies: valueOrRepeatable },
  { key: 'ui:external', label: 'External', control: 'bool', applies: valueOrRepeatable },
  { key: 'ui:disable', label: 'Disabled', control: 'bool', applies: hasValue },
  { key: 'ui:tooltipForDisabledState', label: 'Tooltip when disabled', control: 'text', applies: is('Page', 'Group') },
  { key: 'ui:invisible', label: 'Visible', control: 'visible', applies: () => true },
];

export const KNOWN_KEYS = new Set<string>(['ui:widget', ...METADATA.map((m) => m.key)]);

export function metadataFor(widgetId: string): MetaDef[] {
  const w = getWidgetDef(widgetId);
  return METADATA.filter((m) => m.applies(w));
}

/** ui:* keys that are not structured metadata, in object order (shown as custom key/value rows). */
export function customEntries(ui: UiEntry): [string, unknown][] {
  return Object.entries(ui).filter(([k]) => k.startsWith('ui:') && !KNOWN_KEYS.has(k));
}
