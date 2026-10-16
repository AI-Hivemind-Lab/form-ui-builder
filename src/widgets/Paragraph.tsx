import { EditableHtml } from '../components/EditableHtml';
import type { WidgetProps } from './shared';

export function Paragraph({ node, ui }: WidgetProps) {
  // An empty text stays empty (the editor flags it); only a missing text falls back to the title.
  const html = typeof ui['ui:formattedText'] === 'string' ? ui['ui:formattedText'] : node.title;
  // Info is a light blue well, Warning an orange one, Default (or none) has no background.
  const well = ui['ui:wellType'] === 'Info' ? ' w-paragraph--info' : ui['ui:wellType'] === 'Warning' ? ' w-paragraph--warning' : '';
  return <EditableHtml name={node.name} className={`w-paragraph${well}`} html={html} />;
}
