import { AiFormatError, extractJson } from './validate';

/** Sends one prompt to the AI service and returns the model's text. */
export type Ask = (task: string, system: string, user: string, images?: string[]) => Promise<string>;

/** A small fast hash for cache keys. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const CACHE_PREFIX = 'formbuilder:ai-cache:v1:';

/** The real Ask: the dev-server route, with answers cached by prompt so a rebuild does not call the model again. */
export function makeAsk(fetchFn: typeof fetch = fetch, storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Ask {
  return async (task, system, user, images) => {
    const key = `${CACHE_PREFIX}${hashText(`${task}\n${system}\n${user}\n${(images ?? []).map(hashText).join(',')}`)}`;
    try {
      const hit = storage?.getItem(key);
      if (hit) return hit;
    } catch { /* storage blocked */ }
    const res = await fetchFn('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, user, images }) });
    const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || typeof body.text !== 'string') throw new Error(body.error ?? `The AI service answered ${res.status}`);
    try {
      storage?.setItem(key, body.text);
    } catch { /* cache is optional */ }
    return body.text;
  };
}

export async function aiConfigured(fetchFn: typeof fetch = fetch): Promise<{ configured: boolean; model: string | null }> {
  try {
    const res = await fetchFn('/api/llm/status');
    if (!res.ok) return { configured: false, model: null };
    const body = (await res.json()) as { configured?: boolean; model?: string | null };
    return { configured: body.configured === true, model: body.model ?? null };
  } catch {
    return { configured: false, model: null };
  }
}

/** Ask, parse and validate; one retry that tells the model what was wrong. */
export async function askValidated<T>(ask: Ask, task: string, system: string, user: string, validate: (raw: unknown) => T, images?: string[]): Promise<T> {
  let text = await ask(task, system, user, images);
  try {
    return validate(extractJson(text));
  } catch (e) {
    if (!(e instanceof AiFormatError)) throw e;
    text = await ask(task, system, `${user}\n\nYour previous answer was rejected: ${e.message}. Answer again with a corrected JSON object.`, images);
    return validate(extractJson(text));
  }
}

export interface Voted<T> {
  /** The answer most tries gave. */
  best: T;
  /** How many valid answers agree with it, out of how many valid answers there were. */
  agree: number;
  total: number;
  /** Tries that failed outright (a bad answer twice, or the service erroring). */
  failed: number;
}

/**
 * The same question asked several times, in parallel: a model can answer a borderline call differently from one try to the next,
 * so the answer most tries agree on wins, and how many agreed is reported. `key` says when two answers are the same answer.
 * Each try has its own task name, so each is its own cache entry (a rebuild on the same prompt returns the same votes).
 */
export async function askVoted<T>(ask: Ask, task: string, system: string, user: string, validate: (raw: unknown) => T, key: (answer: T) => string, tries = 3, images?: string[]): Promise<Voted<T>> {
  const settled = await Promise.all(Array.from({ length: tries }, (_, k) => askValidated(ask, `${task}#${k + 1}`, system, user, validate, images).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }))));
  const good = settled.flatMap((x) => (x.ok ? [x.v] : []));
  if (good.length === 0) {
    const first = settled.find((x) => !x.ok);
    throw first && !first.ok ? first.e : new Error('No answer');
  }
  const groups = new Map<string, T[]>();
  good.forEach((v) => groups.set(key(v), [...(groups.get(key(v)) ?? []), v]));
  const winner = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  return { best: winner[0], agree: winner.length, total: good.length, failed: settled.length - good.length };
}
