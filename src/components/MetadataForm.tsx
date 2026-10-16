import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { switchWidget } from '../model/addField';
import {
  getOptions, labelText, nextOptionValue, normalizeCustomKey, parseCustomValue, parseJsonText, setInvisible, setLabel,
  setOptions, setRequired, setUiKey,
} from '../model/editOps';
import { CUSTOM_FORMAT_NAMES } from '../model/format';
import { customEntries, KNOWN_KEYS, metadataFor, WIDTH_PRESETS, type MetaDef } from '../model/metadata';
import { cutOf, sourceFileName, withCut, type PdfCut } from '../model/pdfCut';
import { candidatesForBelow, withFieldBelow, withoutFieldBelow } from '../model/fieldsBelow';
import { findNode, widgetOf } from '../model/schemaWalk';
import { getSignatureMappings, MAPPING_TYPES, newMapping, withMappingType, type SignatureMapping } from '../model/signature';
import type { FormDoc, SchemaNode, UiEntry, UiSchema } from '../model/types';
import { entryInvisible, entryRequired } from '../model/uiEntry';
import { getWidgetDef, switchGroup } from '../model/widgetCatalog';
import { FileGroupEditor } from './FileGroupEditor';
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

/** Structured editor for ui:signature: the PDF annotations a signer fills after the digital form. */
function SignatureMappingEditor({ rows, onChange }: { rows: SignatureMapping[]; onChange: (next: SignatureMapping[]) => void }) {
  const patch = (i: number, p: Partial<SignatureMapping>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="meta-sig">
      {rows.map((r, i) => (
        <div className="meta-sig__row" key={i}>
          <input className="w-input" aria-label={`Mapped PDF field ${i + 1}`} placeholder="PDF field alias" value={r.mapping} onChange={(e) => patch(i, { mapping: e.target.value })} />
          <select className="w-input w-select" aria-label={`Field type ${i + 1}`} value={r.signatureType} onChange={(e) => onChange(rows.map((x, j) => (j === i ? withMappingType(x, e.target.value) : x)))}>
            {(MAPPING_TYPES as readonly string[]).includes(r.signatureType) ? null : <option value={r.signatureType}>{r.signatureType}</option>}
            {MAPPING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {r.signatureType === 'Date' ? (
            <input className="w-input" aria-label={`Date format ${i + 1}`} placeholder="MM/dd/yyyy" value={r.format ?? ''} onChange={(e) => patch(i, { format: e.target.value })} />
          ) : null}
          <label className="meta-sig__opt">
            <input type="checkbox" aria-label={`Optional ${i + 1}`} checked={r.isOptional} onChange={(e) => patch(i, { isOptional: e.target.checked })} /> Optional
          </label>
          <button type="button" className="btn" aria-label={`Remove mapped field ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="meta-list__add" aria-label="Add mapped field" onClick={() => onChange([...rows, newMapping()])}>＋</button>
    </div>
  );
}

/** JSON-valued metadata (ui:dynamicLayout etc). Local text, parsed on blur; invalid JSON is flagged and never saved. */
function JsonField({ id, stored, onSet }: { id: string; stored: unknown; onSet: (value: unknown) => void }) {
  const shown = stored === undefined ? '' : JSON.stringify(stored, null, 2);
  const [text, setText] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(shown);
    setInvalid(false);
  }, [shown]);
  const commit = () => {
    if (text === shown) return setInvalid(false);
    const parsed = parseJsonText(text);
    if (!parsed.ok) return setInvalid(true);
    setInvalid(false);
    onSet(parsed.value);
  };
  return (
    <div>
      <textarea id={id} className={`w-input w-textarea w-json${invalid ? ' w-input--invalid' : ''}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} />
      {invalid && <div className="w-error">Not valid JSON, so it was not saved</div>}
    </div>
  );
}

/** One existing custom key. Text is kept locally and parsed on blur so typing "1.05" or "true story" is not rewritten. */
function CustomRow({ k, v, onSet }: { k: string; v: unknown; onSet: (key: string, value: unknown) => void }) {
  const shown = typeof v === 'string' ? v : JSON.stringify(v);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (text !== shown) onSet(k, parseCustomValue(text));
  };
  return (
    <div className="meta-list__item">
      <code>{k}</code>
      <input
        className="w-input"
        aria-label={`Value of ${k}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <button type="button" className="btn" aria-label={`Remove ${k}`} onClick={() => onSet(k, undefined)}>✕</button>
    </div>
  );
}

function CustomKeys({ ui, onSet }: { ui: UiEntry; onSet: (key: string, value: unknown) => void }) {
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const entries = customEntries(ui);
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
      {entries.map(([k, v]) => <CustomRow key={k} k={k} v={v} onSet={onSet} />)}
      <div className="meta-list__item">
        <input className="w-input" placeholder="ui:key" aria-label="Custom key" value={key} onChange={(e) => setKey(e.target.value)} />
        <input className="w-input" placeholder="value (JSON or text)" aria-label="Custom value" value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="button" className="btn" onClick={add}>Add key</button>
      </div>
      {error && <div className="w-error">{error}</div>}
    </div>
  );
}

/** The pages of the source PDF an embedded PDF is cut from. The pages shown in the form follow every change. */
function PageRangeField({ id, cut, source, onSet }: { id: string; cut: PdfCut | null; source: string; onSet: (c: PdfCut) => void }) {
  const [start, setStart] = useState(cut ? String(cut.start) : '');
  const [end, setEnd] = useState(cut ? String(cut.end) : '');
  // follow a change made elsewhere (undo, the AI)
  useEffect(() => {
    setStart(cut ? String(cut.start) : '');
    setEnd(cut ? String(cut.end) : '');
  }, [cut?.start, cut?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (s: string, e: string) => {
    const a = Number(s);
    const b = Number(e);
    if (s.trim() !== '' && e.trim() !== '' && Number.isInteger(a) && Number.isInteger(b) && a >= 1 && b >= 1) onSet({ start: a, end: b });
  };
  return (
    <div className="meta-range">
      <div className="meta-range__source" title={source}>Source: {source || 'the sub-doc PDF'}</div>
      <div className="meta-range__inputs">
        <label>From page <input id={id} className="w-input" inputMode="numeric" value={start} onChange={(e) => { setStart(e.target.value); commit(e.target.value, end); }} /></label>
        <label>to page <input className="w-input" aria-label="Last page" inputMode="numeric" value={end} onChange={(e) => { setEnd(e.target.value); commit(start, e.target.value); }} /></label>
      </div>
    </div>
  );
}

export function MetadataForm({
  value,
  onChange,
  isAllowed = () => true,
  doc,
}: {
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  /** The form being edited; needed to offer fields that can go below an option. */
  doc?: FormDoc;
  /** Lets the host veto an Input type (e.g. a Repeatable inside a Repeatable). The current widget is always listed. */
  isAllowed?: (widgetId: string) => boolean;
}) {
  const { node, ui } = value;
  const name = node.name;
  const widget = widgetOf(node, ui);
  const defs = metadataFor(widget);

  const one = (): UiSchema => ({ [name]: ui });
  const viaOp = (op: (s: UiSchema) => UiSchema) => onChange({ node, ui: op(one())[name] });
  const setKeyValue = (key: string, v: unknown) => viaOp((s) => setUiKey(s, name, key, v));

  const group = (getWidgetDef(widget) ? switchGroup(widget) : [widget, ...switchGroup('TextBox')]).filter((id) => id === widget || isAllowed(id));
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
        if (m.key === 'ui:tooltipForDisabledState') {
          return <textarea id={id} className="w-input w-textarea" rows={4} value={typeof stored === 'string' ? stored : ''} onChange={(e) => setKeyValue(m.key, e.target.value === '' ? undefined : e.target.value)} />;
        }
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
        const current = typeof stored === 'string' ? stored : (m.defaultValue ?? '');
        const known = m.enumValues ?? [];
        // Keep a stored value that is not in our list (exports can carry values we do not know about).
        const choices = known.some((o) => o.value === current) ? known : [...known, { value: current, label: current }];
        return (
          <select id={id} className="w-input w-select" value={current} onChange={(e) => setKeyValue(m.key, e.target.value === '' ? undefined : e.target.value)}>
            {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        );
      }
      case 'format': {
        // The format lives in the data schema (`format`); ui:customFormat repeats it, as Anduin exports do.
        const current = typeof node.format === 'string' ? node.format : typeof stored === 'string' ? stored : '';
        const choices = CUSTOM_FORMAT_NAMES.includes(current) || current === '' ? CUSTOM_FORMAT_NAMES : [...CUSTOM_FORMAT_NAMES, current];
        return (
          <select
            id={id}
            className="w-input w-select"
            value={current}
            onChange={(e) => {
              const next: SchemaNode = { ...node };
              const nextUi: UiEntry = { ...ui };
              if (e.target.value === '') {
                delete next.format;
                delete nextUi['ui:customFormat'];
              } else {
                next.format = e.target.value;
                nextUi['ui:customFormat'] = e.target.value;
              }
              onChange({ node: next, ui: nextUi });
            }}
          >
            <option value="">None</option>
            {choices.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        );
      }
      case 'file-group':
        return <FileGroupEditor node={node} ui={ui} onChange={onChange} />;
      case 'page-range':
        return <PageRangeField id={id} cut={cutOf(ui)} source={doc ? sourceFileName(doc) : ''} onSet={(c) => setKeyValue(m.key, withCut(ui, c))} />;
      case 'json':
        return <JsonField id={id} stored={stored} onSet={(v) => setKeyValue(m.key, v)} />;
      case 'string-list': {
        // On a Signature widget, ui:signature is the structured PDF mapping, not a plain list.
        if (m.key === 'ui:signature' && widget === 'Signature') {
          return <SignatureMappingEditor rows={getSignatureMappings(ui)} onChange={(next) => setKeyValue(m.key, next)} />;
        }
        const items = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : [];
        return <StringList id={m.label} items={items} onChange={(next) => setKeyValue(m.key, next.length === 0 ? undefined : next)} />;
      }
      case 'options': {
        const options = getOptions(ui, node);
        // Fields below options exist for Radio and MultipleCheckbox only.
        const supportsBelow = widget === 'Radio' || widget === 'MultipleCheckbox';
        const candidates = supportsBelow && doc ? candidatesForBelow(doc, name) : [];
        const titleOf = (n: string) => (doc ? (findNode(doc.schema.properties, n)?.title ?? n) : n);
        return (
          <div className="meta-list">
            {options.map((o, i) => (
              <div className="meta-opt" key={o.value}>
                <div className="meta-list__item">
                  <input className="w-input" aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => viaOp((s) => setOptions(s, name, options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))))} />
                  <button type="button" className="btn" aria-label={`Remove option ${i + 1}`} onClick={() => viaOp((s) => setOptions(s, name, options.filter((_, j) => j !== i)))}>✕</button>
                </div>
                {supportsBelow && (
                  <div className="meta-below">
                    <code className="meta-below__value" title="Option value">{o.value}</code>
                    {(o.fieldsBelow ?? []).length > 0 && (
                      <div className="meta-chips">
                        {o.fieldsBelow?.map((c) => (
                          <span className="meta-chip" key={c} title={titleOf(c)}>
                            {c}
                            <button type="button" aria-label={`Remove field below ${c}`} onClick={() => viaOp((s) => setOptions(s, name, withoutFieldBelow(options, o.value, c)))}>×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <select
                      className="w-input w-select meta-below__add"
                      aria-label={`Add field below option ${i + 1}`}
                      value=""
                      onChange={(e) => e.target.value && viaOp((s) => setOptions(s, name, withFieldBelow(options, o.value, e.target.value)))}
                    >
                      <option value="">＋ Add field below…</option>
                      {candidates.map((c) => <option key={c.name} value={c.name}>{c.title} ({c.name})</option>)}
                    </select>
                  </div>
                )}
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

  const labelFor = (m: MetaDef) =>
    m.control === 'html-text' && widget === 'Paragraph' ? 'Text' : m.key === 'ui:signature' && widget === 'Signature' ? 'Signature mapping'
      : m.key === 'ui:tooltipForDisabledState' && widget === 'Page' ? 'Tooltip for disabled page' : m.label;

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
      {widget === 'Page' && (
        <Row label="Page name" htmlFor="meta-page-name">
          <input id="meta-page-name" className="w-input" value={node.title} onChange={(e) => onChange({ node: { ...node, title: e.target.value }, ui })} />
        </Row>
      )}
      {defs.map((m) => (
        <Fragment key={m.key}>
        {m.key === 'ui:pdfMapping' && getWidgetDef(widget)?.kind === 'input' && (
          <Row label="Default value" htmlFor="meta-default-value">
            <input
              id="meta-default-value"
              className="w-input"
              value={node.default === undefined ? '' : String(node.default)}
              onChange={(e) => {
                const t = e.target.value;
                const next: SchemaNode = { ...node };
                if (t === '') delete next.default;
                else next.default = node.type === 'number' && !Number.isNaN(Number(t)) ? Number(t) : t;
                onChange({ node: next, ui });
              }}
            />
          </Row>
        )}
        {m.control === 'file-group' ? (
          <div className="meta-wide"><div className="meta-wide__title">{labelFor(m)}</div>{control(m)}</div>
        ) : (
          <Row key={m.key} label={labelFor(m)} htmlFor={`meta-${m.key.replace(':', '-')}`}>
            {control(m)}
          </Row>
        )}
        </Fragment>
      ))}
      <CustomKeys ui={ui} onSet={setKeyValue} />
    </div>
  );
}
