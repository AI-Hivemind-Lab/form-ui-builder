import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { customEntries, INDENT_PRESETS, KNOWN_KEYS, MARGIN_PRESETS, metadataFor, METADATA, WIDTH_PRESETS } from './metadata';

const keys = (id: string) => metadataFor(id).map((m) => m.key);

describe('registry shape', () => {
  it('has unique keys and every control is known', () => {
    const ks = METADATA.map((m) => m.key);
    expect(new Set(ks).size).toBe(ks.length);
    expect(KNOWN_KEYS.has('ui:widget')).toBe(true);
    for (const k of ks) expect(KNOWN_KEYS.has(k)).toBe(true);
  });
  it('exposes dropdown presets', () => {
    expect(MARGIN_PRESETS).toContain('12px');
    expect(INDENT_PRESETS).toContain('24px');
    expect(WIDTH_PRESETS[0]).toBe('Auto');
  });
});

describe('metadataFor', () => {
  it('Header: subtitle, heading, description, ASA, margin, indentation, visible (no label/required/pdf)', () => {
    const k = keys('Header');
    expect(k).toEqual(expect.arrayContaining(['ui:subtitle', 'ui:heading', 'ui:description', 'ui:asaMapping', 'ui:marginBottom', 'ui:indentation', 'ui:invisible']));
    expect(k).not.toContain('ui:formattedText');
    expect(k).not.toContain('ui:required');
    expect(k).not.toContain('ui:pdfMapping');
    expect(k).not.toContain('ui:width');
  });
  it('Repeatable: max items, item name, required, comments, external', () => {
    expect(keys('Repeatable')).toEqual(expect.arrayContaining(['ui:maxLength', 'ui:repeatableText', 'ui:required', 'ui:enabledComment', 'ui:external', 'ui:formattedText']));
  });
  it('Radio: options and layout; Dropdown: options but no layout', () => {
    expect(keys('Radio')).toEqual(expect.arrayContaining(['ui:multipleOption', 'ui:fixedLayout']));
    expect(keys('Dropdown')).toContain('ui:multipleOption');
    expect(keys('Dropdown')).not.toContain('ui:fixedLayout');
  });
  it('widget-specific rows appear only on their widget', () => {
    expect(keys('AnchorLink')).toContain('ui:href');
    expect(keys('TextBox')).not.toContain('ui:href');
    expect(keys('CustomFormat')).toContain('ui:pattern');
    expect(keys('Pdf')).toEqual(expect.arrayContaining(['ui:embeddedPdf', 'ui:height', 'ui:viewInModal']));
    expect(keys('Pdf')).not.toContain('ui:fileName');
    expect(keys('File')).toContain('ui:fileName');
  });
  it('Page and Group get layout rows, tooltip and visible (a Group also has its heading text)', () => {
    expect(keys('Page')).toEqual(['ui:marginBottom', 'ui:indentation', 'ui:tooltipForDisabledState', 'ui:invisible']);
    expect(keys('Group')).toEqual(['ui:formattedText', 'ui:dynamicLayout', 'ui:marginBottom', 'ui:indentation', 'ui:tooltipForDisabledState', 'ui:invisible']);
  });
  it('unknown widgets are treated like inputs (label, required, ...)', () => {
    expect(keys('Bogus')).toEqual(expect.arrayContaining(['ui:formattedText', 'ui:required', 'ui:invisible']));
  });
  it('is in display order: required before width before margin before visible', () => {
    const k = keys('TextBox');
    expect(k.indexOf('ui:required')).toBeLessThan(k.indexOf('ui:width'));
    expect(k.indexOf('ui:width')).toBeLessThan(k.indexOf('ui:marginBottom'));
    expect(k.indexOf('ui:marginBottom')).toBeLessThan(k.indexOf('ui:invisible'));
    expect(k[k.length - 1]).toBe('ui:invisible');
  });
});

describe('customEntries', () => {
  it('returns only unknown ui: keys, in order', () => {
    expect(customEntries({ 'ui:widget': 'TextBox', 'ui:formattedText': 'x', 'ui:foo': 1, 'ui:bar': 'b', other: 2 })).toEqual([['ui:foo', 1], ['ui:bar', 'b']]);
  });
  it('treats every key in the demo uiSchema as known', () => {
    for (const [name, entry] of Object.entries(demo.namespaceFormSchemaMap.main.uiSchema)) {
      expect(customEntries(entry as Record<string, unknown>), name).toEqual([]);
    }
  });
});

describe('keys seen in real exports', () => {
  const real: Record<string, string[]> = {
    TextBox: ['ui:placeholder', 'ui:disable'],
    Integer: ['ui:placeholder'],
    Country: ['ui:placeholder'],
    State: ['ui:placeholder', 'ui:subdivisionOf'],
    CustomFormat: ['ui:placeholder', 'ui:customFormat', 'ui:validationError'],
    Radio: ['ui:clearable', 'ui:disable'],
    Paragraph: ['ui:wellType'],
    Header: ['ui:headerType'],
    Signature: ['ui:signatureSigner', 'ui:signatureType'],
    FileGroup: ['ui:supportingFileGroup'],
    File: ['ui:signingGuideline'],
    Pdf: ['ui:embeddedPdf', 'ui:pdfCutInfo', 'ui:height', 'ui:viewInModal'],
    Group: ['ui:dynamicLayout', 'ui:tooltipForDisabledState'],
    Page: ['ui:tooltipForDisabledState'],
  };
  it.each(Object.entries(real))('%s gets its keys as structured rows', (id, expected) => {
    expect(keys(id)).toEqual(expect.arrayContaining(expected));
  });
  it('treats all of those keys as known (not custom)', () => {
    const all = Object.fromEntries(Object.values(real).flat().map((k) => [k, 1]));
    expect(customEntries(all)).toEqual([]);
  });
  it('does not offer a widget-specific key on other widgets', () => {
    expect(keys('TextBox')).not.toContain('ui:wellType');
    expect(keys('Paragraph')).not.toContain('ui:clearable');
    expect(keys('Radio')).not.toContain('ui:customFormat');
  });
});
