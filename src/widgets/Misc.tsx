import type { WidgetProps } from './shared';

export function Unknown({ widget }: WidgetProps) {
  return <div className="w-unknown">Unsupported widget: {widget || '(none)'}</div>;
}
