import { describe, expect, it } from 'vitest';
import {
  asStringArray, formatDateDisplay, formatMoney, formatPercent, parseDateInput, parseEmail, parseInteger, parseNumber,
  parsePhone, parseYear, patternParser, safeHref,
} from './format';

describe('parseNumber (Review Focus 4)', () => {
  it.each([
    ['1000', 1000], ['1,000', 1000], ['$1,234.50', 1234.5], ['12.5%', 12.5], ['-5', -5], ['.5', 0.5], [' 7 ', 7],
  ])('parses %j', (text, n) => expect(parseNumber(text)).toBe(n));
  it.each(['', '   ', 'abc', '1e5', '1.2.3', '--1', '5.'])('rejects %j', (text) => {
    expect(parseNumber(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats money and percent', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatPercent(12.5)).toBe('12.5%');
  });
});

describe('parseDateInput (Review Focus 4)', () => {
  it.each([
    ['01-02-2026', '2026-01-02'], ['1/2/2026', '2026-01-02'], ['2026-01-02', '2026-01-02'], ['02-29-2028', '2028-02-29'],
  ])('parses %j', (text, iso) => expect(parseDateInput(text)).toBe(iso));
  it.each(['', 'abc', '02-30-2026', '13-01-2026', '00-10-2026', '02-29-2027', '1-2-26', '2026-13-01'])(
    'rejects %j',
    (text) => expect(parseDateInput(text)).toBeNull(),
  );
  it('formats ISO for display and passes unknown text through', () => {
    expect(formatDateDisplay('2026-01-02')).toBe('01-02-2026');
    expect(formatDateDisplay('garbage')).toBe('garbage');
  });
});

describe('parseInteger / parseYear', () => {
  it.each([['5', 5], ['-12', -12], ['1,000', 1000], [' 7 ', 7]])('parseInteger %j', (t, n) => expect(parseInteger(t)).toBe(n));
  it.each(['', '1.5', '1e5', 'abc', '--1', '5.'])('parseInteger rejects %j', (t) => expect(parseInteger(t)).toBeNull());
  it.each([['2026', 2026], [' 1999 ', 1999]])('parseYear %j', (t, n) => expect(parseYear(t)).toBe(n));
  it.each(['', '26', '12345', '20x6', '-2026', '2026.0'])('parseYear rejects %j', (t) => expect(parseYear(t)).toBeNull());
});

describe('parseEmail / parsePhone', () => {
  it('accepts normal emails and trims', () => {
    expect(parseEmail(' a@b.co ')).toBe('a@b.co');
    expect(parseEmail('first.last+tag@sub.example.org')).toBe('first.last+tag@sub.example.org');
  });
  it.each(['', 'abc', 'a@b', '@b.co', 'a@.co', 'a b@c.de', 'a@@b.co'])('rejects email %j', (t) => expect(parseEmail(t)).toBeNull());
  it.each([['+1 (415) 555-0100', '+1 (415) 555-0100'], ['415.555.0100', '415.555.0100'], ['1234567', '1234567']])('phone %j', (t, v) => expect(parsePhone(t)).toBe(v));
  it.each(['', 'abc', '12345', '1234567890123456', '555-CALL-NOW', '12;34567'])('rejects phone %j', (t) => expect(parsePhone(t)).toBeNull());
});

describe('patternParser (Review Focus 4: invalid regex)', () => {
  it('accepts text matching the pattern', () => {
    const p = patternParser('^[A-Z]{2}-\\d{3}$');
    expect(p('AB-123')).toBe('AB-123');
    expect(p('ab-123')).toBeNull();
  });
  it('accepts anything when the pattern is missing, empty, or an invalid regex (never throws)', () => {
    for (const pat of [undefined, '', 5, '[']) expect(patternParser(pat)('whatever')).toBe('whatever');
  });
});

describe('safeHref (Review Focus 4: hostile href)', () => {
  it.each(['https://a.com/x', 'http://a.com', 'mailto:a@b.co', '#section', ' HTTPS://A.COM '])('allows %j', (h) => expect(safeHref(h)).not.toBeNull());
  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', 'vbscript:x', '//evil.com', '', 5, null, undefined])('blocks %j', (h) => expect(safeHref(h)).toBeNull());
});

describe('asStringArray (Review Focus 5: stale value types)', () => {
  it('keeps string entries of an array and ignores everything else', () => {
    expect(asStringArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(asStringArray(['a', 1, null, 'c'])).toEqual(['a', 'c']);
    expect(asStringArray('abc')).toEqual([]);
    expect(asStringArray(undefined)).toEqual([]);
    expect(asStringArray({ 0: 'a' })).toEqual([]);
  });
});

import { BUILT_IN_FORMATS, formatPatternOf } from './format';
describe('built-in custom formats', () => {
  const ok = (name: string, text: string) => patternParser(BUILT_IN_FORMATS[name].pattern)(text) !== null;
  it('checks SSN, EIN, ITIN and US ZIP codes', () => {
    expect(ok('SSN', '123-45-6789')).toBe(true);
    expect(ok('SSN', '123456789')).toBe(true);
    expect(ok('SSN', '12-345-6789')).toBe(false);
    expect(ok('EIN', '12-3456789')).toBe(true);
    expect(ok('EIN', '123-456789')).toBe(false);
    expect(ok('ITIN', '912-70-1234')).toBe(true);
    expect(ok('ITIN', '912-69-1234')).toBe(false);
    expect(ok('ITIN', '123-70-1234')).toBe(false);
    expect(ok('USZIP', '02110')).toBe(true);
    expect(ok('USZIP', '02110-1234')).toBe(true);
    expect(ok('USZIP', '2110')).toBe(false);
  });
  it('takes the field\'s own pattern and message first, else the named format', () => {
    expect(formatPatternOf({ 'ui:customFormat': 'SSN' }).pattern).toBe(BUILT_IN_FORMATS.SSN.pattern);
    expect(formatPatternOf({ 'ui:pattern': '^a$', 'ui:customFormat': 'SSN', 'ui:validationError': 'nope' })).toEqual({ pattern: '^a$', error: 'nope' });
    expect(formatPatternOf({}).pattern).toBeUndefined();
  });
});

describe('formats named by the schema', () => {
  it('reads the format from the schema first, then ui:customFormat, and knows the Anduin set', () => {
    expect(formatPatternOf({}, 'GIIN').pattern).toBe(BUILT_IN_FORMATS.GIIN.pattern);
    expect(formatPatternOf({ 'ui:customFormat': 'ABA' }).pattern).toBe(BUILT_IN_FORMATS.ABA.pattern);
    expect(formatPatternOf({ 'ui:customFormat': 'ABA' }, 'SWIFT').pattern).toBe(BUILT_IN_FORMATS.SWIFT.pattern);
    expect(formatPatternOf({}, 'NOPE').pattern).toBeUndefined();
    const ok = (name: string, text: string) => new RegExp(BUILT_IN_FORMATS[name].pattern).test(text);
    expect(ok('GIIN', 'ABC123.00000.LE.250')).toBe(true);
    expect(ok('GIIN', 'ABC123.0000.LE.250')).toBe(false);
    expect(ok('ABA', '011223344')).toBe(true);
    expect(ok('SWIFT', 'AAAABBCC123')).toBe(true);
    expect(ok('SWIFT', 'AAAA')).toBe(false);
    expect(ok('IBAN', 'DE89 3704 0044 0532 0130 00')).toBe(true);
  });
});
