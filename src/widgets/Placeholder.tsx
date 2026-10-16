import { uiString, type WidgetProps } from './shared';

function Box({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="w-placeholder">
      <strong>{title}</strong>
      <span>Not in prototype</span>
      {detail ? <em>{detail}</em> : null}
    </div>
  );
}

/** A top-level File node is the demo's PDF template: it renders nothing. A nested one is a placeholder. */
export function FileWidget({ node, ui, topLevel }: WidgetProps) {
  return topLevel ? null : <Box title={node.title || 'File'} detail={uiString(ui['ui:fileName'])} />;
}
