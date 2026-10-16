import { exportJsonText } from './exportForm';
import { parseFormJson } from './loadForm';
import type { FormDoc } from './types';

/** The form being edited survives refreshes and is shared with tabs opened from the landing page. */
export const STORAGE_KEY = 'formbuilder:current-form';

/**
 * Several tabs share this storage. Each time a form is loaded it gets a new id; a tab only writes while the id in
 * storage is still the one it opened. Otherwise an older tab (still showing the previous form) would overwrite the
 * form you just loaded when it saves, refreshes or is closed.
 */
export const FORM_ID_KEY = 'formbuilder:form-id';
let myId: string | null = null;

const newId = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const storedId = (): string | null => {
  try {
    return localStorage.getItem(FORM_ID_KEY);
  } catch {
    return null;
  }
};

/** This tab loaded a new form: it becomes the owner, and every other open tab is now out of date. */
export function claimForm(): void {
  myId = newId();
  try {
    localStorage.setItem(FORM_ID_KEY, myId);
  } catch {
    /* storage blocked */
  }
}

/** An editor tab opened: it owns whatever form is stored now (older storage without an id gets one). */
export function adoptForm(): void {
  const id = storedId();
  if (id) myId = id;
  else claimForm();
}

/** True while this tab still owns the stored form. */
export const ownsForm = (): boolean => myId !== null && storedId() === myId;

export function saveDoc(doc: FormDoc): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, exportJsonText(doc));
    return true;
  } catch {
    return false; // storage full or blocked
  }
}

/** Save only if this tab still owns the stored form; 'superseded' means another tab loaded a newer one. */
export function saveDocIfOwner(doc: FormDoc): 'saved' | 'superseded' | 'failed' {
  if (!ownsForm()) return 'superseded';
  return saveDoc(doc) ? 'saved' : 'failed';
}

export function loadSavedDoc(): FormDoc | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? parseFormJson(text) : null;
  } catch {
    return null;
  }
}

const IGNORED_KEY = 'formbuilder:ignored-warnings';

export function loadIgnored(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveIgnored(keys: string[], onlyIfOwner = false): void {
  if (onlyIfOwner && !ownsForm()) return;
  try {
    localStorage.setItem(IGNORED_KEY, JSON.stringify(keys));
  } catch {
    /* not critical */
  }
}

const PROPOSALS_KEY = 'formbuilder:ai-proposals';

/** The AI's proposals for the open form (see generator/ai/proposals). Stored with the form, so a refresh keeps them. */
export function saveProposalSet(set: unknown, onlyIfOwner = false): void {
  if (onlyIfOwner && !ownsForm()) return;
  try {
    localStorage.setItem(PROPOSALS_KEY, JSON.stringify(set));
  } catch {
    /* not critical: the proposals are lost on refresh */
  }
}

export function loadProposalSet<T>(): T | null {
  try {
    const text = localStorage.getItem(PROPOSALS_KEY);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export function clearProposalSet(): void {
  try {
    localStorage.removeItem(PROPOSALS_KEY);
  } catch {
    /* not critical */
  }
}
