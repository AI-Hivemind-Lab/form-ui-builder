import { getWidget } from '../../model/schemaWalk';
import type { SchemaNode } from '../../model/types';
import { isBooleanList } from './optionLayouts';
import type { Standard, StandardContext } from './types';
import { detach, labelOf, patchUi, plainText, walk } from './util';

export const FOLLOW_UP_INDENT = '24px';

/** A Yes / No question: a radio or checkbox group whose options are all boolean words. */
const isYesNo = (ctx: StandardContext, n: SchemaNode): boolean => {
  const w = getWidget(ctx.doc, n);
  if (w !== 'Radio' && w !== 'MultipleCheckbox') return false;
  const options = (ctx.doc.uiSchema[n.name]?.['ui:multipleOption'] as { options?: unknown } | undefined)?.options;
  return Array.isArray(options) && isBooleanList(options.map((o) => plainText((Array.isArray(o) ? (o[1] as { formattedText?: unknown } | null)?.formattedText : '') ?? '')));
};

/**
 * The follow-ups of a Yes / No question: the fields that sit right after it, indented 24px. Used to move a question together
 * with the note or fields that belong to its answer.
 */
export function followUpsOf(ctx: StandardContext, siblings: SchemaNode[], question: string): string[] {
  const at = siblings.findIndex((s) => s.name === question);
  if (at < 0 || !isYesNo(ctx, siblings[at])) return [];
  const out: string[] = [];
  for (let i = at + 1; i < siblings.length && ctx.doc.uiSchema[siblings[i].name]?.['ui:indentation'] === FOLLOW_UP_INDENT; i += 1) out.push(siblings[i].name);
  return out;
}

/**
 * A Yes / No question always sits on one line, and what applies to one answer is an independent field indented 24px under it,
 * never a field below an option (that would stack the options in a column). This puts any Yes / No question right, whoever built it.
 */
export function normalizeYesNo(ctx: StandardContext): void {
  const questions: SchemaNode[] = [];
  walk(ctx.doc.schema.properties, (n) => {
    if (isYesNo(ctx, n)) questions.push(n);
  });
  for (const q of questions) {
    const ui = ctx.doc.uiSchema[q.name] ?? {};
    const options = ((ui['ui:multipleOption'] as { options?: unknown[] } | undefined)?.options ?? []) as [string, Record<string, unknown>][];
    const tagged = options.flatMap((o) => (Array.isArray(o[1]?.fieldsBelow) ? (o[1].fieldsBelow as unknown[]).filter((x): x is string => typeof x === 'string').map((child) => ({ child, answer: plainText(o[1].formattedText) })) : []));
    if (tagged.length > 0) {
      // untag, then place the fields right after the question, indented
      const stripped = options.map(([v, o]) => {
        const { fieldsBelow: _gone, ...rest } = o;
        void _gone;
        return [v, rest] as [string, Record<string, unknown>];
      });
      patchUi(ctx, q.name, { 'ui:multipleOption': { ...(ui['ui:multipleOption'] as object), options: stripped } });
      const nodes = tagged.flatMap((t) => {
        const node = detach(ctx, t.child);
        return node ? [{ node, answer: t.answer }] : [];
      });
      const put = (list: SchemaNode[]): SchemaNode[] => {
        const at = list.findIndex((s) => s.name === q.name);
        if (at >= 0) {
          let end = at + 1;
          while (end < list.length && ctx.doc.uiSchema[list[end].name]?.['ui:indentation'] === FOLLOW_UP_INDENT) end += 1;
          return [...list.slice(0, end), ...nodes.map((x) => x.node), ...list.slice(end)];
        }
        return list.map((s) => (s.properties ? { ...s, properties: put(s.properties) } : s));
      };
      ctx.doc = { ...ctx.doc, schema: { ...ctx.doc.schema, properties: put(ctx.doc.schema.properties) } };
      nodes.forEach((x) => {
        patchUi(ctx, x.node.name, { 'ui:indentation': FOLLOW_UP_INDENT });
        ctx.warn(`NEEDS RULE: show ${x.node.name} only when "${labelOf(ctx.doc, q.name).slice(0, 80)}" (${q.name}) is ${x.answer}`);
      });
      ctx.log(`yes-no: ${nodes.length} field(s) that were below an answer of "${labelOf(ctx.doc, q.name).slice(0, 60)}" (${q.name}) are now indented follow-ups, so the answers stay on one line`);
    }
    if (ctx.doc.uiSchema[q.name]?.['ui:fixedLayout'] !== 'Inline') patchUi(ctx, q.name, { 'ui:fixedLayout': 'Inline' });
  }
}

export const yesNoQuestions: Standard = {
  id: 'yes-no',
  title: 'Yes / No questions on one line, with indented follow-ups',
  source: 'rule',
  apply: normalizeYesNo,
};
