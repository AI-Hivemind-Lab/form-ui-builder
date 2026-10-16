import type { ChatMessage } from './types';

/** One line of the conversation as the person sees it. */
export interface ShownMessage {
  id: string;
  role: 'user' | 'assistant' | 'note';
  text: string;
}

export interface Conversation {
  shown: ShownMessage[];
  /** What the model has been sent, tool calls and results included, so a follow-up has the full thread. */
  api: ChatMessage[];
}

const KEY = (formId: string): string => `formbuilder:chat:${formId}`;
export const FORM_ID_KEY = 'formbuilder:form-id';

export const currentFormId = (): string => {
  try {
    return localStorage.getItem(FORM_ID_KEY) ?? 'form';
  } catch {
    return 'form';
  }
};

/** Page pictures are big and cannot be replayed from storage: keep a note in their place. */
const forStorage = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m) => (m.role === 'user' && Array.isArray(m.content) ? { role: 'user', content: m.content.map((p) => (p.type === 'image_url' ? { type: 'text' as const, text: '[a picture of the page was shown here]' } : p)) } : m));

export function loadConversation(formId: string): Conversation {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY(formId)) ?? 'null');
    if (raw && typeof raw === 'object' && Array.isArray((raw as Conversation).shown) && Array.isArray((raw as Conversation).api)) return raw as Conversation;
  } catch { /* nothing kept, or unreadable */ }
  return { shown: [], api: [] };
}

export function saveConversation(formId: string, c: Conversation): void {
  try {
    localStorage.setItem(KEY(formId), JSON.stringify({ shown: c.shown.slice(-200), api: forStorage(c.api.slice(-120)) }));
  } catch { /* storage full or blocked: the conversation just is not kept */ }
}

export function clearConversation(formId: string): void {
  try {
    localStorage.removeItem(KEY(formId));
  } catch { /* nothing to clear */ }
}
