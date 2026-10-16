# Digitizing a PDF subscription booklet into a web form: patterns and an automation spec

Sources:
- **The booklet**: `Demo_Capital_Fund_-_Subscription_Booklet.pdf` (100 pages) and the Form Builder export built from it
  (`form-content (4).json`: 458 nodes, 146 rules). Studied by measurement.
- **Anduin house rules**: the Notion page "Key Indicators for Form Content" (L&D team) and the
  `anduin-ds-toc-ui-build` skill with its three references (form-builder mechanics, design tokens, content
  standards). Per the page, **the customer's own documents override every rule on it**.

Purpose, as stated by the owner: a spec precise enough to automate digitization (e.g. an agent proposing a form from a
PDF).

**Confidence tags**
- **Observed**: measured from the PDF/JSON.
- **Rule**: stated in the Anduin house rules above.
- **Confirmed**: stated by the owner in this project.
- **Inferred**: my reading of why; not verified.

**Limits.** One booklet. I read PDF text, bookmarks and AcroForm fields, not rendered pages (the skill itself warns
that text extraction alone cannot confirm annotation coverage on checkbox grids, dense option lists or
numbering-dependent text). The 146 rules were only skimmed.

---

## 1. The two artifacts

| | PDF | Form export |
|---|---|---|
| Size | 100 pages, 131 bookmarks | 458 nodes: 20 Pages, 108 Groups, 25 Headers, 55 Paragraphs, 206 input-like fields |
| Fillable fields | 386 AcroForm fields: 201 radio buttons, 87 checkboxes, 86 text fields, 12 signature fields | 154 fields with `ui:pdfMapping`, 288 options with `pdfMappings` |
| Logic | none | 146 rules from templates (show/hide, prefill, combine, validate) |

The PDF is itself a fillable form (Observed). The web form collects data and maps it back onto it. Form Builder needs
that annotated PDF **before** building starts (Rule), and every widget is mapped to a PDF field **except gating
questions** (Rule; see 5).

## 2. Structure: the table of contents

### 2.1 What the bookmarks give (Observed)
The form's TOC is a tree of **sections (Groups) containing Pages**, mirroring the PDF bookmark tree:

| PDF bookmark (page) | Form |
|---|---|
| General Instructions (4-7) | Page "Instructions for Subscribers" (embedded PDF) |
| Subscription Agreement (8-33) | Section: agreement (embedded), **General Information** (inputs), Appendix I (embedded) |
| Investor Qualification Statement (34-62) | Section: Individuals, Entities, Appendix A, Appendix B |
| AML & KYC Questionnaire | Page "AML & KYC Checklist" |
| Canadian supplemental IQS (63-79) | Section with a sub-section and Pages |
| EEA, UK, Swiss supplemental IQS (80-89) | Section with one Page |
| Privacy notices (90-100) | Section: three Pages, each embedded |

### 2.2 How to decide it: R-A-I-N (Rule)
1. **R**espect the PDF's section order as the default.
2. **A**djust only where logic requires it, for example a gating question must come before the sections it gates.
3. **I**nvestor-type question goes on the first page or very close to it.
4. **N**ame and group sections for what is actually inside, not just what the PDF called them.

For every page record: main or conditional? exact trigger? disabled for some investor types, and the real tooltip?
hidden (plumbing only)? LP-workflow or GP-workflow?

### 2.3 TOC conventions (Rule, and how this form complies)
- The TOC reflects the sub-docs' real structure unless the DS owner decides otherwise (Observed: it does).
- Every **disabled** page has a specific tooltip, never the default "You can't skip to this section." (Observed: "This
  section is only applicable for individuals / entities / Canadian subscribers / ...", on 10 nodes.)
- **Hidden pages** (plumbing for rules or mapping) must be hidden from the investor. This form has three:
  `Fund Selection`, `Hidden` (signature blocks, prefill group) and `Logic Support` (derived flags such as
  `gr_is_natural_person`, `gr_shortcut`, `gr_groups`).
- Form name: `[Fund Name] - [Subscription Booklet/Documents/Agreement]`; every page carries the fund name as its
  Heading 1 subtitle (Observed: 18 of 25 Headers have a subtitle).

## 3. What is digitized and what is embedded

Observed: pages where the investor must answer something (36-58, 63-70, 80-89) have high text overlap (>= 60%) with the
form. Instructions, the agreement body (8-29), appendices (59-62), Canadian conditions (72-79) and privacy notices
(90-100) have low overlap and are `Pdf` widgets (14, one PDF per section, 4 with `ui:viewInModal`).

**Rule (Confirmed):** embed long read-only legal text; digitize a section only when the investor must answer something.
A digitized page keeps the PDF's reading order (Observed: 18 of 19 located nodes on the Individuals page are in order).

**Standard text above every embedded PDF (Rule):**
- no inputs inside it: "Please carefully review the document below before continuing to the next section."
  (Observed: 10 occurrences)
- inputs inside it: "Note that the embedded reference document below contains questions that should be answered in
  [the section directly beneath / the next section(s)]." (0 in this form: none of its embeds contain inputs)
- Name embedded files and sub-docs `[Fund Name] - [Heading/Title of the document]`, no stray symbols, numbers or
  trailing period.

## 4. PDF construct -> form construct

| PDF signal | Form construct | Evidence |
|---|---|---|
| Part / section heading | `Header` (Heading 1 or 2; use Header, not Paragraph, for headings) | 25 Headers |
| Narrative paragraph | `Paragraph`, one per clause, median 18 words, p90 155, max 325 | 55 |
| Statement ending in a blank or "True / False" | `Radio`, 2 options (True/False 28, Yes/No 27) | 82 Radios |
| `______ (1) ... check all that apply` | `MultipleCheckbox`, options keep "(1)", "(a)" text verbatim | 30 |
| "Specify ____" / "Name: ____" under an option | a **field below** that option | 34 references, each child tagged to exactly one option |
| Superscript footnote number | an ⓘ footnote widget in the label (`FOOT_NOTE_HERE` placeholder with a `data-title`) | 131 |
| ABA, SWIFT, IBAN, ZIP, SSN, GIIN | `CustomFormat` (named format) with a placeholder | 6 |
| Phone/fax, email, %, $ | `Phone`, `Email`, `Percentage`, `Money` | name token matches widget |
| State, country | `State`, `Country` (a US-state field when country = United States) | 3 + 3 |
| Two-column notice/contact blocks | `Group` with `ui:dynamicLayout` (e.g. [70,30], gutter 8) | 8 |
| Signature block | `Signature`, LP or GP type, with a standard signer name | 16 |
| "Attach supporting documents", tax forms | `FileGroup` (give each group a name) | 13 |
| Informative text about an event or consequence | blue well (`ui:wellType` Info) | 20 |
| Warning or action-required text | orange well (`Warning`) | 1 |
| Repeating list (owners, directors, contacts) | `Repeatable`, item name = the actual item, not "Add another row" | 0 in this form |

Remarkable fields (Rule): Local routing number, Suffix, Joint investor name, GIIN, Nationality, Jurisdiction of
organization -> TextBox with a placeholder; Citizenship -> MultipleSuggest; EEA jurisdictions -> Dropdown or
MultipleSuggest using the current gov.uk list; fiscal year end -> month and day.

## 5. Gating questions and invented elements

### 5.1 What they are (Confirmed)
A **gating question** is a question that does not exist in the PDF. We invent it during UI building to route the
investor, so it has **no PDF mapping**. More broadly, "invented elements" are anything added for the investor's benefit
that the PDF does not print: fund selection, investor-type routing, warnings, prefill checkboxes, confirmation boxes.

### 5.2 The two routing levels (Confirmed)
1. **Investor type: Individual or Entity.** One question defines it, and it must sit **before every question or
   section that opens or changes based on investor type**. The PDF's long list of specific types is collapsed into two
   groups, Individual and Entity, with the specific types beneath (Rule).
2. **Group gating** for sections open only to some investors (EEA, UK, Japan, Canada, ...). A gating question routes the
   investor into the group's section. Inside such a section, some questions are for individuals, some for entities, some
   for both, so those sections apply the investor-type routing a second time.

Order rule: group gates and investor type are asked first; everything they control comes after (R-A-I-N, "A" and "I").

**Placement (Confirmed):** the investor-type question may sit a little after page one, for example on General
Information after the instructions and the embedded agreement. That still counts as "very close to the first page". What
matters is that it precedes everything it controls.

**Group gate format (Confirmed).** Two cases, decided by what the sub-doc says:
- **The sub-doc does not lay out who completes the section:** use one generic multiple-choice gate. Standard language is
  "Please indicate your country of residence" or "Please indicate if you are a", with options such as "UK Investor" or
  "Japanese Investor", chosen to fit the question's wording. Each option opens its group's section; the "not applicable"
  tooltips on the others explain why they are closed.
- **The sub-doc already states the condition:** follow the sub-doc. Use the document's own legal wording as the gate,
  and use **separate gating questions when the conditions differ**, because they identify different people. Example
  (Observed in this form): the Canadian IQS opens for "resident of, or located in, any province or territory of Canada";
  the EEA/UK/Swiss IQS opens for "domiciled or resident in, or has a registered office in, an EEA Jurisdiction (an "EEA
  Subscriber"), the United Kingdom (a "UK Subscriber"), or Switzerland (a "Swiss Subscriber")". The tests are not the
  same (located vs domiciled, registered office, three jurisdictions), so each gets its own question.
- The condition therefore has to be **inferred from the legal language**, not from layout. The generic gate is the
  fallback only when the document is silent.

### 5.3 What this form shows (Observed)
59 of 206 input fields have no PDF mapping. After removing hidden-page flags (17) and fields below (they hang off
mapped options), the rest are almost all invented or restructured elements on **General Information**, the page right
after the instructions and the embedded agreement:
- the **Individuals / Entities** investor-type radios, and "Are you investing jointly with your spouse?"
- "Are you a U.S. person?" (a gating question for tax documents)
- **"Is the Subscriber resident of ... any province or territory of Canada?"** and **"... domiciled or resident in an
  EEA Jurisdiction?"**, which gate the Canadian and EEA sections (those sections carry a "only applicable for ..."
  tooltip)
- `Logic Support` flags (`gr_is_natural_person`, `gr_is_trust`, `gr_shortcut`, `gr_groups` g1-g4) that derive the
  investor's type and group for the rules

### 5.4 Split inputs, recombined by rule (Observed)
Name and address are asked as separate fields (first, middle, last, suffix; country, street, city, state, ZIP). These
have no mapping themselves; a **Combine values** rule writes them into the one mapped PDF field (for example
`asa_fullname_...`, `asa_fulladdress_...`). 28 of the 59 unmapped inputs are of this kind.

### 5.5 Standard invented patterns (Rule), each only when its scenario is real
Confirm the scenario for this fund before building any of these. "Standard pattern" does not mean "this fund needs it".
- **Fund selection** ("Please choose the fund(s) you wish to invest in:"), on the very first page. If allocation depends
  on a condition, ask the client for the condition (here it is a hidden page).
- **Capital-commitment warnings**: ask the client whether a minimum or maximum exists and whether it is a hard stop
  (red, blocks submission) or a soft stop (orange, lets the investor proceed).
- **Community property / spouse**: "Are you married and living in a community property state?" and "Are you investing
  with your spouse?", with the community-property footnote; check whether it drives a second signature.
- **Authorized signatory for individuals**: "Does the [Investor/Subscriber] have any authorized signatory?" (entities
  always have one; individuals sometimes do: IRA custodian, revocable trust).
- **Contact prefill checkbox** between back-to-back contact sections: "Check this box if the information for [current
  section] is different from the [section above]." (Observed: 7 in this form)
- **Confirmation checkbox** under any representation, warranty, declaration or acknowledgement ("I confirm that I
  have read, understand, and agree to the above.", with the Oxford comma). Trigger words: represent, warrant, declare,
  acknowledge.
- **Initials**: ask once, right under the legal-name field, and turn "initial here" lines into checkboxes or radios.
- **Additional sheet** for overflow contacts or wire instructions: a triggering radio, a notifying well, a sample, and an
  appropriately named supporting document. (Not present in this form.)
- **AML/KYC investor type**: if the AML/KYC list differs from the General Information list, ask the investor to
  re-select their type there (Observed: an "Please indicate if you are" radio on the AML page).
- **Tax form** as a supporting document unless the client says otherwise: W-9 when U.S. person, "The appropriate Form
  W-8" when not, "The appropriate IRS tax form" when it cannot be determined, each with the standard help text.
  (Observed: both a "Form W-9" and "The appropriate IRS Form W-8" item.)
- **Signing notifications**: a blue well saying who will be asked to sign (witness, IRA custodian, authorized
  signatory). (Observed: 6)

## 6. Mapping back to the PDF's fields

- PDF buttons map one to one to form options: all 288 are mapped, each option has exactly one `pdfMappings` entry;
  126 options have none (web-only options). 59 PDF names are shared by several buttons: those are radio groups.
- Text fields map through `ui:pdfMapping` (154 nodes). Structural widgets (Group, Header, Page, FileGroup, Signature, File)
  never do, and neither do gating questions or split inputs.
- Signature and signature-date fields are not mapped; signing fills them.
- Only 215 of the 442 mapped names exist in this booklet. Confirmed: the booklet differs from the PDF template the
  mappings point at, so a mismatch alone is not an error.
- Mapping methods, most used first (Rule): side-by-side view (PDF next to the builder); map immediately after adding a
  widget; "Import from PDF" (then fix a wrong default type, e.g. a textbox that is really a percentage).
- Unique signer (an email different from the investor's) for: witness, joint investor, spouse, verifying third party.
  GP signature descriptions must be labelled for batch countersign.

## 7. Logic is layered on top

Observed (146 rules from templates): show/hide and enable/disable by option for Radio, MultipleCheckbox and Dropdown,
including `[FieldBelow]` and `[Show if Check]` variants; show/hide FileGroup items; prefill; combine values (names,
addresses); validate Integer / Percent / Money > 0; calculate `gr_shortcut` from the investor type.
Fields below appear only after their option is selected (Confirmed).

For automation: structure (Pages, widgets, mappings) can be proposed from the PDF; the gating questions, routing and
visibility logic need an investor-type and group model plus rule templates, and are the part most likely to need a human.

## 8. Naming and aliases

- Every widget has a unique alias (auto-generated; keep it meaningful when there is a choice). Rules read aliases, and
  every field below needs one (Rule).
- Observed over 458 names: 46 follow `asa_<alias>_<section>` (Inferred: ASA = Anduin Standard Alias, for reuse across
  forms); 292 are descriptive (`<alias>_<role>_<section>`); 120 are tool defaults (`textbox15`).
- Refer to the investor with the term the sub-docs use (Subscriber, Investor or Applicant) in every invented question.

## 9. Design tokens (Rule) and how this form follows them

| Token | Rule | Observed |
|---|---|---|
| Heading sizes | H1 UPPERCASE 23px, H2 Title Case 20px, H3 Title Case 17px; never underline a heading | Header types Heading1 x7, Heading2 x6 |
| Simple input | margin-bottom 12px; label bold; required asterisk red; supporting text 11px gray (orange if important) | margin 12px on 400 nodes |
| Complex input (has children) | children labels 13px regular; indent 16px; margin-bottom 20px | indent 16px on 45, margin 20px on 12 |
| Radio / checkbox field below | indent 24px | indent 24px on 46 |
| Repeatable | labels regular, not bold | none here |
| Alignment | left-aligned, never justified (customer exceptions exist) | |
| Colors | only the predefined colors, used for their meaning: blue informative, orange warning, red required/error | wells use Info/Warning |
| Pages | simple page stays minimal; complex page splits into sections each starting with a Heading 3, content indented 16px, 20px between sections | |

Footnote rules (Rule): replace "see footnote 3" with "here" followed by a footnote widget, because the form has no
PDF footer; bold defined terms consistently. A library of reusable footnote content exists (community property
states, U.S. person definitions, EEA member states, ITIN, initials). Customer-specific requirements (for example
justified text, or no commenting) apply only to that customer.

## 10. Principles (summary)

1. The PDF stays the legal source of truth; the form collects and maps data back (Observed). Anduin never edits a
   client's legal text (Rule).
2. Digitize only what needs input; embed the rest, with the standard lead-in sentence (Confirmed, Rule).
3. One bookmark section becomes one Section/Page, in PDF order, adjusted only for logic (Observed, Rule).
4. One PDF button becomes one option; one text field becomes one node (Observed).
5. **Ask the investor-type question first, and gate group-specific sections with invented gating questions that carry no
   PDF mapping** (Confirmed).
6. Keep legal text verbatim; add only what helps the investor (wells, footnotes, confirmations) (Rule).
7. Let rules, not structure, decide who sees what; keep derived state on hidden pages (Observed).
8. Digitizing is not photocopying: simplify (Individual/Entity), split (name, address), and recombine by rule (Rule,
   Observed).

Why it was built this way: to let investors complete a legal booklet on the web without rewriting the legal text, to show
each investor only the sections that apply, and to still produce the filled PDF (Confirmed).

## 11. Pipeline for automation

1. **Segment**: bookmarks -> sections and pages; apply R-A-I-N to the order.
2. **Classify** each page range as interactive or read-only. Signals: AcroForm fields, blanks (`____`), "check one / all
   that apply", True/False, signature lines. Read-only -> `Pdf` widget plus the standard lead-in sentence.
3. **Detect the audience model**: find the investor types and groups the document addresses (individual, entity,
   jurisdictions such as Canada, EEA, UK, Japan, tax status). This drives everything below.
4. **Place the routing questions first**: propose the investor-type question (Individual / Entity, specific types
   nested), then a gate for each group-specific section, all with no PDF mapping, using the PDF's own term for the
   investor. For each section: if the sub-doc states who completes it, **quote that condition as the gate and keep
   separate questions where conditions differ**; if it is silent, fall back to **one generic multiple-choice gate**
   ("Please indicate your country of residence" / "Please indicate if you are a ..." with options like "UK Investor",
   "Japanese Investor"). Flag each for human confirmation.
5. **Chunk** interactive pages in reading order into Header / Paragraph / input blocks.
6. **Map** constructs to widgets (section 4), using AcroForm field-name tokens as hints.
7. **Bind** AcroForm fields: buttons 1:1 to options (shared name = group), text fields by `pdfMapping`; split inputs
   (name, address) get a combine rule.
8. **Carry** footnotes as footnote widgets (reword "footnote n" to "here"), rich text as rich text.
9. **Propose standard invented patterns** (5.5) **only where their trigger is present** in the text.
10. **Set** disabled-page tooltips, hidden pages, signer names, signing notifications and supporting documents.
11. **Validate**: every AcroForm button mapped to one option; every digitized page has overlap >= 60%; reading order
    preserved; every disabled page has a specific tooltip; every field below has an alias and 24px indent; no
    default-named node left unreviewed; investor-type question precedes everything it controls; Form Builder
    validation all green.

**Needs a human today:** which sections to embed, the audience model and gating questions, rule authoring, alias naming,
which invented patterns the client actually wants (capital-commitment limits, additional sheets), and mapping a PDF
whose field names differ from the template.

## 12. Open questions
- How is `gr_groups` (g1-g4) defined, and does it decide which FileGroup items appear?
- Are the unnamed rules (about 60%) hand-written, and should automation target them?
- What decides Heading 1 vs Heading 2, and Info vs Warning wells?
- Which wording does the gate use when: "country of residence" vs "Please indicate if you are a ..."? (Confirmed that
  both exist; the choice follows how the PDF words the audience of each group section.)
- How should an automation decide that a section's condition is "laid out" in the sub-doc? (Proposed: the section opens
  with an applicability sentence such as "This ... applies to a Subscriber that is ...", or the instructions name who
  completes it; if none, use the generic gate.)
