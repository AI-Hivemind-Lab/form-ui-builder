/** Accepts "1,000", "$1,234.50", "12.5%", "-5", ".5"; rejects "", "abc", "1e5", "5.". */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[$,%\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const formatMoney = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const formatPercent = (n: number): string => `${n}%`;

/** MM-DD-YYYY, MM/DD/YYYY or YYYY-MM-DD -> ISO YYYY-MM-DD; null if not a real calendar date. */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  let y: number;
  let m: number;
  let d: number;
  const us = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
  if (us) {
    m = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
  } else {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!iso) return null;
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function formatDateDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}-${m[3]}-${m[1]}` : iso;
}

/** Whole numbers; commas/spaces tolerated: "1,000" -> 1000. */
export function parseInteger(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  return /^-?\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** Exactly four digits. */
export function parseYear(text: string): number | null {
  const t = text.trim();
  return /^\d{4}$/.test(t) ? Number(t) : null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseEmail(text: string): string | null {
  const t = text.trim();
  return EMAIL_RE.test(t) ? t : null;
}

/** Digits plus " + ( ) . -", with 7 to 15 digits in total. */
export function parsePhone(text: string): string | null {
  const t = text.trim();
  if (!/^[0-9 +().-]+$/.test(t)) return null;
  const digits = t.replace(/\D/g, '').length;
  return digits >= 7 && digits <= 15 ? t : null;
}

/** Built-in formats a field can name in `ui:customFormat` instead of giving a pattern. */
export const BUILT_IN_FORMATS: Record<string, { pattern: string; error: string }> = {
  SSN: { pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', error: 'Enter a Social Security Number as 123-45-6789' },
  EIN: { pattern: '^\\d{2}-?\\d{7}$', error: 'Enter an Employer Identification Number as 12-3456789' },
  // An ITIN starts with 9 and its fourth and fifth digits are 50-65, 70-88, 90-92 or 94-99.
  ITIN: { pattern: '^9\\d{2}-?(5\\d|6[0-5]|7\\d|8[0-8]|9[0-2]|9[4-9])-?\\d{4}$', error: 'Enter an Individual Taxpayer Identification Number as 9XX-XX-XXXX' },
  USZIP: { pattern: '^\\d{5}(-\\d{4})?$', error: 'Enter a ZIP code as 12345 or 12345-6789' },
  GIIN: { pattern: '^[A-Za-z0-9]{6}\\.[A-Za-z0-9]{5}\\.[A-Za-z]{2}\\.\\d{3}$', error: 'Enter a GIIN as XXXXXX.XXXXX.XX.XXX' },
  ABA: { pattern: '^\\d{9}$', error: 'Enter the 9 digits of the ABA routing number' },
  SWIFT: { pattern: '^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$', error: 'Enter a SWIFT/BIC code of 8 or 11 characters, such as AAAABBCC123' },
  IBAN: { pattern: '^[A-Za-z]{2}\\d{2}(?: ?[A-Za-z0-9]){11,30}$', error: 'Enter a valid IBAN, such as DE89 3704 0044 0532 0130 00' },
};

/** The formats Anduin offers: the value of a CustomFormat field's schema `format` (and its `ui:customFormat`). */
export const CUSTOM_FORMAT_NAMES = Object.keys(BUILT_IN_FORMATS);

/** The pattern a CustomFormat field checks: its own `ui:pattern`, else the format its schema `format` names (or `ui:customFormat`). */
export function formatPatternOf(ui: Record<string, unknown>, format?: string): { pattern: unknown; error: string } {
  const name = typeof format === 'string' && BUILT_IN_FORMATS[format] ? format : typeof ui['ui:customFormat'] === 'string' ? ui['ui:customFormat'] : undefined;
  const named = name ? BUILT_IN_FORMATS[name] : undefined;
  const pattern = typeof ui['ui:pattern'] === 'string' && ui['ui:pattern'] !== '' ? ui['ui:pattern'] : named?.pattern;
  const error = typeof ui['ui:validationError'] === 'string' && ui['ui:validationError'] !== '' ? ui['ui:validationError'] : (named?.error ?? 'Does not match the required format, so it was not saved');
  return { pattern, error };
}

/** Parser for CustomFormat: text must match `pattern`. A missing or invalid pattern accepts any text. */
export function patternParser(pattern: unknown): (text: string) => string | null {
  let re: RegExp | null = null;
  if (typeof pattern === 'string' && pattern !== '') {
    try {
      re = new RegExp(pattern);
    } catch {
      re = null;
    }
  }
  return (text) => {
    const t = text.trim();
    return re === null || re.test(t) ? t : null;
  };
}

/** Only http(s), mailto and in-page (#) links are allowed. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const t = href.trim();
  return /^(https?:\/\/|mailto:|#)/i.test(t) ? t : null;
}

export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
