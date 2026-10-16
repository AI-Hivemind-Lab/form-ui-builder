import type { SchemaNode, UiEntry } from '../model/types';
import { HtmlBox } from './HtmlBox';

interface Group {
  description: string;
  helpText: string;
  files: Record<string, { description: string; helpText: string; blueprintMetadataMapping: string }>;
}

function groupOf(ui: UiEntry): Group {
  const raw = ui['ui:supportingFileGroup'] as { description?: unknown; helpText?: unknown; files?: Record<string, { description?: unknown; helpText?: unknown; blueprintMetadataMapping?: unknown }> } | undefined;
  return {
    description: typeof raw?.description === 'string' ? raw.description : '',
    helpText: typeof raw?.helpText === 'string' ? raw.helpText : '',
    files: Object.fromEntries(Object.entries(raw?.files ?? {}).map(([k, f]) => [k, {
      description: typeof f?.description === 'string' ? f.description : '',
      helpText: typeof f?.helpText === 'string' ? f.helpText : '',
      blueprintMetadataMapping: typeof f?.blueprintMetadataMapping === 'string' ? f.blueprintMetadataMapping : '',
    }])),
  };
}

const nextKey = (keys: string[]): string => {
  for (let i = keys.length + 1; ; i += 1) if (!keys.includes(`file${i}`)) return `file${i}`;
};

/**
 * Supporting documents, as in Form Builder: the group's name and help text, then every file item with its own name and help text.
 * The file items are also the values of the widget (its schema's items), so both are written together.
 */
export function FileGroupEditor({ node, ui, onChange }: { node: SchemaNode; ui: UiEntry; onChange: (next: { node: SchemaNode; ui: UiEntry }) => void }) {
  const group = groupOf(ui);
  const keys = Object.keys(group.files);

  const write = (next: Group) => {
    const nextKeys = Object.keys(next.files);
    onChange({
      node: { ...node, title: next.description || node.title, items: { ...(node.items ?? { type: 'string' }), enum: nextKeys } },
      ui: { ...ui, 'ui:supportingFileGroup': next },
    });
  };
  const setFile = (key: string, patch: Partial<Group['files'][string]>) => write({ ...group, files: { ...group.files, [key]: { ...group.files[key], ...patch } } });
  const add = () => write({ ...group, files: { ...group.files, [nextKey(keys)]: { description: '', helpText: '', blueprintMetadataMapping: '' } } });
  const remove = (key: string) => write({ ...group, files: Object.fromEntries(Object.entries(group.files).filter(([k]) => k !== key)) });
  const move = (key: string, by: -1 | 1) => {
    const at = keys.indexOf(key);
    const to = at + by;
    if (to < 0 || to >= keys.length) return;
    const order = [...keys];
    [order[at], order[to]] = [order[to], order[at]];
    write({ ...group, files: Object.fromEntries(order.map((k) => [k, group.files[k]])) });
  };

  return (
    <div className="fgedit">
      <label className="fgedit__label" htmlFor="fg-name">Group name</label>
      <p className="fgedit__hint">Leave empty for the default group</p>
      <input id="fg-name" className="w-input" value={group.description} placeholder="For Natural Person" onChange={(e) => write({ ...group, description: e.target.value })} />

      <div className="fgedit__label fgedit__label--gap">Help text</div>
      <HtmlBox label="Group help text" value={group.helpText} onChange={(html) => write({ ...group, helpText: html })} />

      <div className="fgedit__files-head">
        <span className="fgedit__label">Files <em>{keys.length}</em></span>
        <button type="button" className="btn fgedit__add" onClick={add}>+ Add file</button>
      </div>
      {keys.length === 0 && <p className="fgedit__hint">No files yet. Each file is a document the investor uploads.</p>}
      <ol className="fgedit__files">
        {keys.map((key, i) => (
          <li key={key} className="fgedit__file">
            <div className="fgedit__file-top">
              <span className="fgedit__key">{key}</span>
              <span className="fgedit__tools">
                <button type="button" aria-label={`Move ${key} up`} disabled={i === 0} onClick={() => move(key, -1)}>↑</button>
                <button type="button" aria-label={`Move ${key} down`} disabled={i === keys.length - 1} onClick={() => move(key, 1)}>↓</button>
                <button type="button" aria-label={`Remove ${key}`} onClick={() => remove(key)}>✕</button>
              </span>
            </div>
            <input className="w-input" aria-label={`Name of ${key}`} placeholder="Name of the document" value={group.files[key].description} onChange={(e) => setFile(key, { description: e.target.value })} />
            <div className="fgedit__sub">Help text</div>
            <HtmlBox label={`Help text of ${key}`} value={group.files[key].helpText} onChange={(html) => setFile(key, { helpText: html })} />
          </li>
        ))}
      </ol>
    </div>
  );
}
