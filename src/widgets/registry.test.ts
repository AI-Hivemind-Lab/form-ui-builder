import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { WIDGET_CATALOG } from '../model/widgetCatalog';
import { Unknown } from './Misc';
import { resolveWidget } from './registry';

describe('registry (Review Focus 1)', () => {
  it('resolves every catalog widget to a real component', () => {
    for (const w of WIDGET_CATALOG) expect(resolveWidget(w.id).Component, w.id).not.toBe(Unknown);
  });
  it('resolves every widget used by the demo form', () => {
    const used = new Set(Object.values(demo.namespaceFormSchemaMap.main.uiSchema).map((u) => (u as Record<string, string>)['ui:widget']));
    expect(used.size).toBe(12);
    for (const w of used) expect(resolveWidget(w).Component).not.toBe(Unknown);
  });
  it('falls back to Unknown (with a label) for unrecognised widgets, including prototype-chain names', () => {
    for (const id of ['Bogus', 'constructor', 'toString', '__proto__']) {
      const def = resolveWidget(id);
      expect(def.Component, id).toBe(Unknown);
      expect(def.hasLabel).toBe(true);
    }
  });
  it('has labels exactly where the design says', () => {
    for (const id of ['Page', 'Group', 'Header', 'Paragraph', 'AnchorLink', 'File', 'Signature']) expect(resolveWidget(id).hasLabel, id).toBe(false);
    for (const id of ['Radio', 'Repeatable', 'Pdf', 'FileGroup', 'Email', 'MultipleSuggest']) expect(resolveWidget(id).hasLabel, id).toBe(true);
  });
});

import { dynamicGrid } from './Containers';
describe('dynamic layout', () => {
  it('lays children out in columns from sectionsWidth and gutter, and ignores a single section', () => {
    expect(dynamicGrid({ sectionsWidth: [50, 50], gutter: 12 })).toMatchObject({ display: 'grid', gridTemplateColumns: 'minmax(0, 50fr) minmax(0, 50fr)', columnGap: 12 });
    expect(dynamicGrid({ sectionsWidth: [70, 30] })).toMatchObject({ gridTemplateColumns: 'minmax(0, 70fr) minmax(0, 30fr)', columnGap: 8 });
    expect(dynamicGrid({ sectionsWidth: [100], gutter: 0 })).toBeUndefined();
    expect(dynamicGrid(undefined)).toBeUndefined();
  });
});
