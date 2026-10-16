import { describe, expect, it } from 'vitest';
import type { FormDoc } from './types';
import { canMoveTo, dropTarget, nodeLabel, moveNode, positionOf, removeNode } from './tree';

const mk = (): FormDoc => ({
  schema: { type: 'object', properties: [
    { name: 'p1', type: 'object', title: 'P1', properties: [
      { name: 'a', type: 'string', title: 'A' },
      { name: 'r', type: 'string', title: 'R', enum: ['x', 'y'] },
      { name: 'under', type: 'string', title: 'Under' },
      { name: 'g', type: 'object', title: 'G', properties: [{ name: 'c', type: 'string', title: 'C' }] },
      { name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'rc', type: 'string', title: 'RC' }] },
    ] },
    { name: 'p2', type: 'object', title: 'P2', properties: [] },
  ] },
  uiSchema: {
    p1: { 'ui:widget': 'Page' }, p2: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' },
    r: { 'ui:widget': 'Radio', 'ui:multipleOption': { options: [['x', { formattedText: 'X', fieldsBelow: ['under'] }], ['y', { formattedText: 'Y' }]] } },
    under: { 'ui:widget': 'TextBox' }, g: { 'ui:widget': 'Group' }, c: { 'ui:widget': 'TextBox' },
    rep: { 'ui:widget': 'Repeatable' }, rc: { 'ui:widget': 'TextBox' },
  },
});
const names = (d: FormDoc, parent: string) => d.schema.properties.find((n) => n.name === parent)?.properties?.map((n) => n.name);

describe('removeNode', () => {
  it('removes a field and its ui entry', () => {
    const d = removeNode(mk(), 'a');
    expect(names(d, 'p1')).not.toContain('a');
    expect('a' in d.uiSchema).toBe(false);
  });
  it('removes a container with its whole subtree', () => {
    const d = removeNode(mk(), 'g');
    expect('g' in d.uiSchema || 'c' in d.uiSchema).toBe(false);
  });
  it('un-tags a deleted field from its parent option', () => {
    const d = removeNode(mk(), 'under');
    const opts = (d.uiSchema.r['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(opts[0][1].fieldsBelow).toBeUndefined();
    expect(opts[0][1]).toEqual({ formattedText: 'X' });
  });
  it('returns the same doc for an unknown name', () => {
    const d = mk();
    expect(removeNode(d, 'nope')).toBe(d);
  });
});

describe('moveNode', () => {
  it('reorders within a parent (index counted after lifting out)', () => {
    const d = moveNode(mk(), 'a', 'p1', 2);
    expect(names(d, 'p1')).toEqual(['r', 'under', 'a', 'g', 'rep']);
  });
  it('moves into another container', () => {
    const d = moveNode(mk(), 'a', 'g', 0);
    expect(names(d, 'p1')).not.toContain('a');
    expect(positionOf(d, 'a')).toEqual({ parent: 'g', index: 0 });
  });
  it('moves a page among top-level pages', () => {
    const d = moveNode(mk(), 'p2', null, 0);
    expect(d.schema.properties.map((n) => n.name)).toEqual(['p2', 'p1']);
  });
  it('untags a moved field from its option', () => {
    const d = moveNode(mk(), 'under', 'p2', 0);
    const opts = (d.uiSchema.r['ui:multipleOption'] as { options: [string, { fieldsBelow?: string[] }][] }).options;
    expect(opts[0][1].fieldsBelow).toBeUndefined();
  });
  it('refuses to move a container into itself or its descendants', () => {
    expect(canMoveTo(mk(), 'g', 'g')).toBe(false);
    expect(() => moveNode(mk(), 'g', 'g', 0)).toThrow();
  });
  it('refuses a field at top level when pages exist, and a field into a leaf', () => {
    expect(canMoveTo(mk(), 'a', null)).toBe(false);
    expect(canMoveTo(mk(), 'a', 'under')).toBe(false);
  });
  it('refuses Repeatable inside Repeatable (also via a container holding one)', () => {
    const d = mk();
    expect(canMoveTo(d, 'rep', 'rep')).toBe(false);
  });
  it('refuses a page inside a page', () => {
    expect(canMoveTo(mk(), 'p2', 'p1')).toBe(false);
  });
});

describe('dropTarget', () => {
  it('drops before / after a sibling, adjusting for the lifted node', () => {
    const d = mk();
    expect(dropTarget(d, 'a', 'under', 'before')).toEqual({ parent: 'p1', index: 1 });
    expect(dropTarget(d, 'a', 'under', 'after')).toEqual({ parent: 'p1', index: 2 });
    expect(dropTarget(d, 'under', 'a', 'before')).toEqual({ parent: 'p1', index: 0 });
  });
  it('is null when nothing would change or the drop is illegal', () => {
    const d = mk();
    expect(dropTarget(d, 'a', 'r', 'before')).toBeNull();
    expect(dropTarget(d, 'r', 'a', 'after')).toBeNull();
    expect(dropTarget(d, 'a', 'a', 'into')).toBeNull();
    expect(dropTarget(d, 'g', 'c', 'after')).toBeNull();
    expect(dropTarget(d, 'a', 'under', 'into')).toBeNull();
  });
  it('drops into a container at its end', () => {
    expect(dropTarget(mk(), 'a', 'g', 'into')).toEqual({ parent: 'g', index: 1 });
  });
  it('moves a node out to a different parent', () => {
    expect(dropTarget(mk(), 'c', 'a', 'after')).toEqual({ parent: 'p1', index: 1 });
  });
});

describe('nodeLabel', () => {
  it('uses the right text per widget and falls back to the title', () => {
    const d = mk();
    d.uiSchema.a = { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Full  name <span>*</span></p>' };
    d.uiSchema.c = { 'ui:widget': 'Header', 'ui:heading': 'Big title' };
    const find = (n: string) => d.schema.properties[0].properties!.flatMap((x) => [x, ...(x.properties ?? [])]).find((x) => x.name === n)!;
    expect(nodeLabel(d, find('a'))).toBe('Full name');
    expect(nodeLabel(d, find('c'))).toBe('Big title');
    expect(nodeLabel(d, find('g'))).toBe('G');
  });
});
