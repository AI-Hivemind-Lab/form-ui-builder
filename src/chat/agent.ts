import type { FormDoc } from '../model/types';
import { SYSTEM_PROMPT } from './prompt';
import { streamChat } from './sse';
import { formContext, runTool, TOOLS, type ToolEnv } from './tools';
import type { ChatMessage, ToolCall, Usage } from './types';

/** What a turn needs from the editor: the form, to read and replace; the selection; the PDF; and where to show progress. */
export interface AgentIO {
  getDoc(): FormDoc;
  setDoc(doc: FormDoc): void;
  getSelection(): string | null;
  pdf?: ToolEnv['pdf'];
  onText?(text: string): void;
  /** A tool ran (for the "working" line). */
  onTool?(name: string, args: Record<string, unknown>, ok: boolean): void;
  stream?: typeof streamChat;
}

export const MAX_STEPS = 14;
const MAX_TOOL_OUTPUT = 14_000;

/** Keep the conversation short enough: the latest messages, starting at a person's message. */
export function trimHistory(messages: ChatMessage[], keep = 60): ChatMessage[] {
  if (messages.length <= keep) return messages;
  const tail = messages.slice(-keep);
  const first = tail.findIndex((m) => m.role === 'user' && typeof m.content === 'string');
  return first < 0 ? tail : tail.slice(first);
}

const parseArgs = (call: ToolCall): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(call.function.arguments || '{}');
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export interface TurnResult {
  /** The messages this turn added, in order (the person's message first). */
  added: ChatMessage[];
  usage: Usage;
  /** True when the model was still asking for tools after the step limit. */
  stopped: boolean;
}

/**
 * One turn of the conversation: the person's message goes to the model; whenever the model asks for tools they run here, in the editor,
 * on the form as it is now, and their results go back, until the model answers in words.
 */
export async function runTurn(history: ChatMessage[], userText: string, io: AgentIO, signal?: AbortSignal): Promise<TurnResult> {
  const stream = io.stream ?? streamChat;
  const added: ChatMessage[] = [{ role: 'user', content: `${userText}\n\n[Context from the editor, not from the person]\n${formContext(io.getDoc(), io.getSelection())}` }];
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const { message, usage: u } = await stream({ system: SYSTEM_PROMPT, messages: trimHistory([...history, ...added]), tools: TOOLS }, { signal, onText: io.onText });
    if (u) {
      usage.prompt_tokens += u.prompt_tokens;
      usage.completion_tokens += u.completion_tokens;
    }
    added.push(message);
    if (!message.tool_calls || message.tool_calls.length === 0) return { added, usage, stopped: false };
    const pictures: ChatMessage[] = [];
    for (const call of message.tool_calls) {
      const args = parseArgs(call);
      const result = args ? await runTool(call.function.name, args, { doc: io.getDoc(), selection: io.getSelection(), pdf: io.pdf }) : { output: { error: 'The arguments were not valid JSON.' } };
      if (result.doc) io.setDoc(result.doc);
      const ok = !(typeof result.output === 'object' && result.output !== null && 'error' in result.output);
      io.onTool?.(call.function.name, args ?? {}, ok);
      added.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.output).slice(0, MAX_TOOL_OUTPUT) });
      if (result.image) pictures.push({ role: 'user', content: [{ type: 'text', text: `Page ${result.image.page} of the source PDF:` }, { type: 'image_url', image_url: { url: result.image.url } }] });
    }
    added.push(...pictures);
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  }
  return { added, usage, stopped: true };
}
