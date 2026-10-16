import { describe, expect, it } from 'vitest';
import { clampZoom, zoomIn, zoomOut, ZOOMS } from './Zoom';

describe('zoom steps', () => {
  it('step through the list and stop at both ends', () => {
    expect(zoomIn(100)).toBe(110);
    expect(zoomOut(100)).toBe(90);
    expect(zoomIn(ZOOMS[ZOOMS.length - 1])).toBe(300);
    expect(zoomOut(ZOOMS[0])).toBe(50);
  });
  it('turn a stored value that is not a step into the nearest step', () => {
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(137)).toBe(125);
    expect(clampZoom(9999)).toBe(300);
  });
});
