import { labelText } from '../model/editOps';
import { safeHref } from '../model/format';
import type { WidgetProps } from './shared';

/** A link from `ui:href` (http, https, mailto or #); anything else renders as plain text. */
export function AnchorLink({ node, ui }: WidgetProps) {
  const href = safeHref(ui['ui:href']);
  const text = labelText(ui, node.title) || href || node.title;
  return href ? (
    <a className="w-link" href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  ) : (
    <span className="w-link w-link--inert">{text}</span>
  );
}
