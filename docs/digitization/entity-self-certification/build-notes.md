# Entity Self-Certification Form — build notes

> The generator now lives in the app (`src/generator/annotationToForm.ts`, used by "Build from annotation JSON"). `generate_form_content.py` is the earlier Python version and is no longer kept in step; it does not handle checkbox groups, embedded PDFs, several pages, or the fund-name subtitle.

Output: `form-content.json` (loads in the prototype via **Load form JSON**). Regenerate with:

```
python3 -I generate_form_content.py "<…>/annotation_document_data.json" form-content.json
```

Source: the annotation metadata only (structure, aliases, types, highlight text, coordinates). Nothing is invented and no PDF wording is typed into the script.

## Structure

One Page (`citco_crs`) holding the five numbered sections as Groups, each titled by its own `ui:formattedText`. Only the page title uses the Header widget; a group's heading is never a Header. Controlling Person 1/2 follow the same rule. Groups carry no data.

## Rules applied

- Children sorted by (page, top, left); the annotation order is not reading order.
- Text field → TextBox; `isMultiline` → TextArea; `dateofbirth*` → Date; ownership % → Percentage; country fields → Country.
- Radio group → Radio; each radio alias is the option value and its PDF mapping.
- Fields below: a field or nested radio group that sits clearly to the right of (≥0.015 page width) and after an option of another radio group becomes that option's field below. A child belongs to one option only (checked by the script).
- Address blocks (found by their label text): Country, Address, City, then two State fields and two postal fields. US variant: State widget "U.S. States/Territories" and CustomFormat `USZIP` "ZIP Code", required wherever the block's address is required. Non-US variant: "State / Province" and "Postal Code", optional. Both variants map to the one PDF field; rules choose which shows (not generated).
- Repeatable: only where the annotation has a Repeatable object (the two controlling-person tax-residence groups, max 2). The template row's `ui:pdfMapping` lists both PDF rows. Section 2's two rows are flat fields in the current annotation, so they are flat in the form until the annotation groups them.
- Footnotes: only the four the annotation carries as `data-title` spans (intro paragraph, legal name, section-2 paragraph, option b). Other footnote digits stay in the text as the annotation has them.
- Required by default. Optional only when the highlighted text clearly says so: "(optional)", "if different", or an opening condition ("If the Entity ...", "Or if ...", "Where ..."). A group whose own heading says so (the mailing address) makes everything inside it optional. Fields below an option stay required (they only open when their option is picked). Radio groups stay unrequired until rules exist. One structural exception, from the address rule: the non-US "State / Province" and "Postal Code" variants are optional because the US variants carry the requirement. Matching uses the highlight text, never field names.

## Checks run

110 nodes; all 98 annotated fields (73 text, 23 radio, 2 signature) mapped exactly once; no unknown mappings; 19 fields below, none shared; loads through `loadForm`; rendered in the app.

## Warnings

The generator prints them and writes `form-content.warnings.txt` next to the output:

- **LABEL MISSING:** a field, option, radio group or repeatable has no highlighted text. Its formattedText is left empty (no placeholder); click the empty label on the canvas to type one.
- **FOOTNOTE TEXT MISSING:** the annotation leaves a footnote digit glued to the text but carries no footnote text. The digit becomes a footnote widget with an empty tooltip. Only four footnotes have text in the annotation (intro paragraph, legal name, section-2 paragraph, option b).
- **GATING CHECKBOX:** a block whose heading says "if different from above" (the mailing address) stays required, behind an optional checkbox "Check this box if the mailing address is different from the registered address above." built from the two headings. A rule must show the block only when the box is checked.
- **SIGNATURE:** the signer name and the types of any other fields signed with it are not in the annotation. Only the signature field is mapped as type Signature; the date, name and position fields stay as ordinary fields.

Nothing is invented apart from that gating checkbox: no sub-headings, confirmation checkbox, signing notice or W-9 group.

## Needs rules (not generated)

- Section 4 only when classification is G, H, I, or certain investment-entity options.
- "Select at least one classification" across the two radio groups.
- W-9 only when the Entity is a US person.
- Fields below show only after their option is selected (the prototype always shows them).
