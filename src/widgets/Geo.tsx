import { COUNTRIES, US_STATES } from '../model/countries';
import { Dropdown } from './Choice';
import type { WidgetProps } from './shared';

export const Country = (p: WidgetProps) => <Dropdown {...p} options={COUNTRIES} />;
export const State = (p: WidgetProps) => <Dropdown {...p} options={US_STATES} />;
