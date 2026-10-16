import { describe, expect, it } from 'vitest';
import { loadForm } from './loadForm';
import { searchWidgets } from './search';

const opt = (v: string, label: string) => [v, { formattedText: `<p>${label}</p>`, blueprintMetadataMapping: '' }];
const doc = loadForm({
  namespaceFormSchemaMap: { main: {
    schema: { type: 'object', properties: [
      { name: 'pg1', type: 'object', title: 'General Information', properties: [
        { name: 'hdr', type: 'null', title: 'H' },
        { name: 'investor_type', type: 'object', title: 'Investor type', properties: [{ name: 'investor_type_individual', type: 'string', title: 'Individual', enum: ['ind', 'jt'] }] },
        { name: 'asa_fullname_investorname_generalinfo', type: 'string', title: 'n' },
      ] },
      { name: 'pg2', type: 'object', title: 'Tax', properties: [{ name: 'tin', type: 'string', title: 'Taxpayer ID' }] },
    ] },
    uiSchema: {
      pg1: { 'ui:widget': 'Page' }, hdr: { 'ui:widget': 'Header', 'ui:heading': 'General Information' },
      investor_type: { 'ui:widget': 'Group', 'ui:formattedText': '<p><strong>Please indicate if you are a:</strong></p>' },
      investor_type_individual: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Individual</p>', 'ui:multipleOption': { options: [opt('ind', 'Individual'), opt('jt', 'Joint Tenants')] } },
      asa_fullname_investorname_generalinfo: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>1. Name of Subscriber:</p>', 'ui:pdfMapping': ['subscribername_pdf'] },
      pg2: { 'ui:widget': 'Page' }, tin: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Taxpayer ID</p>' },
    },
  } },
});

describe('searchWidgets', () => {
  it('finds a widget by part of its alias, in form order, with its page', () => {
    const hits = searchWidgets(doc, 'investor_type');
    expect(hits.map((h) => h.name)).toEqual(['investor_type', 'investor_type_individual']);
    expect(hits[0]).toMatchObject({ page: 'pg1', widget: 'Group', matchedIn: ['alias'] });
  });
  it('finds a widget by its formatted text, ignoring case, tags and spacing, and by option text', () => {
    expect(searchWidgets(doc, 'PLEASE   indicate').map((h) => h.name)).toEqual(['investor_type']);
    expect(searchWidgets(doc, 'joint tenants').map((h) => h.name)).toEqual(['investor_type_individual']);
  });
  it('needs every word of the query, and can be limited to aliases or to text', () => {
    expect(searchWidgets(doc, 'name subscriber').map((h) => h.name)).toEqual(['asa_fullname_investorname_generalinfo']);
    expect(searchWidgets(doc, 'name zzz')).toEqual([]);
    expect(searchWidgets(doc, 'fullname', 'text')).toEqual([]);
    expect(searchWidgets(doc, 'name of', 'alias')).toEqual([]);
  });
  it('also finds the PDF field a widget is mapped to, and says where it matched', () => {
    expect(searchWidgets(doc, 'subscribername_pdf')[0]).toMatchObject({ name: 'asa_fullname_investorname_generalinfo', matchedIn: ['pdf'] });
  });
  it('returns nothing for an empty query', () => {
    expect(searchWidgets(doc, '   ')).toEqual([]);
  });
});
