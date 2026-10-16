#!/usr/bin/env python3
"""Generate a Form Builder export (form-content.json) from a PDF's annotation_document_data.json.

Usage: python3 -I generate_form_content.py <annotation_document_data.json> <out form-content.json> [fund name]

Reads only the annotation metadata: nothing is invented and no PDF wording is typed in. Fields without highlighted
text show their alias as the label, and footnote digits the annotation left in the text stay as they are; both are
reported when the script runs so they can be fixed by hand. See build-notes.md for the rules applied.
"""
import html
import json
import re
import sys
from collections import defaultdict

# ----------------------------------------------------------------------------------------------------------------
# Required by default. A field is optional only when its highlighted text clearly says so: "(optional)" or it opens with a condition ("If the Entity ...", "Or if ...", "Where ..."). A group whose own heading says so makes
# everything inside it optional. Fields below an option stay required: they only open when their option is picked.
# The one structural exception is the address rule: the non-US "State / Province" and "Postal Code" variants are
# optional because the US variants carry the requirement. Rules for showing/hiding come later.
OPTIONAL_TEXT = re.compile(r"\(optional\)|\boptional\b|^(or\s+)?if\b|^where\b", re.I)
# A block that only applies "if different from above" (an address) stays required, behind a gating checkbox.
GATE_TEXT = re.compile(r"\bif different\b", re.I)
NON_US_STATE_POSTAL = re.compile(r"^(state\s*/\s*province|state|province|postal\s*code|post\s*code|zip)\b", re.I)

STAR = ' <span style="color: rgb(219, 55, 55);">*</span>'
REQUIRED_MSG = "This field is required"

# ----------------------------------------------------------------------------------------------------------------


def esc(t):
    return html.escape(t, quote=False)


def plain(h):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", h or "")).replace("FOOT_NOTE_HERE", "").strip()


def with_star(h):
    return re.sub(r"</p>\s*$", STAR + "</p>", h) if h.rstrip().endswith("</p>") else h + STAR


def bold_first_paragraph(h):
    return re.sub(r"<p>(.*?)</p>", r"<p><strong>\1</strong></p>", h, count=1)


def main(ann_path, out_path, fund_name=""):
    data = json.load(open(ann_path))
    objs = {o["id"]: o for o in data["pdfObjectDTO"]}
    label = {o["labelOf"]: o for o in objs.values() if o["__typename__"] == "PdfTextLabelDTO"}

    def label_html(o):
        """Highlight text as html. kind 1 = plain text, kind 2 = html."""
        l = label.get(o["id"])
        if not l:
            return None
        kind, text = l["content"]
        return text if kind == 2 else f"<p>{esc(text)}</p>"

    def para_html(o):
        kind, text = o["content"]
        return text if kind == 2 else f"<p>{esc(text)}</p>"

    warnings = []
    meta = {"title": None}

    def footnote_widget(n, where):
        # The annotation marks where a footnote goes (a digit glued to the text) but never carries its text.
        warnings.append(f"FOOTNOTE TEXT MISSING: footnote {n} on {where} has a footnote widget with no text; its text is not in the annotation")
        return '<span data-title="&lt;p&gt;&lt;/p&gt;">FOOT_NOTE_HERE</span>'

    # A footnote digit the annotation left in a highlight: glued to the end of the text ("Entity:7", "Trustee8"),
    # after sentence punctuation ("Section 4. 10"), or before a trailing colon ("GIIN 15:"); or glued between a
    # closing bracket and a word ("(“TIN”)3or"). "page 7" or "CRS 2.0" are not touched.
    MARKERS = [
        (re.compile(r"(?<=[A-Za-z.:)”])(\d{1,2})(?=\s*(?:</p>|$))"), 1),
        (re.compile(r"(?<=[.:)”]) (\d{1,2})(?=\s*(?:</p>|$))"), 1),
        (re.compile(r"(?<=[A-Za-z]) (\d{1,2})(?=:\s*(?:</p>|$))"), 1),
        (re.compile(r"(?<=[)”])(\d{1,2})(?=[A-Za-z])"), 1),
    ]

    def fix_markers(name, h):
        for rx, _ in MARKERS:
            h = rx.sub(lambda m: footnote_widget(m.group(1), name), h)
        return h

    # ------------------------------ positions ------------------------------
    def block_positions(ids):
        out = []
        for c in ids:
            co = objs.get(c)
            if co and co["__typename__"] == "PdfTextBlockDTO":
                out.append((co["pageIndex"], round(co["area"]["top"], 2), co["area"]["left"]))
        return out

    def own_pos(o):
        if "area" in o:
            return (o["pageIndex"], round(o["area"]["top"], 2), o["area"]["left"])
        ps = block_positions(o.get("children", []) or [])
        if o["id"] in label:
            ps += block_positions(label[o["id"]].get("children", []))
        return min(ps) if ps else None

    def real_children(o):
        return [objs[c] for c in o.get("children", []) or [] if c in objs and objs[c]["__typename__"] not in ("PdfTextBlockDTO", "PdfTextLabelDTO")]

    def subtree_pos(o):
        ps = [p for p in [own_pos(o)] if p]
        for c in real_children(o):
            p = subtree_pos(c)
            if p:
                ps.append(p)
        return min(ps) if ps else (99, 0, 0)

    def atom_pos(o):
        """Where an object sits for ordering: a radio group sits at its label, else at its first option."""
        t = o["__typename__"]
        if t in ("PdfGroupFieldDTO", "PdfRepeatableFieldDTO"):
            return subtree_pos(o)
        if t == "PdfRadioGroupFieldDTO":
            lp = own_pos(o)
            return lp if o["id"] in label and lp else min(own_pos(c) for c in real_children(o))
        return own_pos(o) or (99, 0, 0)

    # ------------------------------ node builders ------------------------------
    nodes_ui = {}  # name -> ui entry

    def add_ui(name, ui):
        assert name not in nodes_ui, f"duplicate node name {name}"
        nodes_ui[name] = ui

    def label_text(o):
        h = label_html(o)
        return re.sub(r"^[\s.]+", "", plain(h)) if h else ""

    # Names under a group whose heading says it is optional ("Mailing address If different from above").
    optional_names = set()
    gated = set()  # groups behind a gating checkbox

    def mark_optional_groups(o, inherited=False):
        opt = inherited or (o["__typename__"] == "PdfGroupFieldDTO" and bool(OPTIONAL_TEXT.search(label_text(o))))
        if o["__typename__"] == "PdfGroupFieldDTO" and GATE_TEXT.search(label_text(o)):
            gated.add(o["name"])
        if opt:
            optional_names.add(o["name"])
        for c in real_children(o):
            mark_optional_groups(c, opt)

    def is_required(o):
        text = label_text(o)
        return o["name"] not in optional_names and not OPTIONAL_TEXT.search(text) and not NON_US_STATE_POSTAL.match(text)

    def field_label_html(o, below=False):
        name = o["name"]
        h = label_html(o)
        if h is None:
            warnings.append(f"LABEL MISSING: {name} has no highlighted text (formattedText left empty)")
            return ""
        h = re.sub(r"<p>\s*\.\s*", "<p>", h)  # ". Country of Tax Residence" artefact of a partly selected "2."
        h = fix_markers(name, h)
        return with_star(h) if is_required(o) else h

    def text_widget(o):
        name = o["name"]
        if o.get("isMultiline"):
            return "TextArea", "string", {}
        if name.startswith("dateofbirth"):
            return "Date", "string", {"format": "date"}
        if name.startswith("owenershippercentage"):
            return "Percentage", "number", {}
        if re.search(r"^(country_|countryoftaxresidence_|asa_country_|asa_jurisdiction_taxresidency)", name):
            return "Country", "string", {}
        return "TextBox", "string", {}

    def make_text(o, below=False):
        name = o["name"]
        w, typ, extra = text_widget(o)
        h = field_label_html(o)
        ui = {"ui:widget": w, "ui:formattedText": h, "ui:pdfMapping": [name], "ui:enabledComment": True, "ui:marginBottom": "12px"}
        if is_required(o):
            ui["ui:required"] = REQUIRED_MSG
        if "giin" in name.lower() and w == "TextBox":
            ui["ui:placeholder"] = "e.g. XXXXXX.XXXXX.XX.XXX"
        if w == "Country":
            ui["ui:placeholder"] = "Select country"
        add_ui(name, ui)
        node = {"name": name, "type": typ, "title": plain(h)[:120] or name, **extra}
        return node

    def make_paragraph(o):
        name = o["name"]
        h = fix_markers(name, para_html(o))
        add_ui(name, {"ui:widget": "Paragraph", "ui:formattedText": h, "ui:marginBottom": "12px"})
        return {"name": name, "type": "null", "title": plain(h)[:120] or name}

    counters = defaultdict(int)

    def gen_name(prefix):
        counters[prefix] += 1
        return f"{prefix}{counters[prefix]}"

    def make_header(text, level, subtitle=None, margin="12px"):
        name = gen_name("gen_header")
        ui = {"ui:widget": "Header", "ui:formattedText": "Header", "ui:heading": text, "ui:headerType": level, "ui:marginBottom": margin}
        if fund_name.strip():  # the fund name is not in the annotation; it is the subtitle of every page heading
            ui["ui:subtitle"] = fund_name.strip()
        else:
            warnings.append(f'FUND NAME MISSING: the heading "{text}" has no subtitle; the fund name is not in the annotation')
        add_ui(name, ui)
        return {"name": name, "type": "null", "title": text}

    def make_gate(g, previous):
        """Optional checkbox in front of a required block that applies "if different from above"."""
        first_p = re.search(r"<p>(.*?)</p>", label_html(g) or "")
        subject = GATE_TEXT.split(plain(first_p.group(1)) if first_p else label_text(g))[0].strip(" :-").lower() or "address"
        ref = previous or "address"
        sentence = f"Check this box if the {subject} is different from the {ref} above."
        name = f"{g['name']}_different"
        add_ui(name, {"ui:widget": "MultipleCheckbox", "ui:formattedText": "", "ui:enabledComment": True, "ui:marginBottom": "12px",
                      "ui:multipleOption": {"options": [["different", {"formattedText": f"<p>{esc(sentence)}</p>", "blueprintMetadataMapping": ""}]]}})
        warnings.append(f"GATING CHECKBOX: added {name} before {g['name']} (\"{sentence}\"); a rule must show {g['name']} only when it is checked")
        return {"name": name, "type": "array", "title": subject, "items": {"type": "string", "enum": ["different"]}}

    def make_bold_label(html_text):
        name = gen_name("gen_label")
        h = bold_first_paragraph(html_text)
        add_ui(name, {"ui:widget": "Paragraph", "ui:formattedText": h, "ui:marginBottom": "12px"})
        return {"name": name, "type": "null", "title": plain(h)[:120]}

    def make_well(text_html, kind="Info"):
        name = gen_name("gen_well")
        add_ui(name, {"ui:widget": "Paragraph", "ui:formattedText": text_html, "ui:wellType": kind, "ui:marginBottom": "12px"})
        return {"name": name, "type": "null", "title": plain(text_html)[:120]}

    def make_signature(o):
        name = o["name"]
        # Only what the annotation says: this field is a signature field. Signer name, role and the types of any
        # other fields signed with it are not in the annotation, so they are left unset and flagged.
        add_ui(name, {"ui:widget": "Signature", "ui:formattedText": "Signature", "ui:marginBottom": "12px",
                      "ui:pdfMapping": [], "ui:signature": [{"mapping": name, "signatureType": "Signature", "isOptional": False}]})
        warnings.append(f"SIGNATURE: {name} has no signer name; the types of any other fields signed with it (Date, Name, Title...) are not in the annotation, so only the signature field is mapped")
        return {"name": name, "type": "null", "title": "Signature"}

    def option_html(r):
        h = label_html(r)
        if h is None:
            warnings.append(f"LABEL MISSING: option {r['name']} has no highlighted text (formattedText left empty)")
            return ""
        return fix_markers(r["name"], h)

    # radio groups are built after we know which children hang below which option, so just collect for now
    radios = {}  # group name -> (group obj, [radio objs sorted])

    def make_radio(g, below_by_option):
        name = g["name"]
        rs = sorted(real_children(g), key=own_pos)
        h = label_html(g)
        if h is None:
            warnings.append(f"LABEL MISSING: radio group {name} has no highlighted text (formattedText left empty)")
            h = ""
        options = []
        for r in rs:
            meta = {"formattedText": option_html(r), "pdfMappings": [r["name"]], "blueprintMetadataMapping": ""}
            if below_by_option.get(r["name"]):
                meta["fieldsBelow"] = below_by_option[r["name"]]
            options.append([r["name"], meta])
        ui = {"ui:widget": "Radio", "ui:formattedText": h, "ui:pdfMapping": [name], "ui:enabledComment": True,
              "ui:marginBottom": "12px", "ui:clearable": False, "ui:multipleOption": {"options": options}}
        add_ui(name, ui)
        return {"name": name, "type": "string", "title": plain(h)[:120] or name, "enum": [r["name"] for r in rs]}

    def make_repeatable(o):
        name = o["name"]
        kids = sorted([c for c in real_children(o)], key=own_pos)
        def kind_of(c):
            n = c["name"]
            return "country" if n.startswith(("countryoftaxresidence", "asa_jurisdiction")) else "tin" if n.startswith(("tin", "asa_taxnumber")) else "reason"
        by_kind = defaultdict(list)
        for c in kids:
            by_kind[kind_of(c)].append(c)
        children = []
        for k in ("country", "tin", "reason"):
            pair = sorted(by_kind[k], key=own_pos)  # row 1 first (higher on the page)
            first = pair[0]
            h = field_label_html(first)
            w, typ, extra = text_widget(first)
            ui = {"ui:widget": w, "ui:formattedText": h, "ui:pdfMapping": [p["name"] for p in pair], "ui:enabledComment": True, "ui:marginBottom": "12px"}
            if is_required(first):
                ui["ui:required"] = REQUIRED_MSG
            if w == "Country":
                ui["ui:placeholder"] = "Select country"
            add_ui(first["name"], ui)
            children.append({"name": first["name"], "type": typ, "title": plain(h)[:120], **extra})
        rep_label = label_html(o)
        if rep_label is None:
            warnings.append(f"LABEL MISSING: repeatable {name} has no highlighted text (formattedText left empty)")
            rep_label = ""
        add_ui(name, {"ui:widget": "Repeatable", "ui:formattedText": rep_label,
                      "ui:maxItems": o.get("maxLength", 1), "ui:itemName": "tax residence", "ui:enabledComment": True, "ui:marginBottom": "12px"})
        return {"name": name, "type": "array", "title": plain(rep_label)[:120] or name, "properties": children}

    # ------------------------------ container building ------------------------------
    def build_children(container, depth):
        """Return the ordered node list for a container, wiring fields below options by geometry."""
        kids = sorted(real_children(container), key=atom_pos)
        # options of every radio group in this container, in reading order: (pos, option name, group name)
        options = []
        for k in kids:
            if k["__typename__"] == "PdfRadioGroupFieldDTO":
                for r in real_children(k):
                    options.append((own_pos(r), r["name"], k["name"]))
        options.sort()

        def parent_option(k):
            """Nearest preceding option from ANOTHER radio group that this atom sits clearly to the right of."""
            p = atom_pos(k)
            best = None
            for opos, oname, gname in options:
                if gname == k.get("name"):
                    continue
                if (opos[0], opos[1], opos[2]) <= (p[0], p[1], p[2]) and p[2] - opos[2] > 0.015:
                    best = oname
            return best

        below_by_option = defaultdict(list)
        parent_of = {}
        for k in kids:
            if k["__typename__"] in ("PdfTextFieldDTO", "PdfRadioGroupFieldDTO", "PdfParagraphFieldDTO", "PdfRepeatableFieldDTO"):
                po = parent_option(k)
                if po:
                    parent_of[k["name"]] = po

        built = []
        prev_heading = ""  # heading of the previous group, for gating sentences
        handled = set()
        for k in kids:
            t = k["__typename__"]
            name = k["name"]
            if name in handled:
                continue
            if t == "PdfGroupFieldDTO":
                if name in gated:
                    built.append(make_gate(k, prev_heading))
                built.extend(build_group(k, depth))
                first_p = re.search(r"<p>(.*?)</p>", label_html(k) or "")
                prev_heading = plain(first_p.group(1)).lower() if first_p else prev_heading
                continue
            if t == "PdfParagraphFieldDTO":
                if name == "paragraph":  # the form title
                    meta["title"] = plain(para_html(k))  # the page heading; the TOC name must match it
                    built.append(make_header(meta["title"], "Heading1"))
                    add_ui_skip(k)
                    continue
                node = make_paragraph(k)
            elif t == "PdfTextFieldDTO":
                node = make_text(k)
            elif t == "PdfRadioGroupFieldDTO":
                node = None  # built below once below_by_option is complete
            elif t == "PdfRepeatableFieldDTO":
                node = make_repeatable(k)
            elif t == "PdfSignatureFieldDTO":
                node = make_signature(k)
            else:
                raise SystemExit(f"unhandled {t} {name}")
            if node is not None:
                built.append((k, node))
            else:
                built.append((k, None))

        # second pass: radios, then attach below-lists
        final = []
        for item in built:
            if isinstance(item, dict):
                final.append(item)
                continue
            k, node = item
            if k["__typename__"] == "PdfRadioGroupFieldDTO":
                node = make_radio(k, below_by_option)  # temporarily empty; filled after below_by_option complete
            final.append((k, node))
        # fill below_by_option now (needs final order)
        for k, node in [x for x in final if isinstance(x, tuple)]:
            po = parent_of.get(k["name"])
            if po:
                below_by_option[po].append(k["name"])
        # rebuild radios now that below lists are complete
        out = []
        for item in final:
            if isinstance(item, dict):
                out.append(item)
                continue
            k, node = item
            if k["__typename__"] == "PdfRadioGroupFieldDTO":
                del nodes_ui[k["name"]]
                node = make_radio(k, below_by_option)
            if node is not None:
                out.append(node)
        return out

    skipped = set()

    def add_ui_skip(o):
        skipped.add(o["name"])

    def split_address(children):
        """Address block rule: country first, then a US field and a non-US field for state and for postal code.
        Both variants map to the same PDF field; rules choose which one shows."""
        by = {}
        for n in children:
            nm = n["name"]
            text = plain(nodes_ui[nm].get("ui:formattedText", "")).rstrip(" *").strip().lower()
            if nodes_ui[nm]["ui:widget"] == "Country" and text == "country": by["country"] = n
            elif re.match(r"address\b", text): by["street"] = n
            elif re.match(r"city\b", text): by["city"] = n
            elif re.match(r"state\b|province\b", text): by["state"] = n
            elif re.match(r"postal\s*code|post\s*code|zip", text): by["post"] = n
        if not all(k in by for k in ("country", "street", "city", "state", "post")):
            return children
        req = "ui:required" in nodes_ui[by["street"]["name"]]
        def us_variant(src, widget, label, extra):
            nm = src["name"] + "_us"
            h = f"<p>{label}</p>"
            ui = {"ui:widget": widget, "ui:formattedText": with_star(h) if req else h, "ui:pdfMapping": list(nodes_ui[src["name"]]["ui:pdfMapping"]),
                  "ui:enabledComment": True, "ui:marginBottom": "12px", **extra}
            if req: ui["ui:required"] = REQUIRED_MSG
            add_ui(nm, ui)
            return {"name": nm, "type": "string", "title": label}
        st = us_variant(by["state"], "State", "U.S. States/Territories", {})
        zp = us_variant(by["post"], "CustomFormat", "ZIP Code", {"ui:customFormat": "USZIP"})
        used = {id(by[k]) for k in by}
        rest = [n for n in children if id(n) not in used]
        return [by["country"], by["street"], by["city"], st, by["state"], zp, by["post"]] + rest

    def build_group(g, depth):
        name = g["name"]
        children = split_address(build_children(g, depth + 1))
        lab = label_html(g)
        ui = {"ui:widget": "Group", "ui:marginBottom": "20px" if depth == 1 else "12px", "ui:enabledComment": True}
        if lab:  # a group's heading is its own formattedText, not a Header widget
            ui["ui:formattedText"] = bold_first_paragraph(lab)
        add_ui(name, ui)
        title = plain(lab)[:120] if lab else name
        node = {"name": name, "type": "object", "title": title or name, "properties": children}
        return [node]

    # ------------------------------ top level ------------------------------
    page = next(o for o in objs.values() if o["__typename__"] == "PdfPageFieldDTO")
    mark_optional_groups(page)
    # sections = groups under the page (depth 1)

    def build_page(p):
        kids = sorted(real_children(p), key=atom_pos)
        # reuse build_children with depth 1 semantics for the page's own children
        page_nodes = build_children(p, 1)
        ptitle = meta["title"] or plain(label_html(p) or p["name"])  # the TOC name matches the page heading
        add_ui(p["name"], {"ui:widget": "Page", "ui:marginBottom": "12px", "ui:pdfMapping": [], "ui:signature": []})
        return {"name": p["name"], "type": "object", "title": ptitle, "properties": page_nodes}

    page_node = build_page(page)

    # top-level File node (the PDF template), as in real exports
    add_ui("file0", {"ui:widget": "File", "ui:fileName": data["fileName"]})
    file_node = {"name": "file0", "type": "null", "title": data["fileName"]}

    schema = {"type": "object", "properties": [file_node, page_node]}
    out = {
        "namespaceFormSchemaMap": {"main": {"schema": schema, "uiSchema": nodes_ui}},
        "rules": [], "defaultNamespace": "main", "libs": [], "triggerRuleByProperty": False,
        "gaiaLogicVersion": 200, "cueFieldSchemas": [],
    }
    json.dump(out, open(out_path, "w"), indent=2, ensure_ascii=False)

    # ------------------------------ self-check ------------------------------
    all_nodes = {}
    def collect(ns):
        for n in ns:
            assert n["name"] not in all_nodes, n["name"]
            all_nodes[n["name"]] = n
            collect(n.get("properties", []))
    collect(schema["properties"])
    assert set(all_nodes) == set(nodes_ui), set(all_nodes) ^ set(nodes_ui)
    ann_fields = {o["name"] for o in objs.values() if o["__typename__"] in ("PdfTextFieldDTO", "PdfRadioFieldDTO", "PdfSignatureFieldDTO")}
    mapped = set()
    for v in nodes_ui.values():
        mapped.update(v.get("ui:pdfMapping") or [])
        for o in v.get("ui:multipleOption", {}).get("options", []):
            mapped.update(o[1].get("pdfMappings", []))
        for s in v.get("ui:signature", []) or []:
            mapped.add(s["mapping"])
    missing = ann_fields - mapped
    unknown = mapped - ann_fields - {o["name"] for o in objs.values() if o["__typename__"] == "PdfRadioGroupFieldDTO"}
    below = [c for v in nodes_ui.values() for o in v.get("ui:multipleOption", {}).get("options", []) for c in o[1].get("fieldsBelow", [])]
    assert len(below) == len(set(below)), "a field below belongs to two options"
    assert all(b in all_nodes for b in below)
    warnings[:] = list(dict.fromkeys(warnings))  # radios are built twice; report each once
    print(f"{len(warnings)} warnings:")
    for w_ in warnings:
        print("  -", w_)
    open(out_path.replace(".json", ".warnings.txt"), "w").write("\n".join(warnings) + "\n")
    print(f"nodes={len(all_nodes)} fields-below={len(below)} annotated fields={len(ann_fields)} unmapped annotated fields={sorted(missing)} unknown mappings={sorted(unknown)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
