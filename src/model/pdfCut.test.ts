import { describe, expect, it } from 'vitest';
import { cutOf, cutProblem, sourceFileName, withCut } from './pdfCut';

describe('pdf cut info', () => {
  it('reads the pages, and keeps the file id the platform set when the range changes', () => {
    expect(cutOf({ 'ui:pdfCutInfo': { start: 2, end: 7, fileId: '', reviewingFileId: null } })).toEqual({ start: 2, end: 7 });
    expect(cutOf({})).toBeNull();
    expect(cutOf({ 'ui:pdfCutInfo': { start: 'a', end: 7 } })).toBeNull();
    expect(withCut({ 'ui:pdfCutInfo': { start: 2, end: 7, fileId: 'abc', reviewingFileId: null } }, { start: 3, end: 9 })).toEqual({ start: 3, end: 9, fileId: 'abc', reviewingFileId: null });
    expect(withCut({}, { start: 1, end: 1 })).toEqual({ start: 1, end: 1, fileId: '', reviewingFileId: null });
  });
  it('says why a range does not work', () => {
    expect(cutProblem({ start: 2, end: 7 }, 76)).toBeNull();
    expect(cutProblem({ start: 2, end: 7 }, null)).toBeNull();
    expect(cutProblem({ start: 0, end: 7 }, 76)).toMatch(/start at 1/);
    expect(cutProblem({ start: 8, end: 7 }, 76)).toMatch(/before/);
    expect(cutProblem({ start: 70, end: 80 }, 76)).toBe('The PDF has only 76 pages');
  });
  it('finds the source file name in the form', () => {
    expect(sourceFileName({ schema: { type: 'object', properties: [] }, uiSchema: { f: { 'ui:widget': 'File', 'ui:fileName': 'Sub-doc.pdf' } } })).toBe('Sub-doc.pdf');
  });
});

import { loadForm } from './loadForm';
describe('keys of an earlier version of this app', () => {
  it('are read as the ones Form Builder really uses: max rows, item name; the unknown page key is dropped', () => {
    const doc = loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [] }, uiSchema: {
      rep: { 'ui:widget': 'Repeatable', 'ui:maxItems': 3, 'ui:itemName': 'contact' },
      hidden: { 'ui:widget': 'Page', 'ui:invisible': true, 'ui:invisibleOnTocWhenHidden': true },
      fine: { 'ui:widget': 'Repeatable', 'ui:maxLength': 2 },
    } } } });
    expect(doc.uiSchema.rep).toEqual({ 'ui:widget': 'Repeatable', 'ui:maxLength': 3, 'ui:repeatableText': 'contact' });
    expect(doc.uiSchema.hidden).toEqual({ 'ui:widget': 'Page', 'ui:invisible': true });
    expect(doc.uiSchema.fine).toEqual({ 'ui:widget': 'Repeatable', 'ui:maxLength': 2 });
  });
});
