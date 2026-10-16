import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { filterWidgets, getWidgetDef, switchGroup, WIDGET_CATALOG, widgetKind } from './widgetCatalog';

describe('catalog invariants', () => {
  it('has the 27 picker widgets in picker order with unique ids', () => {
    const ids = WIDGET_CATALOG.map((w) => w.id);
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(27);
    expect(ids.slice(0, 4)).toEqual(['Group', 'Page', 'Paragraph', 'Header']);
    expect(ids).toContain('Pdf');
    expect(ids).toContain('CustomFormat');
  });
  it('every def has a label, a schema type, and defaults carrying its own widget id', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.label).not.toBe('');
      expect(w.schema.type).toBeTruthy();
      expect(w.defaults['ui:widget']).toBe(w.id);
    }
  });
  it('knows every widget used by the demo form', () => {
    const used = new Set(Object.values(demo.namespaceFormSchemaMap.main.uiSchema).map((u) => (u as Record<string, string>)['ui:widget']));
    for (const id of used) expect(getWidgetDef(id), id).toBeDefined();
  });
  it('maps schema types and formats', () => {
    expect(getWidgetDef('Money')?.schema).toEqual({ type: 'number' });
    expect(getWidgetDef('Date')?.schema).toEqual({ type: 'string', format: 'date' });
    expect(getWidgetDef('Repeatable')?.schema.type).toBe('array');
    expect(getWidgetDef('MultipleCheckbox')?.schema.type).toBe('array');
    expect(getWidgetDef('Group')?.schema.type).toBe('object');
    expect(getWidgetDef('Header')?.schema.type).toBe('null');
  });
  it('seeds sensible defaults', () => {
    expect(getWidgetDef('Repeatable')?.defaults).toMatchObject({ 'ui:maxLength': 1 });
    expect(getWidgetDef('Header')?.defaults['ui:heading']).toBe('Heading');
    expect(getWidgetDef('Radio')?.defaults['ui:fixedLayout']).toBe('Inline');
    expect(getWidgetDef('Radio')?.defaults['ui:multipleOption']).toBeDefined();
    expect(getWidgetDef('TextBox')?.defaults['ui:enabledComment']).toBe(true);
  });
});

describe('Pdf widget (real id in exports; the picker label stays Pdf/Word)', () => {
  it('is a placeholder with the Pdf/Word label and a default height', () => {
    expect(getWidgetDef('Pdf')).toMatchObject({ id: 'Pdf', label: 'Pdf/Word', kind: 'placeholder' });
    expect(getWidgetDef('Pdf')?.defaults['ui:height']).toBe('600pt');
    expect(getWidgetDef('PdfWord')).toBeUndefined();
  });
});

describe('widgetKind (Review Focus 5: unknown ids)', () => {
  it('classifies known widgets', () => {
    expect(widgetKind('Page')).toBe('container');
    expect(widgetKind('Repeatable')).toBe('container');
    expect(widgetKind('Header')).toBe('static');
    expect(widgetKind('AnchorLink')).toBe('static');
    expect(widgetKind('Email')).toBe('input');
    expect(widgetKind('Signature')).toBe('placeholder');
    expect(widgetKind('File')).toBe('placeholder');
  });
  it('treats an unknown id as an input (so it keeps a label and a Required toggle)', () => {
    expect(widgetKind('Bogus')).toBe('input');
  });
});

describe('switchGroup', () => {
  it('lets inputs switch among all inputs', () => {
    const g = switchGroup('TextBox');
    expect(g).toContain('Integer');
    expect(g).toContain('Dropdown');
    expect(g).not.toContain('Group');
  });
  it('lets Group and Repeatable swap, never Page', () => {
    expect(switchGroup('Group')).toEqual(['Group', 'Repeatable']);
    expect(switchGroup('Repeatable')).toEqual(['Group', 'Repeatable']);
    expect(switchGroup('Page')).toEqual(['Page']);
  });
  it('keeps Header fixed and lets Paragraph/AnchorLink swap', () => {
    expect(switchGroup('Header')).toEqual(['Header']);
    expect(switchGroup('Paragraph')).toEqual(['Paragraph', 'AnchorLink']);
  });
  it('lets placeholders swap among placeholders', () => {
    expect(switchGroup('Signature').sort()).toEqual(['File', 'FileGroup', 'Pdf', 'Signature']);
  });
  it('returns [] for unknown ids', () => {
    expect(switchGroup('Bogus')).toEqual([]);
  });
});

describe('filterWidgets', () => {
  it('returns everything for an empty/whitespace query', () => {
    expect(filterWidgets('')).toHaveLength(27);
    expect(filterWidgets('   ')).toHaveLength(27);
  });
  it('matches labels case-insensitively and trims', () => {
    expect(filterWidgets(' RADIO ').map((w) => w.id)).toEqual(['Radio']);
    expect(filterWidgets('pdf').map((w) => w.id)).toEqual(['Pdf']);
    expect(filterWidgets('custom').map((w) => w.id)).toEqual(['CustomFormat']);
  });
  it('returns [] when nothing matches', () => {
    expect(filterWidgets('zzz')).toEqual([]);
  });
});
