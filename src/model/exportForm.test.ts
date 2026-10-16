import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { buildNewField, insertNode } from './addField';
import { buildExport, EXPORT_FILE_NAME, exportJsonText } from './exportForm';
import { loadForm } from './loadForm';
import type { FormDoc } from './types';

describe('export round trip', () => {
  it('re-loads to an identical form', () => {
    const doc = loadForm(demo);
    const back = loadForm(JSON.parse(exportJsonText(doc)));
    expect(back.schema).toEqual(doc.schema);
    expect(back.uiSchema).toEqual(doc.uiSchema);
  });
  it('carries rules, libs and other top-level keys through untouched', () => {
    const out = buildExport(loadForm(demo)) as Record<string, unknown>;
    const src = demo as unknown as Record<string, unknown>;
    expect(out.rules).toEqual(src.rules);
    expect(out.libs).toEqual(src.libs);
    expect(out.defaultNamespace).toBe(src.defaultNamespace);
  });
  it('includes added fields and edited metadata', () => {
    const doc0 = loadForm(demo);
    const { node, ui } = buildNewField(doc0, 'Email');
    const doc = insertNode(doc0, node, { ...ui, 'ui:custom': 5 }, { parent: 'demoform', after: 'partnership' });
    const back = loadForm(JSON.parse(exportJsonText(doc)));
    const names = back.schema.properties[1].properties!.map((n) => n.name);
    expect(names.indexOf('email1')).toBe(names.indexOf('partnership') + 1);
    expect(back.uiSchema.email1['ui:custom']).toBe(5);
  });
  it('does not mutate the source or the doc', () => {
    const doc = loadForm(demo);
    const before = JSON.stringify(demo);
    buildExport(doc);
    expect(JSON.stringify(demo)).toBe(before);
  });
  it('emits a minimal valid export when the doc has no source', () => {
    const doc: FormDoc = { schema: { type: 'object', properties: [{ name: 'a', type: 'string', title: 'A' }] }, uiSchema: { a: { 'ui:widget': 'TextBox' } } };
    const out = buildExport(doc) as { defaultNamespace: string; namespaceFormSchemaMap: Record<string, unknown> };
    expect(out.defaultNamespace).toBe('main');
    expect(Object.keys(out.namespaceFormSchemaMap)).toEqual(['main']);
    expect(loadForm(JSON.parse(exportJsonText(doc))).schema.properties[0].name).toBe('a');
  });
  it('respects the doc namespace', () => {
    const doc = loadForm({ namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } });
    const out = buildExport(doc) as { namespaceFormSchemaMap: Record<string, unknown> };
    expect(Object.keys(out.namespaceFormSchemaMap)).toEqual(['alt']);
  });
  it('uses a stable file name', () => {
    expect(EXPORT_FILE_NAME).toBe('form-content-edited.json');
  });
});
