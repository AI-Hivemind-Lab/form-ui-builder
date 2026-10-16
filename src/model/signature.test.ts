import { describe, expect, it } from 'vitest';
import { getSignatureMappings, mappingCaption, newMapping, roleOf, signatureTitle, withMappingType } from './signature';

describe('signature model', () => {
  it('titles the card from role and signer', () => {
    expect(signatureTitle({ 'ui:widget': 'Signature', 'ui:signatureSigner': 'Individual Signatory' })).toBe('LP Signature - Individual Signatory');
    expect(signatureTitle({ 'ui:signatureType': 'GpSignature', 'ui:signatureSigner': ' General Partner Signatory ' })).toBe('GP Signature - General Partner Signatory');
    expect(signatureTitle({ 'ui:signatureType': 'GpSignature' })).toBe('GP Signature');
  });
  it('treats a missing or unknown role as LP', () => {
    expect(roleOf({})).toBe('LpSignature');
    expect(roleOf({ 'ui:signatureType': 'whatever' })).toBe('LpSignature');
  });
  it('reads mappings defensively and keeps unknown keys', () => {
    const ui = { 'ui:signature': [{ mapping: 'a', signatureType: 'Custom', isOptional: true, customTypeConfig: { description: 'Amount' } }, 7, null, {}] };
    const ms = getSignatureMappings(ui);
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ mapping: 'a', isOptional: true, customTypeConfig: { description: 'Amount' } });
    expect(ms[1]).toEqual({ mapping: '', signatureType: 'Signature', isOptional: false });
    expect(getSignatureMappings({})).toEqual([]);
  });
  it('captions rows like the real tool', () => {
    expect(mappingCaption({ ...newMapping(), signatureType: 'Date', format: 'MM/dd/yyyy' })).toBe('Date (mm/dd/yyyy)');
    expect(mappingCaption({ ...newMapping(), signatureType: 'Date' })).toBe('Date');
    expect(mappingCaption({ ...newMapping(), signatureType: 'Custom', customTypeConfig: { description: 'Amount' } })).toBe('Amount');
    expect(mappingCaption({ ...newMapping(), signatureType: 'Title' })).toBe('Title');
  });
  it('gives a Date a default format and removes it for other types', () => {
    const d = withMappingType(newMapping(), 'Date');
    expect(d.format).toBe('MM/dd/yyyy');
    expect(withMappingType(d, 'Name').format).toBeUndefined();
  });
});
