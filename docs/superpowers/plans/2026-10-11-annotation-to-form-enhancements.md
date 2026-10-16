# Annotation → Form: Enhancement Plan (draft for sign-off)

**Goal.** Today "Build from annotation JSON" gives a faithful *import*: every annotated field in PDF order. A DS still has to turn it into a *good form*. This plan closes that gap: apply our standards automatically, and use AI only for the judgment calls rules cannot make.

**Status.** Signed off by you on 2026-10-11; every decision is recorded in section 9. Phases 0 and 1 are built. Phases 2 and 3 are built together (2026-10-12): PDF text extraction, the AI service and review panel, the investor type question, the name blocks and address expansion. Build order: Phase 0 and 1 first, then 2 and 3.

---

## 1. Design

```
annotation JSON ─▶ [A] Importer (exists) ─▶ draft form
PDF (optional) ──▶ [B] PDF text extraction (pdf.js, in browser)
                                │
draft + PDF text ─▶ [C] Standards pass (rules, deterministic) ─▶ standard form
                                │
standard form + PDF ─▶ [D] AI judgment pass (Claude API) ─▶ list of decisions (JSON, schema-checked)
                                │
decisions ─▶ [E] Review panel (accept / reject each, with evidence) ─▶ [F] apply (deterministic) ─▶ final form
```

Principles:

1. **AI never writes the form.** It returns a small list of *decisions* (e.g. "this group is the investor-type question; individual options = …"). Plain code applies them. The same decisions always produce the same form.
2. **Rules first, AI only where rules cannot decide.** Every item in section 3 is tagged *Rule*, *AI* or *Hybrid*.
3. **Every change is traceable.** Each automatic change records which standard made it and why; the review panel and warnings show it. Nothing silent.
4. **Evidence over opinion.** Each AI decision must quote the page/text it relied on. Decisions without evidence are rejected by the validator.
5. **Standards are a registry**, so new ones ("probably more in the future") are added as one function + one test + one line in a list, and can be switched on/off.

---

## 2. Your questions, answered

| Your question / observation | Answer |
|---|---|
| Do we need AI for the judgment part? | **Yes, for a short list** (investor-type question, signature-block assignment, which single address boxes become 5 elements, Subscriber vs Investor wording, gray-zone required/optional, Title Case of unusual words). **No for most of your list** (boolean labels, hidden page, signature grouping, layout, GP-filled fields, Title Case basics): those are rules. See the *Source* column in section 3. |
| "The Investor Designation question must be required, not optional" | Bug in my rules, not a judgment problem: **every radio and checkbox group is generated as not required** (50 of 50 radios and 37 of 37 checkbox groups in the CIC file). I did that earlier "until rules exist". New default: radio groups are required. Checkbox groups: see question Q5. |
| "Many fields are optional with no clear indicator. Do we need AI to read the meaning?" | Mostly **no, it is a rule bug**. In the CIC file 21 text fields come out optional: **10 are "If Yes, provide…" fields that sit below a Yes option** (they must be required, like all fields below), and most of the rest are blocks that begin with "If…" ("If the Subscriber is regulated…"). My rule treated *conditional* as *optional*. Conditional ≠ optional: the field is required, a rule shows or hides it later. New rule: optional only on an explicit marker; conditional fields stay required and are listed as "needs a rule". AI is only a *suggester* for genuinely optional-by-nature fields (Fax, Attention…) and never auto-applies. See 3.9. |
| "Salutation should be inline, AI judgment?" | **A rule is enough**: short options, no fields below → Inline. AI only for edge cases. (Your real exports: 957 inline vs 30 default.) See 3.7. |
| "Address blocks should be 5 elements" | **Hybrid.** Rule when the PDF already has separate boxes. AI decides when a single "Address:" box should be expanded. Open question Q4 about PDF mapping. See 3.6. |
| "Signature widgets in a group at the end of the page" | **Rule.** See 3.4. |
| "Accepted capital commitment is GP-filled" | **Rule** on the label text. See 3.5. |
| "Titles in Title Case" | **Rule** with a glossary; AI only to propose the odd word (acronym vs word). See 3.8. |
| "Hidden page that hosts the PDF" | **Rule.** See 3.3. |
| "yes_/no_/true_/false_ options" | **Rule.** See 3.2. Trivial, and removes ~90 "LABEL MISSING" warnings. |
| "Type of investor question must come first" | **AI to identify, rule to build and place.** See 3.10. |
| "Subscriber name block depends on type" | **Hybrid.** See 3.11. |

---

## 3. The enhancements

Each item: **what**, **how it is detected**, **output**, **source**, **flags**.

### 3.1 Quick fixes found while reviewing your screenshots (Phase 0, no AI)

- **Empty-label fallback.** The Paragraph widget shows its alias when its text is empty (`ui:formattedText || node.title`). Fix to show nothing and keep the "Missing label" chip. In my run the radio and text-field labels render empty with a chip; **your screenshots print the alias above them**, so that form was probably generated by an older build and kept in browser storage. Rebuild once to confirm; if it still shows aliases tell me.
- **Layout options in the editor.** Your tool offers Default / Inline / **2 columns / 3 columns**. Real exports store `ui:fixedLayout` = `Default | Inline | TwoColumns | ThreeColumns`. Add the two missing choices.
- **Default value.** Your tool has a "Default value" row; the app does not. Real exports store it as `default` on the schema node. Add the row.
- **Required on groups.** Radio groups required by default (see section 2).
- **Fields below are always required** (overrides any "If…" wording).

### 3.2 Boolean options from the annotation name (Rule)

- **Detect:** an option (radio or checkbox) with no highlighted text whose alias starts with `yes_`, `no_`, `true_` or `false_` (case-insensitive).
- **Output:** option `formattedText` = "Yes" / "No" / "True" / "False".
- **Also:** the "If Yes/No" field-below tagging then matches by this label, and the "FIELD BELOW INFERRED" warning goes away for it.
- **Test:** the CIC file: every Yes/No option labelled; "LABEL MISSING: option …" warnings drop.

### 3.3 Hidden page for the PDF (Rule)

- **Output:** a first top-level page (`Page`) titled "Hidden" with `ui:invisible: true` **and** `ui:invisibleOnTocWhenHidden: true`, containing the `File` widget (`ui:fileName` = the annotated PDF). Replaces today's bare top-level `file0`.
- **Flag:** none (always created).

### 3.4 Signature widgets in a group, at the end of their page (Rule + AI for membership)

- **Output:** per page, one Group (e.g. "Signatures") placed last, holding that page's signature widgets in PDF order.
- **What belongs to a signature widget.** Your real exports map the *signer's* date, name and title into the signature widget (types `Date`, `Name`, `Title`, `Custom`), because the signer fills them during signing, not the person filling the form. Today those fields appear as ordinary text boxes before the signature. **Hybrid:** a rule proposes that text fields sitting in the same block (same page, between the previous signature and this one) belong to it; AI confirms and assigns each field's type from its label and the block heading (e.g. "Print name" → Name). Without evidence the field stays an ordinary field and is flagged.
- **Signer name and role.** AI reads the block heading and picks the signer name from the **fixed vocabulary**: `Individual Signatory` (individual subscriber), `Authorized Signatory` (entity subscriber), `Joint Signatory` (joint investor), `Spouse Signatory`, `Custodian Signatory` (custodian of an IRA), `Additional Signatory`, `Witness Signatory`, `General Partner Signatory` (GP, role `GpSignature`). Anything else is rejected and flagged. Plus LP/GP. Shown in the review panel; flagged if unknown (as today).
- **Flags:** `SIGNATURE: signer name unset`, `SIGNATURE: field X not assigned`.

### 3.5 GP-filled fields (Rule)

- **Detect:** a text field whose label matches `accepted (capital )?(commitment|amount)` (case-insensitive).
- **Output:** removed from the page body and added to the **GP** signature widget on the same page as a `Custom` mapping (`isCommitmentAmount: true`, description from the label); that signature gets role `GpSignature`.
- **Flag:** if the page has no GP signature, keep the field, warn.

### 3.6 Address blocks (Hybrid)

- **Rule (exists):** a group already split into Country / Address / City / State / Postal becomes the 5-element standard, US and non-US variants for state and ZIP.
- **New:** a group or field whose label says address and which is a **single textbox** is a candidate. **AI decides** which candidates to expand (your "sometimes we leave it as one box"), with evidence. Expanded: Country, Address, City, State (US/non-US), Postal (US/non-US).
- **PDF mapping (decided):** the five elements stay unmapped; a **hidden textbox** (`merged<address alias>`, `ui:invisible`) is created and mapped to the single PDF box. A rule later combines the five elements into it.

### 3.7 Layout of option lists (Rule, AI for edge cases)

- **Rule:** radio/checkbox group → `Inline` when it has ≤ 6 options, no option longer than ~40 characters, and no fields below; `TwoColumns`/`ThreeColumns` for 7+ short options; `Default` otherwise (long options, or any option has fields below).
- **Yes/No (decided):** a group whose options are all Yes/No/True/False is **always Inline**. It never takes a field below, because that would stack the options. A follow-up that says "If Yes…" or "If No…" stays an **independent field right under the question, indented 24px**, still required, and is listed as `NEEDS RULE: … applies only when "<question>" is Yes`.
- **AI:** only when the rule is borderline; the thresholds live in one place and are tunable.

### 3.7b Fields below in two-column lists, and label capitals (Rule)

- **Why a "Please specify" field was missed:** the importer treated any option list with two options on one line as inline and refused to tag fields below it, because it could not tell which option a follow-up belongs to. That is right for Yes/No, wrong for a **two-column list** (the Form PF types, investor types), where only the "Other" row has a follow-up.
- **Now:** a follow-up is tagged below the option **to its left** in the row just above it (same page, close, indented), in two-column lists too, but only if its label reads like a follow-up ("Please specify", "Specify", "If…", "Other"). Yes/No groups still never take fields below (3.7).
- **Capital letters (standard `capitalize-labels`):** the first letter of an input field's label is capitalised ("please specify:" → "Please specify:"), after any numbering. Enumerators ("a)", "(i)") and radio/checkbox group labels (often the second half of a sentence) are left as the PDF has them.

### 3.8 Title Case for titles (Rule + glossary)

- **Applies to:** page titles (TOC names), page headings (Headers), group-of-pages names.
- **Rule:** Title Case with small words lowercase ("of", "and", "for"…), first and last word capitalised; keep Roman numerals ("VII."), tokens with digits or hyphens ("A-1").
- **Acronyms (decided).** A small starting list stays in capitals: LP, ERISA, FOIA, UBTI, IRA, AML, U.S., GP (kept in an editable file). Beyond that list the document decides: an all-caps word is kept in capitals if the same word appears in capitals inside ordinary mixed-case text elsewhere in the annotation (e.g. the fund name). Client-specific words the document does not settle (for example the fund's own abbreviations) go to the AI review list; nothing else is hard-coded.
- **AI:** proposes the case of any all-caps word the document does not settle, listed for review.
- **Note:** the heading is stored in Title Case; the design token shows H1 in capitals.

### 3.9 Required / optional (Rule ladder, AI suggests)

Applied in this order:
1. **Explicit optional marker** in the text → optional: "(optional)", "if any", "if applicable", "if available", "if known", "if different from above" (the last one keeps the block required behind a gating checkbox, as built). The marker list is a file you can extend (Q6).
2. **Field below an option** → required.
3. **Radio group** → required.
4. **Checkbox group** → required, like radio groups (Q5), with one special case: a **split list**. When the annotator split one logical list into several checkbox groups (the CIC accredited-investor categories A to K under one lead-in paragraph), each box stays **optional**, the red asterisk goes on the **label of the paragraph that comes before the list**, and the generator records a rule to write ("at least one of these boxes must be checked"). A rule detects the obvious case (consecutive checkbox groups whose labels run A., B., C. … under one paragraph); the AI confirms or finds the less obvious ones (Phase 3).
5. **Conditional wording** ("If Yes…", "If the Subscriber is…", "Where…", "Or if…") → **required**, and recorded in a **"needs a rule" list** with the condition text (this doubles as the starting point for the logic checklist).
6. **Everything else** → required.
- **AI (suggest only):** reads the labels and proposes fields that are optional by nature (Fax, Attention, Telephone on secondary contacts…). Shown in the review panel, **never auto-applied**; you accept each.

### 3.10 Investor-type question (AI identifies, rules build)

- **Position:** the first thing on the first visible page, before anything that depends on investor type.
- **Finding the taxonomy (AI, reading the PDF):** in order of preference:
  1. a picklist in the sub-doc (in the CIC file, "4. Type of Subscriber — Please check all that apply", alias `asa_investortype_investortype`; the `asa_` prefix is a strong signal);
  2. the signature blocks ("this block is for individuals and IRAs, that one for corporations, LLCs, trusts…");
  3. instructions elsewhere.
  **Never the Form PF list** ("For Reporting Purposes"). The AI returns the options, which are individual and which are entity, and quotes where it found them.
- **Selection mode (rule on the PDF text):** radio unless the sub-doc says "check all that apply" or similar. Entity options may then be checkboxes; **individual options are always radio** (one person cannot be a natural person and joint at once).
- **Layout (rule):** one Group with `ui:dynamicLayout` `{"sectionsWidth": [50, 50], "gutter": 12}` holding two widgets, individual options on the left and entity options on the right. Your exports show this exact shape (26 groups: an `individuals` Radio next to an `entity` Radio).
- **If the doc already has the picklist (decided):**
  - **Not numbered** (free to move): reuse the annotated field, keep its PDF mapping, restructure it into the two columns and move it to the top.
  - **Numbered, inside a numbering sequence:** do not move it (that would break the numbering). Leave the original where it is and create a **duplicate** at the top without numbering and without PDF mapping. A rule later prefills the original from the duplicate.
  - **Not in the doc:** invent it, no PDF mapping, standard lead-in "Please indicate if you are a".
  - The result records which case it was.
- **Required (decided):** both columns **optional**, `ui:clearable: false`. A rule later forces at least one choice across the two lists.
- **Which options go in which column (decided):** depends on the sub-doc's own instructions; the AI reads them and quotes the evidence. If the instructions do not say, the option is flagged for you.
- **Rules later:** choosing in one column clears the other; the answer drives page and name-block visibility. Not built here.

### 3.11 Subscriber name block (Hybrid)

- **Find it:** the first text field whose label or alias says name of subscriber/investor (e.g. alias `asa_fullname_investorname_*`). Later copies (signature pages) are prefills and stay as they are.
- **Output:** three alternative blocks, one per investor kind, placed right after the investor-type question:
  - natural person: First name, Middle name (optional), Last name, Suffix (optional);
  - joint tenants / tenants in common: one text box plus the note *Joint Subscribers should enter their names in the format "Name 1 and Name 2 JTWROS/TIC/TBE". E.g. James Smith and Pauline Jones JTWROS.*;
  - any other type: one text box.
- **Word choice, Subscriber or Investor (Rule, AI as tiebreak):** count which word the PDF text uses for the person subscribing; use it in the labels and the joint note.
- **Rules later:** which block shows for which type. Not built here.
- **PDF mapping (decided):** the four natural-person boxes stay unmapped; a **hidden textbox** `mergedname` (`ui:invisible`) is created and mapped to the PDF name box. A rule later combines the four into it.

### 3.12 Standards registry and the next ones

A single list in code: `{ id, title, source: rule | ai | hybrid, enabled, apply(form) }`. A switch panel on the landing page lets you turn standards on or off per build, and every change is logged as "standard X changed Y". The sections above are standards 1 to 11; yours to come are one function and one test each.

---

## 4. The AI layer

- **Where it runs (decided):** a small server route in the app (`/api/judge`) that calls your **LiteLLM** endpoint, which fronts **Anthropic on AWS Bedrock** (data stays on your servers). Settings live in `.env.local` (git-ignored): `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `JUDGE_MODEL`. The browser never sees the key. The call uses the OpenAI-compatible chat-completions format that LiteLLM exposes, with a forced function call for the structured result.
- **Model (decided):** Sonnet 5.5, high effort, for the judgment calls (investor type, signature assignment, address expansion). A smaller model (Haiku 5.5) for trivial classification if we add any. Opus is not needed unless Sonnet proves unreliable on a real form.
- **Cost design: text first, targeted pages, no full-PDF upload.**
  - A PDF sent as a document is billed per page for the extracted text *and* a page image, roughly a couple of thousand tokens per page, so an 86-page booklet is on the order of 100k+ tokens per call. That is the expensive part.
  - We already extract the PDF text in the browser (pdf.js). Text is far cheaper than page images and carries what the decisions need.
  - The annotation tells us **which pages matter for each decision** (the page of the type picklist, the pages of the signature fields, the pages of the address fields, page 1). Each decision gets its own small call with only those pages' text (typically 3–10 pages), not the booklet.
  - Page images are sent only for a block the text cannot settle (a signature block whose layout is unclear), and only that one page.
  - The standards text goes in a cached system prompt, so repeated calls reuse it.
  - Results are cached by PDF hash plus skeleton hash, so rebuilding does not call the model again.
  - Practical effect: a few small calls instead of one huge one, and no dependency on PDF-attachment support through LiteLLM.
- **Input per call:** the text of the relevant pages (with positions where layout matters), the matching part of a compact skeleton of the standard form (names, labels, types), and the standards text as the system prompt.
- **Output:** one forced tool call returning JSON matching a schema: `investorType`, `nameBlock`, `signatureBlocks[]`, `addressExpansions[]`, `optionalSuggestions[]`, `titleCaseWords[]`. Every item has `evidence` (page + quote) and `confidence`.
- **Validation:** schema check; every referenced alias must exist; evidence must be present; anything invalid is dropped with a warning.
- **Review panel:** a list of decisions with evidence and Accept/Reject (high-confidence ones pre-accepted, optional suggestions never). Nothing is applied until you press Apply; you can re-run.
- **Caching:** results are keyed by PDF hash plus skeleton hash, so rebuilding the same form does not call the API again.
- **Tests:** no network in tests; recorded responses for the Entity and CIC files, plus malformed-response cases.
- **Privacy:** PDF text goes only to your LiteLLM/Bedrock endpoint (decided in Q9).

---

## 5. Phases

| Phase | Content | AI? | Sign-off gate |
|---|---|---|---|
| 0 | Quick fixes (3.1), boolean labels (3.2), fields-below required, radio required, new required ladder without AI (3.9 1–3, 5–6), "needs a rule" list | No | Your CIC form no longer has optional radios or optional "If Yes" fields |
| 1 | Hidden page (3.3), signature group at page end with GP fields (3.4 rule part, 3.5), layouts (3.7), Title Case (3.8), standards registry (3.12) | No | Signatures and titles look right in your review of the CIC form |
| 2 | PDF text extraction; investor-type question and name blocks (3.10, 3.11) built from rules when the picklist is in the annotation; address rule (3.6) | No | Type question first, name blocks present |
| 3 | AI layer (section 4): investor-type discovery when not annotated, signature assignment and signer names, address expansion, gray-zone suggestions, Title Case words | Yes | You review decisions on two real sub-docs |

Each phase ends with: all tests green, the Entity snapshot unchanged unless a standard intentionally changes it (called out), and the CIC form re-checked side by side with the PDF.

## 6. Tests

- Unit test per standard (small synthetic annotations, like the existing ones).
- Snapshot tests on the Entity form and a trimmed CIC fixture; every intentional diff is listed in the commit message.
- AI layer: schema and validator tests; recorded-response tests; one live smoke test you run by hand.

## 7. What stays out of scope here

Rules and logic (show/hide, clearing, gating), ASA alias mapping, concatenating the four name parts into the PDF's single name box, and the unique-signer-email setting. The plan produces the *list* of rules needed (conditions, gates), not the rules.

## 8. Risks

- **AI misjudges the investor-type list.** Mitigation: evidence required, review panel, nothing applied silently.
- **Layout and Title Case thresholds are opinions.** Mitigation: one configuration file each; you tune them on real forms.
- **Signature-block membership is geometric.** Mitigation: AI confirms; unsure fields stay ordinary and flagged.
- **API cost and latency.** Mitigation: text-first, per-decision page selection, cached system prompt and results (section 4), so cost no longer grows with booklet length.

## 9. Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Reuse the existing type picklist? Both columns required? | Reuse and restructure **only if it is not numbered**; if numbered inside a sequence, **duplicate** it (unnumbered, unmapped) and keep the original. Both columns **optional, not clearable**; a later rule forces at least one choice. |
| Q2 | Which column for IRA, Joint tenants, Custodian, Trust? | Depends on the sub-doc's instructions; AI reads them, flags when unclear. |
| Q3 | Four name widgets vs one PDF box | Four unmapped widgets plus a **hidden `mergedname` textbox** mapped to the PDF; a rule combines them later. |
| Q4 | Five address widgets vs one PDF box | Same: hidden merged textbox mapped to the PDF; rule later. |
| Q5 | Checkbox groups required or optional? | **Required by default** unless an indicator says optional. **Split lists** (one logical list cut into several groups by the annotator) keep each box optional, put the red asterisk on the preceding paragraph's label, and list a rule "at least one must be checked". Needs AI judgment beyond the obvious lettered case. |
| Q6 | Optional markers list | OK for now. |
| Q7 | Signer date/name/title into the signature widget; signer names | Yes. Vocabulary in 3.4. |
| Q8 | Hidden page | Title "Hidden", invisible **and** hidden from the TOC. |
| Q9 | AI provider and model | Your LiteLLM key to Anthropic on AWS Bedrock; **Sonnet 5.5**. |
| Q10 | Acronym glossary | Start with LP, ERISA, FOIA, UBTI, IRA, AML, U.S., GP. Further acronyms come from the document itself (3.8), and client-specific ones from the AI review. |
| Q11 | Inline layout limits | ≤ 6 options, ≤ 40 characters each; tunable. |
| Q12 | Phase order | 0 and 1 first, then 2 and 3. |


## 10. DS practices taught on 2026-10-12 (built)

| Practice | How it is built |
|---|---|
| A full-page PDF (not in a modal) has the sentence "Please carefully review the document below before continuing to the next section." above it | Standard `pdf-pages` (rule) |
| The PDF stays at the top of its page, under the heading; a page that mixes it with fillable fields is reported | `pdf-pages` (rule) + `PAGE MIX` warning; the AI proposes where the fields go (`page-structure`) |
| Fillable fields leave the PDF page for the general information page, in a group "Subscriber Information" with the investor type question first | AI decision `move-fields`, applied at the start of the target page |
| One UI field mapped to several PDF places that always show and hide together; invisible prefilled copies | AI decisions `merge-field` and `prefilled-field` (page text and page images), with a `NEEDS RULE` for each prefill |
| Date, name, title and custodian fields on signature pages go into the signature widget | `signature-fields` (rule, by alias) and the AI signature task, which now also looks at the page image |
| Instructions and notices are Info wells (light blue); Warning wells orange | Standard `info-wells` (rule); the Paragraph widget renders both |
| Investor type: a numbered picklist stays, disabled, and an unnumbered copy goes at the top with a prefill rule | AI decision `investor-type`; the numbered original gets `ui:disable` |
| The name blocks keep the original question's number as their heading | `applyNameBlocks` |
| Taxpayer ID is a radio of ID types (only those the sub-doc names, plus Other) with a validated box under each; Other has a "Please specify" box and the orange N/A note | Standard `tax-id` (rule), formats SSN, EIN, ITIN, USZIP built into CustomFormat |
| "If the Subscriber … is not …" questions stay required with the orange note "Please write "N/A" if not applicable." | Standard `na-notes` (rule) |
| Date of birth and similar fields are Date type | Importer, by label text |
| Undo reaches edits too; Cmd/Ctrl+Z | Edits are one undo step per burst on a field |

Not built: swapping and renumbering questions as the alternative to the disabled original, AI classification of wells beyond the rule, and the community-property question (the FCL has it; build it only when a sub-doc asks).
