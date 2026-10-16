# UI Builder

Throwaway prototype of Anduin's Form Builder (preview/fill + light editing), rendered from a Form Builder JSON export.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the pure model/ + reducer
npm run build    # typecheck + production build
```

- Default form: `src/data/demo-form.json` (LP Interest Transfer demo). Use **Load form JSON** (top bar) to render any other export; only `namespaceFormSchemaMap[defaultNamespace]` is read.
- Working: fill the form; click a field to edit all of its metadata (Properties panel); the **+** next to "Table of Contents" opens the widget picker, and picking one opens an Add field form (name, location, every known `ui:` key, plus custom `ui:` keys); all 27 Anduin widgets (Signature, Pdf/Word, FileGroup and a nested File are placeholders; Repeatable has real rows up to `ui:maxItems`); fields below an option (Radio / MultipleCheckbox, set in the options list of the Properties panel, shown under their option; a field belongs to one parent option); footnote tooltips; "Show invisible pages & fields"; **Export form JSON** (the loaded file with only `schema` and `uiSchema` replaced; rules/libs carry through).
- The right column holds the "Show invisible pages & fields" toggle (working) and "Show alias" (inert, "Not in prototype") until you select a field or add one.
- Not implemented: rules, PDF generation, signatures, commenting, persistence, deleting/reordering fields, nested Repeatables, undo.
- Specs: `docs/superpowers/specs/2026-10-09-form-builder-prototype-design.md`, `docs/superpowers/specs/2026-10-09-add-fields-and-widgets-design.md`


## AI review (optional)

On the start page you always choose both files, the annotation JSON and the PDF, and then press **Run build** (nothing starts when a file is chosen). The build can ask a model to review the form before it opens: the investor type question, who signs each signature, which address boxes to split, and fields that are optional by nature. It proposes; nothing is applied until you accept it. The proposals open with the form, each as a card on the field it is about (Accept or Dismiss), and all of them are listed at the top of the table of contents, where you can jump to one, accept the sure ones at once, or dismiss them all. What is left survives a refresh, and an accepted change can be undone with Cmd/Ctrl+Z.

1. Copy `.env.example` to `.env.local` and fill in your LiteLLM endpoint, key and model name (`LITELLM_BASE_URL`, `LITELLM_API_KEY`, `JUDGE_MODEL`; optional `JUDGE_REASONING_EFFORT`). The file is git-ignored and the browser never sees it.
2. Restart `npm run dev`. The landing page then shows "Review with AI (model)".
3. Add the source PDF on the landing page too: its text is what the investor type and signer decisions are read from. Only the few pages each decision needs are sent, as text.

Answers are cached in the browser by prompt, so rebuilding the same form does not call the model again. To try the flow without a model, run `node scripts/mock-llm.mjs` and point `LITELLM_BASE_URL` at `http://localhost:4010/v1`.

### How steady is the AI?

The investor type question is asked three times in parallel and the answer most tries agree on wins; if the tries disagree, the proposal says so, its confidence drops, and a split with no majority is not ticked. To measure the steadiness on a sub-doc (needs `.env.local`):

```bash
node scripts/pdf-pages.mjs "sub-doc.pdf" pages.json
npx tsx scripts/ai-variance.ts "annotation_document_data.json" pages.json 8
```

It prints each run's two columns and how many distinct answers there were.



## The assistant

A chat tab (Assistant, beside Properties) changes the form live: you ask, it reads the form with tools (outline, search, one element, source-PDF page text or picture) and edits it with tools (update, add, delete, move, group). Every change is applied at once, highlighted on the canvas and listed under "changes to review", where each one shows what it was and what it is now and can be accepted or put back (one undo step per turn). The conversation is kept in the browser per form.

The model is reached through the server (`/api/chat`, streamed); the key never reaches the browser. The tools run in the browser on the open form.

## Deploying (Dokploy or any Docker host)

`Dockerfile` builds the app and runs `server/prod.ts` (the app plus `/api/llm` and `/api/chat`). Settings are environment variables (see `.env.example`): `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `JUDGE_MODEL` (and optionally `CHAT_MODEL`, `CHAT_REASONING_EFFORT`).

### Google sign-in (for a public address)

Set `GOOGLE_CLIENT_ID`, `ALLOWED_DOMAINS` (and/or `ALLOWED_EMAILS`) and `SESSION_SECRET` (32+ random characters) and the whole site asks for a Google sign-in first. The server verifies Google's ID token, checks the email against the allowlist, and keeps you signed in with a signed, HttpOnly cookie (`SESSION_HOURS`, default 12). Everything except `/login` and `/api/auth/*` needs that cookie, including the AI endpoints, and the allowlist is re-checked on every request. Leave `GOOGLE_CLIENT_ID` unset and nothing changes: the site is open.

In Google Cloud, create a "Web application" OAuth client and add the site's address (for example `https://uibuilder.example.com`) under Authorized JavaScript origins. There is no client secret to store. Use this together with the AI settings if you put the model key on a public address, so only the allowed accounts can spend it.

Single sign-on: put the app behind the sign-in proxy (Dokploy's forward auth in front of Anduin SSO) and set `AUTH_HEADER` to the header the proxy passes the signed-in user's email in (for example `X-Forwarded-Email`). Every `/api` request without it is refused. Only expose the app through that proxy: a request that skips it could send any header value.
