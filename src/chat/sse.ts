import type { ChatMessage, ToolCall, Usage } from './types';

type Assistant = Extract<ChatMessage, { role: 'assistant' }>;

/**
 * Builds the assistant's message from a stream of server-sent events (OpenAI format): text arrives in pieces, and so does each tool call
 * (its name once, its arguments as text pieces to join).
 */
export class StreamAccumulator {
  text = '';
  usage: Usage | null = null;
  done = false;
  private calls: { id: string; name: string; args: string }[] = [];
  private buffer = '';

  /** Feed a piece of the stream. Returns true when the text changed. */
  push(chunk: string): boolean {
    this.buffer += chunk;
    let changed = false;
    for (;;) {
      const end = this.buffer.indexOf('\n\n');
      if (end < 0) break;
      const event = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          this.done = true;
          continue;
        }
        let parsed: { choices?: { delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; usage?: Usage };
        try {
          parsed = JSON.parse(data);
        } catch {
          continue; // a keep-alive or a broken line: skip it
        }
        if (parsed.usage) this.usage = parsed.usage;
        const delta = parsed.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content !== '') {
          this.text += delta.content;
          changed = true;
        }
        for (const tc of delta?.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const call = (this.calls[i] ??= { id: '', name: '', args: '' });
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.name += tc.function.name;
          if (tc.function?.arguments) call.args += tc.function.arguments;
        }
      }
    }
    return changed;
  }

  message(): Assistant {
    const tool_calls: ToolCall[] = this.calls.filter((c) => c.name !== '').map((c, i) => ({ id: c.id || `call_${i}`, type: 'function', function: { name: c.name, arguments: c.args === '' ? '{}' : c.args } }));
    return { role: 'assistant', content: this.text === '' ? null : this.text, ...(tool_calls.length > 0 ? { tool_calls } : {}) };
  }
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Called with the whole text so far each time it grows. */
  onText?: (text: string) => void;
  fetchFn?: typeof fetch;
}

/** One completion from the server: the assistant's message (text and tool calls), streamed. */
export async function streamChat(body: { system: string; messages: ChatMessage[]; tools: unknown[] }, opts: StreamOptions = {}): Promise<{ message: Assistant; usage: Usage | null }> {
  const res = await (opts.fetchFn ?? fetch)('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok || !res.body) {
    const info = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(info.error ?? `The assistant could not be reached (${res.status}).`);
  }
  const acc = new StreamAccumulator();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (acc.push(decoder.decode(value, { stream: true }))) opts.onText?.(acc.text);
  }
  acc.push('\n\n');
  return { message: acc.message(), usage: acc.usage };
}
