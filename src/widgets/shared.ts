import type { ReactNode } from 'react';
import { escapeHtml } from '../model/html';
import type { Option, SchemaNode, UiEntry } from '../model/types';

/** Which row of which Repeatable a field instance belongs to. */
export interface RowScope {
  rep: string;
  index: number;
}

export interface WidgetProps {
  id: string;
  widget: string;
  node: SchemaNode;
  ui: UiEntry;
  value: unknown;
  onChange: (v: unknown) => void;
  options: Option[];
  /** True for nodes directly under the form root (e.g. the demo's PDF-template File node). */
  topLevel?: boolean;
  children?: ReactNode;
  /** Renders this node's children for a given row (Repeatable) or the current scope. */
  renderChildren?: (scope?: RowScope) => ReactNode;
  /** Renders the fields shown below an option (Radio / MultipleCheckbox); null when it has none. */
  renderBelow?: (option: Option) => ReactNode;
}

/** CSS modifier for a radio/checkbox group's layout. Options that carry fields below read best stacked. */
export function layoutClass(ui: UiEntry, hasBelow: boolean): string {
  if (hasBelow) return '';
  const l = ui['ui:fixedLayout'];
  return l === 'Inline' ? ' w-radio--inline' : l === 'TwoColumns' ? ' w-radio--cols2' : l === 'ThreeColumns' ? ' w-radio--cols3' : '';
}

export const toText = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** An option's rich label, or its plain label as a paragraph. */
export const optionHtml = (o: Option): string => o.html ?? `<p>${escapeHtml(o.label)}</p>`;
export const uiString = (v: unknown): string => (typeof v === 'string' ? v : '');
