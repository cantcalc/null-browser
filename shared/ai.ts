export type AIProvider = 'gemini' | 'groq' | 'openrouter';
export const AI_PROVIDERS: AIProvider[] = ['gemini', 'groq', 'openrouter'];
export const AI_PROVIDER_NAMES: Record<AIProvider, string> = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter' };
export interface AIModel {
  provider: AIProvider; id: string; name: string; free: boolean;
  text: boolean; image: boolean; tools: boolean; context: number;
  reason?: string; verifiedAt: number; expiresAt?: number;
}
export interface AISettings {
  enabled: boolean; position: 'left' | 'right'; width: number;
  referencePage: boolean; dataConsent: boolean; fallbackConsent: boolean;
  autoFallback: boolean; priority: string[]; selectedModel: string;
  dedicatedTab: boolean; concurrentAgents: boolean; showProgress: boolean;
}
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false, position: 'right', width: 360, referencePage: true,
  dataConsent: false, fallbackConsent: false, autoFallback: false,
  priority: [], selectedModel: '', dedicatedTab: true, concurrentAgents: false, showProgress: true,
};
export interface AIConnection { provider: AIProvider; connected: boolean; status: 'disconnected' | 'saved' | 'ready' | 'error'; message?: string; freeAccount: boolean }
export interface AIMessage { id: string; role: 'user' | 'assistant'; text: string; model?: string; taskId?: string; references?: Array<{ title: string; url: string }>; status?: string; usesPageData?: boolean }
export interface AIApproval { id: string; action: string; target: string; detail: string }
export interface AITask {
  id: string; kind: 'chat' | 'agent'; state: 'running' | 'approval' | 'login' | 'paused' | 'done' | 'cancelled' | 'error';
  title: string; tabId?: string; model: string; steps: string[]; approval?: AIApproval; error?: string;
  result?: { tabId: string; title: string; url: string };
}
export interface AIState {
  settings: AISettings; connections: AIConnection[]; models: AIModel[];
  messages: AIMessage[]; tasks: AITask[]; notice?: string; private: boolean;
}
export interface AIImagePreview { token: string; dataURL: string; title: string }
export type AICommand =
  | { op: 'state' }
  | { op: 'settings'; updates: Partial<AISettings> }
  | { op: 'connect'; provider: AIProvider; key: string; freeAccount: boolean }
  | { op: 'disconnect'; provider: AIProvider }
  | { op: 'refresh'; provider: AIProvider }
  | { op: 'send'; text: string; agent: boolean; tabIds: string[]; imageToken?: string; selectionToken?: string }
  | { op: 'image'; tabId: string }
  | { op: 'stop'; taskId: string }
  | { op: 'clear' }
  | { op: 'resolve'; taskId: string; approvalId: string; allow: boolean }
  | { op: 'resume'; taskId: string };
export interface AIResult { ok: boolean; error?: string; state?: AIState; image?: AIImagePreview }
export const modelKey = (model: Pick<AIModel, 'provider' | 'id'>): string => `${model.provider}:${model.id}`;
