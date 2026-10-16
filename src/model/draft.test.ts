import { describe, expect, it } from 'vitest';
import {
  resolveDateDraft, resolveEmailDraft, resolveIntegerDraft, resolveNumberDraft, resolvePatternDraft, resolvePhoneDraft,
  resolveYearDraft,
} from './draft';

describe('resolveNumberDraft (Review Focus 4: junk text must not save a partial value)', () => {
  it.each(['1e5', '12abc', 'abc', '5.', '--1'])('flags %j as invalid', (t) => {
    expect(resolveNumberDraft(t, undefined)).toEqual({ kind: 'invalid' });
  });
  it('sets a parsed number', () => {
    expect(resolveNumberDraft('1,000', undefined)).toEqual({ kind: 'set', value: 1000 });
  });
  it('is unchanged when the parsed value equals the stored one (no spurious undo step)', () => {
    expect(resolveNumberDraft('1000', 1000)).toEqual({ kind: 'unchanged' });
  });
  it('clears a filled value when the text is emptied, and is unchanged when already empty', () => {
    expect(resolveNumberDraft('  ', 5)).toEqual({ kind: 'set', value: '' });
    expect(resolveNumberDraft('', undefined)).toEqual({ kind: 'unchanged' });
    expect(resolveNumberDraft('', '')).toEqual({ kind: 'unchanged' });
  });
});

describe('resolveDateDraft', () => {
  it('flags an impossible date as invalid instead of keeping a partial one', () => {
    expect(resolveDateDraft('02-30-2026', '2026-02-03')).toEqual({ kind: 'invalid' });
    expect(resolveDateDraft('02-3-', '2026-02-03')).toEqual({ kind: 'invalid' });
  });
  it('sets a parsed ISO date and is unchanged when it matches', () => {
    expect(resolveDateDraft('01-02-2026', undefined)).toEqual({ kind: 'set', value: '2026-01-02' });
    expect(resolveDateDraft('01-02-2026', '2026-01-02')).toEqual({ kind: 'unchanged' });
  });
  it('clears when emptied', () => {
    expect(resolveDateDraft('', '2026-01-02')).toEqual({ kind: 'set', value: '' });
  });
});

describe('new resolvers', () => {
  it('integer: rejects decimals and exponents, accepts digits', () => {
    expect(resolveIntegerDraft('1.5', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveIntegerDraft('1e5', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveIntegerDraft('42', undefined)).toEqual({ kind: 'set', value: 42 });
    expect(resolveIntegerDraft('42', 42)).toEqual({ kind: 'unchanged' });
  });
  it('year: needs exactly four digits', () => {
    expect(resolveYearDraft('26', undefined)).toEqual({ kind: 'invalid' });
    expect(resolveYearDraft('2026', 2025)).toEqual({ kind: 'set', value: 2026 });
  });
  it('email/phone: invalid text is flagged, valid text is set (trimmed), empty clears', () => {
    expect(resolveEmailDraft('nope', 'a@b.co')).toEqual({ kind: 'invalid' });
    expect(resolveEmailDraft(' x@y.zz ', undefined)).toEqual({ kind: 'set', value: 'x@y.zz' });
    expect(resolveEmailDraft('', 'a@b.co')).toEqual({ kind: 'set', value: '' });
    expect(resolvePhoneDraft('12', undefined)).toEqual({ kind: 'invalid' });
    expect(resolvePhoneDraft('+1 415 555 0100', undefined)).toEqual({ kind: 'set', value: '+1 415 555 0100' });
  });
  it('pattern: validates against ui:pattern, accepts anything for a bad regex', () => {
    const r = resolvePatternDraft('^\\d{3}$');
    expect(r('12', undefined)).toEqual({ kind: 'invalid' });
    expect(r('123', undefined)).toEqual({ kind: 'set', value: '123' });
    expect(resolvePatternDraft('[')('anything', undefined)).toEqual({ kind: 'set', value: 'anything' });
  });
});
