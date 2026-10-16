import type { UiEntry } from './types';

export const REQUIRED_MESSAGE = 'This field is required';

/** `ui:required` is a message string; any non-empty string (or `true`) means required. */
export function entryRequired(e: UiEntry | undefined): boolean {
  const r = e?.['ui:required'];
  return r === true || (typeof r === 'string' && r !== '');
}

export function entryInvisible(e: UiEntry | undefined): boolean {
  return e?.['ui:invisible'] === true;
}
