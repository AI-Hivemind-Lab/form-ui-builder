import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadForm } from './loadForm';
import { loadSavedDoc, saveDoc, STORAGE_KEY } from './persist';

const doc = loadForm({
  namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [{ name: 'p', type: 'object', title: 'P', properties: [] }] }, uiSchema: { p: { 'ui:widget': 'Page' } } } },
  rules: [{ id: 1 }],
});

describe('persist', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      clear: () => store.clear(),
    });
  });
  it('returns null when nothing was saved or the data is broken', () => {
    expect(loadSavedDoc()).toBeNull();
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadSavedDoc()).toBeNull();
  });
  it('round-trips a form, keeping the other top-level keys', () => {
    expect(saveDoc(doc)).toBe(true);
    const back = loadSavedDoc()!;
    expect(back.schema.properties.map((n) => n.name)).toEqual(['p']);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).rules).toEqual([{ id: 1 }]);
  });
});

describe('tabs sharing one stored form', () => {
  const loadFresh = async () => {
    vi.resetModules();
    return import('./persist');
  };
  it('lets only the tab that owns the stored form save', async () => {
    const tabA = await loadFresh();
    tabA.claimForm();
    expect(tabA.saveDocIfOwner(doc)).toBe('saved');
    // another tab loads a new form: same storage, its own module state
    const stored = localStorage.getItem('formbuilder:form-id');
    const tabB = await loadFresh();
    tabB.claimForm();
    expect(localStorage.getItem('formbuilder:form-id')).not.toBe(stored);
    expect(tabB.saveDocIfOwner(doc)).toBe('saved');
    const before = localStorage.getItem('formbuilder:current-form');
    // tab A is out of date and must not overwrite tab B's form
    const edited = { ...doc, schema: { ...doc.schema, properties: [] } };
    expect(tabA.saveDocIfOwner(edited)).toBe('superseded');
    expect(localStorage.getItem('formbuilder:current-form')).toBe(before);
  });
  it('a tab that opens later adopts the current form and may save', async () => {
    const first = await loadFresh();
    first.claimForm();
    const later = await loadFresh();
    later.adoptForm();
    expect(later.ownsForm()).toBe(true);
    expect(later.saveDocIfOwner(doc)).toBe('saved');
  });
  it('gives older storage without an id one when adopted', async () => {
    const p = await loadFresh();
    p.adoptForm();
    expect(p.ownsForm()).toBe(true);
  });
});
