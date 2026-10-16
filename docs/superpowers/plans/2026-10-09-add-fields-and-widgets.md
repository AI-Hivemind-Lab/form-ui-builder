# Add Fields, Full Widget Set, and Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "add field" flow (widget picker + metadata form), all 27 Anduin widgets (15 new, Repeatable with real rows), a Properties panel that exposes all known metadata, and "Export form JSON", on top of the shipped prototype.

**Architecture:** A pure `model/` layer gains a widget catalog, a metadata registry, add-field/insertion logic, row helpers and export. The reducer gains `adding`, `addNode`, `editDoc` and row actions. React gets a picker popover, an Add Field panel and one shared `MetadataForm` (draft mode for adding, live mode for editing). Everything new is driven by the catalog/registry so adding a widget or key is a one-line change.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), plain CSS, Vitest 2 (jsdom for one file), DOMPurify (already installed).

**Spec:** `docs/superpowers/specs/2026-10-09-add-fields-and-widgets-design.md` (builds on `2026-10-09-form-builder-prototype-design.md`)

## Global Constraints

- Stack unchanged: Vite + React + TypeScript, plain CSS, Vitest for pure logic only. No new runtime dependencies.
- The app has **no undo, reset, progress, or data import/export** (removed by request). Do not re-introduce history, snapshots, coalescing keys, or `computeProgress`.
- Values: top-level fields are stored flat by field `name` in `values`. A Repeatable stores `values[repName]` as `Array<Record<string, unknown>>` (one object per row, keyed by child field name). Multi-value widgets store `string[]`.
- Field names: `^[A-Za-z][A-Za-z0-9_]*$`, unique across the whole doc (schema nodes **and** `uiSchema` keys), and not an `Object.prototype` member name.
- Widget ids equal picker labels with spaces/slashes removed (`MultipleCheckbox`, `PdfWord` with label "Pdf/Word", `CustomFormat` with label "Custom format"). The 12 ids already in the demo (`Page, Group, Header, Paragraph, TextBox, TextArea, Radio, Dropdown, Money, Percentage, Date, File`) are unchanged.
- Assumed key names (one-line changes if wrong): `ui:href`, `ui:pattern`, `ui:maxItems`, `ui:itemName`, `ui:external`, `ui:asaMapping`, `ui:description`, `ui:width`.
- Defaults: `ui:maxItems` = 1, `ui:itemName` = `row`, `ui:width` absent = Auto, Visible switch is the inverse of `ui:invisible`.
- Input widgets commit typed text **on blur** and never save text that does not parse/validate (it stays visible and flagged). Applies to Money, Percentage, Integer, Float, Year, Email, Phone, CustomFormat, Date.
- All `ui:formattedText` HTML goes through `sanitizeHtml`. `ui:href` is limited to `http(s):`, `mailto:`, `#`. An invalid `ui:pattern` regex never throws.
- A Repeatable cannot be placed inside another Repeatable (directly or via a Group). `Page` is top-level only.
- Page and Group are not selectable; every other widget is (Header became selectable).
- Commit with: `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

### Deviations from the spec decided in this plan (the executor ledgers these as rulings)

1. `WidgetDef` has no `metadata: string[]` field: which rows apply to a widget is derived by `metadata.ts` (`appliesTo` predicates), keeping one source of truth.
2. `FormDoc.namespace` and `FormDoc.source` are **optional** (many test docs are built as `{schema, uiSchema}` literals); `buildExport` defaults the namespace to `main`.
3. `startAdd` does **not** clear `selection` (the spec said it does): the default insertion location depends on the selected field. `select` clears `adding`.
4. The "required" metadata control is a checkbox that writes the default message `This field is required` (no message text editing).
5. The default field name is the first unused `<widgetid lowercased><n>`, `n` from 1 (e.g. `textbox1`), not "max suffix + 1".

## Review Focus

Input classes the spec implies that no task's happy-path tests would exercise; each has a test in the owning task.

1. **Names**: empty, leading digit, spaces, duplicates of a schema node, a name that only exists as a `uiSchema` key, and `Object.prototype` names like `constructor`. Task 5.
2. **Placement and nesting**: insert after the last child, into an empty Page/Group, a new Page between pages, no pages in the doc, a Repeatable selected, and a Repeatable inside a Group inside a Repeatable. Task 5.
3. **Bad Repeatable data**: `ui:maxItems` of `0`, `-1`, `2.5`, `"abc"`, `"3"`; `maxItems` lowered below the current row count; removing the last row; `addRow` at max. Task 3 and Task 7.
4. **Hostile or odd metadata**: `javascript:` href, an invalid regex `[` in `ui:pattern`, custom keys like `widget`, `ui:__proto__`, `ui:widget`, duplicates of structured keys. Task 2 and Task 4.
5. **Widget switch with a stale value**: a string value in a field switched to MultipleCheckbox/Integer, a Group with children switched to Repeatable, and unknown widget ids loaded from a file. Tasks 1, 5 and 2 (`asStringArray`).

---

## File Structure

```
src/
  model/
    types.ts            + 'array' NodeType, FormDoc.namespace?/source?
    widgetCatalog.ts    NEW  27 WidgetDefs, widgetKind, switchGroup, filterWidgets
    schemaWalk.ts       catalog-driven kinds/selectable, widgetOf
    format.ts           + parseInteger/Year/Email/Phone, patternParser, safeHref, asStringArray
    draft.ts            resolveWith + Integer/Year/Email/Phone/Pattern resolvers
    rows.ts             NEW  maxItemsOf, getRows, addRow, removeRow, setRowValue
    countries.ts        NEW  COUNTRIES, US_STATES
    metadata.ts         NEW  METADATA registry, presets, customEntries, metadataFor
    editOps.ts          + setUiKey, normalizeCustomKey, parseCustomValue
    addField.ts         NEW  names, buildNewField, switchWidget, insertion, insertNode, replaceNode
    exportForm.ts       NEW  buildExport, exportJsonText
    loadForm.ts         + namespace/source, 'array' type
  state/formReducer.ts  + adding, startAdd/cancelAdd/addNode, editDoc (replaces editUi), row actions
  widgets/
    shared.ts           + RowScope, topLevel?, renderChildren?
    DraftField.tsx      NEW  shared commit-on-blur text field
    NumberInputs.tsx    Money, Percentage, Integer, Float, Year
    TextValidated.tsx   NEW  Email, Phone, CustomFormat
    Geo.tsx             NEW  Country, State
    MultiChoice.tsx     NEW  MultipleCheckbox, MultipleSuggest
    Static.tsx          NEW  AnchorLink
    Placeholder.tsx     NEW  Signature, PdfWord, FileGroup, FileWidget
    Repeatable.tsx      NEW
    Misc.tsx            Unknown only
    registry.ts         all 27
  components/
    FieldRenderer.tsx   row scope, topLevel, width
    FormCanvas.tsx      topLevel
    icons.tsx           + WidgetIcon, PlusIcon, SearchIcon
    WidgetPicker.tsx    NEW
    TocPanel.tsx        + "+" button/popover
    MetadataForm.tsx    NEW
    AddFieldPanel.tsx   NEW
    PropertiesDrawer.tsx rewritten
    TopBar.tsx          + Export form JSON
  App.tsx               right panel switching
  styles/app.css        + new styles
```

---

### Task 1: Catalog, types, and schemaWalk migration

**Files:**
- Modify: `src/model/types.ts`, `src/model/schemaWalk.ts`, `src/model/loadForm.ts` (accept `'array'`)
- Create: `src/model/widgetCatalog.ts`
- Test: `src/model/widgetCatalog.test.ts` (new), `src/model/schemaWalk.test.ts` (modify)

**Interfaces:**
- Produces:
  - `types.ts`: `NodeType` adds `'array'`; `FormDoc` adds `namespace?: string; source?: unknown`.
  - `widgetCatalog.ts`: `type WidgetKind = 'container' | 'static' | 'input' | 'placeholder'`; `interface WidgetDef { id: string; label: string; kind: WidgetKind; schema: { type: NodeType; format?: string }; defaults: UiEntry }`; `WIDGET_CATALOG: WidgetDef[]` (picker order); `getWidgetDef(id: string): WidgetDef | undefined`; `widgetKind(id: string): WidgetKind` (unknown id -> `'input'`); `switchGroup(id: string): string[]`; `filterWidgets(query: string): WidgetDef[]`.
  - `schemaWalk.ts`: `widgetOf(node: SchemaNode, ui: UiEntry): string`; `getWidget(doc, node)` delegates to it; `INPUT_WIDGETS: string[]` (all input-kind ids, derived); `isInputWidget(id)` = `widgetKind(id) === 'input'`; `isSelectable(id)` = not `Page`/`Group`. `STRUCTURAL_WIDGETS` is removed. Default widget for a node with no `ui:widget`: object -> `Group`, null -> `Paragraph`, array with `properties` -> `Repeatable`, array without -> `MultipleCheckbox`, else `TextBox`.

- [ ] **Step 1: Write the failing tests**

`src/model/widgetCatalog.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { filterWidgets, getWidgetDef, switchGroup, WIDGET_CATALOG, widgetKind } from './widgetCatalog';

describe('catalog invariants', () => {
  it('has the 27 picker widgets in picker order with unique ids', () => {
    const ids = WIDGET_CATALOG.map((w) => w.id);
    expect(ids).toHaveLength(27);
    expect(new Set(ids).size).toBe(27);
    expect(ids.slice(0, 4)).toEqual(['Group', 'Page', 'Paragraph', 'Header']);
    expect(ids).toContain('PdfWord');
    expect(ids).toContain('CustomFormat');
  });
  it('every def has a label, a schema type, and defaults carrying its own widget id', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.label).not.toBe('');
      expect(w.schema.type).toBeTruthy();
      expect(w.defaults['ui:widget']).toBe(w.id);
    }
  });
  it('knows every widget used by the demo form', () => {
    const used = new Set(Object.values(demo.namespaceFormSchemaMap.main.uiSchema).map((u) => (u as Record<string, string>)['ui:widget']));
    for (const id of used) expect(getWidgetDef(id), id).toBeDefined();
  });
  it('maps schema types and formats', () => {
    expect(getWidgetDef('Money')?.schema).toEqual({ type: 'number' });
    expect(getWidgetDef('Date')?.schema).toEqual({ type: 'string', format: 'date' });
    expect(getWidgetDef('Repeatable')?.schema.type).toBe('array');
    expect(getWidgetDef('MultipleCheckbox')?.schema.type).toBe('array');
    expect(getWidgetDef('Group')?.schema.type).toBe('object');
    expect(getWidgetDef('Header')?.schema.type).toBe('null');
  });
  it('seeds sensible defaults', () => {
    expect(getWidgetDef('Repeatable')?.defaults).toMatchObject({ 'ui:maxItems': 1, 'ui:itemName': 'row' });
    expect(getWidgetDef('Header')?.defaults['ui:heading']).toBe('Heading');
    expect(getWidgetDef('Radio')?.defaults['ui:fixedLayout']).toBe('Inline');
    expect(getWidgetDef('Radio')?.defaults['ui:multipleOption']).toBeDefined();
    expect(getWidgetDef('TextBox')?.defaults['ui:enabledComment']).toBe(true);
  });
});

describe('widgetKind (Review Focus 5: unknown ids)', () => {
  it('classifies known widgets', () => {
    expect(widgetKind('Page')).toBe('container');
    expect(widgetKind('Repeatable')).toBe('container');
    expect(widgetKind('Header')).toBe('static');
    expect(widgetKind('AnchorLink')).toBe('static');
    expect(widgetKind('Email')).toBe('input');
    expect(widgetKind('Signature')).toBe('placeholder');
    expect(widgetKind('File')).toBe('placeholder');
  });
  it('treats an unknown id as an input (so it keeps a label and a Required toggle)', () => {
    expect(widgetKind('Bogus')).toBe('input');
  });
});

describe('switchGroup', () => {
  it('lets inputs switch among all inputs', () => {
    const g = switchGroup('TextBox');
    expect(g).toContain('Integer');
    expect(g).toContain('Dropdown');
    expect(g).not.toContain('Group');
  });
  it('lets Group and Repeatable swap, never Page', () => {
    expect(switchGroup('Group')).toEqual(['Group', 'Repeatable']);
    expect(switchGroup('Repeatable')).toEqual(['Group', 'Repeatable']);
    expect(switchGroup('Page')).toEqual(['Page']);
  });
  it('keeps Header fixed and lets Paragraph/AnchorLink swap', () => {
    expect(switchGroup('Header')).toEqual(['Header']);
    expect(switchGroup('Paragraph')).toEqual(['Paragraph', 'AnchorLink']);
  });
  it('lets placeholders swap among placeholders', () => {
    expect(switchGroup('Signature').sort()).toEqual(['File', 'FileGroup', 'PdfWord', 'Signature']);
  });
  it('returns [] for unknown ids', () => {
    expect(switchGroup('Bogus')).toEqual([]);
  });
});

describe('filterWidgets', () => {
  it('returns everything for an empty/whitespace query', () => {
    expect(filterWidgets('')).toHaveLength(27);
    expect(filterWidgets('   ')).toHaveLength(27);
  });
  it('matches labels case-insensitively and trims', () => {
    expect(filterWidgets(' RADIO ').map((w) => w.id)).toEqual(['Radio']);
    expect(filterWidgets('pdf').map((w) => w.id)).toEqual(['PdfWord']);
    expect(filterWidgets('custom').map((w) => w.id)).toEqual(['CustomFormat']);
  });
  it('returns [] when nothing matches', () => {
    expect(filterWidgets('zzz')).toEqual([]);
  });
});
```

In `src/model/schemaWalk.test.ts`, change `expect(isSelectable('Header')).toBe(false);` to `expect(isSelectable('Header')).toBe(true);` and add these lines inside the `classifies widgets` test (before its closing `});`):
```ts
    expect(isSelectable('Repeatable')).toBe(true);
    expect(isSelectable('Page')).toBe(false);
    expect(isInputWidget('Email')).toBe(true);
    expect(isInputWidget('Signature')).toBe(false);
    expect(isInputWidget('Bogus')).toBe(true);
```
and add inside the `defaults for missing config` describe:
```ts
  it('defaults arrays by whether they have children', () => {
    expect(getWidget(bare, { name: 'r', type: 'array', title: 'R', properties: [] })).toBe('Repeatable');
    expect(getWidget(bare, { name: 'm', type: 'array', title: 'M' })).toBe('MultipleCheckbox');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/widgetCatalog.test.ts src/model/schemaWalk.test.ts`
Expected: FAIL (`widgetCatalog` module missing; `isSelectable('Header')` mismatch).

- [ ] **Step 3: Implement**

`src/model/types.ts`: change the first line to `export type NodeType = 'null' | 'string' | 'number' | 'object' | 'array';` and replace `FormDoc` with:
```ts
export interface FormDoc {
  schema: { type: 'object'; properties: SchemaNode[] };
  uiSchema: UiSchema;
  /** Namespace this doc was loaded from (used by export); defaults to "main". */
  namespace?: string;
  /** The raw loaded export, carried through so export can keep rules/libs. */
  source?: unknown;
}
```

`src/model/loadForm.ts`: change `const NODE_TYPES = new Set(['null', 'string', 'number', 'object']);` to `new Set(['null', 'string', 'number', 'object', 'array'])`.

`src/model/widgetCatalog.ts`:
```ts
import type { NodeType, UiEntry } from './types';

export type WidgetKind = 'container' | 'static' | 'input' | 'placeholder';

export interface WidgetDef {
  id: string;
  label: string;
  kind: WidgetKind;
  schema: { type: NodeType; format?: string };
  defaults: UiEntry;
}

const DEFAULT_OPTIONS = [
  ['option_1', { formattedText: '<p>Option 1</p>', blueprintMetadataMapping: '' }],
  ['option_2', { formattedText: '<p>Option 2</p>', blueprintMetadataMapping: '' }],
];

function def(
  id: string,
  label: string,
  kind: WidgetKind,
  type: NodeType,
  extra: { format?: string; defaults?: UiEntry } = {},
): WidgetDef {
  const withEnabledComment = kind === 'input' ? { 'ui:enabledComment': true } : {};
  return {
    id,
    label,
    kind,
    schema: extra.format ? { type, format: extra.format } : { type },
    defaults: { 'ui:widget': id, 'ui:marginBottom': '12px', ...withEnabledComment, ...(extra.defaults ?? {}) },
  };
}

const CHOICE = { 'ui:multipleOption': { options: DEFAULT_OPTIONS } };

/** In picker order (matches the reference screenshots). */
export const WIDGET_CATALOG: WidgetDef[] = [
  def('Group', 'Group', 'container', 'object'),
  def('Page', 'Page', 'container', 'object'),
  def('Paragraph', 'Paragraph', 'static', 'null'),
  def('Header', 'Header', 'static', 'null', { defaults: { 'ui:heading': 'Heading' } }),
  def('TextBox', 'TextBox', 'input', 'string'),
  def('MultipleCheckbox', 'MultipleCheckbox', 'input', 'array', { defaults: { ...CHOICE, 'ui:fixedLayout': 'Inline' } }),
  def('MultipleSuggest', 'MultipleSuggest', 'input', 'array', { defaults: CHOICE }),
  def('Radio', 'Radio', 'input', 'string', { defaults: { ...CHOICE, 'ui:fixedLayout': 'Inline' } }),
  def('Dropdown', 'Dropdown', 'input', 'string', { defaults: CHOICE }),
  def('Signature', 'Signature', 'placeholder', 'null'),
  def('PdfWord', 'Pdf/Word', 'placeholder', 'null'),
  def('Repeatable', 'Repeatable', 'container', 'array', { defaults: { 'ui:maxItems': 1, 'ui:itemName': 'row' } }),
  def('TextArea', 'TextArea', 'input', 'string'),
  def('Integer', 'Integer', 'input', 'number'),
  def('Float', 'Float', 'input', 'number'),
  def('Percentage', 'Percentage', 'input', 'number'),
  def('Money', 'Money', 'input', 'number'),
  def('Year', 'Year', 'input', 'number'),
  def('Email', 'Email', 'input', 'string'),
  def('Date', 'Date', 'input', 'string', { format: 'date' }),
  def('Phone', 'Phone', 'input', 'string'),
  def('FileGroup', 'FileGroup', 'placeholder', 'null'),
  def('File', 'File', 'placeholder', 'null'),
  def('AnchorLink', 'AnchorLink', 'static', 'null'),
  def('Country', 'Country', 'input', 'string'),
  def('State', 'State', 'input', 'string'),
  def('CustomFormat', 'Custom format', 'input', 'string'),
];

const BY_ID = new Map(WIDGET_CATALOG.map((w) => [w.id, w]));

export function getWidgetDef(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

/** Unknown ids count as inputs, so a loaded file's odd widget keeps a label and a Required toggle. */
export function widgetKind(id: string): WidgetKind {
  return BY_ID.get(id)?.kind ?? 'input';
}

/** The ids a field of widget `id` may be switched to in the Input type dropdown. */
export function switchGroup(id: string): string[] {
  const d = BY_ID.get(id);
  if (!d) return [];
  if (id === 'Page' || id === 'Header') return [id];
  if (d.kind === 'container') return ['Group', 'Repeatable'];
  if (d.kind === 'static') return ['Paragraph', 'AnchorLink'];
  return WIDGET_CATALOG.filter((w) => w.kind === d.kind).map((w) => w.id);
}

export function filterWidgets(query: string): WidgetDef[] {
  const q = query.trim().toLowerCase();
  return q === '' ? WIDGET_CATALOG : WIDGET_CATALOG.filter((w) => w.label.toLowerCase().includes(q));
}
```

`src/model/schemaWalk.ts`: replace the top of the file (imports through `isSelectable`) with:
```ts
import { escapeHtml } from './html';
import type { FormDoc, SchemaNode, UiEntry } from './types';
import { entryInvisible, entryRequired } from './uiEntry';
import { WIDGET_CATALOG, widgetKind } from './widgetCatalog';

export const INPUT_WIDGETS: string[] = WIDGET_CATALOG.filter((w) => w.kind === 'input').map((w) => w.id);

export function uiOf(doc: FormDoc, name: string): UiEntry {
  return doc.uiSchema[name] ?? {};
}

function defaultWidget(node: SchemaNode): string {
  if (node.type === 'object') return 'Group';
  if (node.type === 'null') return 'Paragraph';
  if (node.type === 'array') return node.properties ? 'Repeatable' : 'MultipleCheckbox';
  return 'TextBox';
}

/** The widget id for a node given its ui entry (falls back by schema type). */
export function widgetOf(node: SchemaNode, ui: UiEntry): string {
  const w = ui['ui:widget'];
  return typeof w === 'string' && w !== '' ? w : defaultWidget(node);
}

export function getWidget(doc: FormDoc, node: SchemaNode): string {
  return widgetOf(node, uiOf(doc, node.name));
}

export function getLabelHtml(doc: FormDoc, node: SchemaNode): string {
  const f = uiOf(doc, node.name)['ui:formattedText'];
  return typeof f === 'string' ? f : `<p>${escapeHtml(node.title)}</p>`;
}

export const isRequired = (doc: FormDoc, name: string): boolean => entryRequired(doc.uiSchema[name]);
export const isInvisible = (doc: FormDoc, name: string): boolean => entryInvisible(doc.uiSchema[name]);

export const isInputWidget = (widget: string): boolean => widgetKind(widget) === 'input';
export const isSelectable = (widget: string): boolean => widget !== 'Page' && widget !== 'Group';
```
Keep `getPages` and `findNode` as they are.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (all prior tests still green; `PropertiesDrawer` still compiles because `INPUT_WIDGETS`/`isInputWidget` remain exported).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(model): widget catalog and catalog-driven schemaWalk" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Parsers, validators, and draft resolvers

**Files:**
- Modify: `src/model/format.ts`, `src/model/draft.ts`
- Test: `src/model/format.test.ts`, `src/model/draft.test.ts` (append)

**Interfaces:**
- Produces in `format.ts`: `parseInteger(text): number | null`, `parseYear(text): number | null`, `parseEmail(text): string | null` (trimmed), `parsePhone(text): string | null` (trimmed), `patternParser(pattern: unknown): (text: string) => string | null`, `safeHref(href: unknown): string | null`, `asStringArray(v: unknown): string[]`.
- Produces in `draft.ts`: `resolveWith<T extends string | number>(draft, current, parse): DraftResult`; `resolveIntegerDraft`, `resolveYearDraft`, `resolveEmailDraft`, `resolvePhoneDraft` (each `(draft: string, current: unknown) => DraftResult`); `resolvePatternDraft(pattern: unknown): (draft: string, current: unknown) => DraftResult`. Existing `resolveNumberDraft` / `resolveDateDraft` keep their signatures.

- [ ] **Step 1: Write the failing tests**

Append to `src/model/format.test.ts` (extend the import list with the new names):
```ts
import { asStringArray, parseEmail, parseInteger, parsePhone, parseYear, patternParser, safeHref } from './format';

describe('parseInteger / parseYear', () => {
  it.each([['5', 5], ['-12', -12], ['1,000', 1000], [' 7 ', 7]])('parseInteger %j', (t, n) => expect(parseInteger(t)).toBe(n));
  it.each(['', '1.5', '1e5', 'abc', '--1', '5.'])('parseInteger rejects %j', (t) => expect(parseInteger(t)).toBeNull());
  it.each([['2026', 2026], [' 1999 ', 1999]])('parseYear %j', (t, n) => expect(parseYear(t)).toBe(n));
  it.each(['', '26', '12345', '20x6', '-2026', '2026.0'])('parseYear rejects %j', (t) => expect(parseYear(t)).toBeNull());
});

describe('parseEmail / parsePhone', () => {
  it('accepts normal emails and trims', () => {
    expect(parseEmail(' a@b.co ')).toBe('a@b.co');
    expect(parseEmail('first.last+tag@sub.example.org')).toBe('first.last+tag@sub.example.org');
  });
  it.each(['', 'abc', 'a@b', '@b.co', 'a@.co', 'a b@c.de', 'a@@b.co'])('rejects email %j', (t) => expect(parseEmail(t)).toBeNull());
  it.each([['+1 (415) 555-0100', '+1 (415) 555-0100'], ['415.555.0100', '415.555.0100'], ['1234567', '1234567']])('phone %j', (t, v) => expect(parsePhone(t)).toBe(v));
  it.each(['', 'abc', '12345', '1234567890123456', '555-CALL-NOW', '12;34567'])('rejects phone %j', (t) => expect(parsePhone(t)).toBeNull());
});

describe('patternParser (Review Focus 4: invalid regex)', () => {
  it('accepts text matching the pattern', () => {
    const p = patternParser('^[A-Z]{2}-\\d{3}$');
    expect(p('AB-123')).toBe('AB-123');
    expect(p('ab-123')).toBeNull();
  });
  it('accepts anything when the pattern is missing, empty, or an invalid regex (never throws)', () => {
    for (const pat of [undefined, '', 5, '[']) expect(patternParser(pat)('whatever')).toBe('whatever');
  });
});

describe('safeHref (Review Focus 4: hostile href)', () => {
  it.each(['https://a.com/x', 'http://a.com', 'mailto:a@b.co', '#section', ' HTTPS://A.COM '])('allows %j', (h) => expect(safeHref(h)).not.toBeNull());
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', '//evil.com', '', 5, null, undefined])('blocks %j', (h) => expect(safeHref(h)).toBeNull());
});

describe('asStringArray (Review Focus 5: stale value types)', () => {
  it('keeps string entries of an array and ignores everything else', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asStringArray(['a', 1, null, 'c'])).toEqual(['a', 'c']);
    expect(asStringArray('abc')).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray({ 0: 'a' })).toEqual([]);
  });
});
```

Append to `src/model/draft.test.ts` (extend imports):
```ts
import { resolveEmailDraft, resolveIntegerDraft, resolvePatternDraft, resolvePhoneDraft, resolveYearDraft } from './draft';

describe('new resolvers', () => {
  it('integer: rejects decimals and exponents, accepts digits', () => {
    expect(resolveIntegerDraft('1.5', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveIntegerDraft('1e5', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveIntegerDraft('42', undefined)).toEqual({ kind: 'set', value: 42 });
    expect(resolveIntegerDraft('42', 42)).toEqual({ kind: 'unchanged' });
  });
  it('year: needs exactly four digits', () => {
    expect(resolveYearDraft('26', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveYearDraft('2026', 2025)).toEqual({ kind: 'set', value: 2026 });
  });
  it('email/phone: invalid text is flagged, valid text is set (trimmed), empty clears', () => {
    expect(resolveEmailDraft('nope', 'a@b.co')).toEqual({ kind: 'invalid' });
    expect(resolveEmailDraft(' x@y.zz ', undefined)).toEqual({ kind: 'set', value: 'x@y.zz' });
    expect(resolveEmailDraft('', 'a@b.co')).toEqual({ kind: 'set', value: '' });
    expect(resolvePhoneDraft('12', undefined)).toEqual({ kind: 'invalid' });
    expect(resolvePhoneDraft('+1 415 555 0100', undefined)).toEqual({ kind: 'set', value: '+1 415 555 0100' });
  });
  it('pattern: validates against ui:pattern, accepts anything for a bad regex', () => {
    const r = resolvePatternDraft('^\\d{3}$');
    expect(r('12', undefined)).toEqual({ kind: 'invalid' });
    expect(r('123', undefined)).toEqual({ kind: 'set', value: '123' });
    expect(resolvePatternDraft('[')('anything', undefined)).toEqual({ kind: 'set', value: 'anything' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/format.test.ts src/model/draft.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

Append to `src/model/format.ts`:
```ts
/** Whole numbers; commas/spaces tolerated: "1,000" -> 1000. */
export function parseInteger(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  return /^-?\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** Exactly four digits. */
export function parseYear(text: string): number | null {
  const t = text.trim();
  return /^\d{4}$/.test(t) ? Number(t) : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseEmail(text: string): string | null {
  const t = text.trim();
  return EMAIL_RE.test(t) ? t : null;
}

/** Digits plus " + ( ) . -", with 7 to 15 digits in total. */
export function parsePhone(text: string): string | null {
  const t = text.trim();
  if (!/^[0-9 +().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 ? t : null;
}

/** Parser for CustomFormat: text must match `pattern`. A missing or invalid pattern accepts any text. */
export function patternParser(pattern: unknown): (text: string) => string | null {
  let re: RegExp | null = null;
  if (typeof pattern === 'string' && pattern !== '') {
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
  }
  return (text) => {
    const t = text.trim();
    return re === null || re.test(t) ? t : null;
  };
}

/** Only http(s), mailto and in-page (#) links are allowed. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const t = href.trim();
  return /^(https?:\/\/|mailto:|#)/i.test(t) ? t : null;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
```

Replace `src/model/draft.ts` with:
```ts
import { parseDateInput, parseEmail, parseInteger, parseNumber, parsePhone, parseYear, patternParser } from './format';

const isFilled = (v: unknown): boolean => v !== undefined && v !== null && String(v).trim() !== '';

export type DraftResult = { kind: 'unchanged' } | { kind: 'set'; value: number | string } | { kind: 'invalid' };

/**
 * Decide what to do with the text a user typed into a field when they leave it.
 * Empty clears (or is a no-op if already empty); unparsable text is `invalid` and must never be saved.
 */
export function resolveWith<T extends string | number>(
  draft: string,
  current: unknown,
  parse: (text: string) => T | null,
): DraftResult {
  if (draft.trim() === '') return isFilled(current) ? { kind: 'set', value: '' } : { kind: 'unchanged' };
  const parsed = parse(draft);
  if (parsed === null) return { kind: 'invalid' };
  return parsed === current ? { kind: 'unchanged' } : { kind: 'set', value: parsed };
}

export const resolveNumberDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseNumber);
export const resolveDateDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseDateInput);
export const resolveIntegerDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseInteger);
export const resolveYearDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseYear);
export const resolveEmailDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parseEmail);
export const resolvePhoneDraft = (draft: string, current: unknown): DraftResult => resolveWith(draft, current, parsePhone);

export function resolvePatternDraft(pattern: unknown): (draft: string, current: unknown) => DraftResult {
  const parse = patternParser(pattern);
  return (draft, current) => resolveWith(draft, current, parse);
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): integer/year/email/phone/pattern parsers and draft resolvers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Repeatable row helpers and geo data

**Files:**
- Create: `src/model/rows.ts`, `src/model/countries.ts`
- Test: `src/model/rows.test.ts`, `src/model/countries.test.ts`

**Interfaces:**
- Produces in `rows.ts`: `type Row = Record<string, unknown>`; `DEFAULT_MAX_ITEMS = 1`; `maxItemsOf(doc: FormDoc, name: string): number`; `getRows(values: Values, rep: string): Row[]` (never empty: an unset/empty/invalid value yields `[{}]`); `addRow(values, rep, max): Values`; `removeRow(values, rep, index): Values`; `setRowValue(values, rep, index, field, value): Values`. All return the **same** `values` object when they are a no-op.
- Produces in `countries.ts`: `COUNTRIES: Option[]` (249 ISO-3166-1 alpha-2, `value` = code, `label` = English name, sorted by label), `US_STATES: Option[]` (50 states + DC, value = 2-letter code).

- [ ] **Step 1: Write the failing tests**

`src/model/rows.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addRow, DEFAULT_MAX_ITEMS, getRows, maxItemsOf, removeRow, setRowValue } from './rows';
import type { FormDoc } from './types';

const docWith = (max: unknown): FormDoc => ({
  schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'Rep', properties: [] }] },
  uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:maxItems': max } },
});

describe('maxItemsOf (Review Focus 3: bad maxItems)', () => {
  it.each([[3, 3], ['4', 4], [1, 1], [10, 10]])('reads %j as %j', (v, n) => expect(maxItemsOf(docWith(v), 'rep')).toBe(n));
  it.each([0, -1, 2.5, 'abc', '', null, undefined, NaN, {}])('falls back to the default for %j', (v) => {
    expect(maxItemsOf(docWith(v), 'rep')).toBe(DEFAULT_MAX_ITEMS);
  });
  it('falls back to the default when there is no ui entry at all', () => {
    expect(maxItemsOf({ schema: { type: 'object', properties: [] }, uiSchema: {} }, 'nope')).toBe(1);
  });
});

describe('getRows', () => {
  it('shows one empty row when unset, empty, or the wrong shape', () => {
    for (const v of [undefined, [], 'x', 5, null, {}]) expect(getRows({ rep: v }, 'rep')).toEqual([{}]);
  });
  it('returns stored rows and replaces non-object rows with {}', () => {
    expect(getRows({ rep: [{ a: 1 }, 'bad', null, [1]] }, 'rep')).toEqual([{ a: 1 }, {}, {}, {}]);
  });
});

describe('addRow / removeRow / setRowValue', () => {
  it('addRow materialises the default row then appends, up to the max', () => {
    let v = addRow({}, 'rep', 3);
    expect(v.rep).toEqual([{}, {}]);
    v = addRow(v, 'rep', 3);
    expect(v.rep).toHaveLength(3);
    const same = addRow(v, 'rep', 3);
    expect(same).toBe(v);
  });
  it('addRow is a no-op when the max is already exceeded (max lowered below the row count)', () => {
    const v = { rep: [{}, {}, {}] };
    expect(addRow(v, 'rep', 2)).toBe(v);
  });
  it('removeRow removes by index but never the last row, and ignores bad indexes', () => {
    const v = { rep: [{ a: 1 }, { a: 2 }] };
    expect(removeRow(v, 'rep', 0).rep).toEqual([{ a: 2 }]);
    const one = { rep: [{ a: 1 }] };
    expect(removeRow(one, 'rep', 0)).toBe(one);
    expect(removeRow(v, 'rep', 5)).toBe(v);
    expect(removeRow(v, 'rep', -1)).toBe(v);
    const unset = {};
    expect(removeRow(unset, 'rep', 0)).toBe(unset);
  });
  it('setRowValue writes one field of one row without touching others, materialising an unset array', () => {
    const v = setRowValue({}, 'rep', 0, 'name', 'Ann');
    expect(v.rep).toEqual([{ name: 'Ann' }]);
    const two = { rep: [{ name: 'a' }, { name: 'b' }] };
    const next = setRowValue(two, 'rep', 1, 'name', 'z');
    expect(next.rep).toEqual([{ name: 'a' }, { name: 'z' }]);
    expect(two.rep).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(setRowValue(two, 'rep', 9, 'name', 'q')).toBe(two);
  });
});
```

`src/model/countries.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { COUNTRIES, US_STATES } from './countries';

describe('COUNTRIES', () => {
  it('has 249 unique ISO codes, sorted by name, with English labels', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((c) => c.value)).size).toBe(249);
    expect(COUNTRIES.find((c) => c.value === 'US')?.label).toBe('United States');
    const labels = COUNTRIES.map((c) => c.label);
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
  });
});

describe('US_STATES', () => {
  it('has 50 states plus DC with 2-letter codes', () => {
    expect(US_STATES).toHaveLength(51);
    expect(US_STATES.every((s) => /^[A-Z]{2}$/.test(s.value))).toBe(true);
    expect(US_STATES.find((s) => s.value === 'DC')?.label).toBe('District of Columbia');
    expect(US_STATES.find((s) => s.value === 'CA')?.label).toBe('California');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/rows.test.ts src/model/countries.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/model/rows.ts`:
```ts
import type { FormDoc, Values } from './types';

export type Row = Record<string, unknown>;

export const DEFAULT_MAX_ITEMS = 1;

/** `ui:maxItems` as an integer >= 1 (numeric strings accepted); anything else falls back to the default. */
export function maxItemsOf(doc: FormDoc, name: string): number {
  const raw = doc.uiSchema[name]?.['ui:maxItems'];
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
```

`src/model/countries.ts`:
```ts
import type { Option } from './types';

const CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' ',
  );

const names = new Intl.DisplayNames(['en'], { type: 'region' });

export const COUNTRIES: Option[] = CODES.map((code) => ({ value: code, label: names.of(code) ?? code })).sort((a, b) =>
  a.label.localeCompare(b.label),
);

const STATES: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
];

export const US_STATES: Option[] = STATES.map(([value, label]) => ({ value, label }));
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (the countries test confirms 249 unique codes; if the count differs, fix the CODES list, not the test).

```bash
git add -A
git commit -m "feat(model): repeatable row helpers and country/state data" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Metadata registry and custom-key helpers

**Files:**
- Create: `src/model/metadata.ts`
- Modify: `src/model/editOps.ts`
- Test: `src/model/metadata.test.ts` (new), `src/model/editOps.test.ts` (append)

**Interfaces:**
- Consumes: `WidgetDef`, `getWidgetDef` (`./widgetCatalog`).
- Produces in `metadata.ts`:
  ```ts
  type Control = 'html-text' | 'required' | 'visible' | 'text' | 'integer' | 'px' | 'width' | 'enum' | 'options' | 'string-list' | 'bool';
  interface MetaDef { key: string; label: string; control: Control; applies: (w: WidgetDef | undefined) => boolean;
    presets?: string[]; enumValues?: { value: string; label: string }[]; defaultText?: string }
  METADATA: MetaDef[]            // in display order
  MARGIN_PRESETS, INDENT_PRESETS, WIDTH_PRESETS: string[]
  KNOWN_KEYS: Set<string>        // 'ui:widget' + every METADATA key
  metadataFor(widgetId: string): MetaDef[]
  customEntries(ui: UiEntry): [string, unknown][]   // ui:* keys not in KNOWN_KEYS, in object order
  ```
- Produces in `editOps.ts`: `setUiKey(ui: UiSchema, name: string, key: string, value: unknown): UiSchema` (value `undefined` deletes the key); `normalizeCustomKey(raw: string, taken: string[]): { ok: true; key: string } | { ok: false; error: string }`; `parseCustomValue(text: string): unknown`.
- Display order of `METADATA` (rows hide when `applies` is false): label, subtitle, heading, description, fileName, href, pattern, maxItems, itemName, required, multipleOption, fixedLayout, pdfMapping, asaMapping, signature, width, marginBottom, indentation, enabledComment, external, invisible(Visible).

- [ ] **Step 1: Write the failing tests**

`src/model/metadata.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { customEntries, INDENT_PRESETS, KNOWN_KEYS, MARGIN_PRESETS, metadataFor, METADATA, WIDTH_PRESETS } from './metadata';

const keys = (id: string) => metadataFor(id).map((m) => m.key);

describe('registry shape', () => {
  it('has unique keys and every control is known', () => {
    const ks = METADATA.map((m) => m.key);
    expect(new Set(ks).size).toBe(ks.length);
    expect(KNOWN_KEYS.has('ui:widget')).toBe(true);
    for (const k of ks) expect(KNOWN_KEYS.has(k)).toBe(true);
  });
  it('exposes dropdown presets', () => {
    expect(MARGIN_PRESETS).toContain('12px');
    expect(INDENT_PRESETS).toContain('24px');
    expect(WIDTH_PRESETS[0]).toBe('Auto');
  });
});

describe('metadataFor', () => {
  it('Header: subtitle, heading, description, ASA, margin, indentation, visible (no label/required/pdf)', () => {
    const k = keys('Header');
    expect(k).toEqual(expect.arrayContaining(['ui:subtitle', 'ui:heading', 'ui:description', 'ui:asaMapping', 'ui:marginBottom', 'ui:indentation', 'ui:invisible']));
    expect(k).not.toContain('ui:formattedText');
    expect(k).not.toContain('ui:required');
    expect(k).not.toContain('ui:pdfMapping');
    expect(k).not.toContain('ui:width');
  });
  it('Repeatable: max items, item name, required, comments, external', () => {
    expect(keys('Repeatable')).toEqual(expect.arrayContaining(['ui:maxItems', 'ui:itemName', 'ui:required', 'ui:enabledComment', 'ui:external', 'ui:formattedText']));
  });
  it('Radio: options and layout; Dropdown: options but no layout', () => {
    expect(keys('Radio')).toEqual(expect.arrayContaining(['ui:multipleOption', 'ui:fixedLayout']));
    expect(keys('Dropdown')).toContain('ui:multipleOption');
    expect(keys('Dropdown')).not.toContain('ui:fixedLayout');
  });
  it('widget-specific rows appear only on their widget', () => {
    expect(keys('AnchorLink')).toContain('ui:href');
    expect(keys('TextBox')).not.toContain('ui:href');
    expect(keys('CustomFormat')).toContain('ui:pattern');
    expect(keys('PdfWord')).toContain('ui:fileName');
    expect(keys('File')).toContain('ui:fileName');
  });
  it('Page/Group only get margin, indentation and visible', () => {
    for (const id of ['Page', 'Group']) {
      expect(keys(id)).toEqual(['ui:marginBottom', 'ui:indentation', 'ui:invisible']);
    }
  });
  it('unknown widgets are treated like inputs (label, required, ...)', () => {
    expect(keys('Bogus')).toEqual(expect.arrayContaining(['ui:formattedText', 'ui:required', 'ui:invisible']));
  });
  it('is in display order: required before width before margin before visible', () => {
    const k = keys('TextBox');
    expect(k.indexOf('ui:required')).toBeLessThan(k.indexOf('ui:width'));
    expect(k.indexOf('ui:width')).toBeLessThan(k.indexOf('ui:marginBottom'));
    expect(k.indexOf('ui:marginBottom')).toBeLessThan(k.indexOf('ui:invisible'));
    expect(k[k.length - 1]).toBe('ui:invisible');
  });
});

describe('customEntries', () => {
  it('returns only unknown ui: keys, in order', () => {
    expect(customEntries({ 'ui:widget': 'TextBox', 'ui:formattedText': 'x', 'ui:foo': 1, 'ui:bar': 'b', other: 2 })).toEqual([['ui:foo', 1], ['ui:bar', 'b']]);
  });
  it('treats every key in the demo uiSchema as known', () => {
    for (const [name, entry] of Object.entries(demo.namespaceFormSchemaMap.main.uiSchema)) {
      expect(customEntries(entry as Record<string, unknown>), name).toEqual([]);
    }
  });
});
```

Append to `src/model/editOps.test.ts` (extend the import list with `normalizeCustomKey, parseCustomValue, setUiKey`):
```ts
describe('setUiKey', () => {
  it('sets a key immutably and deletes it when the value is undefined', () => {
    const ui: UiSchema = { f: { 'ui:widget': 'TextBox' } };
    const next = setUiKey(ui, 'f', 'ui:width', '50%');
    expect(next.f['ui:width']).toBe('50%');
    expect('ui:width' in ui.f).toBe(false);
    expect('ui:width' in setUiKey(next, 'f', 'ui:width', undefined).f).toBe(false);
  });
  it('creates the entry if missing and keeps false/0/empty values', () => {
    expect(setUiKey({}, 'z', 'ui:external', false).z['ui:external']).toBe(false);
    expect(setUiKey({}, 'z', 'ui:maxItems', 0).z['ui:maxItems']).toBe(0);
  });
});

describe('normalizeCustomKey (Review Focus 4)', () => {
  it('auto-prefixes ui: and accepts simple identifiers', () => {
    expect(normalizeCustomKey('foo', [])).toEqual({ ok: true, key: 'ui:foo' });
    expect(normalizeCustomKey(' ui:fooBar_2 ', [])).toEqual({ ok: true, key: 'ui:fooBar_2' });
  });
  it.each(['', '   ', 'ui:', 'a b', '1abc', 'ui:1abc', '__proto__', 'ui:__proto__', 'a.b', 'a-b'])('rejects %j', (raw) => {
    expect(normalizeCustomKey(raw, [])).toMatchObject({ ok: false });
  });
  it('rejects ui:widget and already-taken keys', () => {
    expect(normalizeCustomKey('widget', [])).toMatchObject({ ok: false });
    expect(normalizeCustomKey('ui:widget', [])).toMatchObject({ ok: false });
    expect(normalizeCustomKey('heading', ['ui:heading'])).toMatchObject({ ok: false });
  });
});

describe('parseCustomValue', () => {
  it('keeps JSON types and falls back to a string', () => {
    expect(parseCustomValue('true')).toBe(true);
    expect(parseCustomValue('12')).toBe(12);
    expect(parseCustomValue('["a"]')).toEqual(['a']);
    expect(parseCustomValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseCustomValue('"quoted"')).toBe('quoted');
    expect(parseCustomValue('plain text')).toBe('plain text');
    expect(parseCustomValue('')).toBe('');
    expect(parseCustomValue('[unclosed')).toBe('[unclosed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/metadata.test.ts src/model/editOps.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/model/editOps.ts`:
```ts
/** Set one ui key on one entry, immutably. `undefined` deletes the key. */
export function setUiKey(ui: UiSchema, name: string, key: string, value: unknown): UiSchema {
  return patch(ui, name, (e) => {
    const next: UiEntry = { ...e };
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next;
  });
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
```

`src/model/metadata.ts`:
```ts
import type { UiEntry } from './types';
import { getWidgetDef, type WidgetDef } from './widgetCatalog';

export type Control =
  | 'html-text' | 'required' | 'visible' | 'text' | 'integer' | 'px' | 'width'
  | 'enum' | 'options' | 'string-list' | 'bool';

export interface MetaDef {
  key: string;
  label: string;
  control: Control;
  applies: (w: WidgetDef | undefined) => boolean;
  presets?: string[];
  enumValues?: { value: string; label: string }[];
  /** Placeholder / displayed default when the key is absent. */
  defaultText?: string;
}

export const MARGIN_PRESETS = ['0px', '4px', '8px', '12px', '16px', '24px', '32px', '48px'];
export const INDENT_PRESETS = ['0px', '12px', '24px', '36px', '48px'];
export const WIDTH_PRESETS = ['Auto', '25%', '50%', '75%', '100%'];

const idOf = (w: WidgetDef | undefined): string => w?.id ?? '';
const is = (...ids: string[]) => (w: WidgetDef | undefined) => ids.includes(idOf(w));
const not = (...ids: string[]) => (w: WidgetDef | undefined) => !ids.includes(idOf(w));
const hasValue = (w: WidgetDef | undefined) => (w?.kind ?? 'input') === 'input';
const valueOrRepeatable = (w: WidgetDef | undefined) => hasValue(w) || idOf(w) === 'Repeatable';

/** In display order. Rows hide when `applies` is false. */
export const METADATA: MetaDef[] = [
  { key: 'ui:formattedText', label: 'Label', control: 'html-text', applies: not('Header', 'Page', 'Group') },
  { key: 'ui:subtitle', label: 'Subtitle', control: 'text', applies: is('Header') },
  { key: 'ui:heading', label: 'Heading', control: 'text', applies: is('Header') },
  { key: 'ui:description', label: 'Description', control: 'text', applies: is('Header') },
  { key: 'ui:fileName', label: 'File name', control: 'text', applies: is('File', 'PdfWord') },
  { key: 'ui:href', label: 'Link URL', control: 'text', applies: is('AnchorLink') },
  { key: 'ui:pattern', label: 'Format pattern (regex)', control: 'text', applies: is('CustomFormat') },
  { key: 'ui:maxItems', label: 'Max number of items', control: 'integer', applies: is('Repeatable'), defaultText: '1' },
  { key: 'ui:itemName', label: 'Item name', control: 'text', applies: is('Repeatable'), defaultText: 'row' },
  { key: 'ui:required', label: 'Required', control: 'required', applies: valueOrRepeatable },
  { key: 'ui:multipleOption', label: 'Options', control: 'options', applies: is('Radio', 'Dropdown', 'MultipleCheckbox', 'MultipleSuggest') },
  {
    key: 'ui:fixedLayout', label: 'Layout', control: 'enum', applies: is('Radio', 'MultipleCheckbox'),
    enumValues: [{ value: '', label: 'Default' }, { value: 'Inline', label: 'Inline' }],
  },
  { key: 'ui:pdfMapping', label: 'PDF Mapping', control: 'string-list', applies: not('Header', 'Page', 'Group') },
  { key: 'ui:asaMapping', label: 'Anduin Standard Alias Mapping', control: 'string-list', applies: not('Page', 'Group') },
  { key: 'ui:signature', label: 'Signature', control: 'string-list', applies: not('Header', 'Page', 'Group') },
  { key: 'ui:width', label: 'Width', control: 'width', applies: not('Page', 'Group', 'Header') },
  { key: 'ui:marginBottom', label: 'Margin bottom', control: 'px', presets: MARGIN_PRESETS, applies: () => true },
  { key: 'ui:indentation', label: 'Indentation', control: 'px', presets: INDENT_PRESETS, applies: () => true },
  { key: 'ui:enabledComment', label: 'Enable Commenting', control: 'bool', applies: valueOrRepeatable },
  { key: 'ui:external', label: 'External', control: 'bool', applies: valueOrRepeatable },
  { key: 'ui:invisible', label: 'Visible', control: 'visible', applies: () => true },
];

export const KNOWN_KEYS = new Set<string>(['ui:widget', ...METADATA.map((m) => m.key)]);

export function metadataFor(widgetId: string): MetaDef[] {
  const w = getWidgetDef(widgetId);
  return METADATA.filter((m) => m.applies(w));
}

/** ui:* keys that are not structured metadata, in object order (shown as custom key/value rows). */
export function customEntries(ui: UiEntry): [string, unknown][] {
  return Object.entries(ui).filter(([k]) => k.startsWith('ui:') && !KNOWN_KEYS.has(k));
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): metadata registry and custom-key helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Adding fields: names, new-field builder, widget switch, insertion

**Files:**
- Create: `src/model/addField.ts`
- Test: `src/model/addField.test.ts`

**Interfaces:**
- Consumes: `FormDoc`, `SchemaNode`, `UiEntry`; `escapeHtml`; `setOptions`, `getOptions` (`./editOps`); `findNode`, `getPages`, `getWidget`, `widgetOf` (`./schemaWalk`); `getWidgetDef`, `widgetKind`, `WIDGET_CATALOG`.
- Produces:
  ```ts
  interface InsertLocation { parent: string | null; after: string | null }  // parent null = top level; after null = append at end
  interface LocationOption { id: string; label: string; loc: InsertLocation }
  allNames(doc): Set<string>                                   // schema node names + uiSchema keys
  validateName(doc, name): string | null                       // error message or null
  defaultNameAndTitle(doc, widgetId): { name: string; title: string }
  buildNewField(doc, widgetId): { node: SchemaNode; ui: UiEntry }   // throws on an unknown widget id
  switchWidget(node: SchemaNode, ui: UiEntry, widgetId: string): { node: SchemaNode; ui: UiEntry }
  findParentName(doc, name): string | null | undefined         // null = top level, undefined = not found
  canContain(doc, parentName: string, widgetId: string): boolean
  sameLocation(a: InsertLocation, b: InsertLocation): boolean
  resolveInsertion(doc, widgetId, selection: string | null, activePage: string | null): InsertLocation
  locationOptions(doc, widgetId, selection, activePage): LocationOption[]
  insertNode(doc, node: SchemaNode, ui: UiEntry, loc: InsertLocation): FormDoc   // throws on a duplicate name or unknown parent
  replaceNode(schema: FormDoc['schema'], node: SchemaNode): FormDoc['schema']
  ```
- Option ids: `after:<name>`, `in:<containerName>`, `end`. Labels: `After "<title>"`, `Inside "<title>"` (Group/Repeatable), `End of "<title>"` (Page), `End of form`.

- [ ] **Step 1: Write the failing tests**

`src/model/addField.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  allNames, buildNewField, canContain, defaultNameAndTitle, findParentName, insertNode, locationOptions,
  replaceNode, resolveInsertion, sameLocation, switchWidget, validateName,
} from './addField';
import { getOptions } from './editOps';
import type { FormDoc } from './types';

const doc = (): FormDoc => ({
  schema: {
    type: 'object',
    properties: [
      { name: 'p', type: 'object', title: 'Page one', properties: [
        { name: 'a', type: 'string', title: 'A' },
        { name: 'grp', type: 'object', title: 'Group', properties: [{ name: 'g1', type: 'string', title: 'G1' }] },
        { name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'r1', type: 'string', title: 'R1' }] },
      ] },
      { name: 'q', type: 'object', title: 'Page two', properties: [] },
    ],
  },
  uiSchema: {
    p: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' }, grp: { 'ui:widget': 'Group' }, g1: { 'ui:widget': 'TextBox' },
    rep: { 'ui:widget': 'Repeatable' }, r1: { 'ui:widget': 'TextBox' }, q: { 'ui:widget': 'Page' }, ghost: { 'ui:widget': 'TextBox' },
  },
});

describe('names (Review Focus 1)', () => {
  it('collects schema node names and uiSchema-only keys', () => {
    const n = allNames(doc());
    for (const k of ['p', 'a', 'grp', 'g1', 'rep', 'r1', 'q', 'ghost']) expect(n.has(k), k).toBe(true);
  });
  it('accepts a good name', () => {
    expect(validateName(doc(), 'owner_name2')).toBeNull();
  });
  it.each([
    ['', /required/i], ['  ', /required/i], ['1abc', /letter/i], ['a b', /letter|only/i], ['a-b', /letter|only/i],
    ['a', /already/i], ['grp', /already/i], ['ghost', /already/i],
    ['constructor', /reserved/i], ['toString', /reserved/i], ['hasOwnProperty', /reserved/i], ['__proto__', /letter|only/i],
  ])('rejects %j', (name, re) => {
    expect(validateName(doc(), name)).toMatch(re);
  });
  it('defaults to the first unused <widget><n> with a matching title', () => {
    expect(defaultNameAndTitle(doc(), 'TextBox')).toEqual({ name: 'textbox1', title: 'TextBox 1' });
    const d = doc();
    d.uiSchema.textbox1 = {};
    d.uiSchema.textbox2 = {};
    expect(defaultNameAndTitle(d, 'TextBox')).toEqual({ name: 'textbox3', title: 'TextBox 3' });
    expect(defaultNameAndTitle(doc(), 'CustomFormat')).toEqual({ name: 'customformat1', title: 'Custom format 1' });
    expect(defaultNameAndTitle(doc(), 'PdfWord')).toEqual({ name: 'pdfword1', title: 'Pdf/Word 1' });
  });
});

describe('buildNewField', () => {
  it('builds a labelled input with schema type, widget and margin', () => {
    const { node, ui } = buildNewField(doc(), 'Money');
    expect(node).toMatchObject({ name: 'money1', type: 'number', title: 'Money 1' });
    expect(ui['ui:widget']).toBe('Money');
    expect(ui['ui:formattedText']).toBe('<p>Money 1</p>');
    expect(ui['ui:marginBottom']).toBe('12px');
  });
  it('adds a date format for Date', () => {
    expect(buildNewField(doc(), 'Date').node.format).toBe('date');
  });
  it('seeds options for choice widgets, and the Repeatable defaults and an empty children list', () => {
    const radio = buildNewField(doc(), 'Radio');
    expect(getOptions(radio.ui, radio.node).map((o) => o.label)).toEqual(['Option 1', 'Option 2']);
    const rep = buildNewField(doc(), 'Repeatable');
    expect(rep.node.properties).toEqual([]);
    expect(rep.ui).toMatchObject({ 'ui:maxItems': 1, 'ui:itemName': 'row', 'ui:formattedText': '<p>Repeatable 1</p>' });
  });
  it('does not label Header, Page or Group', () => {
    for (const id of ['Header', 'Page', 'Group']) expect(buildNewField(doc(), id).ui['ui:formattedText']).toBeUndefined();
    expect(buildNewField(doc(), 'Header').ui['ui:heading']).toBe('Heading');
    expect(buildNewField(doc(), 'Page').node.properties).toEqual([]);
  });
  it('throws on an unknown widget id', () => {
    expect(() => buildNewField(doc(), 'Bogus')).toThrow();
  });
});

describe('switchWidget (Review Focus 5)', () => {
  it('updates the schema type/format and the widget id', () => {
    const { node, ui } = buildNewField(doc(), 'TextBox');
    const toInt = switchWidget(node, ui, 'Integer');
    expect(toInt.node.type).toBe('number');
    expect(toInt.ui['ui:widget']).toBe('Integer');
    const toDate = switchWidget(toInt.node, toInt.ui, 'Date');
    expect(toDate.node).toMatchObject({ type: 'string', format: 'date' });
    const back = switchWidget(toDate.node, toDate.ui, 'TextBox');
    expect('format' in back.node).toBe(false);
  });
  it('seeds options when switching to a choice widget with none, and Repeatable defaults for a Group', () => {
    const tb = buildNewField(doc(), 'TextBox');
    const radio = switchWidget(tb.node, tb.ui, 'Radio');
    expect(getOptions(radio.ui, radio.node)).toHaveLength(2);
    const g = buildNewField(doc(), 'Group');
    const r = switchWidget(g.node, g.ui, 'Repeatable');
    expect(r.node.type).toBe('array');
    expect(r.node.properties).toEqual([]);
    expect(r.ui).toMatchObject({ 'ui:maxItems': 1, 'ui:itemName': 'row' });
  });
  it('keeps existing Repeatable settings and children', () => {
    const node = { name: 'g', type: 'object' as const, title: 'G', properties: [{ name: 'c', type: 'string' as const, title: 'C' }] };
    const r = switchWidget(node, { 'ui:widget': 'Group', 'ui:maxItems': 4 }, 'Repeatable');
    expect(r.ui['ui:maxItems']).toBe(4);
    expect(r.node.properties).toHaveLength(1);
  });
  it('does not mutate its inputs', () => {
    const { node, ui } = buildNewField(doc(), 'TextBox');
    switchWidget(node, ui, 'Integer');
    expect(node.type).toBe('string');
    expect(ui['ui:widget']).toBe('TextBox');
  });
});

describe('parents and containment (Review Focus 2)', () => {
  it('finds parents', () => {
    expect(findParentName(doc(), 'a')).toBe('p');
    expect(findParentName(doc(), 'g1')).toBe('grp');
    expect(findParentName(doc(), 'p')).toBeNull();
    expect(findParentName(doc(), 'nope')).toBeUndefined();
  });
  it('lets fields into Page/Group/Repeatable but never a Page below the top, or a Repeatable inside a Repeatable', () => {
    expect(canContain(doc(), 'p', 'TextBox')).toBe(true);
    expect(canContain(doc(), 'grp', 'Repeatable')).toBe(true);
    expect(canContain(doc(), 'rep', 'TextBox')).toBe(true);
    expect(canContain(doc(), 'rep', 'Repeatable')).toBe(false);
    expect(canContain(doc(), 'p', 'Page')).toBe(false);
  });
  it('blocks a Repeatable inside a Group that sits inside a Repeatable', () => {
    const d = doc();
    d.schema.properties[0].properties![2].properties!.push({ name: 'inner', type: 'object', title: 'Inner', properties: [] });
    d.uiSchema.inner = { 'ui:widget': 'Group' };
    expect(canContain(d, 'inner', 'Repeatable')).toBe(false);
    expect(canContain(d, 'inner', 'TextBox')).toBe(true);
  });
});

describe('resolveInsertion (Review Focus 2)', () => {
  it('goes after the selected field in its parent', () => {
    expect(resolveInsertion(doc(), 'TextBox', 'a', 'p')).toEqual({ parent: 'p', after: 'a' });
    expect(resolveInsertion(doc(), 'TextBox', 'g1', 'p')).toEqual({ parent: 'grp', after: 'g1' });
  });
  it('goes inside a selected Repeatable (at the end) for non-Repeatable widgets', () => {
    expect(resolveInsertion(doc(), 'TextBox', 'rep', 'p')).toEqual({ parent: 'rep', after: null });
  });
  it('never nests a Repeatable: after the selected Repeatable, or the end of the active page from inside one', () => {
    expect(resolveInsertion(doc(), 'Repeatable', 'rep', 'p')).toEqual({ parent: 'p', after: 'rep' });
    expect(resolveInsertion(doc(), 'Repeatable', 'r1', 'p')).toEqual({ parent: 'p', after: null });
  });
  it('uses the end of the active page with no selection, and the first page if the active one is missing', () => {
    expect(resolveInsertion(doc(), 'TextBox', null, 'q')).toEqual({ parent: 'q', after: null });
    expect(resolveInsertion(doc(), 'TextBox', null, null)).toEqual({ parent: 'p', after: null });
    expect(resolveInsertion(doc(), 'TextBox', 'nope', 'zzz')).toEqual({ parent: 'p', after: null });
  });
  it('puts a Page after the active page, or at the end', () => {
    expect(resolveInsertion(doc(), 'Page', 'a', 'p')).toEqual({ parent: null, after: 'p' });
    expect(resolveInsertion(doc(), 'Page', null, null)).toEqual({ parent: null, after: 'q' });
  });
  it('appends at the top level when the doc has no pages', () => {
    const none: FormDoc = { schema: { type: 'object', properties: [{ name: 'x', type: 'string', title: 'X' }] }, uiSchema: { x: { 'ui:widget': 'TextBox' } } };
    expect(resolveInsertion(none, 'TextBox', null, null)).toEqual({ parent: null, after: null });
    expect(resolveInsertion(none, 'TextBox', 'x', null)).toEqual({ parent: null, after: 'x' });
  });
});

describe('locationOptions', () => {
  const ids = (id: string, sel: string | null, page: string | null) => locationOptions(doc(), id, sel, page).map((o) => o.id);
  it('lists after-selected first, then every container that can hold the widget', () => {
    expect(ids('TextBox', 'a', 'p')).toEqual(['after:a', 'in:p', 'in:grp', 'in:rep', 'in:q']);
  });
  it('omits Repeatable targets when adding a Repeatable', () => {
    expect(ids('Repeatable', 'a', 'p')).toEqual(['after:a', 'in:p', 'in:grp', 'in:q']);
  });
  it('lists only page positions for a Page', () => {
    expect(ids('Page', 'a', 'p')).toEqual(['after:p', 'after:q', 'end']);
  });
  it('offers the end of the form when there are no pages', () => {
    const none: FormDoc = { schema: { type: 'object', properties: [] }, uiSchema: {} };
    expect(locationOptions(none, 'TextBox', null, null).map((o) => o.id)).toEqual(['end']);
  });
  it('labels containers with their titles and the default option matches resolveInsertion', () => {
    const opts = locationOptions(doc(), 'TextBox', 'a', 'p');
    expect(opts.find((o) => o.id === 'in:grp')?.label).toBe('Inside "Group"');
    expect(opts.find((o) => o.id === 'in:p')?.label).toBe('End of "Page one"');
    const def = resolveInsertion(doc(), 'TextBox', 'a', 'p');
    expect(opts.some((o) => sameLocation(o.loc, def))).toBe(true);
  });
});

describe('insertNode (Review Focus 2)', () => {
  const field = { name: 'newf', type: 'string' as const, title: 'New' };
  const ui = { 'ui:widget': 'TextBox' };
  const names = (d: FormDoc, parent: string) => d.schema.properties.find((n) => n.name === parent)!.properties!.map((n) => n.name);

  it('inserts after a sibling and records the ui entry', () => {
    const d = insertNode(doc(), field, ui, { parent: 'p', after: 'a' });
    expect(names(d, 'p')).toEqual(['a', 'newf', 'grp', 'rep']);
    expect(d.uiSchema.newf).toEqual(ui);
  });
  it('appends when `after` is null or unknown, including after the last child', () => {
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: null }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: 'rep' }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: 'zzz' }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
  });
  it('inserts into an empty page and into nested containers', () => {
    expect(names(insertNode(doc(), field, ui, { parent: 'q', after: null }), 'q')).toEqual(['newf']);
    const d = insertNode(doc(), field, ui, { parent: 'grp', after: 'g1' });
    expect(d.schema.properties[0].properties![1].properties!.map((n) => n.name)).toEqual(['g1', 'newf']);
    const r = insertNode(doc(), field, ui, { parent: 'rep', after: null });
    expect(r.schema.properties[0].properties![2].properties!.map((n) => n.name)).toEqual(['r1', 'newf']);
  });
  it('inserts a Page at the top level between pages', () => {
    const page = { name: 'mid', type: 'object' as const, title: 'Mid', properties: [] };
    const d = insertNode(doc(), page, { 'ui:widget': 'Page' }, { parent: null, after: 'p' });
    expect(d.schema.properties.map((n) => n.name)).toEqual(['p', 'mid', 'q']);
  });
  it('does not mutate the original doc', () => {
    const d0 = doc();
    insertNode(d0, field, ui, { parent: 'p', after: 'a' });
    expect(names(d0, 'p')).toEqual(['a', 'grp', 'rep']);
    expect(d0.uiSchema.newf).toBeUndefined();
  });
  it('throws on a duplicate name or an unknown parent', () => {
    expect(() => insertNode(doc(), { ...field, name: 'a' }, ui, { parent: 'p', after: null })).toThrow(/already/i);
    expect(() => insertNode(doc(), field, ui, { parent: 'nope', after: null })).toThrow(/parent/i);
  });
});

describe('replaceNode', () => {
  it('replaces a nested node by name, immutably', () => {
    const d = doc();
    const next = replaceNode(d.schema, { name: 'g1', type: 'number', title: 'G1' });
    expect(next.properties[0].properties![1].properties![0].type).toBe('number');
    expect(d.schema.properties[0].properties![1].properties![0].type).toBe('string');
  });
  it('returns an equal schema when the node is unknown', () => {
    expect(replaceNode(doc().schema, { name: 'zzz', type: 'string', title: 'Z' })).toEqual(doc().schema);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/addField.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/model/addField.ts`**

```ts
import { getOptions, setOptions } from './editOps';
import { escapeHtml } from './html';
import { findNode, getPages, getWidget, widgetOf } from './schemaWalk';
import type { FormDoc, SchemaNode, UiEntry, UiSchema } from './types';
import { getWidgetDef, WIDGET_CATALOG, widgetKind } from './widgetCatalog';

export interface InsertLocation {
  /** Container name, or null for the top level. */
  parent: string | null;
  /** Sibling to insert after, or null to append at the end. */
  after: string | null;
}

export interface LocationOption {
  id: string;
  label: string;
  loc: InsertLocation;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const UNLABELLED = new Set(['Header', 'Page', 'Group']);

/** Every name already in use: schema nodes and uiSchema keys. */
export function allNames(doc: FormDoc): Set<string> {
  const names = new Set<string>(Object.keys(doc.uiSchema));
  const visit = (nodes: SchemaNode[]) =>
    nodes.forEach((n) => {
      names.add(n.name);
      if (n.properties) visit(n.properties);
    });
  visit(doc.schema.properties);
  return names;
}

export function validateName(doc: FormDoc, name: string): string | null {
  if (name.trim() === '') return 'Name is required';
  if (!NAME_RE.test(name)) return 'Use letters, digits and _ only (must start with a letter)';
  if (name in Object.prototype) return 'Reserved name';
  if (allNames(doc).has(name)) return `"${name}" is already used`;
  return null;
}

export function defaultNameAndTitle(doc: FormDoc, widgetId: string): { name: string; title: string } {
  const used = allNames(doc);
  const base = widgetId.toLowerCase();
  let n = 1;
  while (used.has(`${base}${n}`)) n += 1;
  const label = getWidgetDef(widgetId)?.label ?? widgetId;
  return { name: `${base}${n}`, title: `${label} ${n}` };
}

export function buildNewField(doc: FormDoc, widgetId: string): { node: SchemaNode; ui: UiEntry } {
  const def = getWidgetDef(widgetId);
  if (!def) throw new Error(`Unknown widget "${widgetId}"`);
  const { name, title } = defaultNameAndTitle(doc, widgetId);
  const node: SchemaNode = { name, type: def.schema.type, title };
  if (def.schema.format) node.format = def.schema.format;
  if (def.kind === 'container') node.properties = [];
  const ui: UiEntry = { ...def.defaults };
  if (!UNLABELLED.has(widgetId)) ui['ui:formattedText'] = `<p>${escapeHtml(title)}</p>`;
  return { node, ui };
}

/** Switch a field's widget, keeping its schema node consistent. Pure: returns new objects. */
export function switchWidget(node: SchemaNode, ui: UiEntry, widgetId: string): { node: SchemaNode; ui: UiEntry } {
  const def = getWidgetDef(widgetId);
  if (!def) return { node, ui: { ...ui, 'ui:widget': widgetId } };
  const nextNode: SchemaNode = { ...node, type: def.schema.type };
  if (def.schema.format) nextNode.format = def.schema.format;
  else delete nextNode.format;
  if (def.kind === 'container' && !nextNode.properties) nextNode.properties = [];

  let nextUi: UiEntry = { ...ui, 'ui:widget': widgetId };
  if (widgetId === 'Repeatable') {
    if (nextUi['ui:maxItems'] === undefined) nextUi['ui:maxItems'] = 1;
    if (nextUi['ui:itemName'] === undefined) nextUi['ui:itemName'] = 'row';
  }
  if ((widgetId === 'Radio' || widgetId === 'Dropdown' || widgetId === 'MultipleCheckbox' || widgetId === 'MultipleSuggest') && getOptions(nextUi, nextNode).length === 0) {
    const seeded = setOptions({ x: nextUi }, 'x', [
      { value: 'option_1', label: 'Option 1' },
      { value: 'option_2', label: 'Option 2' },
    ]);
    nextUi = seeded.x;
  }
  return { node: nextNode, ui: nextUi };
}

/** null = top level, undefined = no such node. */
export function findParentName(doc: FormDoc, name: string): string | null | undefined {
  const visit = (nodes: SchemaNode[], parent: string | null): string | null | undefined => {
    for (const n of nodes) {
      if (n.name === name) return parent;
      const hit = n.properties ? visit(n.properties, n.name) : undefined;
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return visit(doc.schema.properties, null);
}

function isInsideRepeatable(doc: FormDoc, name: string | null): boolean {
  let cur: string | null | undefined = name;
  while (cur) {
    const node = findNode(doc.schema.properties, cur);
    if (node && getWidget(doc, node) === 'Repeatable') return true;
    cur = findParentName(doc, cur);
  }
  return false;
}

/** Can container `parentName` hold a new widget `widgetId`? */
export function canContain(doc: FormDoc, parentName: string, widgetId: string): boolean {
  const parent = findNode(doc.schema.properties, parentName);
  if (!parent || widgetKind(getWidget(doc, parent)) !== 'container') return false;
  if (widgetId === 'Page') return false;
  if (widgetId === 'Repeatable' && isInsideRepeatable(doc, parentName)) return false;
  return true;
}

export const sameLocation = (a: InsertLocation, b: InsertLocation): boolean => a.parent === b.parent && a.after === b.after;

export function resolveInsertion(
  doc: FormDoc,
  widgetId: string,
  selection: string | null,
  activePage: string | null,
): InsertLocation {
  const pages = getPages(doc);
  if (widgetId === 'Page') return { parent: null, after: activePage ?? pages[pages.length - 1]?.name ?? null };

  const sel = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (sel) {
    if (getWidget(doc, sel) === 'Repeatable' && canContain(doc, sel.name, widgetId)) return { parent: sel.name, after: null };
    const parent = findParentName(doc, sel.name);
    if (parent === null && pages.length === 0) return { parent: null, after: sel.name };
    if (parent && canContain(doc, parent, widgetId)) return { parent, after: sel.name };
  }
  const page = pages.find((p) => p.name === activePage) ?? pages[0];
  return { parent: page?.name ?? null, after: null };
}

export function locationOptions(
  doc: FormDoc,
  widgetId: string,
  selection: string | null,
  activePage: string | null,
): LocationOption[] {
  const pages = getPages(doc);
  if (widgetId === 'Page') {
    return [
      ...pages.map((p) => ({ id: `after:${p.name}`, label: `After "${p.title}"`, loc: { parent: null, after: p.name } })),
      { id: 'end', label: 'End of form', loc: { parent: null, after: null } },
    ];
  }
  const out: LocationOption[] = [];
  const sel = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (sel) {
    const parent = findParentName(doc, sel.name);
    if (parent && canContain(doc, parent, widgetId)) out.push({ id: `after:${sel.name}`, label: `After "${sel.title}"`, loc: { parent, after: sel.name } });
    else if (parent === null && pages.length === 0) out.push({ id: `after:${sel.name}`, label: `After "${sel.title}"`, loc: { parent: null, after: sel.name } });
  }
  const visit = (nodes: SchemaNode[]) => {
    for (const n of nodes) {
      const w = getWidget(doc, n);
      if (widgetKind(w) === 'container' && canContain(doc, n.name, widgetId)) {
        out.push({ id: `in:${n.name}`, label: w === 'Page' ? `End of "${n.title}"` : `Inside "${n.title}"`, loc: { parent: n.name, after: null } });
      }
      if (n.properties) visit(n.properties);
    }
  };
  visit(doc.schema.properties);
  if (pages.length === 0) out.push({ id: 'end', label: 'End of form', loc: { parent: null, after: null } });
  void activePage;
  return out;
}

function place(list: SchemaNode[], after: string | null, node: SchemaNode): SchemaNode[] {
  const i = after === null ? -1 : list.findIndex((n) => n.name === after);
  const at = i < 0 ? list.length : i + 1;
  return [...list.slice(0, at), node, ...list.slice(at)];
}

function insertInto(nodes: SchemaNode[], parent: string, after: string | null, node: SchemaNode): SchemaNode[] {
  return nodes.map((n) => {
    if (n.name === parent) return { ...n, properties: place(n.properties ?? [], after, node) };
    return n.properties ? { ...n, properties: insertInto(n.properties, parent, after, node) } : n;
  });
}

export function insertNode(doc: FormDoc, node: SchemaNode, ui: UiEntry, loc: InsertLocation): FormDoc {
  if (allNames(doc).has(node.name)) throw new Error(`"${node.name}" is already used`);
  let properties: SchemaNode[];
  if (loc.parent === null) properties = place(doc.schema.properties, loc.after, node);
  else {
    if (!findNode(doc.schema.properties, loc.parent)) throw new Error(`Unknown parent "${loc.parent}"`);
    properties = insertInto(doc.schema.properties, loc.parent, loc.after, node);
  }
  const uiSchema: UiSchema = { ...doc.uiSchema, [node.name]: ui };
  return { ...doc, schema: { ...doc.schema, properties }, uiSchema };
}

/** Replace the node with the same name (anywhere in the tree), immutably. */
export function replaceNode(schema: FormDoc['schema'], node: SchemaNode): FormDoc['schema'] {
  const swap = (nodes: SchemaNode[]): SchemaNode[] =>
    nodes.map((n) => (n.name === node.name ? node : n.properties ? { ...n, properties: swap(n.properties) } : n));
  return { ...schema, properties: swap(schema.properties) };
}
```
Remove the stray `void activePage;` line and the unused `activePage` parameter's usage only if the typechecker complains; otherwise keep the parameter (it keeps the signature symmetric with `resolveInsertion`). Also remove the unused imports `WIDGET_CATALOG` and `widgetOf` if `tsc` reports them.

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): add-field names, builders, widget switch, and insertion" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Export and load metadata

**Files:**
- Create: `src/model/exportForm.ts`
- Modify: `src/model/loadForm.ts`
- Test: `src/model/exportForm.test.ts`; append to `src/model/loadForm.test.ts`

**Interfaces:**
- Consumes: `FormDoc`; `loadForm` (for the round trip in tests); `insertNode`, `buildNewField`.
- Produces: `loadForm` now returns `{ schema, uiSchema, namespace: ns, source: raw }`. `buildExport(doc: FormDoc): unknown`; `exportJsonText(doc: FormDoc): string` (2-space JSON); `EXPORT_FILE_NAME = 'form-content-edited.json'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/model/loadForm.test.ts`:
```ts
describe('loadForm remembers where it came from', () => {
  it('records the namespace and the raw source', () => {
    const doc = loadForm(demo);
    expect(doc.namespace).toBe('main');
    expect(doc.source).toBe(demo);
  });
  it('records the fallback namespace when defaultNamespace is missing', () => {
    const raw = { namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } };
    expect(loadForm(raw).namespace).toBe('alt');
  });
});
```

`src/model/exportForm.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { buildNewField, insertNode } from './addField';
import { buildExport, EXPORT_FILE_NAME, exportJsonText } from './exportForm';
import { loadForm } from './loadForm';
import type { FormDoc } from './types';

describe('export round trip', () => {
  it('re-loads to an identical form', () => {
    const doc = loadForm(demo);
    const back = loadForm(JSON.parse(exportJsonText(doc)));
    expect(back.schema).toEqual(doc.schema);
    expect(back.uiSchema).toEqual(doc.uiSchema);
  });
  it('carries rules, libs and other top-level keys through untouched', () => {
    const out = buildExport(loadForm(demo)) as Record<string, unknown>;
    const src = demo as unknown as Record<string, unknown>;
    expect(out.rules).toEqual(src.rules);
    expect(out.libs).toEqual(src.libs);
    expect(out.defaultNamespace).toBe(src.defaultNamespace);
  });
  it('includes added fields and edited metadata', () => {
    const doc0 = loadForm(demo);
    const { node, ui } = buildNewField(doc0, 'Email');
    const doc = insertNode(doc0, node, { ...ui, 'ui:custom': 5 }, { parent: 'demoform', after: 'partnership' });
    const back = loadForm(JSON.parse(exportJsonText(doc)));
    const names = back.schema.properties[1].properties!.map((n) => n.name);
    expect(names.indexOf('email1')).toBe(names.indexOf('partnership') + 1);
    expect(back.uiSchema.email1['ui:custom']).toBe(5);
  });
  it('does not mutate the source or the doc', () => {
    const doc = loadForm(demo);
    const before = JSON.stringify(demo);
    buildExport(doc);
    expect(JSON.stringify(demo)).toBe(before);
  });
  it('emits a minimal valid export when the doc has no source', () => {
    const doc: FormDoc = { schema: { type: 'object', properties: [{ name: 'a', type: 'string', title: 'A' }] }, uiSchema: { a: { 'ui:widget': 'TextBox' } } };
    const out = buildExport(doc) as { defaultNamespace: string; namespaceFormSchemaMap: Record<string, unknown> };
    expect(out.defaultNamespace).toBe('main');
    expect(Object.keys(out.namespaceFormSchemaMap)).toEqual(['main']);
    expect(loadForm(JSON.parse(exportJsonText(doc))).schema.properties[0].name).toBe('a');
  });
  it('respects the doc namespace', () => {
    const doc = loadForm({ namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } });
    const out = buildExport(doc) as { namespaceFormSchemaMap: Record<string, unknown> };
    expect(Object.keys(out.namespaceFormSchemaMap)).toEqual(['alt']);
  });
  it('uses a stable file name', () => {
    expect(EXPORT_FILE_NAME).toBe('form-content-edited.json');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/exportForm.test.ts src/model/loadForm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/model/loadForm.ts`, change the return statement of `loadForm` to:
```ts
  return {
    schema: { type: 'object', properties: normalizeNodes(entry.schema.properties, 'schema.properties') },
    uiSchema,
    namespace: ns,
    source: raw,
  };
```

`src/model/exportForm.ts`:
```ts
import type { FormDoc } from './types';

export const EXPORT_FILE_NAME = 'form-content-edited.json';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The loaded export with only `schema.properties` and `uiSchema` replaced by the current ones, so
 * rules, libs and every other top-level key carry through. Falls back to a minimal export.
 */
export function buildExport(doc: FormDoc): unknown {
  const ns = doc.namespace ?? 'main';
  const base: Record<string, unknown> = isObj(doc.source) ? structuredClone(doc.source) : { defaultNamespace: ns };
  const map: Record<string, unknown> = isObj(base.namespaceFormSchemaMap) ? base.namespaceFormSchemaMap : {};
  const entry = isObj(map[ns]) ? (map[ns] as Record<string, unknown>) : {};
  const schema = isObj(entry.schema) ? entry.schema : {};
  map[ns] = {
    ...entry,
    schema: { ...schema, type: 'object', properties: doc.schema.properties },
    uiSchema: doc.uiSchema,
  };
  base.namespaceFormSchemaMap = map;
  return base;
}

export function exportJsonText(doc: FormDoc): string {
  return JSON.stringify(buildExport(doc), null, 2);
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): export form JSON and record namespace/source on load" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Reducer: adding, addNode, editDoc, row actions

**Files:**
- Modify: `src/state/formReducer.ts`, `src/state/formReducer.test.ts`, `src/components/PropertiesDrawer.tsx` (rename the dispatch only)

**Interfaces:**
- Consumes: `insertNode`, `InsertLocation` (`../model/addField`); `addRow`, `removeRow`, `setRowValue`, `maxItemsOf` (`../model/rows`); `getWidget`, `isSelectable`, `getPages` (`../model/schemaWalk`).
- Produces: `FormState` adds `adding: { widget: string } | null`. `Action` adds `startAdd { widget }`, `cancelAdd`, `addNode { node, ui, loc }`, `setRowValue { rep, index, name, value }`, `addRow { rep }`, `removeRow { rep, index }`, and **replaces** `editUi` with `editDoc { schema?: FormDoc['schema']; uiSchema?: UiSchema }`. `select` also sets `adding` to `null`; `loadDoc` resets `adding`.

- [ ] **Step 1: Update the tests**

In `src/state/formReducer.test.ts`: replace the `editUi` test with
```ts
  it('editDoc replaces uiSchema and/or schema', () => {
    const edited = { ...doc.uiSchema, a: { 'ui:widget': 'Money' } };
    let s = formReducer(fresh(), { type: 'editDoc', uiSchema: edited });
    expect(s.doc.uiSchema.a['ui:widget']).toBe('Money');
    expect(s.doc.schema).toBe(doc.schema);
    const schema = { type: 'object' as const, properties: [] };
    s = formReducer(s, { type: 'editDoc', schema });
    expect(s.doc.schema).toBe(schema);
    expect(s.doc.uiSchema).toBe(edited);
  });
```
and append:
```ts
import { buildNewField } from '../model/addField';

describe('adding fields', () => {
  it('startAdd opens the add panel and keeps the selection; cancelAdd closes it; select closes it', () => {
    let s = formReducer(fresh(), { type: 'select', name: 'a' });
    s = formReducer(s, { type: 'startAdd', widget: 'Email' });
    expect(s.adding).toEqual({ widget: 'Email' });
    expect(s.selection).toBe('a');
    expect(formReducer(s, { type: 'cancelAdd' }).adding).toBeNull();
    expect(formReducer(s, { type: 'select', name: 'b' }).adding).toBeNull();
  });
  it('addNode inserts, selects the new field and closes the panel', () => {
    const { node, ui } = buildNewField(doc, 'Email');
    let s = formReducer(fresh(), { type: 'startAdd', widget: 'Email' });
    s = formReducer(s, { type: 'addNode', node, ui, loc: { parent: 'p', after: 'a' } });
    expect(s.doc.schema.properties[0].properties!.map((n) => n.name)).toEqual(['a', 'email1', 'b']);
    expect(s.doc.uiSchema.email1['ui:widget']).toBe('Email');
    expect(s.selection).toBe('email1');
    expect(s.adding).toBeNull();
  });
  it('addNode of a Page makes it the active page and leaves nothing selected', () => {
    const { node, ui } = buildNewField(doc, 'Page');
    const s = formReducer(fresh(), { type: 'addNode', node, ui, loc: { parent: null, after: 'p' } });
    expect(s.activePage).toBe('page1');
    expect(s.selection).toBeNull();
    expect(s.doc.schema.properties.map((n) => n.name)).toEqual(['p', 'page1']);
  });
  it('loadDoc clears the add panel', () => {
    let s = formReducer(fresh(), { type: 'startAdd', widget: 'Email' });
    s = formReducer(s, { type: 'loadDoc', doc: { schema: { type: 'object', properties: [] }, uiSchema: {} } });
    expect(s.adding).toBeNull();
  });
});

describe('repeatable rows (Review Focus 3)', () => {
  const repDoc: FormDoc = {
    schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'c', type: 'string', title: 'C' }] }] },
    uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:maxItems': 2 }, c: { 'ui:widget': 'TextBox' } },
  };
  const start = () => initialState(repDoc);
  it('setRowValue writes into a row, materialising the array', () => {
    const s = formReducer(start(), { type: 'setRowValue', rep: 'rep', index: 0, name: 'c', value: 'x' });
    expect(s.values.rep).toEqual([{ c: 'x' }]);
  });
  it('addRow respects ui:maxItems and removeRow keeps the last row', () => {
    let s = formReducer(start(), { type: 'addRow', rep: 'rep' });
    expect(s.values.rep).toEqual([{}, {}]);
    const atMax = formReducer(s, { type: 'addRow', rep: 'rep' });
    expect(atMax).toBe(s);
    s = formReducer(s, { type: 'removeRow', rep: 'rep', index: 0 });
    expect(s.values.rep).toEqual([{}]);
    const last = formReducer(s, { type: 'removeRow', rep: 'rep', index: 0 });
    expect(last).toBe(s);
  });
  it('treats a missing or bad ui:maxItems as 1 (no extra rows)', () => {
    const d: FormDoc = { ...repDoc, uiSchema: { ...repDoc.uiSchema, rep: { 'ui:widget': 'Repeatable', 'ui:maxItems': 0 } } };
    const s = initialState(d);
    expect(formReducer(s, { type: 'addRow', rep: 'rep' })).toBe(s);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/state/formReducer.test.ts`
Expected: FAIL (unknown action types / missing `adding`).

- [ ] **Step 3: Implement**

Replace `src/state/formReducer.ts` with:
```ts
import { insertNode, type InsertLocation } from '../model/addField';
import { addRow, maxItemsOf, removeRow, setRowValue } from '../model/rows';
import { getPages, getWidget, isSelectable } from '../model/schemaWalk';
import type { FormDoc, SchemaNode, UiEntry, UiSchema, Values } from '../model/types';

export interface FormState {
  doc: FormDoc;
  values: Values;
  selection: string | null;
  showInvisible: boolean;
  activePage: string | null;
  /** Set while the Add field panel is open; the widget id picked in the picker. */
  adding: { widget: string } | null;
  notice: string | null;
}

export type Action =
  | { type: 'setValue'; name: string; value: unknown }
  | { type: 'setRowValue'; rep: string; index: number; name: string; value: unknown }
  | { type: 'addRow'; rep: string }
  | { type: 'removeRow'; rep: string; index: number }
  | { type: 'editDoc'; schema?: FormDoc['schema']; uiSchema?: UiSchema }
  | { type: 'select'; name: string | null }
  | { type: 'startAdd'; widget: string }
  | { type: 'cancelAdd' }
  | { type: 'addNode'; node: SchemaNode; ui: UiEntry; loc: InsertLocation }
  | { type: 'toggleInvisible' }
  | { type: 'setPage'; name: string }
  | { type: 'loadDoc'; doc: FormDoc }
  | { type: 'notify'; message: string }
  | { type: 'dismissNotice' };

export function initialState(doc: FormDoc): FormState {
  return {
    doc,
    values: {},
    selection: null,
    showInvisible: false,
    activePage: getPages(doc, false)[0]?.name ?? null,
    adding: null,
    notice: null,
  };
}

export function formReducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'setValue':
      return { ...state, values: { ...state.values, [action.name]: action.value } };
    case 'setRowValue': {
      const values = setRowValue(state.values, action.rep, action.index, action.name, action.value);
      return values === state.values ? state : { ...state, values };
    }
    case 'addRow': {
      const values = addRow(state.values, action.rep, maxItemsOf(state.doc, action.rep));
      return values === state.values ? state : { ...state, values };
    }
    case 'removeRow': {
      const values = removeRow(state.values, action.rep, action.index);
      return values === state.values ? state : { ...state, values };
    }
    case 'editDoc':
      return {
        ...state,
        doc: {
          ...state.doc,
          schema: action.schema ?? state.doc.schema,
          uiSchema: action.uiSchema ?? state.doc.uiSchema,
        },
      };
    case 'select':
      return { ...state, selection: action.name, adding: null };
    case 'startAdd':
      return { ...state, adding: { widget: action.widget } };
    case 'cancelAdd':
      return { ...state, adding: null };
    case 'addNode': {
      const doc = insertNode(state.doc, action.node, action.ui, action.loc);
      const widget = getWidget(doc, action.node);
      return {
        ...state,
        doc,
        adding: null,
        selection: isSelectable(widget) ? action.node.name : null,
        activePage: widget === 'Page' ? action.node.name : state.activePage,
      };
    }
    case 'toggleInvisible': {
      const showInvisible = !state.showInvisible;
      const pages = getPages(state.doc, showInvisible);
      const stillValid = pages.some((p) => p.name === state.activePage);
      return {
        ...state,
        showInvisible,
        activePage: stillValid ? state.activePage : (pages[0]?.name ?? null),
      };
    }
    case 'setPage':
      return { ...state, activePage: action.name };
    case 'loadDoc':
      return { ...initialState(action.doc), showInvisible: state.showInvisible };
    case 'notify':
      return { ...state, notice: action.message };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}
```

In `src/components/PropertiesDrawer.tsx` change the `edit` helper's dispatch to `dispatch({ type: 'editDoc', uiSchema })` (it is fully replaced in Task 11; this only keeps the build green).

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(state): adding panel state, addNode, editDoc, and repeatable row actions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: New widgets and the registry

**Files:**
- Modify: `src/widgets/shared.ts`, `src/widgets/NumberInputs.tsx`, `src/widgets/Misc.tsx`, `src/widgets/registry.ts`, `src/widgets/registry.test.ts`, `src/components/FieldRenderer.tsx` (pass the new props)
- Create: `src/widgets/DraftField.tsx`, `src/widgets/TextValidated.tsx`, `src/widgets/Geo.tsx`, `src/widgets/MultiChoice.tsx`, `src/widgets/Static.tsx`, `src/widgets/Placeholder.tsx`, `src/widgets/Repeatable.tsx`

**Interfaces:**
- Consumes: resolvers (`../model/draft`), parsers/formatters (`../model/format`), `COUNTRIES`, `US_STATES`, `getRows`, `maxItemsOf`, `asStringArray`, `safeHref`, `labelText`, `useForm`.
- Produces:
  - `shared.ts`: `interface RowScope { rep: string; index: number }`; `WidgetProps` adds `topLevel?: boolean` and `renderChildren?: (scope?: RowScope) => ReactNode`.
  - `DraftField({ id, value, onChange, resolve, display?, editText?, errorText, inputMode? })`.
  - Widgets (each `(p: WidgetProps) => JSX`): `Money, Percentage, Integer, Float, Year` (NumberInputs), `Email, Phone, CustomFormat` (TextValidated), `Country, State` (Geo), `MultipleCheckbox, MultipleSuggest` (MultiChoice), `AnchorLink` (Static), `Signature, PdfWord, FileGroup, FileWidget` (Placeholder), `Repeatable` (Repeatable.tsx), `Unknown` (Misc, unchanged).
  - `registry.ts`: `resolveWidget(name)` returns a non-Unknown def for all 27 catalog ids. `hasLabel`: `false` for Page, Group, Header, Paragraph, AnchorLink, File; `true` for everything else (including Repeatable, Signature, PdfWord, FileGroup).
- Repeatable markup contract (used by CSS in Task 9): `.w-repeatable > .w-repeatable__row > (.w-repeatable__fields + .w-repeatable__trash > button)`, then `button.w-repeatable__add` (disabled at max). Trash is hidden when only one row. The add label is `⊕ Add another <itemName>`.

- [ ] **Step 1: Update the registry test (RED)**

Replace `src/widgets/registry.test.ts` with:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { WIDGET_CATALOG } from '../model/widgetCatalog';
import { Unknown } from './Misc';
import { resolveWidget } from './registry';

describe('registry (Review Focus 1)', () => {
  it('resolves every catalog widget to a real component', () => {
    for (const w of WIDGET_CATALOG) expect(resolveWidget(w.id).Component, w.id).not.toBe(Unknown);
  });
  it('resolves every widget used by the demo form', () => {
    const used = new Set(Object.values(demo.namespaceFormSchemaMap.main.uiSchema).map((u) => (u as Record<string, string>)['ui:widget']));
    expect(used.size).toBe(12);
    for (const w of used) expect(resolveWidget(w).Component).not.toBe(Unknown);
  });
  it('falls back to Unknown (with a label) for unrecognised widgets, including prototype-chain names', () => {
    for (const id of ['Bogus', 'constructor', 'toString', '__proto__']) {
      const def = resolveWidget(id);
      expect(def.Component, id).toBe(Unknown);
      expect(def.hasLabel).toBe(true);
    }
  });
  it('has labels exactly where the design says', () => {
    for (const id of ['Page', 'Group', 'Header', 'Paragraph', 'AnchorLink', 'File']) expect(resolveWidget(id).hasLabel, id).toBe(false);
    for (const id of ['Radio', 'Repeatable', 'Signature', 'PdfWord', 'FileGroup', 'Email', 'MultipleSuggest']) expect(resolveWidget(id).hasLabel, id).toBe(true);
  });
});
```
Run `npx vitest run src/widgets/registry.test.ts` and confirm it **fails** (new ids still resolve to Unknown).

- [ ] **Step 2: Implement shared types and DraftField**

`src/widgets/shared.ts` (replace):
```ts
import type { ReactNode } from 'react';
import type { Option, SchemaNode, UiEntry } from '../model/types';

/** Which row of which Repeatable a field instance belongs to. */
export interface RowScope {
  rep: string;
  index: number;
}

export interface WidgetProps {
  id: string;
  widget: string;
  node: SchemaNode;
  ui: UiEntry;
  value: unknown;
  onChange: (v: unknown) => void;
  options: Option[];
  /** True for nodes directly under the form root (e.g. the demo's PDF-template File node). */
  topLevel?: boolean;
  children?: ReactNode;
  /** Renders this node's children for a given row (Repeatable) or the current scope. */
  renderChildren?: (scope?: RowScope) => ReactNode;
}

export const toText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const uiString = (v: unknown): string => (typeof v === 'string' ? v : '');
```

`src/widgets/DraftField.tsx`:
```tsx
import { useEffect, useState } from 'react';
import type { DraftResult } from '../model/draft';
import { toText } from './shared';

interface Props {
  id: string;
  value: unknown;
  onChange: (v: unknown) => void;
  resolve: (draft: string, current: unknown) => DraftResult;
  /** Text shown when not editing. */
  display?: (v: unknown) => string;
  /** Text shown when editing starts. */
  editText?: (v: unknown) => string;
  errorText: string;
  inputMode?: 'decimal' | 'numeric' | 'email' | 'tel' | 'text';
}

/**
 * Free text while editing; committed on blur only. Text that does not resolve is never saved: it stays
 * visible and flagged, and the previously stored value is left alone.
 */
export function DraftField({ id, value, onChange, resolve, display = toText, editText = toText, errorText, inputMode }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => setDraft(null), [value]);
  const invalid = draft !== null && resolve(draft, value).kind === 'invalid';

  const commit = () => {
    setFocused(false);
    if (draft === null) return;
    const result = resolve(draft, value);
    if (result.kind === 'invalid') return;
    if (result.kind === 'set') onChange(result.value);
    setDraft(null);
  };

  return (
    <div className="w-number">
      <input
        id={id}
        className={`w-input${invalid ? ' w-input--invalid' : ''}`}
        inputMode={inputMode}
        value={draft ?? display(value)}
        onFocus={() => {
          setFocused(true);
          setDraft((d) => d ?? editText(value));
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      {invalid && !focused && <div className="w-error">{errorText}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Implement the widget files**

`src/widgets/NumberInputs.tsx` (replace):
```tsx
import { resolveIntegerDraft, resolveNumberDraft, resolveYearDraft, type DraftResult } from '../model/draft';
import { formatMoney, formatPercent } from '../model/format';
import { DraftField } from './DraftField';
import { toText, type WidgetProps } from './shared';

const show = (fmt: (n: number) => string) => (v: unknown) => (typeof v === 'number' ? fmt(v) : toText(v));
const edit = (v: unknown) => (typeof v === 'number' ? String(v) : toText(v));

function numeric(
  resolve: (draft: string, current: unknown) => DraftResult,
  fmt: (n: number) => string,
  errorText: string,
  inputMode: 'decimal' | 'numeric' = 'decimal',
) {
  return function NumericWidget(p: WidgetProps) {
    return (
      <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolve} display={show(fmt)} editText={edit} errorText={errorText} inputMode={inputMode} />
    );
  };
}

export const Money = numeric(resolveNumberDraft, formatMoney, 'Not a valid number, so it was not saved');
export const Percentage = numeric(resolveNumberDraft, formatPercent, 'Not a valid number, so it was not saved');
export const Float = numeric(resolveNumberDraft, String, 'Not a valid number, so it was not saved');
export const Integer = numeric(resolveIntegerDraft, String, 'Not a whole number, so it was not saved', 'numeric');
export const Year = numeric(resolveYearDraft, String, 'Not a 4-digit year, so it was not saved', 'numeric');
```

`src/widgets/TextValidated.tsx`:
```tsx
import { useMemo } from 'react';
import { resolveEmailDraft, resolvePatternDraft, resolvePhoneDraft } from '../model/draft';
import { DraftField } from './DraftField';
import type { WidgetProps } from './shared';

export function Email(p: WidgetProps) {
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolveEmailDraft} errorText="Not a valid email address, so it was not saved" inputMode="email" />;
}

export function Phone(p: WidgetProps) {
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolvePhoneDraft} errorText="Not a valid phone number, so it was not saved" inputMode="tel" />;
}

/** Validates against `ui:pattern` (a regex) when set; a missing or invalid pattern accepts any text. */
export function CustomFormat(p: WidgetProps) {
  const pattern = p.ui['ui:pattern'];
  const resolve = useMemo(() => resolvePatternDraft(pattern), [pattern]);
  return <DraftField id={p.id} value={p.value} onChange={p.onChange} resolve={resolve} errorText="Does not match the required format, so it was not saved" />;
}
```

`src/widgets/Geo.tsx`:
```tsx
import { COUNTRIES, US_STATES } from '../model/countries';
import { Dropdown } from './Choice';
import type { WidgetProps } from './shared';

export const Country = (p: WidgetProps) => <Dropdown {...p} options={COUNTRIES} />;
export const State = (p: WidgetProps) => <Dropdown {...p} options={US_STATES} />;
```

`src/widgets/MultiChoice.tsx`:
```tsx
import { useState } from 'react';
import { asStringArray } from '../model/format';
import type { WidgetProps } from './shared';

export function MultipleCheckbox({ ui, value, onChange, options }: WidgetProps) {
  const selected = asStringArray(value);
  const inline = ui['ui:fixedLayout'] === 'Inline';
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div className={`w-radio${inline ? ' w-radio--inline' : ''}`} role="group">
      {options.map((o) => (
        <label key={o.value} className="w-check__opt">
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
          <span className="w-check__box" />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function MultipleSuggest({ id, value, onChange, options }: WidgetProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = asStringArray(value);
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !selected.includes(o.value) && o.label.toLowerCase().includes(q)).slice(0, 8);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  return (
    <div className="w-suggest">
      {selected.length > 0 && (
        <div className="w-chips">
          {selected.map((v) => (
            <span key={v} className="w-chip">
              {labelOf(v)}
              <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={() => onChange(selected.filter((x) => x !== v))}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="w-input"
        placeholder="Type to search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && (
        <ul className="w-suggest__list">
          {matches.length === 0 ? (
            <li className="w-suggest__empty">No matches</li>
          ) : (
            matches.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange([...selected, o.value]);
                    setQuery('');
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
```

`src/widgets/Static.tsx`:
```tsx
import { labelText } from '../model/editOps';
import { safeHref } from '../model/format';
import type { WidgetProps } from './shared';

/** A link from `ui:href` (http, https, mailto or #); anything else renders as plain text. */
export function AnchorLink({ node, ui }: WidgetProps) {
  const href = safeHref(ui['ui:href']);
  const text = labelText(ui, node.title) || href || node.title;
  return href ? (
    <a className="w-link" href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <span className="w-link w-link--inert">{text}</span>
  );
}
```

`src/widgets/Placeholder.tsx`:
```tsx
import { uiString, type WidgetProps } from './shared';

function Box({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="w-placeholder">
      <strong>{title}</strong>
      <span>Not in prototype</span>
      {detail ? <em>{detail}</em> : null}
    </div>
  );
}

export const Signature = () => <Box title="Signature" />;
export const PdfWord = ({ ui }: WidgetProps) => <Box title="Pdf/Word" detail={uiString(ui['ui:fileName'])} />;
export const FileGroup = () => <Box title="FileGroup" />;

/** A top-level File node is the demo's PDF template: it renders nothing. A nested one is a placeholder. */
export function FileWidget({ node, ui, topLevel }: WidgetProps) {
  return topLevel ? null : <Box title={node.title || 'File'} detail={uiString(ui['ui:fileName'])} />;
}
```

`src/widgets/Repeatable.tsx`:
```tsx
import { getRows, maxItemsOf } from '../model/rows';
import { useForm } from '../state/useFormStore';
import { uiString, type WidgetProps } from './shared';

/** Rows of the Repeatable's child fields, up to `ui:maxItems`; the add button disables at the max. */
export function Repeatable({ node, renderChildren }: WidgetProps) {
  const { state, dispatch } = useForm();
  const rows = getRows(state.values, node.name);
  const max = maxItemsOf(state.doc, node.name);
  const itemName = uiString(state.doc.uiSchema[node.name]?.['ui:itemName']) || 'row';
  return (
    <div className="w-repeatable">
      {rows.map((_, index) => (
        <div className="w-repeatable__row" key={index}>
          <div className="w-repeatable__fields">{renderChildren?.({ rep: node.name, index })}</div>
          {rows.length > 1 && (
            <div className="w-repeatable__trash">
              <button
                type="button"
                aria-label={`Remove ${itemName} ${index + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: 'removeRow', rep: node.name, index });
                }}
              >
                🗑
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="w-repeatable__add"
        disabled={rows.length >= max}
        onClick={(e) => {
          e.stopPropagation();
          dispatch({ type: 'addRow', rep: node.name });
        }}
      >
        ⊕ Add another {itemName}
      </button>
    </div>
  );
}
```

`src/widgets/Misc.tsx` (replace; `FileWidget` moved to Placeholder):
```tsx
import type { WidgetProps } from './shared';

export function Unknown({ widget }: WidgetProps) {
  return <div className="w-unknown">Unsupported widget: {widget || '(none)'}</div>;
}
```

`src/widgets/registry.ts` (replace):
```ts
import type { ComponentType } from 'react';
import { Dropdown, Radio } from './Choice';
import { Group, Page } from './Containers';
import { DateWidget } from './DateWidget';
import { Country, State } from './Geo';
import { Header } from './Header';
import { Unknown } from './Misc';
import { MultipleCheckbox, MultipleSuggest } from './MultiChoice';
import { Float, Integer, Money, Percentage, Year } from './NumberInputs';
import { Paragraph } from './Paragraph';
import { FileGroup, FileWidget, PdfWord, Signature } from './Placeholder';
import { Repeatable } from './Repeatable';
import type { WidgetProps } from './shared';
import { AnchorLink } from './Static';
import { CustomFormat, Email, Phone } from './TextValidated';
import { TextArea, TextBox } from './TextInputs';

export interface WidgetDef {
  Component: ComponentType<WidgetProps>;
  hasLabel: boolean;
}

const WIDGETS: Record<string, WidgetDef> = {
  Page: { Component: Page, hasLabel: false },
  Group: { Component: Group, hasLabel: false },
  Repeatable: { Component: Repeatable, hasLabel: true },
  Header: { Component: Header, hasLabel: false },
  Paragraph: { Component: Paragraph, hasLabel: false },
  AnchorLink: { Component: AnchorLink, hasLabel: false },
  TextBox: { Component: TextBox, hasLabel: true },
  TextArea: { Component: TextArea, hasLabel: true },
  Integer: { Component: Integer, hasLabel: true },
  Float: { Component: Float, hasLabel: true },
  Year: { Component: Year, hasLabel: true },
  Money: { Component: Money, hasLabel: true },
  Percentage: { Component: Percentage, hasLabel: true },
  Email: { Component: Email, hasLabel: true },
  Phone: { Component: Phone, hasLabel: true },
  CustomFormat: { Component: CustomFormat, hasLabel: true },
  Date: { Component: DateWidget, hasLabel: true },
  Radio: { Component: Radio, hasLabel: true },
  Dropdown: { Component: Dropdown, hasLabel: true },
  MultipleCheckbox: { Component: MultipleCheckbox, hasLabel: true },
  MultipleSuggest: { Component: MultipleSuggest, hasLabel: true },
  Country: { Component: Country, hasLabel: true },
  State: { Component: State, hasLabel: true },
  Signature: { Component: Signature, hasLabel: true },
  PdfWord: { Component: PdfWord, hasLabel: true },
  FileGroup: { Component: FileGroup, hasLabel: true },
  File: { Component: FileWidget, hasLabel: false },
};

const UNKNOWN: WidgetDef = { Component: Unknown, hasLabel: true };

export function resolveWidget(name: string): WidgetDef {
  return Object.prototype.hasOwnProperty.call(WIDGETS, name) ? WIDGETS[name] : UNKNOWN;
}

export { Unknown };
```

`src/components/FieldRenderer.tsx`: in the `<Component ...>` element add `topLevel={false}` (a placeholder; Task 9 supplies the real value) so the build stays green. No other change in this task.

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: PASS (the registry test now passes; typecheck clean). The UI for these widgets is exercised in the browser in Task 12.

```bash
git add -A
git commit -m "feat(widgets): Integer, Float, Year, Email, Phone, CustomFormat, Country, State, multi-choice, AnchorLink, placeholders, Repeatable" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: FieldRenderer row scope, top-level flag, width, and styles

**Files:**
- Modify: `src/components/FieldRenderer.tsx`, `src/components/FormCanvas.tsx`, `src/styles/app.css`

**Interfaces:**
- Consumes: `getRows` (`../model/rows`), `RowScope` (`../widgets/shared`), reducer actions `setValue`/`setRowValue`.
- Produces: `FieldRenderer({ node, row?, topLevel? })`. Inside a Repeatable row, a field's value is `getRows(values, row.rep)[row.index][node.name]`, its change dispatches `setRowValue`, its DOM id is `<rep>.<index>.<name>`. A `Repeatable` rendered with a `row` scope (nested) is treated as a Group. `ui:width` (not `Auto`) becomes the wrapper's CSS `width`.

- [ ] **Step 1: Implement**

`src/components/FieldRenderer.tsx` (replace):
```tsx
import type { MouseEvent, ReactNode } from 'react';
import { getOptions } from '../model/editOps';
import { getRows } from '../model/rows';
import { getLabelHtml, getWidget, isInvisible, isSelectable, uiOf } from '../model/schemaWalk';
import type { SchemaNode } from '../model/types';
import { useForm } from '../state/useFormStore';
import { resolveWidget } from '../widgets/registry';
import type { RowScope } from '../widgets/shared';
import { sanitizeHtml } from './sanitize';

const px = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const width = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' && v !== 'Auto' ? v : undefined);

export function FieldRenderer({ node, row, topLevel = false }: { node: SchemaNode; row?: RowScope; topLevel?: boolean }) {
  const { state, dispatch } = useForm();
  const { doc, values, showInvisible, selection, activePage } = state;
  const declared = getWidget(doc, node);
  // A Repeatable nested inside a row has no rows of its own: render it like a Group.
  const widget = declared === 'Repeatable' && row ? 'Group' : declared;
  const ui = uiOf(doc, node.name);
  const invisible = isInvisible(doc, node.name);

  if (invisible && !showInvisible) return null;
  if (widget === 'Page' && activePage !== node.name) return null;

  const { Component, hasLabel } = resolveWidget(widget);
  const selectable = isSelectable(widget);
  const classes = [
    'field',
    selectable && 'field--selectable',
    selection === node.name && 'field--selected',
    invisible && 'field--invisible',
    widget === 'Repeatable' && 'field--repeatable',
  ]
    .filter(Boolean)
    .join(' ');
  const onClick = selectable
    ? (e: MouseEvent) => {
        e.stopPropagation();
        dispatch({ type: 'select', name: node.name });
      }
    : undefined;

  const renderChildren = (scope?: RowScope): ReactNode =>
    node.properties?.map((child) => <FieldRenderer key={child.name} node={child} row={scope ?? row} />);

  const value = row ? getRows(values, row.rep)[row.index]?.[node.name] : values[node.name];
  const onChange = (v: unknown) =>
    row
      ? dispatch({ type: 'setRowValue', rep: row.rep, index: row.index, name: node.name, value: v })
      : dispatch({ type: 'setValue', name: node.name, value: v });
  const id = row ? `${row.rep}.${row.index}.${node.name}` : node.name;

  return (
    <div
      className={classes}
      style={{ paddingLeft: px(ui['ui:indentation']), marginBottom: px(ui['ui:marginBottom']), width: width(ui['ui:width']) }}
      onClick={onClick}
      data-field={node.name}
    >
      {invisible && <span className="field__badge">invisible</span>}
      {hasLabel && (
        <div className="field__label" dangerouslySetInnerHTML={{ __html: sanitizeHtml(getLabelHtml(doc, node)) }} />
      )}
      <Component
        id={id}
        widget={widget}
        node={node}
        ui={ui}
        value={value}
        onChange={onChange}
        options={getOptions(ui, node)}
        topLevel={topLevel}
        renderChildren={renderChildren}
      >
        {widget === 'Repeatable' ? undefined : renderChildren()}
      </Component>
    </div>
  );
}
```

`src/components/FormCanvas.tsx`: change `<FieldRenderer key={n.name} node={n} />` to `<FieldRenderer key={n.name} node={n} topLevel />`.

Append to `src/styles/app.css`:
```css

.field--repeatable { border: 1px solid transparent; }
.w-repeatable { border: 1px solid var(--border); border-radius: var(--radius); background: #fff; }
.w-repeatable__row { display: flex; border-bottom: 1px solid var(--border); }
.w-repeatable__fields { flex: 1; min-width: 0; padding: 16px 20px 4px; }
.w-repeatable__trash { width: 42px; border-left: 1px solid var(--border); background: #f6f8fa; display: grid; place-items: start center; padding-top: 18px; }
.w-repeatable__trash button { background: none; border: 0; padding: 4px; color: #5c6b7a; }
.w-repeatable__add { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 12px 20px; color: var(--accent); font-weight: 500; }
.w-repeatable__add:disabled { color: #a9c1d9; cursor: default; }

.w-check__opt { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.w-check__opt input { position: absolute; opacity: 0; pointer-events: none; }
.w-check__box { width: 20px; height: 20px; border: 1px solid #c4ccd6; border-radius: 3px; background: #fff; flex: none; display: grid; place-items: center; }
.w-check__opt input:checked + .w-check__box { background: var(--accent); border-color: var(--accent); }
.w-check__opt input:checked + .w-check__box::after { content: '✓'; color: #fff; font-size: 14px; line-height: 1; }
.w-check__opt input:focus-visible + .w-check__box { outline: 2px solid var(--accent); outline-offset: 2px; }

.w-suggest { position: relative; }
.w-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.w-chip { display: inline-flex; align-items: center; gap: 6px; background: #e6f1fb; color: var(--blue); border-radius: 12px; padding: 2px 4px 2px 10px; font-size: 13px; }
.w-chip button { background: none; border: 0; padding: 0 4px; font-size: 16px; line-height: 1; color: var(--blue); }
.w-suggest__list { list-style: none; margin: 4px 0 0; padding: 4px 0; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.12); max-height: 220px; overflow: auto; position: absolute; left: 0; right: 0; z-index: 10; }
.w-suggest__list button { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 6px 12px; }
.w-suggest__list button:hover { background: #f0f6fc; }
.w-suggest__empty { padding: 6px 12px; color: var(--muted); }

.w-link { color: var(--accent); text-decoration: underline; }
.w-link--inert { color: var(--muted); text-decoration: none; }
.w-placeholder { display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center; min-height: 72px; border: 1px dashed #b9c3cf; border-radius: var(--radius); background: #fafbfc; color: var(--muted); text-align: center; padding: 10px; }
.w-placeholder span { font-size: 12px; }
.w-placeholder em { font-size: 12px; color: var(--text); }
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: clean / all pass. (Visual checks happen in Task 12.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: row-scoped FieldRenderer, top-level flag, width, and widget styles" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Icons, widget picker, and the "+" button

**Files:**
- Modify: `src/components/icons.tsx`, `src/components/TocPanel.tsx`, `src/styles/app.css`
- Create: `src/components/WidgetPicker.tsx`

**Interfaces:**
- Consumes: `WIDGET_CATALOG`, `filterWidgets` (`../model/widgetCatalog`); reducer `startAdd`.
- Produces: `WidgetIcon({ id }: { id: string })` (renders a 24x24 stroke SVG; unknown ids get a generic box), `PlusIcon`, `SearchIcon`; `WidgetPicker({ onPick, onClose })`: search box (autofocus), "Widgets" heading, 3-column grid of icon + label, Esc or outside click calls `onClose`, Enter picks the first match, no matches shows "No widgets". The TOC title row shows a round "+" button (`aria-label="Add widget"`) that toggles the popover; picking dispatches `{ type: 'startAdd', widget }` and closes it.

- [ ] **Step 1: Implement icons**

Append to `src/components/icons.tsx`:
```tsx
export const PlusIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" /><path d="M12 8v8M8 12h8" stroke="#fff" /></svg>
);
export const SearchIcon = () => (
  <svg {...base} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
);

const BOX = 'M4 7h16v10H4z';
const FILE = 'M6 3h8l4 4v14H6z M14 3v4h4';
/** Simple stroke glyphs per widget id; `text` ones draw a character instead of a path. */
const GLYPHS: Record<string, { d?: string; text?: string }> = {
  Group: { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  Page: { d: `${FILE} M9 13h6 M9 17h6` },
  Paragraph: { text: 'Aa' },
  Header: { text: 'H' },
  TextBox: { d: `${BOX} M12 10v4` },
  MultipleCheckbox: { d: 'M4 4h16v16H4z M8 12l3 3 5-6' },
  MultipleSuggest: { d: 'M4 7l2 2 3-3 M12 7h8 M4 15l2 2 3-3 M12 15h8' },
  Radio: { d: 'M12 4a8 8 0 1 0 0.01 0z M12 9a3 3 0 1 0 0.01 0z' },
  Dropdown: { d: 'M8 10l4-4 4 4 M8 14l4 4 4-4' },
  Signature: { d: 'M4 20l4-1 11-11-3-3L5 16z M14 7l3 3' },
  PdfWord: { d: `${FILE} M12 14a2 2 0 1 0 0.01 0z` },
  Repeatable: { d: 'M8 8h12v12H8z M4 4h12 M4 4v12' },
  TextArea: { d: 'M4 5h16v14H4z M8 9h8 M8 13h5' },
  Integer: { text: '123' },
  Float: { text: '1.5' },
  Percentage: { text: '%' },
  Money: { text: '$' },
  Year: { d: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2' },
  Email: { d: 'M3 6h18v12H3z M3 6l9 7 9-7' },
  Date: { d: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4' },
  Phone: { d: 'M8 3h8v18H8z M11 18h2' },
  FileGroup: { d: 'M8 8h12v12H8z M4 4h12v2 M4 4v12h2' },
  File: { d: FILE },
  AnchorLink: { d: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1' },
  Country: { d: 'M5 21V4 M5 4h12l-2 4 2 4H5' },
  State: { d: 'M5 21V4 M5 4h12v8H5' },
  CustomFormat: { d: `${BOX} M8 12h8` },
};

export function WidgetIcon({ id }: { id: string }) {
  const g = GLYPHS[id] ?? { d: BOX };
  return (
    <svg {...base} width={22} height={22} aria-hidden="true">
      {g.text ? (
        <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" stroke="none">{g.text}</text>
      ) : (
        <path d={g.d} />
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Implement the picker**

`src/components/WidgetPicker.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { filterWidgets } from '../model/widgetCatalog';
import { SearchIcon, WidgetIcon } from './icons';

export function WidgetPicker({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const matches = filterWidgets(query);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // The "+" button toggles the popover itself, so a mousedown on it must not also close it here.
      if (ref.current && !ref.current.contains(target) && !target.closest('[data-picker-anchor]')) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  return (
    <div className="picker" ref={ref} role="dialog" aria-label="Add a widget" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="picker__search">
        <SearchIcon />
        <input
          autoFocus
          placeholder="Search"
          aria-label="Search widgets"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) onPick(matches[0].id);
          }}
        />
      </div>
      <div className="picker__heading">Widgets</div>
      {matches.length === 0 ? (
        <div className="picker__empty">No widgets</div>
      ) : (
        <div className="picker__grid">
          {matches.map((w) => (
            <button key={w.id} type="button" className="picker__item" onClick={() => onPick(w.id)}>
              <WidgetIcon id={w.id} />
              <span>{w.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

`src/components/TocPanel.tsx` (replace):
```tsx
import { useState } from 'react';
import { getPages } from '../model/schemaWalk';
import { useForm } from '../state/useFormStore';
import { PlusIcon } from './icons';
import { WidgetPicker } from './WidgetPicker';

export function TocPanel() {
  const { state, dispatch } = useForm();
  const { doc, showInvisible, activePage } = state;
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <nav className="toc">
      <div className="toc__head">
        <h2 className="toc__title">Table of Contents</h2>
        <button type="button" className="toc__add" data-picker-anchor aria-label="Add widget" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
          <PlusIcon />
        </button>
        {pickerOpen && (
          <WidgetPicker
            onClose={() => setPickerOpen(false)}
            onPick={(widget) => {
              dispatch({ type: 'startAdd', widget });
              setPickerOpen(false);
            }}
          />
        )}
      </div>
      <ul className="toc__pages">
        {getPages(doc, showInvisible).map((p) => (
          <li key={p.name}>
            <button type="button" className={`toc__page${activePage === p.name ? ' toc__page--active' : ''}`} onClick={() => dispatch({ type: 'setPage', name: p.name })}>
              <span>{p.title}</span>
              <span className="toc__dot" />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```
Append to `src/styles/app.css`:
```css

.toc__head { position: relative; display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.toc__head .toc__title { margin: 0; }
.toc__add { background: none; border: 0; padding: 2px; color: #5c6b7a; line-height: 0; border-radius: 50%; }
.toc__add:hover { color: var(--blue); }
.picker { position: absolute; z-index: 40; top: 38px; left: 0; width: 460px; max-width: calc(100vw - 32px); background: #fff; border-radius: 10px; box-shadow: 0 8px 30px rgba(16,22,26,.22); padding: 20px; }
.picker__search { display: flex; align-items: center; gap: 8px; border: 1px solid var(--accent); border-radius: var(--radius); padding: 0 10px; color: var(--muted); }
.picker__search input { flex: 1; border: 0; outline: 0; height: 40px; font: inherit; }
.picker__heading { margin: 18px 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px; }
.picker__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; max-height: 340px; overflow: auto; }
.picker__item { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 6px; background: none; border: 0; border-radius: var(--radius); color: #5c6b7a; font-size: 14px; }
.picker__item:hover, .picker__item:focus-visible { background: #eef1f4; }
.picker__empty { padding: 24px 0; text-align: center; color: var(--muted); }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: clean / all pass. Visual checks in Task 12.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: widget icons, searchable picker popover, and TOC add button" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: MetadataForm, Properties panel, Add field panel, wiring

**Files:**
- Create: `src/components/MetadataForm.tsx`, `src/components/AddFieldPanel.tsx`
- Modify: `src/components/PropertiesDrawer.tsx` (replace), `src/App.tsx`, `src/styles/app.css`

**Interfaces:**
- Consumes: `METADATA`/`metadataFor`/`customEntries`/presets (`../model/metadata`); `setLabel`, `setRequired`, `setInvisible`, `setOptions`, `getOptions`, `nextOptionValue`, `setUiKey`, `normalizeCustomKey`, `parseCustomValue`, `labelText` (`../model/editOps`); `switchWidget`, `buildNewField`, `validateName`, `locationOptions`, `resolveInsertion`, `sameLocation`, `replaceNode` (`../model/addField`); `switchGroup`, `getWidgetDef`; `widgetOf`; `entryRequired`/`entryInvisible`; `Toggle` (`./Inert`); `useForm`.
- Produces:
  - `MetadataForm({ value, onChange })` with `interface FieldValue { node: SchemaNode; ui: UiEntry }`. It never touches the store: `onChange` receives the next `{ node, ui }`. Rows: **Input type** (select over `switchGroup(widget)`, disabled when the group has one entry; a `Header` shows "Heading 1"; an unknown widget id shows itself plus the input widgets), then every `metadataFor(widget)` row in registry order with the label on the left and the control on the right, then custom keys.
  - `PropertiesDrawer()` live-edits the selected field via `editDoc` (schema + uiSchema).
  - `AddFieldPanel()` is a draft: Name, Location select, the same `MetadataForm`, "Add field" (disabled while the name is invalid) and "Cancel".
  - `App` right column: `state.adding ? <AddFieldPanel key={state.adding.widget} /> : state.selection ? <PropertiesDrawer /> : <ToolsPanel />`.
- Control behavior: `required` checkbox writes the default message via `setRequired`; **Visible** switch is `!entryInvisible` via `setInvisible(!checked)`; `bool` switch sets `true` or deletes the key; `text` deletes the key when emptied; `integer` accepts a positive whole number, otherwise leaves the stored value unchanged; `px`/`width`/`enum` are selects (`Auto` and `Default` delete the key; a stored non-preset value is kept as an extra option); `string-list` rows with remove buttons and a `+` that adds an empty row, an empty list deletes the key; `options` rows edit labels (values stay stable), with remove and add via `nextOptionValue`.

- [ ] **Step 1: Implement MetadataForm**

`src/components/MetadataForm.tsx`:
```tsx
import { useState, type ReactNode } from 'react';
import { switchWidget } from '../model/addField';
import {
  getOptions, labelText, nextOptionValue, normalizeCustomKey, parseCustomValue, setInvisible, setLabel, setOptions,
  setRequired, setUiKey,
} from '../model/editOps';
import { customEntries, KNOWN_KEYS, metadataFor, WIDTH_PRESETS, type MetaDef } from '../model/metadata';
import { widgetOf } from '../model/schemaWalk';
import type { SchemaNode, UiEntry, UiSchema } from '../model/types';
import { entryInvisible, entryRequired } from '../model/uiEntry';
import { getWidgetDef, switchGroup } from '../model/widgetCatalog';
import { Toggle } from './Inert';

export interface FieldValue {
  node: SchemaNode;
  ui: UiEntry;
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="meta-row">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="meta-row__control">{children}</div>
    </div>
  );
}

function StringList({ id, items, onChange }: { id: string; items: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="meta-list">
      {items.map((it, i) => (
        <div className="meta-list__item" key={i}>
          <input className="w-input" aria-label={`${id} ${i + 1}`} value={it} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button type="button" className="btn" aria-label={`Remove ${id} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="meta-list__add" aria-label={`Add ${id}`} onClick={() => onChange([...items, ''])}>＋</button>
    </div>
  );
}

function CustomKeys({ ui, onSet }: { ui: UiEntry; onSet: (key: string, value: unknown) => void }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = customEntries(ui);
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
  const add = () => {
    const check = normalizeCustomKey(key, [...Object.keys(ui), ...KNOWN_KEYS]);
    if (!check.ok) return setError(check.error);
    onSet(check.key, parseCustomValue(val));
    setKey('');
    setVal('');
    setError(null);
  };
  return (
    <div className="meta-custom">
      <div className="meta-custom__title">Custom keys</div>
      {entries.map(([k, v]) => (
        <div className="meta-list__item" key={k}>
          <code>{k}</code>
          <input className="w-input" aria-label={`Value of ${k}`} value={show(v)} onChange={(e) => onSet(k, parseCustomValue(e.target.value))} />
          <button type="button" className="btn" aria-label={`Remove ${k}`} onClick={() => onSet(k, undefined)}>✕</button>
        </div>
      ))}
      <div className="meta-list__item">
        <input className="w-input" placeholder="ui:key" aria-label="Custom key" value={key} onChange={(e) => setKey(e.target.value)} />
        <input className="w-input" placeholder="value (JSON or text)" aria-label="Custom value" value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="button" className="btn" onClick={add}>Add key</button>
      </div>
      {error && <div className="w-error">{error}</div>}
    </div>
  );
}

export function MetadataForm({ value, onChange }: { value: FieldValue; onChange: (next: FieldValue) => void }) {
  const { node, ui } = value;
  const name = node.name;
  const widget = widgetOf(node, ui);
  const defs = metadataFor(widget);

  const one = (): UiSchema => ({ [name]: ui });
  const viaOp = (op: (s: UiSchema) => UiSchema) => onChange({ node, ui: op(one())[name] });
  const setKeyValue = (key: string, v: unknown) => viaOp((s) => setUiKey(s, name, key, v));

  const group = getWidgetDef(widget) ? switchGroup(widget) : [widget, ...switchGroup('TextBox')];
  const optionLabel = (id: string) => (id === 'Header' ? 'Heading 1' : (getWidgetDef(id)?.label ?? id));

  const control = (m: MetaDef): ReactNode => {
    const id = `meta-${m.key.replace(':', '-')}`;
    const stored = ui[m.key];
    switch (m.control) {
      case 'html-text':
        return widget === 'Paragraph' ? (
          <textarea id={id} className="w-input w-textarea" rows={4} value={labelText(ui, node.title)} onChange={(e) => viaOp((s) => setLabel(s, name, e.target.value))} />
        ) : (
          <input id={id} className="w-input" value={labelText(ui, node.title)} onChange={(e) => viaOp((s) => setLabel(s, name, e.target.value))} />
        );
      case 'required':
        return <input id={id} type="checkbox" checked={entryRequired(ui)} onChange={(e) => viaOp((s) => setRequired(s, name, e.target.checked))} />;
      case 'visible':
        return <Toggle label="Visible" checked={!entryInvisible(ui)} onChange={() => viaOp((s) => setInvisible(s, name, !entryInvisible(ui)))} />;
      case 'bool':
        return <Toggle label={m.label} checked={stored === true} onChange={() => setKeyValue(m.key, stored === true ? undefined : true)} />;
      case 'text':
        return (
          <input id={id} className="w-input" placeholder={m.defaultText} value={typeof stored === 'string' ? stored : ''} onChange={(e) => setKeyValue(m.key, e.target.value === '' ? undefined : e.target.value)} />
        );
      case 'integer':
        return (
          <input
            id={id}
            className="w-input"
            inputMode="numeric"
            value={stored === undefined ? '' : String(stored)}
            placeholder={m.defaultText}
            onChange={(e) => {
              const t = e.target.value.trim();
              if (t === '') return setKeyValue(m.key, undefined);
              if (/^\d+$/.test(t) && Number(t) >= 1) setKeyValue(m.key, Number(t));
            }}
          />
        );
      case 'px':
      case 'width': {
        const presets = m.control === 'width' ? WIDTH_PRESETS : (m.presets ?? []);
        const current = typeof stored === 'string' && stored !== '' ? stored : m.control === 'width' ? 'Auto' : (presets[0] ?? '');
        const options = presets.includes(current) ? presets : [...presets, current];
        return (
          <select
            id={id}
            className="w-input w-select"
            value={current}
            onChange={(e) => setKeyValue(m.key, m.control === 'width' && e.target.value === 'Auto' ? undefined : e.target.value)}
          >
            {options.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        );
      }
      case 'enum': {
        const current = typeof stored === 'string' ? stored : '';
        return (
          <select id={id} className="w-input w-select" value={current} onChange={(e) => setKeyValue(m.key, e.target.value === '' ? undefined : e.target.value)}>
            {m.enumValues?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      }
      case 'string-list': {
        const items = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : [];
        return <StringList id={m.label} items={items} onChange={(next) => setKeyValue(m.key, next.length === 0 ? undefined : next)} />;
      }
      case 'options': {
        const options = getOptions(ui, node);
        return (
          <div className="meta-list">
            {options.map((o, i) => (
              <div className="meta-list__item" key={o.value}>
                <input className="w-input" aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => viaOp((s) => setOptions(s, name, options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))))} />
                <button type="button" className="btn" aria-label={`Remove option ${i + 1}`} onClick={() => viaOp((s) => setOptions(s, name, options.filter((_, j) => j !== i)))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => viaOp((s) => setOptions(s, name, [...options, { value: nextOptionValue(options), label: `Option ${options.length + 1}` }]))}>
              + Add option
            </button>
          </div>
        );
      }
    }
  };

  const labelFor = (m: MetaDef) => (m.control === 'html-text' && widget === 'Paragraph' ? 'Text' : m.label);

  return (
    <div className="meta-form">
      <Row label="Input type" htmlFor="meta-widget">
        <select
          id="meta-widget"
          className="w-input w-select"
          disabled={group.length <= 1}
          value={widget}
          onChange={(e) => onChange(switchWidget(node, ui, e.target.value))}
        >
          {group.map((id) => <option key={id} value={id}>{optionLabel(id)}</option>)}
        </select>
      </Row>
      {defs.map((m) => (
        <Row key={m.key} label={labelFor(m)} htmlFor={`meta-${m.key.replace(':', '-')}`}>
          {control(m)}
        </Row>
      ))}
      <CustomKeys ui={ui} onSet={setKeyValue} />
    </div>
  );
}
```

- [ ] **Step 2: Implement the panels and wiring**

`src/components/PropertiesDrawer.tsx` (replace):
```tsx
import { replaceNode } from '../model/addField';
import { findNode, uiOf } from '../model/schemaWalk';
import { useForm } from '../state/useFormStore';
import { MetadataForm, type FieldValue } from './MetadataForm';

export function PropertiesDrawer() {
  const { state, dispatch } = useForm();
  const { doc, selection } = state;
  const node = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (!node) return null;

  const onChange = (next: FieldValue) =>
    dispatch({
      type: 'editDoc',
      schema: next.node === node ? undefined : replaceNode(doc.schema, next.node),
      uiSchema: { ...doc.uiSchema, [next.node.name]: next.ui },
    });

  return (
    <div className="drawer">
      <div className="drawer__tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" className="drawer__tab drawer__tab--active">Properties</button>
        <button type="button" role="tab" aria-selected="false" className="drawer__tab" title="Not in prototype">Rules</button>
        <button type="button" role="tab" aria-selected="false" className="drawer__tab" title="Not in prototype">ASA</button>
      </div>
      <button type="button" className="drawer__back" onClick={() => dispatch({ type: 'select', name: null })}>
        ← Back to tools
      </button>
      <MetadataForm value={{ node, ui: uiOf(doc, node.name) }} onChange={onChange} />
      <div className="drawer__info">
        <div>Name: <code>{node.name}</code></div>
        <div>Schema type: <code>{node.type}</code></div>
      </div>
    </div>
  );
}
```

`src/components/AddFieldPanel.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { buildNewField, locationOptions, resolveInsertion, sameLocation, validateName } from '../model/addField';
import { labelText } from '../model/editOps';
import { getWidgetDef } from '../model/widgetCatalog';
import { useForm } from '../state/useFormStore';
import { MetadataForm, type FieldValue } from './MetadataForm';

export function AddFieldPanel() {
  const { state, dispatch } = useForm();
  const { doc, selection, activePage } = state;
  const widgetId = state.adding?.widget ?? '';
  const def = getWidgetDef(widgetId);

  const [draft, setDraft] = useState<FieldValue>(() => buildNewField(doc, widgetId));
  const [name, setName] = useState(draft.node.name);
  const options = useMemo(() => locationOptions(doc, widgetId, selection, activePage), [doc, widgetId, selection, activePage]);
  const [locId, setLocId] = useState(() => {
    const def0 = resolveInsertion(doc, widgetId, selection, activePage);
    return (options.find((o) => sameLocation(o.loc, def0)) ?? options[0])?.id ?? '';
  });

  const nameError = validateName(doc, name);
  const loc = options.find((o) => o.id === locId)?.loc ?? resolveInsertion(doc, widgetId, selection, activePage);

  const submit = () => {
    if (nameError) return;
    const title = labelText(draft.ui, draft.node.title) || draft.node.title;
    dispatch({ type: 'addNode', node: { ...draft.node, name, title }, ui: draft.ui, loc });
  };

  return (
    <div className="drawer">
      <h3 className="drawer__title">Add {def?.label ?? widgetId}</h3>
      <div className="meta-form">
        <div className="meta-row">
          <label htmlFor="add-name">Name</label>
          <div className="meta-row__control">
            <input id="add-name" className={`w-input${nameError ? ' w-input--invalid' : ''}`} value={name} onChange={(e) => setName(e.target.value)} />
            {nameError && <div className="w-error">{nameError}</div>}
          </div>
        </div>
        <div className="meta-row">
          <label htmlFor="add-location">Location</label>
          <div className="meta-row__control">
            <select id="add-location" className="w-input w-select" value={locId} onChange={(e) => setLocId(e.target.value)}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </div>
      <MetadataForm value={draft} onChange={setDraft} />
      <div className="drawer__actions">
        <button type="button" className="btn btn--primary" disabled={nameError !== null} onClick={submit}>Add field</button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'cancelAdd' })}>Cancel</button>
      </div>
    </div>
  );
}
```

`src/App.tsx`: add `import { AddFieldPanel } from './components/AddFieldPanel';` and change the aside content to
```tsx
        <aside className="right">
          {state.adding ? <AddFieldPanel key={state.adding.widget} /> : state.selection ? <PropertiesDrawer /> : <ToolsPanel />}
        </aside>
```

Append to `src/styles/app.css`:
```css

.drawer__tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--border); margin: -20px -20px 14px; padding: 0 20px; }
.drawer__tab { background: none; border: 0; padding: 14px 0 12px; color: var(--muted); font-weight: 500; border-bottom: 2px solid transparent; }
.drawer__tab--active { color: var(--text); border-bottom-color: var(--accent); }
.drawer__actions { display: flex; gap: 10px; margin-top: 18px; }
.btn--primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn--primary:disabled { opacity: .5; cursor: default; }
.meta-form { display: block; }
.meta-row { display: grid; grid-template-columns: 1fr 1.1fr; gap: 12px; align-items: start; padding: 12px 0; border-bottom: 1px solid #eef1f4; }
.meta-row > label { font-weight: 600; font-size: 14px; padding-top: 8px; }
.meta-row__control { min-width: 0; }
.meta-list { display: flex; flex-direction: column; gap: 8px; }
.meta-list__item { display: flex; gap: 8px; align-items: center; }
.meta-list__item code { font-size: 12px; white-space: nowrap; }
.meta-list__add { align-self: flex-start; background: none; border: 0; color: var(--muted); font-size: 20px; line-height: 1; padding: 4px 0; }
.meta-custom { padding-top: 14px; }
.meta-custom__title { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
.drawer .w-select:disabled { opacity: .6; }
```
and remove the now-unused `.drawer__group`, `.drawer__check`, `.drawer__option`, `.drawer__group label` rules if present (harmless to leave).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: shared MetadataForm, Properties panel, and Add field panel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Export button, README, and end-to-end browser verification

**Files:**
- Modify: `src/components/TopBar.tsx`, `README.md`

**Interfaces:**
- Consumes: `exportJsonText`, `EXPORT_FILE_NAME` (`../model/exportForm`); `useForm`.
- Produces: an "Export form JSON" button in the top bar (between "Load form JSON" and "Save and close") that downloads `form-content-edited.json` and shows a toast "Exported form-content-edited.json".

- [ ] **Step 1: Implement**

In `src/components/TopBar.tsx`: add `import { EXPORT_FILE_NAME, exportJsonText } from '../model/exportForm';`, change `const { dispatch } = useForm();` to `const { state, dispatch } = useForm();`, add inside the component:
```tsx
  function exportForm() {
    const blob = new Blob([exportJsonText(state.doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = EXPORT_FILE_NAME;
    a.click();
    URL.revokeObjectURL(url);
    dispatch({ type: 'notify', message: `Exported ${EXPORT_FILE_NAME}` });
  }
```
and, after the Load form JSON button and hidden input, add:
```tsx
        <button type="button" className="btn" onClick={exportForm}>
          Export form JSON
        </button>
```

`README.md`: replace the "Working" and "Not implemented" bullets with:
```markdown
- Working: fill the form; click a field to edit all of its metadata (Properties panel); the **+** next to "Table of Contents" opens the widget picker, and picking one opens an Add field form (name, location, every known `ui:` key, plus custom `ui:` keys); all 27 Anduin widgets (Signature, Pdf/Word, FileGroup and a nested File are placeholders; Repeatable has real rows up to `ui:maxItems`); "Show invisible pages & fields"; **Export form JSON** (the loaded file with only `schema` and `uiSchema` replaced; rules/libs carry through).
- Everything else in the side panels is inert ("Not in prototype").
- Not implemented: rules, PDF generation, signatures, commenting, persistence, deleting/reordering fields, nested Repeatables, undo.
```

- [ ] **Step 2: Automated checks**

Run: `npm test && npm run build`
Expected: all tests pass; `tsc` clean; Vite build succeeds.

- [ ] **Step 3: Browser verification**

Start the preview (`mcp__Claude_Browser__preview_start` with `form-builder-proto`; if `.claude/launch.json` is missing recreate it with the config used earlier: `npm run dev -- --port 5173 --strictPort`), set the viewport to 1600x1000, and verify with `read_page` / `javascript_tool` (note: the pane window is not focused, so fire `focusin`/`focusout` events instead of `.focus()`/`.blur()`). Check, fixing any failure before committing:
1. **Layout**: TOC shows the title with a "+" button, the page list, and nothing else. Console clean.
2. **Picker**: click "+" -> popover with a search box and 27 icon+label items in 3 columns in the screenshot's order. Typing "pdf" leaves only "Pdf/Word". Typing "zzz" shows "No widgets". Esc and an outside click close it. Enter picks the first match.
3. **Add every widget**: loop over the 27 catalog ids: open the picker, click the item, confirm the right panel shows "Add <Label>" with Name, Location and the Input type row, click "Add field", and confirm `[data-field="<name>"]` exists, nothing threw, and the new field is selected (Page: a second TOC entry appears and becomes active). Take screenshots of the Add panel for Radio and Repeatable, and of the rendered canvas.
4. **Location**: select the demo's "Is it an exempted partnership?" field, add a TextBox -> it appears directly after it. Select it, add an Email -> default location "After ...". In the Add form switch Location to "Inside Group"-type targets (add a Group first) and confirm nesting. Adding a Repeatable while a Repeatable is selected does not offer "Inside" that Repeatable.
5. **Name validation**: type `partnership` (duplicate), `1abc`, ``, `constructor` -> inline error and "Add field" disabled each time.
6. **Repeatable**: add a Repeatable, add a TextBox "inside" it, set Max number of items to 3 and Item name to `owner` in its Properties panel. In the canvas: one row, "⊕ Add another owner" enabled; click twice -> 3 rows with trash buttons, the add button disabled; type different text in each row; remove the middle row -> remaining rows keep their text. Set max to `0` -> the stored value is left unchanged (the input only accepts >= 1).
7. **New widgets behave**: Integer (`1.5` flagged and not saved, `42` saved), Year (`26` flagged, `2026` saved), Email (`nope` flagged, `a@b.co` saved), Phone, CustomFormat with `ui:pattern` set to `^\d{3}$` (`12` flagged, `123` saved; an invalid pattern `[` accepts anything), Country and State dropdowns (US selectable), MultipleCheckbox (toggle two options), MultipleSuggest (type to filter, pick adds a chip, × removes), AnchorLink with `ui:href` `https://example.com` renders a link, with `javascript:alert(1)` renders plain text.
8. **Properties panel**: select the demo Header -> tabs Properties/Rules/ASA, Input type "Heading 1" (disabled), rows Subtitle/Heading/Description/ASA/Margin bottom/Indentation/Visible. Edit the heading -> the canvas title updates live. Select a Radio -> Input type switch to Dropdown keeps the options; to Integer works. The Visible switch hides a field (and "Show invisible" reveals it). Add a custom key `foo` = `{"a":1}`, then try `widget` and `heading` -> rejected with a message.
9. **Export/Load**: monkey-patch `URL.createObjectURL` to capture the Blob text, click "Export form JSON", parse the text: it contains `rules`, `libs`, the added fields, and the custom key. Feed that text back through the "Load form JSON" input (via a `DataTransfer` File) -> the form renders the same fields. Loading a bad file shows the toast and keeps the form.
10. Reset the viewport (`resize_window` preset `desktop`) and stop the preview server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: Export form JSON button and README update" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
