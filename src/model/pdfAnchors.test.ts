import { describe, expect, it } from 'vitest';
import { boxOf, boxOfName, primaryBox } from './pdfAnchors';
import { loadForm } from './loadForm';
import type { Anchors } from './pdfStore';

type Ui = Record<string, Record<string, unknown>>;
const raw = (nodes: unknown[], ui: Ui) => loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: ui } } });
const at = (page: number, top: number) => ({ page, left: 0.1, top, right: 0.5, bottom: top + 0.02 });

describe('where a field sits on the PDF', () => {
  const doc = raw(
    [{ name: 'pg', type: 'object', title: 'P', properties: [
      { name: 'yn', type: 'string', title: 'yn' }, { name: 'name', type: 'string', title: 'name' }, { name: 'sig', type: 'null', title: 'Signature' },
    ] }],
    {
      pg: { 'ui:widget': 'Page' },
      yn: { 'ui:widget': 'Radio', 'ui:pdfMapping': ['yn'], 'ui:multipleOption': { options: [['yes', { pdfMappings: ['yes_yn'] }], ['no', { pdfMappings: ['no_yn'] }]] } },
      name: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['name_main', 'name_on_signature_page'] },
      sig: { 'ui:widget': 'Signature', 'ui:signature': [{ mapping: 'sig_line', signatureType: 'Signature' }, { mapping: 'sig_name', signatureType: 'Name' }] },
    },
  );
  const anchors: Anchors = { yes_yn: at(4, 0.3), no_yn: at(4, 0.3), name_main: at(30, 0.3), name_on_signature_page: at(28, 0.4), sig_line: at(10, 0.6), sig_name: at(10, 0.5) };
  const node = (n: string) => doc.schema.properties[0].properties?.find((x) => x.name === n) as NonNullable<typeof doc.schema.properties[0]['properties']>[number];

  it('a choice has no box of its own: its place is its options\'', () => {
    expect(boxOf(doc, node('yn'), anchors)).toMatchObject({ page: 4 });
    expect(primaryBox(doc, node('yn'), anchors)).toMatchObject({ page: 4 });
    expect(boxOfName(doc, 'yn', anchors)).toMatchObject({ page: 4 });
  });
  it('a field merged from several places: the earliest for where it starts, the main one for its question', () => {
    expect(boxOf(doc, node('name'), anchors)).toMatchObject({ page: 28 });
    expect(primaryBox(doc, node('name'), anchors)).toMatchObject({ page: 30 });
  });
  it('a signature: its own line is the primary box, the name field that joined it is earlier on the page', () => {
    expect(primaryBox(doc, node('sig'), anchors)).toMatchObject({ page: 10, top: 0.6 });
    expect(boxOf(doc, node('sig'), anchors)).toMatchObject({ page: 10, top: 0.5 });
  });
  it('says nothing for a field with no box', () => {
    expect(boxOf(doc, node('yn'), {})).toBeNull();
    expect(primaryBox(doc, node('name'), {})).toBeNull();
  });
});
