import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { loadForm } from './loadForm';
import type { FormDoc } from './types';
import {
  findNode, getAllPages, getLabelHtml, getPages, getWidget, tocTree, isInputWidget, isInvisible, isRequired, isSelectable,
} from './schemaWalk';

const doc = loadForm(demo);

describe('defaults for missing config (Review Focus 1)', () => {
  const bare: FormDoc = {
    schema: {
      type: 'object',
      properties: [
        { name: 'a', type: 'string', title: 'A <b>' },
        { name: 'g', type: 'object', title: 'G', properties: [] },
        { name: 'n', type: 'null', title: 'N' },
      ],
    },
    uiSchema: {},
  };
  it('defaults widget by node type', () => {
    expect(getWidget(bare, bare.schema.properties[0])).toBe('TextBox');
    expect(getWidget(bare, bare.schema.properties[1])).toBe('Group');
    expect(getWidget(bare, bare.schema.properties[2])).toBe('Paragraph');
  });
  it('uses the escaped title as label when ui:formattedText is missing', () => {
    expect(getLabelHtml(bare, bare.schema.properties[0])).toBe('<p>A &lt;b&gt;</p>');
  });
  it('treats a missing entry as optional and visible', () => {
    expect(isRequired(bare, 'a')).toBe(false);
    expect(isInvisible(bare, 'a')).toBe(false);
  });
  it('defaults arrays by whether they have children', () => {
    expect(getWidget(bare, { name: 'r', type: 'array', title: 'R', properties: [] })).toBe('Repeatable');
    expect(getWidget(bare, { name: 'm', type: 'array', title: 'M' })).toBe('MultipleCheckbox');
  });
  it('has no pages', () => {
    expect(getPages(bare)).toEqual([]);
  });
});

describe('demo doc', () => {
  it('finds the single Page', () => {
    expect(getPages(doc).map((n) => n.name)).toEqual(['demoform']);
  });
  it('classifies widgets', () => {
    expect(isInputWidget('Radio')).toBe(true);
    expect(isInputWidget('Paragraph')).toBe(false);
    expect(isSelectable('Paragraph')).toBe(true);
    expect(isSelectable('Header')).toBe(true);
    expect(isSelectable('Group')).toBe(false);
    expect(isSelectable('Repeatable')).toBe(true);
    expect(isSelectable('Page')).toBe(false);
    expect(isInputWidget('Email')).toBe(true);
    expect(isInputWidget('Signature')).toBe(false);
    expect(isInputWidget('Bogus')).toBe(true);
  });
  it('findNode searches nested nodes', () => {
    expect(findNode(doc.schema.properties, 'textbox8')?.title).toBe('Textbox 8');
    expect(findNode(doc.schema.properties, 'nope')).toBeUndefined();
  });
});

describe('hidden pages (Review: invisible pages)', () => {
  const twoPages: FormDoc = {
    schema: {
      type: 'object',
      properties: [
        { name: 'p1', type: 'object', title: 'Hidden', properties: [] },
        { name: 'p2', type: 'object', title: 'Shown', properties: [] },
      ],
    },
    uiSchema: { p1: { 'ui:widget': 'Page', 'ui:invisible': true }, p2: { 'ui:widget': 'Page' } },
  };
  it('lists invisible pages only when asked', () => {
    expect(getPages(twoPages, false).map((n) => n.name)).toEqual(['p2']);
    expect(getPages(twoPages, true).map((n) => n.name)).toEqual(['p1', 'p2']);
    expect(getPages(twoPages).map((n) => n.name)).toEqual(['p1', 'p2']);
  });
});

describe('nested pages and the TOC tree (real exports put Pages inside section Groups)', () => {
  const leaf = (name: string) => ({ name, type: 'string' as const, title: name });
  const group = (name: string, children: FormDoc['schema']['properties']) => ({ name, type: 'object' as const, title: `T ${name}`, properties: children });
  const sectioned: FormDoc = {
    schema: {
      type: 'object',
      properties: [
        group('hidden', [leaf('h1')]),
        group('intro', [leaf('i1')]),
        group('sec', [group('pageA', [leaf('a1')]), group('pageB', [leaf('b1')]), group('subsec', [group('pageC', [leaf('c1')])])]),
        group('plain', [leaf('p1')]),
        group('aml', [leaf('m1')]),
        group('hiddenSec', [group('pageD', [leaf('d1')])]),
      ],
    },
    uiSchema: {
      hidden: { 'ui:widget': 'Page', 'ui:invisible': true },
      intro: { 'ui:widget': 'Page' },
      sec: { 'ui:widget': 'Group' },
      pageA: { 'ui:widget': 'Page' },
      pageB: { 'ui:widget': 'Page', 'ui:invisible': true },
      subsec: { 'ui:widget': 'Group' },
      pageC: { 'ui:widget': 'Page' },
      plain: { 'ui:widget': 'Group' },
      aml: { 'ui:widget': 'Page' },
      hiddenSec: { 'ui:widget': 'Group', 'ui:invisible': true },
      pageD: { 'ui:widget': 'Page' },
    },
  };
  const shape = (entries: ReturnType<typeof tocTree>): unknown[] =>
    entries.map((e) => (e.kind === 'page' ? e.name : { [e.name]: shape(e.children) }));

  it('builds a tree: Groups containing Pages become sections, Pages are leaves, page-less Groups are omitted', () => {
    expect(shape(tocTree(sectioned, false))).toEqual(['intro', { sec: ['pageA', { subsec: ['pageC'] }] }, 'aml']);
  });
  it('includes invisible pages and sections only when asked', () => {
    expect(shape(tocTree(sectioned, true))).toEqual([
      'hidden', 'intro', { sec: ['pageA', 'pageB', { subsec: ['pageC'] }] }, 'aml', { hiddenSec: ['pageD'] },
    ]);
  });
  it('uses node titles', () => {
    const t = tocTree(sectioned, false);
    expect(t[0].title).toBe('T intro');
    expect(t[1].title).toBe('T sec');
  });
  it('getAllPages lists every reachable Page depth-first, in order', () => {
    expect(getAllPages(sectioned, false).map((p) => p.name)).toEqual(['intro', 'pageA', 'pageC', 'aml']);
    expect(getAllPages(sectioned, true).map((p) => p.name)).toEqual(['hidden', 'intro', 'pageA', 'pageB', 'pageC', 'aml', 'pageD']);
  });
  it('returns [] for a doc with no pages', () => {
    const none: FormDoc = { schema: { type: 'object', properties: [leaf('x')] }, uiSchema: {} };
    expect(tocTree(none, true)).toEqual([]);
    expect(getAllPages(none, true)).toEqual([]);
  });
});
