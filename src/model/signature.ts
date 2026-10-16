import type { UiEntry } from './types';

export const SIGNER_ROLES = [
  { value: 'LpSignature', label: 'LP Signature' },
  { value: 'GpSignature', label: 'GP Signature' },
] as const;
export const DEFAULT_ROLE = 'LpSignature';

export const MAPPING_TYPES = ['Signature', 'Date', 'Name', 'Title', 'Custom'] as const;
export type MappingType = (typeof MAPPING_TYPES)[number];
export const DEFAULT_DATE_FORMAT = 'MM/dd/yyyy';

/** One PDF annotation the signer fills during the signature process (after the digital form is done). */
export interface SignatureMapping {
  mapping: string;
  signatureType: MappingType | string;
  isOptional: boolean;
  format?: string;
  /** Anything else a real export carries (customTypeConfig, tooltip); kept as-is on edit. */
  [extra: string]: unknown;
}

export function getSignatureMappings(ui: UiEntry): SignatureMapping[] {
  const raw = ui['ui:signature'];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x))
    .map((x) => ({
      ...x,
      mapping: typeof x.mapping === 'string' ? x.mapping : '',
      signatureType: typeof x.signatureType === 'string' ? x.signatureType : 'Signature',
      isOptional: x.isOptional === true,
    }));
}

export const roleOf = (ui: UiEntry): string => (ui['ui:signatureType'] === 'GpSignature' ? 'GpSignature' : DEFAULT_ROLE);
export const roleLabel = (role: string): string => SIGNER_ROLES.find((r) => r.value === role)?.label ?? role;

/** "LP Signature - Individual Signatory" */
export function signatureTitle(ui: UiEntry): string {
  const signer = typeof ui['ui:signatureSigner'] === 'string' ? ui['ui:signatureSigner'].trim() : '';
  const role = roleLabel(roleOf(ui));
  return signer ? `${role} - ${signer}` : role;
}

/** The right-hand caption of a mapping row: "Date (mm/dd/yyyy)", "Signature", the custom description… */
export function mappingCaption(m: SignatureMapping): string {
  if (m.signatureType === 'Date') return m.format ? `Date (${m.format.toLowerCase()})` : 'Date';
  if (m.signatureType === 'Custom') {
    const d = (m.customTypeConfig as { description?: unknown } | undefined)?.description;
    return typeof d === 'string' && d ? d : 'Custom';
  }
  return m.signatureType;
}

/** Changing a row's type: a Date gets a default format, any other type drops the format. */
export function withMappingType(m: SignatureMapping, type: string): SignatureMapping {
  const next: SignatureMapping = { ...m, signatureType: type };
  if (type === 'Date') next.format = m.format ?? DEFAULT_DATE_FORMAT;
  else delete next.format;
  return next;
}

export const newMapping = (): SignatureMapping => ({ mapping: '', signatureType: 'Signature', isOptional: false });
