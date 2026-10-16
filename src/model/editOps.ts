import { escapeHtml, stripHtml } from './html';
import type { Option, SchemaNode, UiEntry, UiSchema } from './types';
import { entryRequired, REQUIRED_MESSAGE } from './uiEntry';

const STAR = ' <span style="color: rgb(219, 55, 55);">*</span>';

function patch(ui: UiSchema, name: string, fn: (e: UiEntry) => UiEntry): UiSchema {
  return { ...ui, [name]: fn({ ...(ui[name] ?? {}) }) };
}

/** Label text without the trailing required star. Whitespace is preserved on purpose. */
export function labelText(entry: UiEntry | undefined, fallback: string): string {
  const f = entry?.['ui:formattedText'];
  return typeof f === 'string' ? stripHtml(f).replace(/ \*$/, '') : fallback;
}

const STAR_RE = /\s*<span[^>]*>\s*\*\s*<\/span>/;

/** Add or remove only the required-star span, leaving any other markup intact. */
function withStar(html: string, required: boolean): string {
  const stripped = html.replace(STAR_RE, '');
  if (!required) return stripped;
  return /<\/p>\s*$/.test(stripped) ? stripped.replace(/<\/p>\s*$/, `${STAR}</p>`) : stripped + STAR;
}

export function buildLabelHtml(text: string, required: boolean): string {
  return `<p>${escapeHtml(text)}${required ? STAR : ''}</p>`;
}

/** Rebuilds the label only when the text actually changed, so untouched rich markup survives. */
export function setLabel(ui: UiSchema, name: string, text: string): UiSchema {
  return patch(ui, name, (e) => {
    if (typeof e['ui:formattedText'] === 'string' && labelText(e, '') === text) return e;
    return {
      ...e,
      'ui:formattedText': e['ui:widget'] === 'Paragraph' ? escapeHtml(text) : buildLabelHtml(text, entryRequired(e)),
    };
  });
}

/** Toggles `ui:required` and the label's star span; other label markup is preserved. */
export function setRequired(ui: UiSchema, name: string, required: boolean): UiSchema {
  return patch(ui, name, (e) => {
    const next: UiEntry = { ...e };
    if (required) next['ui:required'] = REQUIRED_MESSAGE;
    else delete next['ui:required'];
    if (typeof next['ui:formattedText'] === 'string' && next['ui:widget'] !== 'Paragraph') {
      next['ui:formattedText'] = withStar(next['ui:formattedText'], required);
    }
    return next;
  });
}

export function setInvisible(ui: UiSchema, name: string, invisible: boolean): UiSchema {
  return patch(ui, name, (e) => {
    const next: UiEntry = { ...e };
    if (invisible) next['ui:invisible'] = true;
    else delete next['ui:invisible'];
    return next;
  });
}

/** The authoritative option order: a node's `enum`, or `items.enum` for array nodes (MultipleCheckbox etc). */
function enumOf(node: SchemaNode): string[] | undefined {
  if (node.enum && node.enum.length > 0) return node.enum;
  return node.items?.enum && node.items.enum.length > 0 ? node.items.enum : undefined;
}

/**
 * The options list in an export can be in an arbitrary order (it looks like a serialized map), so the
 * enum decides the order. Stable sort; options not in the enum go last in their original order.
 */
function orderByEnum(options: Option[], en: string[] | undefined): Option[] {
  if (!en) return options;
  const rank = (v: string) => {
    const i = en.indexOf(v);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return options.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o.value) - rank(b.o.value) || a.i - b.i).map((x) => x.o);
}

/** Plain text of an option's rich label; footnote placeholders are dropped. */
const optionLabel = (html: string): string => stripHtml(html).replace(/FOOT_NOTE_HERE/g, '');

export function getOptions(entry: UiEntry | undefined, node: SchemaNode): Option[] {
  const mo = entry?.['ui:multipleOption'] as { options?: unknown } | undefined;
  const raw = mo?.options;
  if (Array.isArray(raw)) {
    const options = raw.flatMap((item): Option[] => {
      if (!Array.isArray(item) || typeof item[0] !== 'string') return [];
      const meta = item[1] as { formattedText?: unknown; fieldsBelow?: unknown } | undefined;
      const html = typeof meta?.formattedText === 'string' ? meta.formattedText : undefined;
      const below = Array.isArray(meta?.fieldsBelow) ? meta.fieldsBelow.filter((x): x is string => typeof x === 'string') : [];
      const option: Option = { value: item[0], label: html !== undefined ? optionLabel(html) : item[0] };
      if (html !== undefined) option.html = html;
      if (below.length > 0) option.fieldsBelow = below;
      return [option];
    });
    return orderByEnum(options, enumOf(node));
  }
  return (enumOf(node) ?? []).map((v) => ({ value: v, label: v }));
}

/**
 * Write the options back. An option whose label did not change keeps its stored metadata untouched (rich
 * html, pdfMappings, fieldsBelow, ...); a renamed one gets new text but keeps its other metadata.
 * `fieldsBelow` on an Option sets it ([] clears it); leaving it undefined keeps the stored value.
 */
export function setOptions(ui: UiSchema, name: string, options: Option[]): UiSchema {
  return patch(ui, name, (e) => {
    const existing = new Map<string, Record<string, unknown>>();
    const old = (e['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
    if (Array.isArray(old)) {
      for (const item of old) {
        if (Array.isArray(item) && typeof item[0] === 'string' && item[1] && typeof item[1] === 'object') {
          existing.set(item[0], item[1] as Record<string, unknown>);
        }
      }
    }
    return {
      ...e,
      'ui:multipleOption': {
        ...((e['ui:multipleOption'] as object | undefined) ?? {}),
        options: options.map((o) => {
          const prev = existing.get(o.value);
          const unchanged = prev !== undefined && typeof prev.formattedText === 'string' && optionLabel(prev.formattedText) === o.label;
          const meta: Record<string, unknown> = unchanged
            ? { ...prev }
            : { ...(prev ?? {}), formattedText: `<p>${escapeHtml(o.label)}</p>`, blueprintMetadataMapping: prev?.blueprintMetadataMapping ?? '' };
          if (o.fieldsBelow !== undefined) {
            if (o.fieldsBelow.length > 0) meta.fieldsBelow = o.fieldsBelow;
            else delete meta.fieldsBelow;
          }
          return [o.value, meta];
        }),
      },
    };
  });
}

export function nextOptionValue(options: Option[]): string {
  const used = new Set(options.map((o) => o.value));
  let n = 1;
  while (used.has(`option_${n}`)) n += 1;
  return `option_${n}`;
}

export function setWidget(ui: UiSchema, name: string, widget: string, node: SchemaNode): UiSchema {
  const switched = patch(ui, name, (e) => ({ ...e, 'ui:widget': widget }));
  if ((widget === 'Radio' || widget === 'Dropdown') && getOptions(switched[name], node).length === 0) {
    return setOptions(switched, name, [
      { value: 'option_1', label: 'Option 1' },
      { value: 'option_2', label: 'Option 2' },
    ]);
  }
  return switched;
}

/** Set one ui key on one entry, immutably. `undefined` deletes the key. */
export function setUiKey(ui: UiSchema, name: string, key: string, value: unknown): UiSchema {
  return patch(ui, name, (e) => {
    const next: UiEntry = { ...e };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });
}

/** Parse JSON-valued metadata text. Empty text clears the key; anything that is not valid JSON is rejected. */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === '') return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export type CustomKeyCheck = { ok: true; key: string } | { ok: false; error: string };

/** Auto-prefix `ui:`, require a plain identifier, and reject `ui:widget` and keys already in `taken`. */
export function normalizeCustomKey(raw: string, taken: string[]): CustomKeyCheck {
  const t = raw.trim();
  if (t === '' || t === 'ui:') return { ok: false, error: 'Key is required' };
  const key = t.startsWith('ui:') ? t : `ui:${t}`;
  if (!/^ui:[A-Za-z][A-Za-z0-9_]*$/.test(key)) return { ok: false, error: 'Use letters, digits and _ only (must start with a letter)' };
  if (key === 'ui:widget' || taken.includes(key)) return { ok: false, error: `${key} is already used` };
  return { ok: true, key };
}

/** JSON.parse when valid (true, 12, ["a"]), otherwise the raw string. */
export function parseCustomValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
