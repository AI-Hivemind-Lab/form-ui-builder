# transFORM patch: make the embedded PDF files while saving

What it changes in the team's transFORM extension (read from the version in `~/Downloads/transFORM`):

- `sandbox.js`: passes the function's `embeddedCuts` list through (the extension keeps only schema and uiSchema from the function's answer).
- `js/modes/fullTransformMode.js`: before the save, makes each cut and writes the new file ids into the form.
- `js/api/cutApi.js` (new, this folder): the three calls and the rule for keeping a cut the form already has.

Apply, from the extension's folder (a copy of it, not a running one):

```bash
patch -p1 < /path/to/docs/transform-extension/embedded-cuts.patch
cp /path/to/docs/transform-extension/cutApi.js js/api/
```

Then reload the extension in `chrome://extensions`. Without this patch the extension behaves as before and ignores the list.

The request paths are as confirmed for production (`portal.anduin.app`) and Minas (`portal-minas-tirith.anduin.dev`): `/api/v3/form/getFileInfoToCut`, `/api/v3/form/cutFile` and `/api/v3/files/getPdfUrl` (note: `files/`, not `form/`). The host is the one of the open tab, as for the other calls.

How a cut is decided (see `src/model/transformCuts.test.ts`): wanted pages are checked against the page count first and nothing is made if one is wrong; a cut is kept when the form lists that name for the same pages of the same PDF and the file is still there (`getPdfUrl` answers); otherwise it is made again and the entry replaced. Files are archived by the platform, never deleted, so a failure half way leaves the earlier cuts as unused files.
