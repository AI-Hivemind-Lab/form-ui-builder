/**
 * A checkbox or a bullet drawn in the PDF is a glyph of a symbol font (Wingdings, Symbol): the annotation's highlighted text and the
 * PDF text carry it as a private-use character (U+F0A8 for a box) or a ballot box, and the form would show it as a strange mark.
 * It is never part of what the document says, so it is always taken out, with the space after it.
 */
const GLYPHS = /[-☐-☒□⬜❏-❒]\s*/g;

export const cleanGlyphs = (text: string): string => text.replace(GLYPHS, '');
