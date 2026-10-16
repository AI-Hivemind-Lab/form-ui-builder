import { headingTitle, type StructureFacts, type StructurePlan } from '../structure';
import { askValidated, type Ask } from './client';
import { STRUCTURE_SYSTEM } from './prompts';
import { AiFormatError, arr, obj, oneOf, str, strOrNull } from './validate';

const readable = (title: string): boolean => title.trim().length >= 3 && !/_/.test(title) && /[A-Za-z]{2}/.test(title) && title.length <= 120;

/** What the model may say, checked against what it was shown: pages and headings it names must exist, nothing visible is hidden. */
export function validateStructure(raw: unknown, facts: StructureFacts): StructurePlan {
  const o = obj(raw, 'answer');
  const heading = (id: string) => facts.headings.find((h) => h.id === id);
  const plan: StructurePlan = { runs: {}, titles: {} };
  arr(o.runs ?? [], 'runs').forEach((x, i) => {
    const e = obj(x, `runs[${i}]`);
    const id = str(e.run, `runs[${i}].run`);
    const run = facts.runs.find((r) => r.id === id);
    if (!run) return; // an invented run: ignored
    const action = oneOf(e.action, ['page', 'new', 'hidden'] as const, `runs[${i}].action`);
    if (action === 'hidden') {
      if (!run.hideable) throw new AiFormatError(`run ${id} holds fields an investor fills in: it cannot be hidden (answer "page" or "new")`);
      plan.runs[id] = { kind: 'hidden' };
    } else if (action === 'page') {
      const page = str(e.page, `runs[${i}].page`);
      if (!facts.pageNames.includes(page)) throw new AiFormatError(`runs[${i}].page "${page}" is not a page of the form: copy a name from "pages"`);
      plan.runs[id] = { kind: 'page', page };
    } else {
      const hid = strOrNull(e.headingId);
      const h = hid ? heading(hid) : undefined;
      if (hid && !h) throw new AiFormatError(`runs[${i}].headingId "${hid}" is not one of the headings`);
      const title = h ? headingTitle(h) : (strOrNull(e.title) ?? '').trim();
      if (!readable(title)) throw new AiFormatError(`runs[${i}] needs the headingId of a heading, or a plain-words title (no underscores, not an alias)`);
      plan.runs[id] = { kind: 'new', title, ...(h ? { headingId: h.id } : {}) };
    }
  });
  arr(o.pages ?? [], 'pages').forEach((x, i) => {
    const e = obj(x, `pages[${i}]`);
    const page = str(e.page, `pages[${i}].page`);
    if (!facts.pages.some((p) => p.name === page)) return;
    const hid = strOrNull(e.headingId);
    const h = hid ? heading(hid) : undefined;
    if (hid && !h) throw new AiFormatError(`pages[${i}].headingId "${hid}" is not one of the headings`);
    const title = h ? headingTitle(h) : (strOrNull(e.title) ?? '').trim();
    if (!readable(title)) throw new AiFormatError(`pages[${i}] needs the headingId of a heading, or a plain-words title (no underscores, not an alias)`);
    plan.titles[page] = { title, ...(h ? { headingId: h.id } : {}) };
  });
  return plan;
}

/** What the model is shown: only what it can decide on. */
export function structurePrompt(facts: StructureFacts): string {
  const weak = facts.pages.filter((p) => p.source === 'heading' || p.source === 'alias');
  return JSON.stringify({
    headings: facts.headings.map((h) => ({ id: h.id, page: h.page + 1, text: h.text })),
    allPages: facts.pages.map((p) => ({ name: p.name, title: p.title, startPage: p.startPage })),
    pages: weak.map((p) => ({ name: p.name, title: p.title, titleFrom: p.source === 'alias' ? 'the alias (no real title found)' : 'a heading of the PDF', startPage: p.startPage, under: p.heading?.id ?? null, candidates: p.candidates.map((c) => c.id), firstTexts: p.firstTexts })),
    runs: facts.runs.map((r) => ({ id: r.id, pages: r.fromPage === r.toPage ? `${r.fromPage}` : `${r.fromPage}-${r.toPage}`, count: r.count, kinds: r.kinds, under: r.heading?.id ?? null, hideable: r.hideable, sample: r.sample, suggestion: r.action.kind === 'page' ? { action: 'page', page: r.action.page } : r.action.kind === 'new' ? { action: 'new', title: r.action.title } : { action: 'hidden' } })),
  });
}

/**
 * Asks the model where the objects outside every page go and what the untitled pages are called. Returns null when there is nothing to
 * decide; the program's own answer (the headings of the PDF) stands for anything the model leaves out or gets wrong twice.
 */
export async function planStructure(facts: StructureFacts, ask: Ask, onProgress: (message: string) => void = () => {}): Promise<StructurePlan | null> {
  const weak = facts.pages.filter((p) => p.source === 'heading' || p.source === 'alias');
  if (facts.runs.length === 0 && weak.length === 0) return null;
  onProgress('Reading the structure of the PDF…');
  return askValidated(ask, 'structure', STRUCTURE_SYSTEM, structurePrompt(facts), (raw) => validateStructure(raw, facts));
}
