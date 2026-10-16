# Add Fields, Full Widget Set, and Export — Design

Date: 2026-10-09
Status: Draft for review
Builds on: `2026-10-09-form-builder-prototype-design.md` (the prototype as shipped on this branch)

## Goal

Extend the Form Builder prototype so a user can **add new fields** (defining all known metadata), use **all 27 Anduin widget types** (15 new), and **export** the edited form as Form Builder JSON.

**Success criteria**
1. A "+" button in the Table of Contents opens a searchable picker of 27 widgets (3-column icon grid, as in the reference screenshots).
2. Picking a widget opens an **Add field** form with every known metadata key for that widget plus free-form custom `ui:` keys. "Add field" inserts it at the chosen location, selects it, and it renders immediately.
3. The 12 new widgets with real behavior work (the 11 simple ones plus **Repeatable**, with add/remove rows and a max-items limit); the 3 remaining complex ones (Signature, Pdf/Word, FileGroup) and a nested File render as clear placeholders (see Widget catalog).
4. The app stays light: there is **no undo, reset, progress bar, or data import/export** (these were removed from the prototype by request), so none of the new work adds history or progress machinery.
5. "Export form JSON" downloads a file that `loadForm` loads back to an identical form.
6. Existing fields get the same metadata form in the edit drawer (live-edit), so there is one metadata UI.

**Non-goals:** undo/redo, progress, reset, data import/export, deleting or reordering fields, rules, nested Repeatables (a Repeatable cannot be placed inside another), real signature/file/PDF handling, form-data import/export (the left "Export"/"Import" buttons stay inert), persistence.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Metadata | Structured form for every `ui:` key seen in the demo JSON + free-form custom key/value rows |
| Placement | Smart default (after selected field, else end of active page) + editable **Location** dropdown; all 27 widgets addable incl. Page/Group/Header |
| New widget fidelity | Working: Integer, Float, Year, Email, Phone, Country, State, MultipleCheckbox, MultipleSuggest, Custom format, AnchorLink, **Repeatable** (rows, per the reference screenshots). Placeholders: Signature, Pdf/Word, FileGroup, File (nested) |
| Export | "Export form JSON" button in the top bar beside "Load form JSON"; TOC Export/Import stay inert (they look like form-*data* actions in the real tool) |
| Shared metadata UI | One `MetadataForm` used by the Add form (draft, commit on submit) and the edit drawer (live) |

## Widget catalog (`src/model/widgetCatalog.ts`)

Single source of truth replacing `STRUCTURAL_WIDGETS` / `INPUT_WIDGETS` / `NOT_SELECTABLE` in `schemaWalk.ts` and the hard-coded drawer list. Each entry:

```ts
interface WidgetDef {
  id: string;                    // ui:widget value
  label: string;                 // picker label
  kind: 'container' | 'static' | 'input' | 'placeholder';
  schema: { type: NodeType; format?: string };
  metadata: string[];            // metadata registry keys that apply
  defaults: UiEntry;             // seed ui entry for a new field
}
```

| id | label | kind | schema | notes |
|---|---|---|---|---|
| Page | Page | container | object | top-level only; adds a TOC entry |
| Group | Group | container | object | |
| Repeatable | Repeatable | container | array | rows of its child fields; see **Repeatable** below |
| Header | Header | static | null | `ui:subtitle`, `ui:heading`, `ui:description`; its Input type row is read-only "Heading 1" |
| Paragraph | Paragraph | static | null | text in `ui:formattedText` |
| AnchorLink | AnchorLink | static | null | renders a link (`ui:href`, text from `ui:formattedText`) |
| TextBox, TextArea, Email, Phone, CustomFormat | … | input | string | Email/Phone/CustomFormat validate on blur |
| Integer, Float, Year, Money, Percentage | … | input | number | parse on blur |
| Date | Date | input | string, format `date` | |
| Country, State | … | input | string | dropdowns: ISO-3166 countries (names via `Intl.DisplayNames`), US states + DC |
| Radio, Dropdown | … | input | string | options |
| MultipleCheckbox, MultipleSuggest | … | input | array | value is `string[]`; options |
| Signature, PdfWord (label "Pdf/Word"), FileGroup, File | … | placeholder | null | styled non-functional box. A top-level `File` renders nothing (the demo's PDF template node); a nested one shows the placeholder |

`NodeType` gains `'array'`. `loadForm`'s node normaliser accepts it.

**Assumptions** (one line each in the catalog/registry if wrong): Width presets and the `ui:description`/`ui:width` key names; widget ids equal picker labels with spaces/slashes removed; Repeatable and the multi-select widgets use schema type `array`; key names `ui:href` (AnchorLink), `ui:pattern` (Custom format regex, validated on blur when set), `ui:maxItems` and `ui:itemName` (Repeatable), `ui:external`, `ui:asaMapping`.

## Metadata registry (`src/model/metadata.ts`)

Maps each known key to `{ key, label, control, appliesTo }`. Controls: `text`, `html-text`, `bool`, `message` (required message; presence = required), `px` (dropdown of presets: margin 0/4/8/12/16/24/32/48px, indentation 0/12/24/36/48px; a non-preset existing value is kept as an extra option), `integer`, `enum`, `options`, `string-list`, `json`.

| key | control | applies to |
|---|---|---|
| `ui:formattedText` (Label / Text) | html-text | all but Header/Page/Group |
| `ui:required` | message | `input` widgets, Repeatable |
| `ui:invisible` — shown as a **Visible** switch (on = not invisible), last row | bool, inverted | all |
| `ui:enabledComment` ("Enable Commenting") | bool | input widgets, Repeatable |
| `ui:external` ("External") | bool | input widgets, Repeatable |
| `ui:indentation`, `ui:marginBottom` | px (dropdown) | all |
| `ui:width` ("Width") | dropdown: Auto (default), 25%, 50%, 75%, 100%; applied as the field wrapper's CSS width | all but Page/Group/Header |
| `ui:maxItems` ("Max number of items") | integer ≥ 1, default 1 | Repeatable |
| `ui:itemName` ("Item name") | text, default `row` | Repeatable |
| `ui:fixedLayout` | enum (Inline) | Radio, MultipleCheckbox |
| `ui:multipleOption` | options | Radio, Dropdown, MultipleCheckbox, MultipleSuggest |
| `ui:subtitle`, `ui:heading`, `ui:description` ("Subtitle", "Heading", "Description") | text | Header; the description renders as muted text under the heading rule |
| `ui:fileName` | text | File, PdfWord |
| `ui:href` | text | AnchorLink |
| `ui:pattern` | text | CustomFormat |
| `ui:pdfMapping` ("PDF Mapping", a `+` list) | string-list | all but Header/Page/Group |
| `ui:asaMapping` ("Anduin Standard Alias Mapping", a `+` list) | string-list | all but Page/Group (Header included) |
| `ui:signature` | string-list | all but Header/Page/Group |

**Custom keys.** Rows of key + value below the structured controls. The key is auto-prefixed with `ui:`; rejected if empty, equal to a structured key, or `ui:widget`. Value is `JSON.parse`d when valid JSON (so `true`, `12`, `["a"]` keep their type), otherwise stored as a string. Existing unknown keys on a field are listed in the same rows when editing.

## Adding a field

**State** (`FormState`) gains `adding: { widget: string } | null`. Actions:
- `startAdd { widget }` — clears selection, opens the Add panel
- `cancelAdd`
- `addNode { node, ui, parent, after }` — inserts, sets `selection` to the new field (or `null` if not selectable), `adding = null`; for a Page also sets `activePage`
- `select` also clears `adding`
- `editDoc { schema?, uiSchema? }` replaces `editUi`: edits that change a node's schema (a widget change that alters `type`/`format`, e.g. TextBox → Integer, Group ↔ Repeatable) update both together
- `setRowValue { rep, index, name, value }`, `addRow { rep }`, `removeRow { rep, index }` — see Repeatable

**Name and title.** Default name is the first unused `<widgetid lowercased><n>` (e.g. `textbox16`), default title `<Label> <n>` (e.g. "Textbox 16"), matching the demo's convention. Name rules: matches `^[A-Za-z][A-Za-z0-9_]*$` and unique across the whole doc (values and `uiSchema` are keyed by name). Name is editable in the Add form, read-only afterwards.

**Location.** `resolveInsertion` default: selected Repeatable → inside it, at the end; selected field → after it, in its parent; else end of the active page; else (doc has no pages) end of the top level. The Add form shows a Location select listing: "After <selected>", "End of <page>", and "Inside <title>" for every Page/Group/Repeatable. Rules: `Page` is always top-level (inserted after the active page, or appended); every other widget needs a container parent unless the doc has no pages; a `Repeatable` cannot be placed inside another Repeatable (the Location list omits them as targets for Repeatable).

## Repeatable

Modelled on the reference screenshots: an array of rows, each row an instance of the Repeatable's child fields, up to a maximum.

- **Metadata:** `ui:maxItems` (default **1**, as in the reference panel; integer ≥ 1) and `ui:itemName` (default `row`, used in the "Add another <itemName>" label). Children are ordinary nodes under the Repeatable node and are the row *template*.
- **Values:** `values[repName]` is `Array<Record<string, unknown>>` (one object per row, keyed by child field name). When unset the Repeatable shows **one empty row**; adding a row materialises the array. Fields inside the Repeatable are not stored in the flat top-level map.
- **Canvas:** the Repeatable's label (if any), then one bordered block per row: the child fields stacked on the left, a trash icon button in a right-hand cell (hidden when only one row), and below the rows a pale-blue "⊕ Add another <itemName>" that is **disabled at the max**. HTML ids are `<rep>.<rowIndex>.<child>`; clicking any row's copy of a child selects the template child (`selection` stays a node name); clicking the Repeatable's own area selects the Repeatable (it is selectable, unlike Group/Page). A row shows invisible children under the same toggle rule.
- **Reducer:** `addRow` is a no-op at max (max read from `ui:maxItems` via the doc); `removeRow` is a no-op on the last row. There is no undo, so none of them records history.
- **Required:** `ui:required` on a Repeatable's child only adds the red `*` to its label; there is no completion tracking.
- **Not supported:** a Repeatable inside a Repeatable; row reordering; min-items.

## Widgets

- **Integer** `^-?\d+$`; **Float** `parseNumber`; **Year** `^\d{4}$`. Same rule as Money/Percentage: commit on blur, invalid text stays visible and flagged, never saved. Implemented as one generic `resolveDraft(draft, current, validator)` in `model/draft.ts` (existing number/date resolvers become thin wrappers).
- **Email** `^[^@\s]+@[^@\s]+\.[^@\s]+$`; **Phone** only `[0-9 +().-]` with 7–15 digits; **CustomFormat** validates against `ui:pattern` when present (an invalid regex is ignored, not thrown). All via `resolveDraft`.
- **Country / State**: select; option value is the ISO / 2-letter code, label is the name.
- **MultipleCheckbox**: checkboxes from `ui:multipleOption`, honoring `ui:fixedLayout`; value `string[]`.
- **MultipleSuggest**: text box filters `ui:multipleOption`; picking adds a removable chip; value `string[]`.
- **AnchorLink**: `<a target="_blank" rel="noopener noreferrer">`; `href` limited to `http(s):`, `mailto:`, `#`; anything else renders as plain text.
- **Placeholders** (Signature, Pdf/Word, FileGroup, nested File): dashed box with the widget name and "Not in prototype"; Pdf/Word and File also show `ui:fileName`.
- A multi-value widget's value is `string[]`; an empty array is the empty value.

## UI

- **TocPanel**: "+" icon button right of the "Table of Contents" title opens `WidgetPicker` (popover: search box, "Widgets" heading, 3-column grid of icon + label, Esc/outside-click closes, Enter picks the first match, zero-match shows "No widgets").
- **AddFieldPanel** (right column while `adding`): header "Add <Label>", `MetadataForm` in draft mode with Name and Location, "Add field" (disabled until valid, errors inline) and "Cancel".
- **PropertiesDrawer**: a thin wrapper over `MetadataForm` in live mode, laid out like the real Properties panel: a tab strip **Properties | Rules | ASA** (Rules/ASA inert), then rows with the label on the left and the control on the right. The widget selector is labelled **Input type**; order is Input type, widget-specific rows (a Header shows Subtitle, Heading, Description) (e.g. Max number of items, Item name), PDF Mapping, Anduin Standard Alias Mapping, Width, Margin bottom, Indentation, Enable Commenting, External, and **Visible** last, with label/required/options rows above or between as applicable. `Header` becomes selectable (it was not before) so its panel can be edited; Page and Group stay non-selectable. Input type may switch within a kind: input ↔ input, Group ↔ Repeatable, static ↔ static; `Page` is never switchable. Switching goes through `editDoc` so the schema node's `type`/`format` stays consistent.
- **MetadataForm**: renders the registry rows in the order above for the widget at hand (rows hide when the key does not apply), then Custom keys. The Add form puts Name and Location first.
- **TopBar**: "Export form JSON" next to "Load form JSON".
- **Icons**: small inline SVG per widget id (`WidgetIcon`).

## Export (`src/model/exportForm.ts`)

`FormDoc` gains `namespace: string` and `source?: unknown` (the raw loaded export). `buildExport(doc)`: deep-clone `source`, set `namespaceFormSchemaMap[namespace]` to the existing entry with `schema.properties` and `uiSchema` replaced by the current ones; `rules`, `libs` and other top-level keys carry through. With no `source`, emit a minimal `{ namespaceFormSchemaMap: { [ns]: { schema, uiSchema } }, defaultNamespace: ns }`. The button downloads `form-content-edited.json` via a Blob. Note: the export reflects loader normalisation (missing titles defaulted to the name, unknown node types coerced to `string`).

## Error handling

- Add form blocks submit on invalid or duplicate name, invalid custom key, and invalid JSON in `json` controls; errors render under the control.
- Unknown `ui:widget` values in loaded files keep the "Unsupported widget" placeholder.
- Invalid `ui:pattern` regex and unsafe `ui:href` are ignored safely (no throw, no link).

## File structure

New: `model/rows.ts` (`maxItemsOf`, row add/remove helpers), `widgets/Repeatable.tsx`, `model/widgetCatalog.ts`, `model/metadata.ts`, `model/addField.ts` (name defaults/validation, `resolveInsertion`, `insertNode`), `model/exportForm.ts`, `model/countries.ts` (ISO codes + US states), `components/WidgetPicker.tsx`, `components/AddFieldPanel.tsx`, `components/MetadataForm.tsx`, `widgets/{Numeric,TextValidated,Geo,MultiChoice,Static,Placeholder}.tsx` (grouped), tests alongside each model file.
Modified: `types.ts` (`'array'`, `FormDoc.namespace/source`), `loadForm.ts`, `schemaWalk.ts` (catalog-driven), `draft.ts`, `formReducer.ts`, `FieldRenderer.tsx` (`topLevel`, Repeatable container), `registry.ts`, `PropertiesDrawer.tsx`, `TocPanel.tsx`, `TopBar.tsx`, `icons.tsx`, `App.tsx`, `app.css`, `README.md`.

## Testing

Vitest for pure logic, written first: catalog invariants (27 unique ids, every id resolvable in the registry, schema type present), name defaults and validation, `resolveInsertion` and `insertNode` (after a nested field, inside a Group, end of page, new Page, no-pages doc), custom-key parsing and rejection, `resolveDraft` validators (Integer/Year/Email/Phone/CustomFormat incl. invalid regex), Repeatable rows (add/remove/max/last-row guards, an unset Repeatable shows one row, `maxItems` fallback for bad values), `editDoc` keeping schema type and `ui:widget` consistent on a widget switch, export round-trip (`loadForm(buildExport(doc))` equals `doc`, `rules`/`libs` preserved), AnchorLink href allowlist. React UI is verified in the browser: picker search/keyboard, adding each of the 27 widgets, location choices, validation errors, drawer live-edit, export then re-load.

## Open points

1. The assumptions listed under Widget catalog (ids, `array` types, `ui:href`, `ui:pattern`).
2. Default `ui:maxItems` is 1 (as in the reference panel), so a freshly added Repeatable cannot add rows until its max is raised; this is a one-line default in the catalog if you would rather start at 3.
3. A nested `File` shows a placeholder while a top-level `File` stays invisible, which depends on the demo's convention that the PDF template is a top-level `File` node.
