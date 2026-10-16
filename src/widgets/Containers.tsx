import type { CSSProperties } from 'react';
import type { WidgetProps } from './shared';

export function Page({ children }: WidgetProps) {
  return <>{children}</>;
}

/** `ui:dynamicLayout` {sectionsWidth: [50, 50], gutter: 12}: children side by side, one per section, wrapping to a new row. */
export function dynamicGrid(layout: unknown): CSSProperties | undefined {
  const l = layout as { sectionsWidth?: unknown; gutter?: unknown } | null | undefined;
  const widths = Array.isArray(l?.sectionsWidth) ? l.sectionsWidth.filter((w): w is number => typeof w === 'number' && w > 0) : [];
  if (widths.length < 2) return undefined;
  return { display: 'grid', gridTemplateColumns: widths.map((w) => `minmax(0, ${w}fr)`).join(' '), columnGap: typeof l?.gutter === 'number' ? l.gutter : 8, alignItems: 'start' };
}

export function Group({ ui, children }: WidgetProps) {
  return <div className="w-group" style={dynamicGrid(ui['ui:dynamicLayout'])}>{children}</div>;
}
