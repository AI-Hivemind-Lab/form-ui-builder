import type { NodeType, UiEntry } from './types';

export type WidgetKind = 'container' | 'static' | 'input' | 'placeholder';

export interface WidgetDef {
  id: string;
  label: string;
  kind: WidgetKind;
  schema: { type: NodeType; format?: string };
  defaults: UiEntry;
}

const DEFAULT_OPTIONS = [
  ['option_1', { formattedText: '<p>Option 1</p>', blueprintMetadataMapping: '' }],
  ['option_2', { formattedText: '<p>Option 2</p>', blueprintMetadataMapping: '' }],
];

function def(
  id: string,
  label: string,
  kind: WidgetKind,
  type: NodeType,
  extra: { format?: string; defaults?: UiEntry } = {},
): WidgetDef {
  const withEnabledComment = kind === 'input' ? { 'ui:enabledComment': true } : {};
  return {
    id,
    label,
    kind,
    schema: extra.format ? { type, format: extra.format } : { type },
    defaults: { 'ui:widget': id, 'ui:marginBottom': '12px', ...withEnabledComment, ...(extra.defaults ?? {}) },
  };
}

const CHOICE = { 'ui:multipleOption': { options: DEFAULT_OPTIONS } };

/** In picker order (matches the reference screenshots). */
export const WIDGET_CATALOG: WidgetDef[] = [
  def('Group', 'Group', 'container', 'object'),
  def('Page', 'Page', 'container', 'object'),
  def('Paragraph', 'Paragraph', 'static', 'null'),
  def('Header', 'Header', 'static', 'null', { defaults: { 'ui:heading': 'Heading' } }),
  def('TextBox', 'TextBox', 'input', 'string'),
  def('MultipleCheckbox', 'MultipleCheckbox', 'input', 'array', { defaults: { ...CHOICE, 'ui:fixedLayout': 'Inline' } }),
  def('MultipleSuggest', 'MultipleSuggest', 'input', 'array', { defaults: CHOICE }),
  def('Radio', 'Radio', 'input', 'string', { defaults: { ...CHOICE, 'ui:fixedLayout': 'Inline' } }),
  def('Dropdown', 'Dropdown', 'input', 'string', { defaults: CHOICE }),
  def('Signature', 'Signature', 'placeholder', 'null', { defaults: { 'ui:signatureType': 'LpSignature', 'ui:signatureSigner': 'Individual Signatory', 'ui:signature': [] } }),
  def('Pdf', 'Pdf/Word', 'placeholder', 'null', { defaults: { 'ui:height': '600pt' } }),
  def('Repeatable', 'Repeatable', 'container', 'array', { defaults: { 'ui:maxLength': 1 } }),
  def('TextArea', 'TextArea', 'input', 'string'),
  def('Integer', 'Integer', 'input', 'number'),
  def('Float', 'Float', 'input', 'number'),
  def('Percentage', 'Percentage', 'input', 'number'),
  def('Money', 'Money', 'input', 'number'),
  def('Year', 'Year', 'input', 'number'),
  def('Email', 'Email', 'input', 'string'),
  def('Date', 'Date', 'input', 'string', { format: 'date' }),
  def('Phone', 'Phone', 'input', 'string'),
  def('FileGroup', 'FileGroup', 'placeholder', 'null'),
  def('File', 'File', 'placeholder', 'null'),
  def('AnchorLink', 'AnchorLink', 'static', 'null'),
  def('Country', 'Country', 'input', 'string'),
  def('State', 'State', 'input', 'string'),
  def('CustomFormat', 'Custom format', 'input', 'string'),
];

const BY_ID = new Map(WIDGET_CATALOG.map((w) => [w.id, w]));

export function getWidgetDef(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

/** Unknown ids count as inputs, so a loaded file's odd widget keeps a label and a Required toggle. */
export function widgetKind(id: string): WidgetKind {
  return BY_ID.get(id)?.kind ?? 'input';
}

/** The ids a field of widget `id` may be switched to in the Input type dropdown. */
export function switchGroup(id: string): string[] {
  const d = BY_ID.get(id);
  if (!d) return [];
  if (id === 'Page' || id === 'Header') return [id];
  if (d.kind === 'container') return ['Group', 'Repeatable'];
  if (d.kind === 'static') return ['Paragraph', 'AnchorLink'];
  return WIDGET_CATALOG.filter((w) => w.kind === d.kind).map((w) => w.id);
}

export function filterWidgets(query: string): WidgetDef[] {
  const q = query.trim().toLowerCase();
  return q === '' ? WIDGET_CATALOG : WIDGET_CATALOG.filter((w) => w.label.toLowerCase().includes(q));
}
