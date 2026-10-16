import { describe, expect, it } from 'vitest';
import { linesFromItems } from './pdfText';

describe('linesFromItems', () => {
  it('joins items on one baseline left to right and orders lines top to bottom', () => {
    const lines = linesFromItems(
      [
        { str: 'world', x: 80, y: 700 },
        { str: 'Hello', x: 10, y: 700.5 },
        { str: 'Second line', x: 10, y: 650 },
        { str: '  ', x: 5, y: 600 },
      ],
      800,
    );
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Second line']);
    expect(lines[0].top).toBeCloseTo(0.125, 2);
    expect(lines[1].top).toBeGreaterThan(lines[0].top);
  });
});

describe('box glyphs in the PDF text', () => {
  it('are dropped from a line, and a line holding only a glyph is not a line', () => {
    const lines = linesFromItems([{ str: '', x: 10, y: 700 }, { str: 'License held:', x: 30, y: 700 }, { str: '', x: 10, y: 600 }], 800);
    expect(lines.map((l) => l.text)).toEqual(['License held:']);
  });
});
