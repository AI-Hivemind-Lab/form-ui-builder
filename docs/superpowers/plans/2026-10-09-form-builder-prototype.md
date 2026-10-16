# Form Builder Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vite + React prototype of Anduin's Form Builder (preview/fill + light editing) that renders any Form Builder JSON export, with the demo fund-transfer form bundled as the default.

**Architecture:** A pure-TypeScript `model/` layer (parse, walk, progress, edit ops, history) is the only unit-tested code. A reducer-backed React context holds `{doc, values, selection, ...}`. A generic `FieldRenderer` walks `schema.properties`, looks up `uiSchema[name]`, and dispatches to a widget registry keyed by `ui:widget`. Three-column shell (Table of Contents, canvas, tools/properties panel) matches the reference screenshot.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), plain CSS, Vitest 2 (+ jsdom for one test file), DOMPurify.

**Spec:** `docs/superpowers/specs/2026-10-09-form-builder-prototype-design.md`

## Global Constraints

- Only `namespaceFormSchemaMap[defaultNamespace]` (`main`) is read. `rules`, `libs`, `triggerRuleByProperty`, `cueFieldSchemas`, `gaiaLogicVersion` are ignored.
- Stack is Vite + React + TypeScript, plain CSS (no UI library), Vitest for pure logic. No e2e framework.
- `values` is a **flat** `Record<string, unknown>` keyed by field `name` (names are unique across the doc; nesting does not change the shape).
- `schema.properties` is an **ordered array** of nodes (not a map); `uiSchema` is a flat map `name -> { "ui:*": ... }`.
- All `ui:formattedText` HTML is sanitized before `dangerouslySetInnerHTML`. Allowed tags: `p, span, strong, em, br, a, ul, ol, li`; scripts and event handlers stripped.
- Unknown `ui:widget` renders a labeled placeholder and never throws. Missing `uiSchema` entry renders with defaults (title as label, `TextBox`).
- A field is "required" when `ui:required` is present (a non-empty message string). Progress counts only currently visible required input fields with a non-empty value; `Header`, `Paragraph`, `Page`, `Group`, `File` never count.
- Rules are not evaluated, so the demo's `Group` renders from the schema alone (always visible).
- Prototype scope: no add/delete/reorder of fields or pages, no persistence, no backend. Inert controls show the tooltip "Not in prototype".
- Working tools-panel features: "Show invisible pages & fields" toggle, Undo, Reset. All other panel controls are inert.

## Review Focus

Input classes the spec implies but that are most likely to bite someone using the prototype, most likely first. Each has a test in the task that owns the code.

1. **Node with no `uiSchema` entry, an unknown `ui:widget`, or Radio/Dropdown with no `ui:multipleOption`** should render with defaults or the enum fallback, never throw. Tests: Task 3 (`getWidget`/`getLabelHtml` defaults), Task 5 (`getOptions` enum fallback), Task 7 (registry fallback).
2. **Bad file loaded** (not JSON, array/empty `namespaceFormSchemaMap`, `properties` not an array, missing `defaultNamespace`) should give a readable error and leave the current form untouched. Tests: Task 2.
3. **Hostile or odd HTML**: `<script>`/`onerror`/`javascript:` in labels and paragraphs; `<`, `&`, quotes typed into the label editor. Tests: Task 5 (escaping and round trip), Task 7 (sanitizer).
4. **Junk numeric/date text**: `"abc"`, `""`, `"1,000"`, `"1e5"`, `"02-30-2026"`, `"13-01-2026"`. Tests: Task 4.
5. **Undo/reset edge cases**: undo on empty history is a no-op; reset on already-empty values adds no snapshot; reset then undo restores values; typing in one field coalesces into one undo step. Tests: Task 6.

---

## File Structure

```
.gitignore  package.json  tsconfig.json  vite.config.ts  index.html  README.md
src/
  main.tsx  App.tsx
  data/demo-form.json            bundled copy of the source export
  model/                         PURE TS, no React, no DOM
    types.ts                     SchemaNode, UiEntry, UiSchema, FormDoc, Values, Option
    html.ts                      escapeHtml, stripHtml
    loadForm.ts                  FormLoadError, loadForm, parseFormJson
    uiEntry.ts                   REQUIRED_MESSAGE, entryRequired, entryInvisible
    schemaWalk.ts                widget/label/visibility helpers, getPages, visibleLeaves, requiredFields, findNode
    progress.ts                  isFilled, computeProgress
    format.ts                    parseNumber, formatMoney, formatPercent, parseDateInput, formatDateDisplay
    editOps.ts                   labelText, buildLabelHtml, setLabel, setRequired, setInvisible, setWidget, getOptions, setOptions, nextOptionValue
    history.ts                   Snapshot, pushSnapshot, popSnapshot
  state/
    formReducer.ts               FormState, Action, initialState, formReducer
    useFormStore.tsx             FormProvider, useForm
  components/
    sanitize.ts                  sanitizeHtml (DOMPurify)
    icons.tsx                    CalendarIcon, EyeIcon, SwapIcon, ChevronRightIcon
    Inert.tsx                    InertButton, Toggle, ToggleRow
    FieldRenderer.tsx            recursive node renderer
    FormCanvas.tsx               center column
    TocPanel.tsx                 left column
    ToolsPanel.tsx               right column (default)
    PropertiesDrawer.tsx         right column (when a field is selected)
    TopBar.tsx                   top bar + Load form JSON
    Toast.tsx                    notice toast
  widgets/
    shared.ts                    WidgetProps, toText, uiString
    Header.tsx  Paragraph.tsx  Containers.tsx (Page, Group)  TextInputs.tsx (TextBox, TextArea)
    NumberInputs.tsx (Money, Percentage)  DateWidget.tsx  Choice.tsx (Radio, Dropdown)  Misc.tsx (FileWidget, Unknown)
    registry.ts                  resolveWidget
  styles/app.css
```

---

### Task 1: Scaffold, shared types, HTML helpers

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `src/main.tsx`, `src/App.tsx`, `src/styles/app.css`, `src/data/demo-form.json` (copied)
- Create: `src/model/types.ts`, `src/model/html.ts`
- Test: `src/model/html.test.ts`

**Interfaces:**
- Produces: `types.ts` exports `NodeType`, `SchemaNode`, `UiEntry`, `UiSchema`, `FormDoc`, `Values`, `Option`. `html.ts` exports `escapeHtml(s: string): string`, `stripHtml(s: string): string`.

- [ ] **Step 1: Create config files**

`.gitignore`:
```
node_modules
dist
.DS_Store
.claude/
```

`package.json`:
```json
{
  "name": "form-builder-prototype",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "dompurify": "^3.2.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Form Builder Prototype</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`src/App.tsx` (placeholder, replaced in Task 8):
```tsx
export default function App() {
  return <h1>Form Builder prototype</h1>;
}
```

`src/styles/app.css` (placeholder, replaced in Task 8):
```css
body { font-family: sans-serif; }
```

- [ ] **Step 2: Copy demo data and install**

Run:
```bash
mkdir -p src/data && cp "/Users/ops/Downloads/demo form-content.json" src/data/demo-form.json
npm install
```
Expected: `node_modules` created, no errors.

- [ ] **Step 3: Write `src/model/types.ts`**

```ts
export type NodeType = 'null' | 'string' | 'number' | 'object';

export interface SchemaNode {
  name: string;
  type: NodeType;
  title: string;
  enum?: string[];
  format?: string;
  properties?: SchemaNode[];
}

/** One uiSchema entry: a bag of `ui:*` keys. */
export type UiEntry = Record<string, unknown>;
export type UiSchema = Record<string, UiEntry>;

export interface FormDoc {
  schema: { type: 'object'; properties: SchemaNode[] };
  uiSchema: UiSchema;
}

/** Flat map keyed by field name. */
export type Values = Record<string, unknown>;

export interface Option {
  value: string;
  label: string;
}
```

- [ ] **Step 4: Write the failing test `src/model/html.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { escapeHtml, stripHtml } from './html';

describe('escapeHtml', () => {
  it('escapes the five special characters', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});

describe('stripHtml', () => {
  it('removes tags and keeps text', () => {
    expect(stripHtml('<p>specify percentage <span style="color: red;">*</span></p>')).toBe('specify percentage *');
  });
  it('decodes entities, ampersand last, so &amp;lt; stays literal', () => {
    expect(stripHtml('<p>a &lt; b &amp; c &amp;lt;</p>')).toBe('a < b & c &lt;');
  });
  it('does not collapse or trim whitespace', () => {
    expect(stripHtml('<p>abc  </p>')).toBe('abc  ');
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/model/html.test.ts`
Expected: FAIL (cannot find module `./html`).

- [ ] **Step 6: Write `src/model/html.ts`**

```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tag-strip plus entity decode. Pure (no DOM). Ampersand is decoded last. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
```

- [ ] **Step 7: Run to verify pass, typecheck, commit**

Run: `npx vitest run src/model/html.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

```bash
git add -A
git commit -m "chore: scaffold Vite React TS app with shared types and html helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `loadForm`

**Files:**
- Create: `src/model/loadForm.ts`
- Test: `src/model/loadForm.test.ts`

**Interfaces:**
- Consumes: `FormDoc`, `SchemaNode`, `UiSchema` from `./types`.
- Produces: `class FormLoadError extends Error`, `loadForm(raw: unknown): FormDoc`, `parseFormJson(text: string): FormDoc`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { FormLoadError, loadForm, parseFormJson } from './loadForm';

describe('loadForm', () => {
  it('loads the bundled demo export', () => {
    const doc = loadForm(demo);
    expect(doc.schema.properties.map((n) => n.name)).toEqual(['file0', 'demoform']);
    expect(Object.keys(doc.uiSchema)).toHaveLength(24);
  });

  it('falls back to the first namespace when defaultNamespace is missing or unknown', () => {
    const raw = { namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } };
    expect(loadForm(raw).schema.properties).toEqual([]);
    expect(loadForm({ ...raw, defaultNamespace: 'nope' }).schema.properties).toEqual([]);
  });

  it('defaults a missing uiSchema to {}', () => {
    const raw = { namespaceFormSchemaMap: { main: { schema: { properties: [] } } }, defaultNamespace: 'main' };
    expect(loadForm(raw).uiSchema).toEqual({});
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no namespaceFormSchemaMap', {}],
    ['namespaceFormSchemaMap is an array', { namespaceFormSchemaMap: [] }],
    ['empty namespaceFormSchemaMap', { namespaceFormSchemaMap: {} }],
    ['schema.properties not an array', { namespaceFormSchemaMap: { main: { schema: { properties: {} } } } }],
    ['namespace entry has no schema', { namespaceFormSchemaMap: { main: {} } }],
  ])('rejects %s with a FormLoadError', (_label, raw) => {
    expect(() => loadForm(raw)).toThrow(FormLoadError);
  });
});

describe('parseFormJson', () => {
  it('rejects non-JSON text with a readable message', () => {
    expect(() => parseFormJson('{oops')).toThrow('File is not valid JSON');
  });
  it('parses valid text', () => {
    const text = JSON.stringify({ namespaceFormSchemaMap: { main: { schema: { properties: [] }, uiSchema: {} } } });
    expect(parseFormJson(text).schema.properties).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/loadForm.test.ts`
Expected: FAIL (cannot find module `./loadForm`).

- [ ] **Step 3: Implement `src/model/loadForm.ts`**

```ts
import type { FormDoc, SchemaNode, UiSchema } from './types';

export class FormLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormLoadError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadForm(raw: unknown): FormDoc {
  if (!isObj(raw)) throw new FormLoadError('File is not a JSON object');
  const map = raw.namespaceFormSchemaMap;
  if (!isObj(map)) throw new FormLoadError('Missing "namespaceFormSchemaMap"');
  const keys = Object.keys(map);
  if (keys.length === 0) throw new FormLoadError('"namespaceFormSchemaMap" is empty');
  const ns =
    typeof raw.defaultNamespace === 'string' && raw.defaultNamespace in map ? raw.defaultNamespace : keys[0];
  const entry = map[ns];
  if (!isObj(entry) || !isObj(entry.schema) || !Array.isArray(entry.schema.properties)) {
    throw new FormLoadError(`Namespace "${ns}" has no schema.properties array`);
  }
  const uiSchema = isObj(entry.uiSchema) ? (entry.uiSchema as UiSchema) : {};
  return {
    schema: { type: 'object', properties: entry.schema.properties as SchemaNode[] },
    uiSchema,
  };
}

export function parseFormJson(text: string): FormDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FormLoadError('File is not valid JSON');
  }
  return loadForm(raw);
}
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run src/model/loadForm.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): load Form Builder export into FormDoc" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `uiEntry` and `schemaWalk`

**Files:**
- Create: `src/model/uiEntry.ts`, `src/model/schemaWalk.ts`
- Test: `src/model/schemaWalk.test.ts`

**Interfaces:**
- Consumes: types from `./types`, `escapeHtml` from `./html`.
- Produces:
  - `uiEntry.ts`: `REQUIRED_MESSAGE = 'This field is required'`, `entryRequired(e: UiEntry | undefined): boolean`, `entryInvisible(e: UiEntry | undefined): boolean`.
  - `schemaWalk.ts`: `STRUCTURAL_WIDGETS: Set<string>`, `INPUT_WIDGETS: string[]` (`['TextBox','TextArea','Money','Percentage','Date','Radio','Dropdown']`), `uiOf(doc, name): UiEntry`, `getWidget(doc, node): string`, `getLabelHtml(doc, node): string`, `isRequired(doc, name): boolean`, `isInvisible(doc, name): boolean`, `isInputWidget(widget: string): boolean`, `isSelectable(widget: string): boolean`, `getPages(doc): SchemaNode[]`, `visibleLeaves(doc, showInvisible): SchemaNode[]`, `requiredFields(doc, showInvisible): SchemaNode[]`, `findNode(nodes: SchemaNode[], name: string): SchemaNode | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { loadForm } from './loadForm';
import type { FormDoc } from './types';
import {
  findNode, getLabelHtml, getPages, getWidget, isInputWidget, isInvisible, isRequired, isSelectable,
  requiredFields, visibleLeaves,
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
  it('has no pages', () => {
    expect(getPages(bare)).toEqual([]);
  });
});

describe('demo doc', () => {
  it('finds the single Page', () => {
    expect(getPages(doc).map((n) => n.name)).toEqual(['demoform']);
  });
  it('flattens leaves, hiding invisible fields unless asked', () => {
    expect(visibleLeaves(doc, false)).toHaveLength(14);
    expect(visibleLeaves(doc, true)).toHaveLength(22);
    expect(visibleLeaves(doc, false).map((n) => n.name)).not.toContain('textbox9');
    expect(visibleLeaves(doc, true).map((n) => n.name)).toContain('textbox9');
  });
  it('descends into Group children in order', () => {
    const names = visibleLeaves(doc, false).map((n) => n.name);
    expect(names.indexOf('percentage')).toBe(names.indexOf('radio2') + 1);
    expect(names.indexOf('textbox8')).toBe(names.indexOf('percentage') + 1);
  });
  it('counts required input fields only', () => {
    expect(requiredFields(doc, false)).toHaveLength(10);
    expect(requiredFields(doc, true)).toHaveLength(16);
    expect(requiredFields(doc, false).map((n) => n.name)).not.toContain('header');
  });
  it('classifies widgets', () => {
    expect(isInputWidget('Radio')).toBe(true);
    expect(isInputWidget('Paragraph')).toBe(false);
    expect(isSelectable('Paragraph')).toBe(true);
    expect(isSelectable('Header')).toBe(false);
    expect(isSelectable('Group')).toBe(false);
  });
  it('findNode searches nested nodes', () => {
    expect(findNode(doc.schema.properties, 'textbox8')?.title).toBe('Textbox 8');
    expect(findNode(doc.schema.properties, 'nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/schemaWalk.test.ts`
Expected: FAIL (cannot find module).

- [ ] **Step 3: Implement `src/model/uiEntry.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/model/schemaWalk.ts`**

```ts
import { escapeHtml } from './html';
import type { FormDoc, SchemaNode, UiEntry } from './types';
import { entryInvisible, entryRequired } from './uiEntry';

export const STRUCTURAL_WIDGETS = new Set(['Header', 'Page', 'Group', 'Paragraph', 'File']);
export const INPUT_WIDGETS = ['TextBox', 'TextArea', 'Money', 'Percentage', 'Date', 'Radio', 'Dropdown'];
const NOT_SELECTABLE = new Set(['Header', 'Page', 'Group', 'File']);

export function uiOf(doc: FormDoc, name: string): UiEntry {
  return doc.uiSchema[name] ?? {};
}

function defaultWidget(node: SchemaNode): string {
  if (node.type === 'object') return 'Group';
  if (node.type === 'null') return 'Paragraph';
  return 'TextBox';
}

export function getWidget(doc: FormDoc, node: SchemaNode): string {
  const w = uiOf(doc, node.name)['ui:widget'];
  return typeof w === 'string' && w !== '' ? w : defaultWidget(node);
}

export function getLabelHtml(doc: FormDoc, node: SchemaNode): string {
  const f = uiOf(doc, node.name)['ui:formattedText'];
  return typeof f === 'string' ? f : `<p>${escapeHtml(node.title)}</p>`;
}

export const isRequired = (doc: FormDoc, name: string): boolean => entryRequired(doc.uiSchema[name]);
export const isInvisible = (doc: FormDoc, name: string): boolean => entryInvisible(doc.uiSchema[name]);

/** Anything that is not a structural/static widget collects a value (incl. unknown widgets). */
export const isInputWidget = (widget: string): boolean => !STRUCTURAL_WIDGETS.has(widget);
export const isSelectable = (widget: string): boolean => !NOT_SELECTABLE.has(widget);

export function getPages(doc: FormDoc): SchemaNode[] {
  return doc.schema.properties.filter((n) => getWidget(doc, n) === 'Page');
}

function isContainer(doc: FormDoc, n: SchemaNode): boolean {
  const w = getWidget(doc, n);
  return n.properties !== undefined && (w === 'Page' || w === 'Group' || n.type === 'object');
}

/** Flattened non-container nodes in document order; invisible nodes (and their subtree) are skipped unless showInvisible. */
export function visibleLeaves(doc: FormDoc, showInvisible: boolean): SchemaNode[] {
  const out: SchemaNode[] = [];
  const visit = (nodes: SchemaNode[]) => {
    for (const n of nodes) {
      if (!showInvisible && isInvisible(doc, n.name)) continue;
      if (isContainer(doc, n)) visit(n.properties ?? []);
      else out.push(n);
    }
  };
  visit(doc.schema.properties);
  return out;
}

export function requiredFields(doc: FormDoc, showInvisible: boolean): SchemaNode[] {
  return visibleLeaves(doc, showInvisible).filter(
    (n) => isInputWidget(getWidget(doc, n)) && isRequired(doc, n.name),
  );
}

export function findNode(nodes: SchemaNode[], name: string): SchemaNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = n.properties ? findNode(n.properties, name) : undefined;
    if (hit) return hit;
  }
  return undefined;
}
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `npx vitest run src/model/schemaWalk.test.ts && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): schema walking, widget/label defaults, visibility" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `progress` and `format`

**Files:**
- Create: `src/model/progress.ts`, `src/model/format.ts`
- Test: `src/model/progress.test.ts`, `src/model/format.test.ts`

**Interfaces:**
- Consumes: `requiredFields` from `./schemaWalk`; `FormDoc`, `Values`.
- Produces:
  - `progress.ts`: `interface Progress { completed: number; total: number; percent: number }`, `isFilled(v: unknown): boolean`, `computeProgress(doc: FormDoc, values: Values, showInvisible?: boolean): Progress`.
  - `format.ts`: `parseNumber(text: string): number | null`, `formatMoney(n: number): string`, `formatPercent(n: number): string`, `parseDateInput(text: string): string | null` (ISO `YYYY-MM-DD`), `formatDateDisplay(iso: string): string` (`MM-DD-YYYY`).

- [ ] **Step 1: Write the failing tests**

`src/model/progress.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { loadForm } from './loadForm';
import { computeProgress, isFilled } from './progress';

const doc = loadForm(demo);

describe('isFilled', () => {
  it.each([
    [undefined, false], [null, false], ['', false], ['   ', false],
    [0, true], ['x', true], [12.5, true], [NaN, false],
  ])('isFilled(%j) = %s', (v, expected) => {
    expect(isFilled(v)).toBe(expected);
  });
});

describe('computeProgress', () => {
  it('is 0 of 10 with no values', () => {
    expect(computeProgress(doc, {})).toEqual({ completed: 0, total: 10, percent: 0 });
  });
  it('counts filled visible required fields, ignoring non-required ones', () => {
    const values = { partnership: 'Yes', textbox2: '2026-01-02', textbox6: 'x' };
    expect(computeProgress(doc, values)).toEqual({ completed: 2, total: 10, percent: 20 });
  });
  it('includes invisible required fields only when shown', () => {
    expect(computeProgress(doc, {}, true).total).toBe(16);
  });
  it('is 0 percent (not 100) when nothing is required', () => {
    const empty = loadForm({ namespaceFormSchemaMap: { main: { schema: { properties: [] }, uiSchema: {} } } });
    expect(computeProgress(empty, {})).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});
```

`src/model/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatDateDisplay, formatMoney, formatPercent, parseDateInput, parseNumber } from './format';

describe('parseNumber (Review Focus 4)', () => {
  it.each([
    ['1000', 1000], ['1,000', 1000], ['$1,234.50', 1234.5], ['12.5%', 12.5], ['-5', -5], ['.5', 0.5], [' 7 ', 7],
  ])('parses %j', (text, n) => expect(parseNumber(text)).toBe(n));
  it.each(['', '   ', 'abc', '1e5', '1.2.3', '--1', '5.'])('rejects %j', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats money and percent', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatPercent(12.5)).toBe('12.5%');
  });
});

describe('parseDateInput (Review Focus 4)', () => {
  it.each([
    ['01-02-2026', '2026-01-02'], ['1/2/2026', '2026-01-02'], ['2026-01-02', '2026-01-02'], ['02-29-2028', '2028-02-29'],
  ])('parses %j', (text, iso) => expect(parseDateInput(text)).toBe(iso));
  it.each(['', 'abc', '02-30-2026', '13-01-2026', '00-10-2026', '02-29-2027', '1-2-26', '2026-13-01'])(
    'rejects %j',
    (text) => expect(parseDateInput(text)).toBeNull(),
  );
  it('formats ISO for display and passes unknown text through', () => {
    expect(formatDateDisplay('2026-01-02')).toBe('01-02-2026');
    expect(formatDateDisplay('garbage')).toBe('garbage');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/progress.test.ts src/model/format.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/model/progress.ts`**

```ts
import { requiredFields } from './schemaWalk';
import type { FormDoc, Values } from './types';

export interface Progress {
  completed: number;
  total: number;
  percent: number;
}

export function isFilled(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  return String(v).trim() !== '';
}

export function computeProgress(doc: FormDoc, values: Values, showInvisible = false): Progress {
  const req = requiredFields(doc, showInvisible);
  const completed = req.filter((n) => isFilled(values[n.name])).length;
  const total = req.length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}
```

- [ ] **Step 4: Implement `src/model/format.ts`**

```ts
/** Accepts "1,000", "$1,234.50", "12.5%", "-5", ".5"; rejects "", "abc", "1e5", "5.". */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[$,%\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const formatMoney = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const formatPercent = (n: number): string => `${n}%`;

/** MM-DD-YYYY, MM/DD/YYYY or YYYY-MM-DD -> ISO YYYY-MM-DD; null if not a real calendar date. */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let y: number;
  let m: number;
  let d: number;
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!iso) return null;
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatDateDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}-${m[3]}-${m[1]}` : iso;
}
```

- [ ] **Step 5: Run to verify pass, then commit**

Run: `npx vitest run src/model && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): progress counting and number/date parsing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `editOps`

**Files:**
- Create: `src/model/editOps.ts`
- Test: `src/model/editOps.test.ts`

**Interfaces:**
- Consumes: `escapeHtml`, `stripHtml` from `./html`; `entryRequired`, `REQUIRED_MESSAGE` from `./uiEntry`; `Option`, `SchemaNode`, `UiEntry`, `UiSchema` from `./types`.
- Produces (all pure; every setter returns a **new** `UiSchema` and never mutates input):
  - `labelText(entry: UiEntry | undefined, fallback: string): string`
  - `buildLabelHtml(text: string, required: boolean): string`
  - `setLabel(ui: UiSchema, name: string, text: string): UiSchema`
  - `setRequired(ui: UiSchema, name: string, required: boolean): UiSchema`
  - `setInvisible(ui: UiSchema, name: string, invisible: boolean): UiSchema`
  - `setWidget(ui: UiSchema, name: string, widget: string, node: SchemaNode): UiSchema` (adds "Option 1"/"Option 2" for Radio/Dropdown only if `getOptions` is empty)
  - `getOptions(entry: UiEntry | undefined, node: SchemaNode): Option[]`
  - `setOptions(ui: UiSchema, name: string, options: Option[]): UiSchema`
  - `nextOptionValue(options: Option[]): string` (`option_1`, `option_2`, ... first unused)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildLabelHtml, getOptions, labelText, nextOptionValue, setInvisible, setLabel, setOptions, setRequired, setWidget,
} from './editOps';
import type { SchemaNode, UiSchema } from './types';

const STAR = '<span style="color: rgb(219, 55, 55);">*</span>';
const node: SchemaNode = { name: 'f', type: 'string', title: 'F' };
const base = (): UiSchema => ({
  f: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>specify percentage ${STAR}</p>`, 'ui:required': 'This field is required' },
});

describe('labelText / buildLabelHtml', () => {
  it('extracts text without the required star', () => {
    expect(labelText(base().f, 'x')).toBe('specify percentage');
  });
  it('falls back when there is no formattedText', () => {
    expect(labelText({}, 'Title')).toBe('Title');
    expect(labelText(undefined, 'Title')).toBe('Title');
  });
  it('builds html with or without the star', () => {
    expect(buildLabelHtml('A', true)).toBe(`<p>A ${STAR}</p>`);
    expect(buildLabelHtml('A', false)).toBe('<p>A</p>');
  });
});

describe('setLabel (Review Focus 3)', () => {
  it('keeps the star when required and does not mutate input', () => {
    const ui = base();
    const next = setLabel(ui, 'f', 'New');
    expect(next.f['ui:formattedText']).toBe(`<p>New ${STAR}</p>`);
    expect(ui.f['ui:formattedText']).toBe(`<p>specify percentage ${STAR}</p>`);
  });
  it('escapes special characters and round-trips them', () => {
    const next = setLabel(base(), 'f', `a < b & "c" <script>`);
    const html = next.f['ui:formattedText'] as string;
    expect(html).not.toContain('<script>');
    expect(labelText(next.f, '')).toBe(`a < b & "c" <script>`);
  });
  it('keeps trailing spaces so a controlled input does not eat them', () => {
    expect(labelText(setLabel(base(), 'f', 'abc ').f, '')).toBe('abc ');
  });
  it('stores Paragraph text escaped, with no star', () => {
    const ui: UiSchema = { p: { 'ui:widget': 'Paragraph', 'ui:formattedText': 'old' } };
    expect(setLabel(ui, 'p', 'a & b').p['ui:formattedText']).toBe('a &amp; b');
  });
  it('creates the entry if missing', () => {
    expect(setLabel({}, 'z', 'Hi').z['ui:formattedText']).toBe('<p>Hi</p>');
  });
});

describe('setRequired / setInvisible', () => {
  it('turns required off and removes the star', () => {
    const next = setRequired(base(), 'f', false);
    expect(next.f['ui:required']).toBeUndefined();
    expect(next.f['ui:formattedText']).toBe('<p>specify percentage</p>');
  });
  it('turns required on and adds the star', () => {
    const off = setRequired(base(), 'f', false);
    const on = setRequired(off, 'f', true);
    expect(on.f['ui:required']).toBe('This field is required');
    expect(on.f['ui:formattedText']).toBe(`<p>specify percentage ${STAR}</p>`);
  });
  it('toggles invisible', () => {
    const on = setInvisible(base(), 'f', true);
    expect(on.f['ui:invisible']).toBe(true);
    expect('ui:invisible' in setInvisible(on, 'f', false).f).toBe(false);
  });
});

describe('options (Review Focus 1)', () => {
  const withOpts: UiSchema = {
    f: { 'ui:multipleOption': { options: [['A', { formattedText: '<p>Class A</p>', blueprintMetadataMapping: '' }], ['B', { formattedText: '<p>Class B</p>' }]] } },
  };
  it('reads options from ui:multipleOption with stripped labels', () => {
    expect(getOptions(withOpts.f, node)).toEqual([{ value: 'A', label: 'Class A' }, { value: 'B', label: 'Class B' }]);
  });
  it('falls back to schema enum when ui:multipleOption is absent', () => {
    expect(getOptions({}, { ...node, enum: ['x', 'y'] })).toEqual([{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }]);
  });
  it('returns [] when neither exists, and tolerates malformed entries', () => {
    expect(getOptions(undefined, node)).toEqual([]);
    expect(getOptions({ 'ui:multipleOption': { options: [null, 5, [1, 2], ['ok']] } }, node)).toEqual([{ value: 'ok', label: 'ok' }]);
  });
  it('setOptions round-trips through getOptions and escapes labels', () => {
    const opts = [{ value: 'a', label: 'A & B' }, { value: 'b', label: 'B' }];
    const next = setOptions({}, 'f', opts);
    expect(getOptions(next.f, node)).toEqual(opts);
  });
  it('nextOptionValue picks the first unused option_N', () => {
    expect(nextOptionValue([])).toBe('option_1');
    expect(nextOptionValue([{ value: 'option_1', label: '' }, { value: 'option_3', label: '' }])).toBe('option_2');
  });
});

describe('setWidget', () => {
  it('switches widget and seeds default options for Radio when none exist', () => {
    const next = setWidget(base(), 'f', 'Radio', node);
    expect(next.f['ui:widget']).toBe('Radio');
    expect(getOptions(next.f, node).map((o) => o.label)).toEqual(['Option 1', 'Option 2']);
  });
  it('does not seed when the schema enum already provides options', () => {
    const enumNode = { ...node, enum: ['x'] };
    const next = setWidget(base(), 'f', 'Dropdown', enumNode);
    expect(next.f['ui:multipleOption']).toBeUndefined();
    expect(getOptions(next.f, enumNode)).toHaveLength(1);
  });
  it('does not seed for non-choice widgets', () => {
    expect(setWidget(base(), 'f', 'Money', node).f['ui:multipleOption']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/editOps.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/model/editOps.ts`**

```ts
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

export function buildLabelHtml(text: string, required: boolean): string {
  return `<p>${escapeHtml(text)}${required ? STAR : ''}</p>`;
}

export function setLabel(ui: UiSchema, name: string, text: string): UiSchema {
  return patch(ui, name, (e) => ({
    ...e,
    'ui:formattedText': e['ui:widget'] === 'Paragraph' ? escapeHtml(text) : buildLabelHtml(text, entryRequired(e)),
  }));
}

/** Note: re-building the label flattens any rich markup (bold etc.) down to plain text + star. */
export function setRequired(ui: UiSchema, name: string, required: boolean): UiSchema {
  return patch(ui, name, (e) => {
    const next: UiEntry = { ...e };
    if (required) next['ui:required'] = REQUIRED_MESSAGE;
    else delete next['ui:required'];
    if (typeof next['ui:formattedText'] === 'string' && next['ui:widget'] !== 'Paragraph') {
      next['ui:formattedText'] = buildLabelHtml(labelText(next, ''), required);
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

export function getOptions(entry: UiEntry | undefined, node: SchemaNode): Option[] {
  const mo = entry?.['ui:multipleOption'] as { options?: unknown } | undefined;
  const raw = mo?.options;
  if (Array.isArray(raw)) {
    return raw.flatMap((item): Option[] => {
      if (!Array.isArray(item) || typeof item[0] !== 'string') return [];
      const meta = item[1] as { formattedText?: unknown } | undefined;
      const label = typeof meta?.formattedText === 'string' ? stripHtml(meta.formattedText) : item[0];
      return [{ value: item[0], label }];
    });
  }
  return (node.enum ?? []).map((v) => ({ value: v, label: v }));
}

export function setOptions(ui: UiSchema, name: string, options: Option[]): UiSchema {
  return patch(ui, name, (e) => ({
    ...e,
    'ui:multipleOption': {
      ...((e['ui:multipleOption'] as object | undefined) ?? {}),
      options: options.map((o) => [
        o.value,
        { formattedText: `<p>${escapeHtml(o.label)}</p>`, blueprintMetadataMapping: '' },
      ]),
    },
  }));
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
```

- [ ] **Step 4: Run to verify pass, then commit**

Run: `npx vitest run src/model && npm run typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(model): pure uiSchema edit operations" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `history`, reducer, and store

**Files:**
- Create: `src/model/history.ts`, `src/state/formReducer.ts`, `src/state/useFormStore.tsx`
- Test: `src/model/history.test.ts`, `src/state/formReducer.test.ts`

**Interfaces:**
- Consumes: `FormDoc`, `UiSchema`, `Values`; `getPages` from `../model/schemaWalk`.
- Produces:
  - `history.ts`: `interface Snapshot { uiSchema: UiSchema; values: Values }`, `HISTORY_LIMIT = 100`, `pushSnapshot(stack: Snapshot[], snap: Snapshot): Snapshot[]`, `popSnapshot(stack: Snapshot[]): { snapshot: Snapshot | undefined; stack: Snapshot[] }`.
  - `formReducer.ts`:
    ```ts
    interface FormState { doc: FormDoc; values: Values; selection: string | null; showInvisible: boolean;
      activePage: string | null; history: Snapshot[]; lastKey: string | null; notice: string | null }
    type Action =
      | { type: 'setValue'; name: string; value: unknown }
      | { type: 'editUi'; uiSchema: UiSchema; key: string }
      | { type: 'select'; name: string | null }
      | { type: 'toggleInvisible' }
      | { type: 'setPage'; name: string }
      | { type: 'undo' } | { type: 'reset' }
      | { type: 'loadDoc'; doc: FormDoc }
      | { type: 'notify'; message: string } | { type: 'dismissNotice' }
    initialState(doc: FormDoc): FormState
    formReducer(state: FormState, action: Action): FormState
    ```
  - `useFormStore.tsx`: `FormProvider({ initialDoc, children })`, `useForm(): { state: FormState; dispatch: Dispatch<Action> }`.
- Coalescing rule: `setValue` uses key `v:<name>`; `editUi` uses its `key`. A snapshot is pushed before the change only when the key differs from `state.lastKey`. Every other action sets `lastKey` to `null`.

- [ ] **Step 1: Write the failing tests**

`src/model/history.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, popSnapshot, pushSnapshot, type Snapshot } from './history';

const snap = (n: number): Snapshot => ({ uiSchema: {}, values: { n } });

describe('history', () => {
  it('pushes without mutating', () => {
    const a: Snapshot[] = [];
    const b = pushSnapshot(a, snap(1));
    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
  });
  it('pops the latest snapshot', () => {
    const { snapshot, stack } = popSnapshot([snap(1), snap(2)]);
    expect(snapshot?.values).toEqual({ n: 2 });
    expect(stack).toHaveLength(1);
  });
  it('pop on empty returns undefined and an empty stack (Review Focus 5)', () => {
    expect(popSnapshot([])).toEqual({ snapshot: undefined, stack: [] });
  });
  it('caps the stack at HISTORY_LIMIT, dropping the oldest', () => {
    let s: Snapshot[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) s = pushSnapshot(s, snap(i));
    expect(s).toHaveLength(HISTORY_LIMIT);
    expect(s[0].values).toEqual({ n: 5 });
  });
});
```

`src/state/formReducer.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { FormDoc } from '../model/types';
import { formReducer, initialState } from './formReducer';

const doc: FormDoc = {
  schema: {
    type: 'object',
    properties: [
      { name: 'p', type: 'object', title: 'Page', properties: [
        { name: 'a', type: 'string', title: 'A' },
        { name: 'b', type: 'string', title: 'B' },
      ] },
    ],
  },
  uiSchema: { p: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'TextBox' } },
};
const fresh = () => initialState(doc);

describe('initialState', () => {
  it('selects the first page', () => {
    expect(fresh().activePage).toBe('p');
    expect(fresh().history).toEqual([]);
  });
  it('has no active page when the doc has none', () => {
    expect(initialState({ schema: { type: 'object', properties: [] }, uiSchema: {} }).activePage).toBeNull();
  });
});

describe('setValue + undo', () => {
  it('sets a value and undo restores the previous values', () => {
    let s = formReducer(fresh(), { type: 'setValue', name: 'a', value: 'x' });
    expect(s.values).toEqual({ a: 'x' });
    s = formReducer(s, { type: 'undo' });
    expect(s.values).toEqual({});
  });
  it('coalesces consecutive edits to the same field into one undo step', () => {
    let s = fresh();
    for (const v of ['h', 'he', 'hel']) s = formReducer(s, { type: 'setValue', name: 'a', value: v });
    expect(s.history).toHaveLength(1);
    s = formReducer(s, { type: 'undo' });
    expect(s.values).toEqual({});
  });
  it('starts a new undo step when the field changes', () => {
    let s = formReducer(fresh(), { type: 'setValue', name: 'a', value: '1' });
    s = formReducer(s, { type: 'setValue', name: 'b', value: '2' });
    expect(s.history).toHaveLength(2);
    s = formReducer(s, { type: 'undo' });
    expect(s.values).toEqual({ a: '1' });
  });
  it('select breaks coalescing', () => {
    let s = formReducer(fresh(), { type: 'setValue', name: 'a', value: '1' });
    s = formReducer(s, { type: 'select', name: 'a' });
    s = formReducer(s, { type: 'setValue', name: 'a', value: '12' });
    expect(s.history).toHaveLength(2);
  });
  it('undo on empty history is a no-op (Review Focus 5)', () => {
    const s = fresh();
    expect(formReducer(s, { type: 'undo' })).toBe(s);
  });
});

describe('editUi', () => {
  it('replaces uiSchema and undo restores it', () => {
    const edited = { ...doc.uiSchema, a: { 'ui:widget': 'Money' } };
    let s = formReducer(fresh(), { type: 'editUi', uiSchema: edited, key: 'k1' });
    expect(s.doc.uiSchema.a['ui:widget']).toBe('Money');
    s = formReducer(s, { type: 'undo' });
    expect(s.doc.uiSchema.a['ui:widget']).toBe('TextBox');
  });
  it('coalesces edits that share a key', () => {
    let s = fresh();
    s = formReducer(s, { type: 'editUi', uiSchema: { ...doc.uiSchema }, key: 'label:a' });
    s = formReducer(s, { type: 'editUi', uiSchema: { ...doc.uiSchema }, key: 'label:a' });
    expect(s.history).toHaveLength(1);
  });
});

describe('reset (Review Focus 5)', () => {
  it('clears values and undo restores them', () => {
    let s = formReducer(fresh(), { type: 'setValue', name: 'a', value: 'x' });
    s = formReducer(s, { type: 'reset' });
    expect(s.values).toEqual({});
    s = formReducer(s, { type: 'undo' });
    expect(s.values).toEqual({ a: 'x' });
  });
  it('adds no snapshot when values are already empty', () => {
    const s = fresh();
    expect(formReducer(s, { type: 'reset' })).toBe(s);
  });
});

describe('loadDoc, toggles, notices', () => {
  it('loadDoc replaces everything but keeps showInvisible', () => {
    let s = formReducer(fresh(), { type: 'toggleInvisible' });
    s = formReducer(s, { type: 'setValue', name: 'a', value: 'x' });
    s = formReducer(s, { type: 'select', name: 'a' });
    const next: FormDoc = { schema: { type: 'object', properties: [] }, uiSchema: {} };
    s = formReducer(s, { type: 'loadDoc', doc: next });
    expect(s.doc).toBe(next);
    expect(s.values).toEqual({});
    expect(s.selection).toBeNull();
    expect(s.history).toEqual([]);
    expect(s.showInvisible).toBe(true);
  });
  it('toggleInvisible flips and setPage/select/notify/dismiss work', () => {
    let s = formReducer(fresh(), { type: 'toggleInvisible' });
    expect(s.showInvisible).toBe(true);
    s = formReducer(s, { type: 'select', name: 'b' });
    expect(s.selection).toBe('b');
    s = formReducer(s, { type: 'setPage', name: 'p' });
    expect(s.activePage).toBe('p');
    s = formReducer(s, { type: 'notify', message: 'hi' });
    expect(s.notice).toBe('hi');
    s = formReducer(s, { type: 'dismissNotice' });
    expect(s.notice).toBeNull();
  });
  it('notify leaves the doc untouched (failed load keeps the current form)', () => {
    const s = fresh();
    expect(formReducer(s, { type: 'notify', message: 'File is not valid JSON' }).doc).toBe(s.doc);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/model/history.test.ts src/state/formReducer.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/model/history.ts`**

```ts
import type { UiSchema, Values } from './types';

export interface Snapshot {
  uiSchema: UiSchema;
  values: Values;
}

export const HISTORY_LIMIT = 100;

export function pushSnapshot(stack: Snapshot[], snap: Snapshot): Snapshot[] {
  const next = [...stack, snap];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

export function popSnapshot(stack: Snapshot[]): { snapshot: Snapshot | undefined; stack: Snapshot[] } {
  if (stack.length === 0) return { snapshot: undefined, stack };
  return { snapshot: stack[stack.length - 1], stack: stack.slice(0, -1) };
}
```

- [ ] **Step 4: Implement `src/state/formReducer.ts`**

```ts
import { popSnapshot, pushSnapshot, type Snapshot } from '../model/history';
import { getPages } from '../model/schemaWalk';
import type { FormDoc, UiSchema, Values } from '../model/types';

export interface FormState {
  doc: FormDoc;
  values: Values;
  selection: string | null;
  showInvisible: boolean;
  activePage: string | null;
  history: Snapshot[];
  lastKey: string | null;
  notice: string | null;
}

export type Action =
  | { type: 'setValue'; name: string; value: unknown }
  | { type: 'editUi'; uiSchema: UiSchema; key: string }
  | { type: 'select'; name: string | null }
  | { type: 'toggleInvisible' }
  | { type: 'setPage'; name: string }
  | { type: 'undo' }
  | { type: 'reset' }
  | { type: 'loadDoc'; doc: FormDoc }
  | { type: 'notify'; message: string }
  | { type: 'dismissNotice' };

export function initialState(doc: FormDoc): FormState {
  return {
    doc,
    values: {},
    selection: null,
    showInvisible: false,
    activePage: getPages(doc)[0]?.name ?? null,
    history: [],
    lastKey: null,
    notice: null,
  };
}

function snapshot(s: FormState): Snapshot {
  return { uiSchema: s.doc.uiSchema, values: s.values };
}

/** Push a snapshot unless this edit continues the previous one (same coalescing key). */
function historyFor(s: FormState, key: string): Snapshot[] {
  return s.lastKey === key ? s.history : pushSnapshot(s.history, snapshot(s));
}

export function formReducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'setValue': {
      const key = `v:${action.name}`;
      return {
        ...state,
        history: historyFor(state, key),
        lastKey: key,
        values: { ...state.values, [action.name]: action.value },
      };
    }
    case 'editUi':
      return {
        ...state,
        history: historyFor(state, action.key),
        lastKey: action.key,
        doc: { ...state.doc, uiSchema: action.uiSchema },
      };
    case 'undo': {
      const { snapshot: snap, stack } = popSnapshot(state.history);
      if (!snap) return state;
      return {
        ...state,
        history: stack,
        lastKey: null,
        values: snap.values,
        doc: { ...state.doc, uiSchema: snap.uiSchema },
      };
    }
    case 'reset':
      if (Object.keys(state.values).length === 0) return state;
      return { ...state, history: pushSnapshot(state.history, snapshot(state)), lastKey: null, values: {} };
    case 'select':
      return { ...state, selection: action.name, lastKey: null };
    case 'toggleInvisible':
      return { ...state, showInvisible: !state.showInvisible, lastKey: null };
    case 'setPage':
      return { ...state, activePage: action.name, lastKey: null };
    case 'loadDoc':
      return { ...initialState(action.doc), showInvisible: state.showInvisible };
    case 'notify':
      return { ...state, notice: action.message };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}
```

- [ ] **Step 5: Implement `src/state/useFormStore.tsx`**

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { FormDoc } from '../model/types';
import { formReducer, initialState, type Action, type FormState } from './formReducer';

interface Store {
  state: FormState;
  dispatch: Dispatch<Action>;
}

const Ctx = createContext<Store | null>(null);

export function FormProvider({ initialDoc, children }: { initialDoc: FormDoc; children: ReactNode }) {
  const [state, dispatch] = useReducer(formReducer, initialDoc, initialState);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useForm(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useForm must be used inside <FormProvider>');
  return store;
}
```

- [ ] **Step 6: Run to verify pass, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, typecheck clean.

```bash
git add -A
git commit -m "feat(state): reducer with undo/reset history and form store" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sanitizer, widgets, registry, `FieldRenderer`

**Files:**
- Create: `src/components/sanitize.ts`, `src/components/icons.tsx`, `src/components/FieldRenderer.tsx`
- Create: `src/widgets/shared.ts`, `Header.tsx`, `Paragraph.tsx`, `Containers.tsx`, `TextInputs.tsx`, `NumberInputs.tsx`, `DateWidget.tsx`, `Choice.tsx`, `Misc.tsx`, `registry.ts`
- Test: `src/components/sanitize.test.ts` (jsdom), `src/widgets/registry.test.ts`

**Interfaces:**
- Consumes: `useForm` (`../state/useFormStore`); `getWidget`, `getLabelHtml`, `uiOf`, `isInvisible`, `isSelectable` (`../model/schemaWalk`); `getOptions` (`../model/editOps`); `parseNumber`, `formatMoney`, `formatPercent`, `parseDateInput`, `formatDateDisplay` (`../model/format`).
- Produces:
  - `sanitizeHtml(html: string): string`
  - `icons.tsx`: `CalendarIcon`, `EyeIcon`, `SwapIcon`, `ChevronRightIcon` (each `() => JSX.Element`)
  - `shared.ts`: `WidgetProps { id: string; widget: string; node: SchemaNode; ui: UiEntry; value: unknown; onChange: (v: unknown) => void; options: Option[]; children?: ReactNode }`, `toText(v: unknown): string`, `uiString(v: unknown): string`
  - `registry.ts`: `interface WidgetDef { Component: ComponentType<WidgetProps>; hasLabel: boolean }`, `resolveWidget(name: string): WidgetDef`, plus `Unknown` re-exported from `Misc.tsx` for tests.
  - `FieldRenderer({ node }: { node: SchemaNode })`
- CSS classes used here are styled in Task 8: `field`, `field--selectable`, `field--selected`, `field--invisible`, `field__badge`, `field__label`, `w-header`, `w-header__subtitle`, `w-header__heading`, `w-header__rule`, `w-paragraph`, `w-group`, `w-input`, `w-input--invalid`, `w-textarea`, `w-select`, `w-number`, `w-date`, `w-date__icon`, `w-date__native`, `w-radio`, `w-radio--inline`, `w-radio__opt`, `w-radio__dot`, `w-unknown`.

- [ ] **Step 1: Write the failing tests**

`src/components/sanitize.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize';

describe('sanitizeHtml (Review Focus 3)', () => {
  it('keeps the required-star markup used by Form Builder labels', () => {
    const html = '<p>Is it exempt? <span style="color: rgb(219, 55, 55);">*</span></p>';
    const out = sanitizeHtml(html);
    expect(out).toContain('<p>');
    expect(out).toContain('*');
    expect(out).toContain('style=');
  });
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });
  it('strips event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">a</p><a href="#" onmouseover="y()">b</a>');
    expect(out).not.toMatch(/onclick|onmouseover/);
  });
  it('strips javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });
  it('drops disallowed tags like img/iframe but keeps text', () => {
    const out = sanitizeHtml('<img src=x onerror=alert(1)><iframe src="//e"></iframe><strong>ok</strong>');
    expect(out).toBe('<strong>ok</strong>');
  });
});
```

`src/widgets/registry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { Unknown } from './Misc';
import { resolveWidget } from './registry';

describe('registry (Review Focus 1)', () => {
  it('resolves every widget used by the demo form to a real component', () => {
    const used = new Set(Object.values(demo.namespaceFormSchemaMap.main.uiSchema).map((u) => (u as Record<string, string>)['ui:widget']));
    expect(used.size).toBe(12);
    for (const w of used) expect(resolveWidget(w).Component).not.toBe(Unknown);
  });
  it('falls back to Unknown (with a label) for unrecognised widgets', () => {
    const def = resolveWidget('Signature');
    expect(def.Component).toBe(Unknown);
    expect(def.hasLabel).toBe(true);
  });
  it('structural widgets have no label; inputs do', () => {
    expect(resolveWidget('Header').hasLabel).toBe(false);
    expect(resolveWidget('Paragraph').hasLabel).toBe(false);
    expect(resolveWidget('Radio').hasLabel).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components src/widgets`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement `src/components/sanitize.ts`**

```ts
import DOMPurify from 'dompurify';

const CONFIG = {
  ALLOWED_TAGS: ['p', 'span', 'strong', 'em', 'br', 'a', 'ul', 'ol', 'li'],
  ALLOWED_ATTR: ['style', 'href', 'target', 'rel'],
};

/** Sanitize Form Builder `formattedText` HTML before dangerouslySetInnerHTML. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG);
}
```

- [ ] **Step 4: Implement `src/components/icons.tsx`**

```tsx
const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const CalendarIcon = () => (
  <svg {...base} aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h4" /></svg>
);
export const EyeIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const SwapIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13" /></svg>
);
export const ChevronRightIcon = () => (
  <svg {...base} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
```

- [ ] **Step 5: Implement `src/widgets/shared.ts`**

```ts
import type { ReactNode } from 'react';
import type { Option, SchemaNode, UiEntry } from '../model/types';

export interface WidgetProps {
  id: string;
  widget: string;
  node: SchemaNode;
  ui: UiEntry;
  value: unknown;
  onChange: (v: unknown) => void;
  options: Option[];
  children?: ReactNode;
}

export const toText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const uiString = (v: unknown): string => (typeof v === 'string' ? v : '');
```

- [ ] **Step 6: Implement the widgets**

`src/widgets/Header.tsx`:
```tsx
import { uiString, type WidgetProps } from './shared';

export function Header({ ui }: WidgetProps) {
  return (
    <div className="w-header">
      <div className="w-header__subtitle">{uiString(ui['ui:subtitle'])}</div>
      <h1 className="w-header__heading">{uiString(ui['ui:heading'])}</h1>
      <div className="w-header__rule" />
    </div>
  );
}
```

`src/widgets/Paragraph.tsx`:
```tsx
import { sanitizeHtml } from '../components/sanitize';
import { uiString, type WidgetProps } from './shared';

export function Paragraph({ node, ui }: WidgetProps) {
  const html = uiString(ui['ui:formattedText']) || node.title;
  return <div className="w-paragraph" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />;
}
```

`src/widgets/Containers.tsx`:
```tsx
import type { WidgetProps } from './shared';

export function Page({ children }: WidgetProps) {
  return <>{children}</>;
}

export function Group({ children }: WidgetProps) {
  return <div className="w-group">{children}</div>;
}
```

`src/widgets/TextInputs.tsx`:
```tsx
import { toText, type WidgetProps } from './shared';

export function TextBox({ id, value, onChange }: WidgetProps) {
  return <input id={id} className="w-input" value={toText(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function TextArea({ id, value, onChange }: WidgetProps) {
  return (
    <textarea id={id} className="w-input w-textarea" rows={3} value={toText(value)} onChange={(e) => onChange(e.target.value)} />
  );
}
```

`src/widgets/NumberInputs.tsx`:
```tsx
import { useState } from 'react';
import { formatMoney, formatPercent, parseNumber } from '../model/format';
import { toText, type WidgetProps } from './shared';

type Props = Pick<WidgetProps, 'id' | 'value' | 'onChange'> & { format: (n: number) => string };

/** Free text while focused (draft), formatted when blurred. Stores a number, or '' when cleared. */
function NumberField({ id, value, onChange, format }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = typeof value === 'number' ? format(value) : toText(value);
  const shown = draft ?? stored;
  const invalid = draft !== null && draft.trim() !== '' && parseNumber(draft) === null;
  return (
    <div className="w-number">
      <input
        id={id}
        className={`w-input${invalid ? ' w-input--invalid' : ''}`}
        inputMode="decimal"
        value={shown}
        onFocus={() => setDraft(typeof value === 'number' ? String(value) : toText(value))}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          if (t.trim() === '') onChange('');
          else {
            const n = parseNumber(t);
            if (n !== null) onChange(n);
          }
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

export const Money = (p: WidgetProps) => <NumberField id={p.id} value={p.value} onChange={p.onChange} format={formatMoney} />;
export const Percentage = (p: WidgetProps) => <NumberField id={p.id} value={p.value} onChange={p.onChange} format={formatPercent} />;
```

`src/widgets/DateWidget.tsx`:
```tsx
import { useRef, useState } from 'react';
import { CalendarIcon } from '../components/icons';
import { formatDateDisplay, parseDateInput } from '../model/format';
import { toText, type WidgetProps } from './shared';

/** Stores ISO YYYY-MM-DD. Typed text accepts MM-DD-YYYY; invalid text is flagged and never stored. */
export function DateWidget({ id, value, onChange }: WidgetProps) {
  const iso = toText(value);
  const [draft, setDraft] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const shown = draft ?? (iso ? formatDateDisplay(iso) : '');
  const invalid = draft !== null && draft.trim() !== '' && parseDateInput(draft) === null;
  return (
    <div className="w-date">
      <button type="button" className="w-date__icon" aria-label="Pick a date" onClick={() => picker.current?.showPicker?.()}>
        <CalendarIcon />
      </button>
      <input
        id={id}
        className={`w-input${invalid ? ' w-input--invalid' : ''}`}
        placeholder="Pick a date, or enter as MM-DD-YYYY"
        value={shown}
        onFocus={() => setDraft(shown)}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          if (t.trim() === '') onChange('');
          else {
            const parsed = parseDateInput(t);
            if (parsed) onChange(parsed);
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <input ref={picker} type="date" className="w-date__native" tabIndex={-1} aria-hidden="true" value={iso} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
```

`src/widgets/Choice.tsx`:
```tsx
import { toText, type WidgetProps } from './shared';

export function Radio({ id, ui, value, onChange, options }: WidgetProps) {
  const inline = ui['ui:fixedLayout'] === 'Inline';
  return (
    <div className={`w-radio${inline ? ' w-radio--inline' : ''}`} role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="w-radio__opt">
          <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="w-radio__dot" />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Dropdown({ id, value, onChange, options }: WidgetProps) {
  return (
    <select id={id} className="w-input w-select" value={toText(value)} onChange={(e) => onChange(e.target.value)}>
      <option value="" />
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

`src/widgets/Misc.tsx`:
```tsx
import type { WidgetProps } from './shared';

/** The File node only carries the PDF template name; it renders nothing in the canvas. */
export function FileWidget() {
  return null;
}

export function Unknown({ widget }: WidgetProps) {
  return <div className="w-unknown">Unsupported widget: {widget || '(none)'}</div>;
}
```

`src/widgets/registry.ts`:
```ts
import type { ComponentType } from 'react';
import { Dropdown, Radio } from './Choice';
import { Group, Page } from './Containers';
import { DateWidget } from './DateWidget';
import { Header } from './Header';
import { FileWidget, Unknown } from './Misc';
import { Money, Percentage } from './NumberInputs';
import { Paragraph } from './Paragraph';
import type { WidgetProps } from './shared';
import { TextArea, TextBox } from './TextInputs';

export interface WidgetDef {
  Component: ComponentType<WidgetProps>;
  hasLabel: boolean;
}

const WIDGETS: Record<string, WidgetDef> = {
  Header: { Component: Header, hasLabel: false },
  Page: { Component: Page, hasLabel: false },
  Group: { Component: Group, hasLabel: false },
  Paragraph: { Component: Paragraph, hasLabel: false },
  File: { Component: FileWidget, hasLabel: false },
  TextBox: { Component: TextBox, hasLabel: true },
  TextArea: { Component: TextArea, hasLabel: true },
  Money: { Component: Money, hasLabel: true },
  Percentage: { Component: Percentage, hasLabel: true },
  Date: { Component: DateWidget, hasLabel: true },
  Radio: { Component: Radio, hasLabel: true },
  Dropdown: { Component: Dropdown, hasLabel: true },
};

const UNKNOWN: WidgetDef = { Component: Unknown, hasLabel: true };

export function resolveWidget(name: string): WidgetDef {
  return Object.prototype.hasOwnProperty.call(WIDGETS, name) ? WIDGETS[name] : UNKNOWN;
}

export { Unknown };
```

Note: `registry.test.ts` imports `Unknown` from `./Misc`; the re-export is for convenience only.

- [ ] **Step 7: Implement `src/components/FieldRenderer.tsx`**

```tsx
import type { MouseEvent } from 'react';
import { getOptions } from '../model/editOps';
import { getLabelHtml, getWidget, isInvisible, isSelectable, uiOf } from '../model/schemaWalk';
import type { SchemaNode } from '../model/types';
import { useForm } from '../state/useFormStore';
import { resolveWidget } from '../widgets/registry';
import { sanitizeHtml } from './sanitize';

const px = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function FieldRenderer({ node }: { node: SchemaNode }) {
  const { state, dispatch } = useForm();
  const { doc, values, showInvisible, selection, activePage } = state;
  const widget = getWidget(doc, node);
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
  ]
    .filter(Boolean)
    .join(' ');
  const onClick = selectable
    ? (e: MouseEvent) => {
        e.stopPropagation();
        dispatch({ type: 'select', name: node.name });
      }
    : undefined;

  return (
    <div
      className={classes}
      style={{ paddingLeft: px(ui['ui:indentation']), marginBottom: px(ui['ui:marginBottom']) }}
      onClick={onClick}
      data-field={node.name}
    >
      {invisible && <span className="field__badge">invisible</span>}
      {hasLabel && (
        <div className="field__label" dangerouslySetInnerHTML={{ __html: sanitizeHtml(getLabelHtml(doc, node)) }} />
      )}
      <Component
        id={node.name}
        widget={widget}
        node={node}
        ui={ui}
        value={values[node.name]}
        onChange={(value) => dispatch({ type: 'setValue', name: node.name, value })}
        options={getOptions(ui, node)}
      >
        {node.properties?.map((child) => <FieldRenderer key={child.name} node={child} />)}
      </Component>
    </div>
  );
}
```

- [ ] **Step 8: Run to verify pass and typecheck, then commit**

Run: `npx vitest run && npm run typecheck`
Expected: all tests PASS, typecheck clean.

```bash
git add -A
git commit -m "feat: sanitizer, widget registry, and schema-driven FieldRenderer" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Layout shell, styles, and visual verification

**Files:**
- Create: `src/components/Inert.tsx`, `Toast.tsx`, `TopBar.tsx`, `TocPanel.tsx`, `FormCanvas.tsx`, `ToolsPanel.tsx`
- Modify: `src/App.tsx`, `src/styles/app.css` (replace placeholders)
- Create: `.claude/launch.json` (git-ignored; used by the browser preview only)

**Interfaces:**
- Consumes: `useForm`, `FormProvider`; `computeProgress` (`../model/progress`); `getPages` (`../model/schemaWalk`); `parseFormJson` (`../model/loadForm`); `loadForm`; `FieldRenderer`; icons; `demo-form.json`.
- Produces:
  - `Inert.tsx`: `InertButton({ className, label, children })` (button that dispatches `notify` "“<label>” isn't part of this prototype" on click, `title="Not in prototype"`), `Toggle({ checked, onChange, label })`, `ToggleRow({ label, checked?, onToggle?, defaultOn? })` (wired when `onToggle` is provided; otherwise flips local state only and shows the tooltip).
  - `App` default export; `Shell` renders `TopBar`, a `.card` containing `TocPanel` + `FormCanvas`, an `<aside className="right">` showing `ToolsPanel` (Task 9 swaps in `PropertiesDrawer` when a field is selected), and `Toast`.

- [ ] **Step 1: Implement `src/components/Inert.tsx`**

```tsx
import { useState, type ReactNode } from 'react';
import { useForm } from '../state/useFormStore';

export function InertButton({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const { dispatch } = useForm();
  return (
    <button
      type="button"
      className={className}
      title="Not in prototype"
      onClick={() => dispatch({ type: 'notify', message: `“${label}” isn't part of this prototype` })}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' toggle--on' : ''}`} onClick={onChange}>
      <span className="toggle__knob" />
    </button>
  );
}

/** Wired when `onToggle` is given (controlled by `checked`); otherwise flips visually only. */
export function ToggleRow({ label, checked, onToggle, defaultOn = false }: { label: string; checked?: boolean; onToggle?: () => void; defaultOn?: boolean }) {
  const [local, setLocal] = useState(defaultOn);
  const wired = onToggle !== undefined;
  return (
    <div className="tool-row" title={wired ? undefined : 'Not in prototype'}>
      <span>{label}</span>
      <Toggle label={label} checked={wired ? Boolean(checked) : local} onChange={wired ? onToggle : () => setLocal((v) => !v)} />
    </div>
  );
}
```

- [ ] **Step 2: Implement `src/components/Toast.tsx`**

```tsx
import { useEffect } from 'react';
import { useForm } from '../state/useFormStore';

export function Toast() {
  const { state, dispatch } = useForm();
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => dispatch({ type: 'dismissNotice' }), 4000);
    return () => clearTimeout(t);
  }, [state.notice, dispatch]);
  if (!state.notice) return null;
  return (
    <div className="toast" role="status" onClick={() => dispatch({ type: 'dismissNotice' })}>
      {state.notice}
    </div>
  );
}
```

- [ ] **Step 3: Implement `src/components/TopBar.tsx`** (includes Load form JSON)

```tsx
import { useRef, type ChangeEvent } from 'react';
import { parseFormJson } from '../model/loadForm';
import { useForm } from '../state/useFormStore';
import { InertButton } from './Inert';

export function TopBar() {
  const { dispatch } = useForm();
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const doc = parseFormJson(await file.text());
      dispatch({ type: 'loadDoc', doc });
      dispatch({ type: 'notify', message: `Loaded “${file.name}”` });
    } catch (err) {
      dispatch({ type: 'notify', message: err instanceof Error ? err.message : 'Could not load file' });
    }
  }

  return (
    <header className="topbar">
      <div className="topbar__tab" />
      <div className="topbar__actions">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Load form JSON
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onFile} />
        <InertButton className="btn" label="Save and close">
          Save and close
        </InertButton>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Implement `src/components/TocPanel.tsx`**

```tsx
import { computeProgress } from '../model/progress';
import { getPages } from '../model/schemaWalk';
import { useForm } from '../state/useFormStore';
import { InertButton } from './Inert';

export function TocPanel() {
  const { state, dispatch } = useForm();
  const { doc, values, showInvisible, activePage, history } = state;
  const { percent } = computeProgress(doc, values, showInvisible);
  return (
    <nav className="toc">
      <h2 className="toc__title">Table of Contents</h2>
      <div className="progress" aria-label="Form progress">
        <div className="progress__fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="toc__percent">{percent}% completed</div>
      <ul className="toc__pages">
        {getPages(doc).map((p) => (
          <li key={p.name}>
            <button type="button" className={`toc__page${activePage === p.name ? ' toc__page--active' : ''}`} onClick={() => dispatch({ type: 'setPage', name: p.name })}>
              <span>{p.title}</span>
              <span className="toc__dot" />
            </button>
          </li>
        ))}
      </ul>
      <div className="toc__buttons">
        <InertButton className="toc-btn" label="Preview data">👁 Preview data</InertButton>
        <InertButton className="toc-btn" label="Supporting documents">🗎 Supporting documents</InertButton>
        <InertButton className="toc-btn" label="Export">⇪ Export</InertButton>
        <InertButton className="toc-btn" label="Import">⇩ Import</InertButton>
        <button type="button" className="toc-btn toc-btn--undo" disabled={history.length === 0} onClick={() => dispatch({ type: 'undo' })}>
          ↶ Undo last action
        </button>
        <button type="button" className="toc-btn toc-btn--reset" onClick={() => dispatch({ type: 'reset' })}>
          🗑 Reset form data
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Implement `src/components/FormCanvas.tsx`**

```tsx
import { useForm } from '../state/useFormStore';
import { FieldRenderer } from './FieldRenderer';
import { InertButton } from './Inert';

export function FormCanvas() {
  const { state, dispatch } = useForm();
  return (
    <main className="canvas" onClick={() => dispatch({ type: 'select', name: null })}>
      {state.doc.schema.properties.map((n) => (
        <FieldRenderer key={n.name} node={n} />
      ))}
      <div className="canvas__footer">
        <InertButton className="btn" label="Save and close">
          Save and close
        </InertButton>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Implement `src/components/ToolsPanel.tsx`**

```tsx
import { useForm } from '../state/useFormStore';
import { ChevronRightIcon, EyeIcon, SwapIcon } from './icons';
import { InertButton, ToggleRow } from './Inert';

export function ToolsPanel() {
  const { state, dispatch } = useForm();
  return (
    <div className="tools">
      <div className="tool-row">
        <span>Profile</span>
        <span className="tool-row__actions">
          <InertButton className="link-btn link-btn--muted" label="Fill form">✎ Fill form</InertButton>
          <InertButton className="link-btn" label="Save profile">🗎 Save profile</InertButton>
        </span>
      </div>
      <div className="tool-row">
        <span>Values</span>
        <span className="tool-row__actions">
          <InertButton className="icon-btn" label="Values"><EyeIcon /></InertButton>
          <InertButton className="icon-btn icon-btn--red" label="Swap values"><SwapIcon /></InertButton>
        </span>
      </div>
      <InertButton className="tool-row tool-row--button" label="Signatures">
        <span>Signatures</span>
        <ChevronRightIcon />
      </InertButton>
      <InertButton className="tool-row tool-row--button" label="Additional documents">
        <span>Additional documents</span>
        <ChevronRightIcon />
      </InertButton>
      <ToggleRow label="Preview commenting" />
      <ToggleRow label="Show alias" />
      <ToggleRow label="Enable form rules" defaultOn />
      <ToggleRow label="Use new viewer (MVU)" defaultOn />
      <ToggleRow label="Show invisible pages & fields" checked={state.showInvisible} onToggle={() => dispatch({ type: 'toggleInvisible' })} />
      <InertButton className="tool-btn" label="View summary">☑ View summary</InertButton>
      <InertButton className="tool-btn" label="View table">▦ View table</InertButton>
      <InertButton className="tool-btn" label="Generate PDF">⎙ Generate PDF</InertButton>
      <InertButton className="tool-btn" label="Enter Live Preview mode">⌕ Enter Live Preview mode</InertButton>
    </div>
  );
}
```

- [ ] **Step 7: Replace `src/App.tsx`**

```tsx
import { FormCanvas } from './components/FormCanvas';
import { Toast } from './components/Toast';
import { ToolsPanel } from './components/ToolsPanel';
import { TocPanel } from './components/TocPanel';
import { TopBar } from './components/TopBar';
import demoJson from './data/demo-form.json';
import { loadForm } from './model/loadForm';
import { FormProvider } from './state/useFormStore';

const demoDoc = loadForm(demoJson);

function Shell() {
  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <div className="card">
          <TocPanel />
          <FormCanvas />
        </div>
        <aside className="right">
          <ToolsPanel />
        </aside>
      </div>
      <Toast />
    </div>
  );
}

export default function App() {
  return (
    <FormProvider initialDoc={demoDoc}>
      <Shell />
    </FormProvider>
  );
}
```

- [ ] **Step 8: Replace `src/styles/app.css`**

```css
:root {
  --bg: #f4f7fa;
  --card: #fff;
  --text: #2f3b4a;
  --muted: #7b8794;
  --border: #d6dce3;
  --blue: #0f5ca8;
  --accent: #2b9bdc;
  --red: #e02f2f;
  --req: #db3737;
  --yellow: #fdebb8;
  --radius: 4px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif; }
button { font: inherit; color: inherit; cursor: pointer; }
p { margin: 0; }

.topbar { height: 82px; background: #fff; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 40px; position: relative; }
.topbar__tab { position: absolute; top: 0; left: 50%; width: 72px; height: 3px; background: var(--accent); }
.topbar__actions { display: flex; gap: 12px; margin-left: auto; }
.btn { background: #fff; border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 16px; box-shadow: 0 1px 1px rgba(0,0,0,.05); }
.btn:hover { background: #f7f9fb; }

.layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 40px; max-width: 1500px; margin: 26px auto; padding: 0 40px; align-items: start; }
.card { display: grid; grid-template-columns: 352px minmax(0, 1fr); background: var(--card); border-radius: 8px; box-shadow: 0 0 12px rgba(16,22,26,.06); padding: 44px 40px 40px 44px; gap: 0; }

.toc { padding-right: 40px; }
.toc__title { font-size: 22px; font-weight: 500; margin: 0 0 28px; }
.progress { height: 10px; border-radius: 6px; background: #cfe2f4; overflow: hidden; }
.progress__fill { height: 100%; background: var(--accent); transition: width .2s; }
.toc__percent { font-size: 13px; color: var(--muted); margin: 8px 0 28px; font-weight: 500; }
.toc__pages { list-style: none; margin: 0 0 22px; padding: 0; }
.toc__page { display: flex; width: 100%; justify-content: space-between; align-items: center; background: none; border: 0; padding: 6px 4px 6px 26px; color: var(--blue); font-weight: 600; font-size: 17px; text-align: left; }
.toc__page--active { color: var(--blue); }
.toc__dot { width: 11px; height: 11px; border-radius: 50%; border: 2px solid var(--blue); }
.toc__buttons { display: flex; flex-direction: column; gap: 10px; }
.toc-btn { width: 100%; padding: 6px 10px; font-size: 13px; font-weight: 500; background: #fff; border: 1px solid var(--border); border-radius: var(--radius); }
.toc-btn--undo { background: var(--yellow); border-color: #f3d98a; color: #8a6d1c; }
.toc-btn--undo:disabled { opacity: .6; cursor: default; }
.toc-btn--reset { background: var(--red); border-color: var(--red); color: #fff; }

.canvas { border-left: 1px solid var(--border); padding: 0 8px 0 48px; min-height: 600px; }
.canvas__footer { margin-top: 40px; }

.field { position: relative; border-radius: var(--radius); }
.field--selectable { cursor: pointer; outline: 2px solid transparent; outline-offset: 4px; }
.field--selectable:hover { outline-color: #d3e6f6; }
.field--selected, .field--selected:hover { outline-color: var(--accent); }
.field--invisible { outline: 2px dashed #b9c3cf; outline-offset: 4px; background: #fafbfc; }
.field--invisible.field--selected { outline-style: solid; outline-color: var(--accent); }
.field__badge { position: absolute; top: -9px; right: 0; background: #b9c3cf; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 0 6px; border-radius: 3px; }
.field__label { margin-bottom: 8px; }
.field__label span[style] { font-weight: 600; }

.w-header { text-align: center; margin-bottom: 40px; }
.w-header__subtitle { color: var(--muted); font-size: 15px; }
.w-header__heading { font-size: 28px; line-height: 1.25; font-weight: 600; text-transform: uppercase; margin: 8px 0 14px; }
.w-header__rule { width: 170px; height: 4px; background: var(--accent); margin: 0 auto; border-radius: 2px; }
.w-paragraph { margin-bottom: 4px; }
.w-group { display: block; }

.w-input { width: 100%; height: 42px; padding: 0 12px; border: 1px solid var(--border); border-radius: var(--radius); background: #fff; font: inherit; color: var(--text); }
.w-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.w-input--invalid { border-color: var(--red); background: #fff6f6; }
.w-textarea { height: auto; padding: 8px 12px; resize: vertical; }
.w-select { appearance: none; background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0h10L5 6z' fill='%235c6b7a'/%3E%3C/svg%3E") no-repeat right 14px center; padding-right: 36px; }

.w-date { position: relative; }
.w-date .w-input { padding-left: 42px; }
.w-date__icon { position: absolute; left: 6px; top: 6px; width: 30px; height: 30px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; }
.w-date__native { position: absolute; left: 0; bottom: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.w-radio { display: flex; flex-direction: column; gap: 8px; }
.w-radio--inline { flex-direction: row; flex-wrap: wrap; gap: 28px; }
.w-radio__opt { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.w-radio__opt input { position: absolute; opacity: 0; pointer-events: none; }
.w-radio__dot { width: 22px; height: 22px; border-radius: 50%; border: 1px solid #c4ccd6; background: #fff; flex: none; }
.w-radio__opt input:checked + .w-radio__dot { border: 6px solid var(--accent); }
.w-radio__opt input:focus-visible + .w-radio__dot { outline: 2px solid var(--accent); outline-offset: 2px; }

.w-unknown { border: 1px dashed var(--border); border-radius: var(--radius); padding: 10px 12px; color: var(--muted); font-style: italic; }

.right { padding-top: 0; }
.tools { border-top: 1px solid var(--border); }
.tool-row { display: flex; align-items: center; justify-content: space-between; min-height: 69px; padding: 0 10px; border-bottom: 1px solid var(--border); background: none; border-left: 0; border-right: 0; border-top: 0; width: 100%; text-align: left; }
.tool-row--button { cursor: pointer; }
.tool-row__actions { display: flex; gap: 22px; align-items: center; }
.link-btn { background: none; border: 0; padding: 0; font-size: 15px; }
.link-btn--muted { color: #a3adb8; }
.icon-btn { background: none; border: 0; padding: 4px; color: #5c6b7a; display: grid; place-items: center; }
.icon-btn--red { color: var(--red); }
.tool-btn { display: block; width: 100%; margin: 21px 0; padding: 10px; background: #fff; border: 1px solid var(--border); border-radius: var(--radius); font-size: 16px; box-shadow: 0 1px 1px rgba(0,0,0,.05); }
.toggle { width: 42px; height: 22px; border-radius: 11px; border: 0; background: #e3e8ee; position: relative; padding: 0; transition: background .15s; flex: none; }
.toggle--on { background: #1e6fe0; }
.toggle__knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.toggle--on .toggle__knob { transform: translateX(20px); }

.drawer { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
.drawer__back { background: none; border: 0; color: var(--blue); padding: 0; margin-bottom: 14px; }
.drawer__title { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
.drawer__group { margin-bottom: 16px; }
.drawer__group label, .drawer__group .drawer__label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin-bottom: 6px; }
.drawer__check { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.drawer__option { display: flex; gap: 8px; margin-bottom: 8px; }
.drawer__option .btn { padding: 0 12px; }
.drawer__info { font-size: 13px; color: var(--muted); }
.drawer__info code { background: #f0f3f6; padding: 1px 5px; border-radius: 3px; }

.toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #1f2933; color: #fff; padding: 10px 18px; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.25); cursor: pointer; z-index: 50; }
```

- [ ] **Step 9: Typecheck and run the app**

Run: `npm run typecheck`
Expected: clean.

Create `.claude/launch.json`:
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "form-builder-proto", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev", "--", "--port", "5173", "--strictPort"], "port": 5173 }
  ]
}
```
Then use `mcp__Claude_Browser__preview_start` with `name: "form-builder-proto"`.

- [ ] **Step 10: Visually verify against the reference screenshot**

Using the browser pane (`get_page_text`, `read_page`, screenshot), confirm:
- Header "LIMITED PARTNERSHIP INTEREST TRANSFER AGREEMENT" with subtitle "Demo Form LP Transfer" and blue rule.
- Visible fields in order: "Is it an exempted partnership?" (inline Yes/No), date field with placeholder "Pick a date, or enter as MM-DD-YYYY", "are the transferor shown…" paragraph, Class radios (Class A / Class B / not applicable), "[exempted] limited partnership interest in", "(the “Partnership”) represented by…", "The Transferor desires to transfer and assign" dropdown (options "all of its right, title and interest in and to the Partnership" and "___ percentage % of its…"), the long AIV paragraph, "Clause (j) Section 1446(f)?" Yes/No, the Loan radio.
- Red `*` after required labels; progress "0% completed".
- The "capital commitment totaling" and "specify percentage" Group fields appear below the dropdown (documented deviation: no rules engine).
- Fill "Is it an exempted partnership?" -> progress rises to 10%. Click Undo -> back to 0%. Click Reset.
- Toggle "Show invisible pages & fields" -> 8 dashed-outline fields with "invisible" badge appear; progress denominator changes.
- Click any inert button -> toast "“…” isn't part of this prototype".
- Console has no errors (`read_console_messages` with `onlyErrors: true`).
Fix any discrepancy in CSS/components before committing.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: three-column shell, tools panel, TOC, and styles" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Properties drawer

**Files:**
- Create: `src/components/PropertiesDrawer.tsx`
- Modify: `src/App.tsx` (swap panel when a field is selected)

**Interfaces:**
- Consumes: `useForm`; `findNode`, `getWidget`, `uiOf`, `isInputWidget`, `isRequired`, `isInvisible`, `INPUT_WIDGETS` (`../model/schemaWalk`); `labelText`, `setLabel`, `setRequired`, `setInvisible`, `setWidget`, `getOptions`, `setOptions`, `nextOptionValue` (`../model/editOps`).
- Produces: `PropertiesDrawer()`. Edits dispatch `{ type: 'editUi', uiSchema, key }` with keys `label:<name>`, `opt:<name>:<index>` for option renames, and unique keys (`Date.now()`-suffixed) for discrete changes (widget, required, invisible, add/remove option) so each is its own undo step.

- [ ] **Step 1: Implement `src/components/PropertiesDrawer.tsx`**

```tsx
import { getOptions, labelText, nextOptionValue, setInvisible, setLabel, setOptions, setRequired, setWidget } from '../model/editOps';
import { findNode, getWidget, INPUT_WIDGETS, isInputWidget, isInvisible, isRequired, uiOf } from '../model/schemaWalk';
import type { UiSchema } from '../model/types';
import { useForm } from '../state/useFormStore';

export function PropertiesDrawer() {
  const { state, dispatch } = useForm();
  const { doc, selection } = state;
  const node = selection ? findNode(doc.schema.properties, selection) : undefined;
  if (!node) return null;

  const ui = uiOf(doc, node.name);
  const widget = getWidget(doc, node);
  const isInput = isInputWidget(widget);
  const isChoice = widget === 'Radio' || widget === 'Dropdown';
  const options = getOptions(ui, node);
  const widgetChoices = INPUT_WIDGETS.includes(widget) ? INPUT_WIDGETS : [widget, ...INPUT_WIDGETS];

  const edit = (uiSchema: UiSchema, key: string) => dispatch({ type: 'editUi', uiSchema, key });
  const discrete = (name: string) => `${name}:${node.name}:${Date.now()}`;

  return (
    <div className="drawer">
      <button type="button" className="drawer__back" onClick={() => dispatch({ type: 'select', name: null })}>
        ← Back to tools
      </button>
      <h3 className="drawer__title">Field properties</h3>

      <div className="drawer__group">
        <label htmlFor="prop-label">{widget === 'Paragraph' ? 'Text' : 'Label'}</label>
        {widget === 'Paragraph' ? (
          <textarea
            id="prop-label"
            className="w-input w-textarea"
            rows={5}
            value={labelText(ui, node.title)}
            onChange={(e) => edit(setLabel(doc.uiSchema, node.name, e.target.value), `label:${node.name}`)}
          />
        ) : (
          <input
            id="prop-label"
            className="w-input"
            value={labelText(ui, node.title)}
            onChange={(e) => edit(setLabel(doc.uiSchema, node.name, e.target.value), `label:${node.name}`)}
          />
        )}
      </div>

      {isInput && (
        <div className="drawer__group">
          <label htmlFor="prop-widget">Widget type</label>
          <select
            id="prop-widget"
            className="w-input w-select"
            value={widget}
            onChange={(e) => edit(setWidget(doc.uiSchema, node.name, e.target.value, node), discrete('widget'))}
          >
            {widgetChoices.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      )}

      {isInput && (
        <label className="drawer__check">
          <input
            type="checkbox"
            checked={isRequired(doc, node.name)}
            onChange={(e) => edit(setRequired(doc.uiSchema, node.name, e.target.checked), discrete('required'))}
          />
          Required
        </label>
      )}
      <label className="drawer__check">
        <input
          type="checkbox"
          checked={isInvisible(doc, node.name)}
          onChange={(e) => edit(setInvisible(doc.uiSchema, node.name, e.target.checked), discrete('invisible'))}
        />
        Invisible
      </label>

      {isChoice && (
        <div className="drawer__group">
          <span className="drawer__label">Options</span>
          {options.map((o, i) => (
            <div className="drawer__option" key={o.value}>
              <input
                className="w-input"
                aria-label={`Option ${i + 1}`}
                value={o.label}
                onChange={(e) =>
                  edit(
                    setOptions(doc.uiSchema, node.name, options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))),
                    `opt:${node.name}:${i}`,
                  )
                }
              />
              <button
                type="button"
                className="btn"
                aria-label={`Remove option ${i + 1}`}
                onClick={() => edit(setOptions(doc.uiSchema, node.name, options.filter((_, j) => j !== i)), discrete('optdel'))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() =>
              edit(
                setOptions(doc.uiSchema, node.name, [...options, { value: nextOptionValue(options), label: `Option ${options.length + 1}` }]),
                discrete('optadd'),
              )
            }
          >
            + Add option
          </button>
        </div>
      )}

      <div className="drawer__info">
        <div>Name: <code>{node.name}</code></div>
        <div>Schema type: <code>{node.type}</code></div>
        <div>PDF mapping: <code>{JSON.stringify(ui['ui:pdfMapping'] ?? [])}</code></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Swap the right panel in `src/App.tsx`**

Replace the `Shell` function with:
```tsx
function Shell() {
  const { state } = useForm();
  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <div className="card">
          <TocPanel />
          <FormCanvas />
        </div>
        <aside className="right">{state.selection ? <PropertiesDrawer /> : <ToolsPanel />}</aside>
      </div>
      <Toast />
    </div>
  );
}
```
and update imports: add `import { PropertiesDrawer } from './components/PropertiesDrawer';` and change the store import to `import { FormProvider, useForm } from './state/useFormStore';`.

- [ ] **Step 3: Typecheck and verify in the browser**

Run: `npm run typecheck`
Expected: clean.

In the running preview, confirm:
- Click "Is it an exempted partnership?" -> blue ring on the field, right panel becomes "Field properties" with Label, Widget type (Radio), Required (checked), Invisible, options "Yes"/"No".
- Rename label to "Is it exempt?" -> canvas updates live and the red `*` remains. Type `a < b & c` -> shown literally, no broken markup.
- Untick Required -> `*` disappears and progress denominator drops from 10 to 9. Retick -> back.
- Change widget to Dropdown -> field renders as a select with the same options. Change back to Radio.
- Rename an option, add an option, remove an option -> canvas updates.
- Tick Invisible -> field disappears from canvas (with the toggle off) and the drawer stays; with "Show invisible" toggle on it shows dashed. (Reach the toggle via "Back to tools".)
- Click a Paragraph -> drawer shows "Text" textarea; edit it and see the canvas update.
- Click Undo repeatedly -> each edit reverts in reverse order; typing in the label is a single undo step.
- Click empty canvas space or "Back to tools" -> drawer closes.
- Console shows no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: properties drawer for light field editing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Load-any-JSON verification, README, final checks

**Files:**
- Create: `README.md`
- (Scratch only, not committed) a modified/bad JSON in the scratchpad directory for manual load tests.

**Interfaces:** None new. This task verifies Task 8's `TopBar` file loading end to end and documents how to run the app.

- [ ] **Step 1: Write `README.md`**

````markdown
# Form Builder Prototype

Throwaway prototype of Anduin's Form Builder (preview/fill + light editing), rendered from a Form Builder JSON export.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the pure model/ + reducer
npm run build    # typecheck + production build
```

- Default form: `src/data/demo-form.json` (LP Interest Transfer demo). Use **Load form JSON** (top bar) to render any other export; only `namespaceFormSchemaMap[defaultNamespace]` is read.
- Working: fill the form, progress, click a field to edit its properties (label, widget, required, invisible, options), "Show invisible pages & fields", Undo, Reset.
- Everything else in the side panels is inert ("Not in prototype").
- Not implemented: rules, PDF generation, signatures, commenting, persistence, adding/deleting/reordering fields.
- Spec: `docs/superpowers/specs/2026-10-09-form-builder-prototype-design.md`
````

- [ ] **Step 2: Manual load tests (Review Focus 2)**

Create scratch files in the session scratchpad directory (not in the repo) and load each via the "Load form JSON" button in the browser pane (use `mcp__Claude_Browser__find` for the file input, or set the file with a `javascript_tool` `DataTransfer` shim if direct upload is not available):
1. `bad.json` containing `{oops` -> toast "File is not valid JSON"; form unchanged.
2. `empty.json` containing `{"namespaceFormSchemaMap":{}}` -> toast ""namespaceFormSchemaMap" is empty"; form unchanged.
3. `weird.json`: a copy of the demo with one field's `ui:widget` changed to `"Signature"` and one node's uiSchema entry removed -> loads; the unknown widget shows "Unsupported widget: Signature"; the node without a uiSchema entry renders as a TextBox labeled with its title; nothing throws.
4. The original `/Users/ops/Downloads/demo form-content.json` -> loads and looks identical to the bundled default; toast "Loaded “demo form-content.json”".
Fix any failure before continuing.

- [ ] **Step 3: Final checks**

Run:
```bash
npm test && npm run build
```
Expected: all tests PASS; `tsc` clean; Vite production build succeeds.

Stop the preview server (`mcp__Claude_Browser__preview_stop`).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README for the form builder prototype" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
