import { sanitizeHtml } from '../components/sanitize';
import { filesOf } from '../generator/standards/fileGroup';
import type { WidgetProps } from './shared';

/** The supporting documents an investor uploads: the group name, then one item per document with its help text. */
export function FileGroup({ ui }: WidgetProps) {
  const { group, files } = filesOf(ui);
  return (
    <div className="w-filegroup">
      <div className="w-filegroup__kind">FileGroup</div>
      <div className="w-filegroup__name">{group || 'Supporting documents'}</div>
      {files.length === 0 ? <div className="w-filegroup__empty">No files yet</div> : (
        <ul className="w-filegroup__files">
          {files.map((f) => (
            <li key={f.key} className="w-filegroup__file">
              <div className="w-filegroup__desc">{f.description || <em>Unnamed file</em>}</div>
              {f.helpText ? (
                <>
                  <div className="w-filegroup__help-label">Help text</div>
                  <div className="w-filegroup__help" dangerouslySetInnerHTML={{ __html: sanitizeHtml(f.helpText) }} />
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
