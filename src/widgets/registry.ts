import type { ComponentType } from 'react';
import { Dropdown, Radio } from './Choice';
import { Group, Page } from './Containers';
import { DateWidget } from './DateWidget';
import { Country, State } from './Geo';
import { Header } from './Header';
import { Unknown } from './Misc';
import { MultipleCheckbox, MultipleSuggest } from './MultiChoice';
import { Float, Integer, Money, Percentage, Year } from './NumberInputs';
import { Paragraph } from './Paragraph';
import { FileWidget } from './Placeholder';
import { Pdf } from './Pdf';
import { FileGroup } from './FileGroup';
import { Signature } from './SignatureWidget';
import { Repeatable } from './Repeatable';
import type { WidgetProps } from './shared';
import { AnchorLink } from './Static';
import { CustomFormat, Email, Phone } from './TextValidated';
import { TextArea, TextBox } from './TextInputs';

export interface WidgetDef {
  Component: ComponentType<WidgetProps>;
  hasLabel: boolean;
}

const WIDGETS: Record<string, WidgetDef> = {
  Page: { Component: Page, hasLabel: false },
  Group: { Component: Group, hasLabel: false },
  Repeatable: { Component: Repeatable, hasLabel: true },
  Header: { Component: Header, hasLabel: false },
  Paragraph: { Component: Paragraph, hasLabel: false },
  AnchorLink: { Component: AnchorLink, hasLabel: false },
  TextBox: { Component: TextBox, hasLabel: true },
  TextArea: { Component: TextArea, hasLabel: true },
  Integer: { Component: Integer, hasLabel: true },
  Float: { Component: Float, hasLabel: true },
  Year: { Component: Year, hasLabel: true },
  Money: { Component: Money, hasLabel: true },
  Percentage: { Component: Percentage, hasLabel: true },
  Email: { Component: Email, hasLabel: true },
  Phone: { Component: Phone, hasLabel: true },
  CustomFormat: { Component: CustomFormat, hasLabel: true },
  Date: { Component: DateWidget, hasLabel: true },
  Radio: { Component: Radio, hasLabel: true },
  Dropdown: { Component: Dropdown, hasLabel: true },
  MultipleCheckbox: { Component: MultipleCheckbox, hasLabel: true },
  MultipleSuggest: { Component: MultipleSuggest, hasLabel: true },
  Country: { Component: Country, hasLabel: true },
  State: { Component: State, hasLabel: true },
  Signature: { Component: Signature, hasLabel: false },
  Pdf: { Component: Pdf, hasLabel: true },
  FileGroup: { Component: FileGroup, hasLabel: true },
  File: { Component: FileWidget, hasLabel: false },
};

const UNKNOWN: WidgetDef = { Component: Unknown, hasLabel: true };

export function resolveWidget(name: string): WidgetDef {
  return Object.prototype.hasOwnProperty.call(WIDGETS, name) ? WIDGETS[name] : UNKNOWN;
}

export { Unknown };
