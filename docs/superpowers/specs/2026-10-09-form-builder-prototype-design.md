# Form Builder Prototype — Design

Date: 2026-10-09
Status: Draft for review

## Goal

An interactive, throwaway web prototype of Anduin's internal **Form Builder** (preview/fill mode plus light editing), driven by a Form Builder JSON export of a digitized fund subscription document. It is for demoing and exploring the interface. It is not production code.

**Source:** `/Users/ops/Downloads/demo form-content.json` (an LP Interest Transfer Agreement demo form). Only `namespaceFormSchemaMap[defaultNamespace]` (`main`) is used. `rules`, `libs`, `triggerRuleByProperty`, `cueFieldSchemas` and `gaiaLogicVersion` are ignored.

**Success criteria**
1. The demo form renders from the JSON and visually matches the reference screenshot (3-column layout: Table of Contents, form canvas, tools panel).
2. The form is fillable; progress and values update live.
3. Clicking a field opens a properties drawer; edits re-render the canvas immediately.
4. Another Form Builder export can be loaded and rendered without code changes (unknown widgets degrade gracefully).

**Non-goals:** rules engine, PDF generation or mapping, signatures, commenting, backend, persistence, drag-and-drop, adding/deleting fields or pages.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Scope | Preview/fill + light editing of field properties |
| Architecture | Schema-driven generic renderer (widget registry keyed by `ui:widget`) |
| Reusability | Demo JSON bundled as default; "Load form JSON" accepts any export |
| Stack | Vite + React + TypeScript, plain CSS, Vitest for pure logic |
| Working tools-panel features | "Show invisible pages & fields" toggle only; plus Undo and Reset (they fall out of the undo stack) |
| Everything else in the panel | Rendered like the real UI but inert, with a "Not in prototype" tooltip |

## Source data shape

- `schema`: `{ type: "object", properties: Node[] }`. A `Node` is `{ name, type, title, enum?, format?, properties? }`. `type` is `null | string | number | object`. `properties` is an **ordered array**, not a map, and objects nest (Page contains fields; Group contains fields).
- `uiSchema`: a flat map `name → { "ui:*": … }`, keyed by field `name` regardless of nesting depth.
- Relevant `ui:` keys observed: `widget`, `formattedText` (HTML), `required` (message string; presence means required), `invisible`, `multipleOption.options` (`[value, {formattedText, …}][]`), `fixedLayout` (`"Inline"`), `indentation`, `marginBottom`, `heading`, `subtitle`, `fileName`, `enabledComment`, `pdfMapping`, `signature`.
- Widgets in the demo (12): `Header`, `Page`, `Group`, `Paragraph`, `TextBox`, `TextArea`, `Money`, `Percentage`, `Date`, `Radio`, `Dropdown`, `File`.
- 24 `uiSchema` entries; 8 are `ui:invisible` (`textbox`, `textbox6`, `textbox7`, `textbox9`, `textbox11`, `textbox12`, `textbox15`, `class_partnership`).

## Architecture

```
src/
  main.tsx, App.tsx
  model/
    types.ts          Node, UiSchema, FormDoc, Values types
    loadForm.ts       parse export JSON -> FormDoc (picks defaultNamespace)
    schemaWalk.ts     flatten/walk nodes, find pages, resolve visibility, list required fields
    progress.ts       required-field counting and completion %
    editOps.ts        pure uiSchema update helpers (setLabel, setWidget, setRequired, setInvisible, setOptions)
    history.ts        undo stack of { uiSchema, values } snapshots
  state/
    useFormStore.ts   React context + reducer: doc, values, selection, showInvisible, history
  widgets/
    registry.ts       ui:widget -> component map; Unknown fallback
    Header, Page, Group, Paragraph, TextBox, TextArea, Money, Percentage, Date, Radio, Dropdown, File, Unknown
  components/
    FieldRenderer.tsx walks a Node, resolves ui props, applies indentation/margin/invisible, wires selection
    TocPanel.tsx      progress bar, page list, action buttons
    ToolsPanel.tsx    right panel rows, toggles, inert controls
    PropertiesDrawer.tsx  edit panel for selected field
    TopBar.tsx
  styles/             plain CSS, tokens in :root
  data/demo-form.json bundled copy of the source JSON
```

Boundaries: `model/` is pure TypeScript (no React) and is the only unit-tested layer. Widgets are dumb: they receive `{ node, ui, value, onChange, disabled }`. `FieldRenderer` is the only code that knows about nesting, visibility and selection.

## State

- `doc: { schema, uiSchema }` from the loaded export. Edits replace `uiSchema` immutably.
- `values: Record<string, unknown>`, **flat by field `name`**. Names are unique across the doc (they key `uiSchema`), so nesting does not affect the shape.
- `selection: string | null` (field name), `showInvisible: boolean`.
- `history`: stack of `{ uiSchema, values }` snapshots, pushed before each edit or value change group. Undo pops. Reset clears `values` (and pushes a snapshot first). Loading a new JSON replaces `doc`, clears `values`, selection and history.

## Layout

Matches the reference screenshot.

- **Top bar:** "Save and close" (inert).
- **Left (Table of Contents):** title, progress bar with "N% completed", a page entry per `Page` widget node (active, with status dot), then the buttons: Preview data, Supporting documents, Export, Import (all inert), **Undo last action** (works), **Reset form data** (works, red).
- **Center (canvas):** `Header` widget renders the subtitle (grey), heading (bold, uppercase) and the blue underline. Fields follow in schema order. A trailing "Save and close" button (inert).
- **Right (tools):** rows Profile (Fill form / Save profile), Values (eye icon and swap icon), Signatures >, Additional documents >, Preview commenting toggle, Show alias toggle, Enable form rules toggle, Use new viewer (MVU) toggle, **Show invisible pages & fields toggle (works)**, then buttons View summary, View table, Generate PDF, Enter Live Preview mode. All inert except the working toggle. Inert controls show a "Not in prototype" tooltip. Toggles that are not wired still flip visually but have no effect, and are labeled in the tooltip.
- When a field is selected, the **Properties drawer** replaces the right tools panel and has a "Back to tools" link.

## Widget behavior

| Widget | Rendering |
|---|---|
| `Header` | title block from `ui:heading` and `ui:subtitle` |
| `Page` | container; heading in the TOC; children rendered in order |
| `Group` | transparent container; children rendered with their own indentation |
| `Paragraph` | static text from `ui:formattedText` (HTML) |
| `TextBox` | single-line input |
| `TextArea` | multi-line input |
| `Money` | numeric input with currency formatting on blur |
| `Percentage` | numeric input with `%` suffix |
| `Date` | text input with calendar icon; accepts `MM-DD-YYYY` and a picker |
| `Radio` | options from `ui:multipleOption`; `Inline` fixed layout lays them out in a row |
| `Dropdown` | select over `ui:multipleOption` options |
| `File` | not rendered in the canvas (it only supplies the PDF template name for display) |
| unknown | grey labeled placeholder showing the widget name |

Common: label is `ui:formattedText` rendered as sanitized HTML (red `*` comes from the markup); `ui:indentation` becomes left padding; `ui:marginBottom` becomes bottom margin; `ui:required` marks the field required for progress.

Visibility: `ui:invisible` fields are omitted unless `showInvisible` is on. When shown they have a dashed outline and an "invisible" badge. Rules are not evaluated, so the demo's `Group` (percentage/capital commitment) renders from the schema alone. In the original tool a rule probably hides it until the dropdown is set to "percentage"; that is not reproduced.

Progress: `completed / required` over currently visible required fields with a non-empty value. `Header`, `Paragraph`, `Page`, `Group`, `File` never count.

## Properties drawer (light editing)

Edits apply to `uiSchema[name]` via `editOps` and push a history snapshot.

- **Label:** simple text input (HTML tags and the required marker preserved by editing only the text content; the required `*` span is re-applied when "Required" is on).
- **Widget type:** dropdown of the 12 widgets (changing type is allowed for field nodes only, not `Page`/`Group`/`Header`/`File`).
- **Required:** on/off, which sets or removes `ui:required`.
- **Invisible:** on/off, which sets or removes `ui:invisible`.
- **Options** (Radio/Dropdown only): editable list of option labels (add/remove/rename), keeping each value stable.
- Read-only info: field `name`, schema `type`, `pdfMapping`.

No add/delete/reorder of fields or pages.

## Loading JSON

"Load form JSON" (small control in the top bar) accepts a file. `loadForm` reads `namespaceFormSchemaMap[defaultNamespace ?? first key]`, validates `schema.properties` is an array, and surfaces a readable error toast on failure without touching current state. Unknown widgets use the fallback.

## Error handling

- Invalid JSON or wrong shape: toast with the reason; current form stays.
- Missing `uiSchema` entry for a node: render with defaults (title as label, `TextBox`).
- Unknown `ui:widget`: placeholder, never throw.
- All `formattedText` HTML is sanitized (allow `p`, `span`, `strong`, `em`, `br`, `a`, `ul`, `ol`, `li`; strip scripts and event handlers) before `dangerouslySetInnerHTML`.

## Testing

- **Vitest unit tests** for `model/`: `loadForm` (demo JSON, wrong shape), `schemaWalk` (ordering, nesting, invisibility), `progress` (counting rules), `editOps` (each op is immutable and correct), `history` (undo/reset).
- **Manual visual check** in the browser pane against the reference screenshot: layout, label rendering, radios inline, dropdown, invisible toggle, drawer editing, undo/reset, and loading the bundled JSON as an uploaded file.
- No e2e framework (prototype).

## Open points

1. Group visibility without rules: rendered always (see above). If this looks wrong in review, a cheap alternative is hiding the Group until the "percentage" option is picked, but that hard-codes demo-specific logic.
2. "Show alias" and "Enable form rules" toggles do nothing in this prototype.
