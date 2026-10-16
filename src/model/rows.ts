import type { FormDoc, Values } from './types';

export type Row = Record<string, unknown>;

export const DEFAULT_MAX_ITEMS = 1;

/** `ui:maxLength` as an integer >= 1 (numeric strings accepted); anything else falls back to the default. */
export function maxItemsOf(doc: FormDoc, name: string): number {
  const raw = doc.uiSchema[name]?.['ui:maxLength'];
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : DEFAULT_MAX_ITEMS;
}

/** The rows to render: stored rows, or one empty row when unset. Never empty. */
export function getRows(values: Values, rep: string): Row[] {
  const v = values[rep];
  if (!Array.isArray(v) || v.length === 0) return [{}];
  return v.map((r) => (r !== null && typeof r === 'object' && !Array.isArray(r) ? (r as Row) : {}));
}

export function addRow(values: Values, rep: string, max: number): Values {
  const rows = getRows(values, rep);
  if (rows.length >= max) return values;
  return { ...values, [rep]: [...rows, {}] };
}

export function removeRow(values: Values, rep: string, index: number): Values {
  const rows = getRows(values, rep);
  if (rows.length <= 1 || index < 0 || index >= rows.length) return values;
  return { ...values, [rep]: rows.filter((_, i) => i !== index) };
}

export function setRowValue(values: Values, rep: string, index: number, field: string, value: unknown): Values {
  const rows = getRows(values, rep);
  if (index < 0 || index >= rows.length) return values;
  return { ...values, [rep]: rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)) };
}
