/** The all-caps words the Title Case standard could not settle, with the original titles they appear in. */
export function titleWordsFrom(warnings: string[], changes: string[]): { word: string; titles: string[] }[] {
  const line = warnings.find((w) => w.startsWith('TITLE CASE REVIEW:'));
  if (!line) return [];
  const words = line.slice('TITLE CASE REVIEW:'.length).split(' may be')[0].split(',').map((w) => w.trim()).filter(Boolean);
  const originals = changes.flatMap((c) => {
    const m = /^title-case: "(.*)" → "/.exec(c);
    return m ? [m[1]] : [];
  });
  return words.map((word) => ({ word, titles: originals.filter((t) => new RegExp(`\\b${word}\\b`).test(t)).slice(0, 3) }));
}
