import type { AIModel, AIProvider } from '../../shared/ai';
import { classifyProviderError, geminiFreeCatalog, groqFreeCatalog, ProviderError } from './Policy';
import reviewedPolicy from '../../shared/ai-model-policy.json';
import { randomUUID } from 'node:crypto';

export interface ToolCall { id: string; name: string; arguments: Record<string, unknown>; signature?: string; idProvided?: boolean }
export interface WireMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; image?: string; calls?: ToolCall[]; callId?: string; toolName?: string }
export interface ToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export interface Completion { text: string; calls: ToolCall[] }
export type Transport = typeof fetch;
const API = { gemini: 'https://generativelanguage.googleapis.com/v1beta', groq: 'https://api.groq.com/openai/v1', openrouter: 'https://openrouter.ai/api/v1' };
export const PRICING_SOURCES = { gemini: 'https://aistudio.google.com/docs/pricing', groq: 'https://console.groq.com/docs/rate-limits', openrouter: 'https://openrouter.ai/api/v1/models' };

async function limitedText(response: Response, max = 2_000_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let value = '', bytes = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > max) throw Error('제공자 응답이 크기 제한을 초과했습니다.'); value += decoder.decode(next.value, { stream: true }); }
    return value + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
export async function* sse(response: Response): AsyncGenerator<any> {
  if (!response.body) throw Error('스트리밍 응답이 비어 있습니다.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  const parse = (event: string) => {
    const text = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!text || text === '[DONE]') return null;
    return JSON.parse(text);
  };
  try {
    for (;;) {
      const next = await reader.read();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 1_000_000) throw Error('스트림 이벤트가 크기 제한을 초과했습니다.');
      let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = parse(event); if (data) yield data;
      }
      if (next.done) { const data = parse(buffer); if (data) yield data; break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export class AIProviders {
  constructor(private transport: Transport = fetch) {}
  private async request(url: string, init: RequestInit, signal: AbortSignal, provider: AIProvider) {
    try {
      // No browser session, extension webRequest hooks, cookies or redirects.
      const response = await this.transport(url, { ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!response.ok) {
        let body; try { body = JSON.parse(await limitedText(response, 64_000)); } catch { body = {}; }
        throw classifyProviderError(provider, response.status, body, response.headers);
      }
      return response;
    } catch (error) {
      if (error instanceof ProviderError || signal.aborted) throw error;
      throw new ProviderError('network', provider, 'AI 제공자에 연결하지 못했거나 응답 시간이 초과되었습니다.');
    }
  }
  private headers(provider: AIProvider, key: string): Record<string, string> {
    return provider === 'gemini' ? { 'x-goog-api-key': key, 'Content-Type': 'application/json' } : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  }
  private async docs(url: string, signal: AbortSignal, provider: AIProvider) {
    return limitedText(await this.request(url, { headers: { Accept: 'text/markdown, text/html;q=0.9' } }, AbortSignal.any([signal, AbortSignal.timeout(8000)]), provider));
  }
  async models(provider: AIProvider, key: string, freeAccount: boolean, signal: AbortSignal): Promise<AIModel[]> {
    if (provider !== 'openrouter' && !freeAccount) throw Error('제공자 콘솔에서 무료 요금제인지 확인한 뒤 연결해 주세요. 계정 결제 상태는 모델 API로 확인할 수 없습니다.');
    if (provider === 'openrouter') {
      const keyResponse = await this.request(`${API.openrouter}/key`, { headers: this.headers(provider, key) }, signal, provider).then(r => limitedText(r));
      let keyInfo: any; try { keyInfo = JSON.parse(keyResponse).data; } catch { throw Error('제공자의 API 키 확인 응답을 읽지 못했습니다.'); }
      if (!keyInfo || typeof keyInfo !== 'object' || !(typeof keyInfo.label === 'string' || typeof keyInfo.is_free_tier === 'boolean' || Object.hasOwn(keyInfo, 'limit_remaining'))) throw Error('공식 API 키 확인 응답이 아닙니다. 연결 완료로 처리하지 않았습니다.');
    }
    const response = await this.request(`${API[provider]}/models${provider === 'gemini' ? '?pageSize=1000' : ''}`, { headers: this.headers(provider, key) }, signal, provider);
    const raw = JSON.parse(await limitedText(response, 8_000_000));
    const verifiedAt = Date.now();
    let free = new Set<string>(), capabilityDocs = '', policyFallback = false;
    const reviewed: Record<string, { image: boolean; tools: boolean }> = provider === 'openrouter' || Date.now() >= Date.parse(reviewedPolicy.expiresAt) ? {} : reviewedPolicy[provider];
    if (provider === 'gemini') {
      try { free = geminiFreeCatalog(await this.docs(PRICING_SOURCES.gemini, signal, provider)); }
      catch { signal.throwIfAborted(); free = new Set(Object.keys(reviewed)); policyFallback = true; }
    }
    if (provider === 'groq') {
      try { free = groqFreeCatalog(await this.docs(PRICING_SOURCES.groq, signal, provider)); }
      catch { signal.throwIfAborted(); free = new Set(Object.keys(reviewed)); policyFallback = true; }
      try { capabilityDocs = await this.docs('https://console.groq.com/docs/tool-use/overview', signal, provider); } catch { /* unknown capabilities stay disabled */ }
    }
    const records = provider === 'gemini' ? raw.models || [] : raw.data || [];
    const capabilityPages = new Map<string, string>();
    if (provider === 'gemini') {
      const ids = records.map((m: any) => String(m.name || '').replace(/^models\//, '')).filter((id: string) => free.has(id)).slice(0, 12);
      await Promise.allSettled(ids.map(async (id: string) => { capabilityPages.set(id, await this.docs(`https://aistudio.google.com/docs/models/${encodeURIComponent(id)}`, signal, provider)); }));
      signal.throwIfAborted();
    }
    const models: AIModel[] = [];
    for (const item of records.slice(0, 1000)) {
      const id = String(item.id || item.name || '').replace(/^models\//, '');
      if (!id || id.length > 160 || !/^[a-zA-Z0-9/.:_-]+$/.test(id)) continue;
      let isFree = false, text = true, image = false, tools = false, capabilityPolicy = false;
      if (provider === 'openrouter') {
        const price = item.pricing || {};
        const charges = ['prompt', 'completion', 'request', 'image', 'internal_reasoning', 'web_search'];
        isFree = ['prompt', 'completion'].every(p => price[p] !== undefined && Number(price[p]) === 0) && charges.every(p => price[p] === undefined || Number(price[p]) === 0);
        text = item.architecture?.output_modalities?.includes('text') === true;
        image = item.architecture?.input_modalities?.includes('image') === true;
        tools = item.supported_parameters?.includes('tools') === true;
      } else if (provider === 'gemini') {
        isFree = free.has(id);
        text = item.supportedGenerationMethods?.includes('generateContent') === true && !/tts|audio|live|image|robotics|transcri|translate/i.test(id);
        if (isFree && text) {
          try {
            const doc = capabilityPages.get(id);
            if (!doc) throw Error('Capability page unavailable');
            image = /\*\*Inputs\*\*[^\n]*\bImage\b/i.test(doc);
            tools = /\*\*Function calling\*\*\s*\{% badge[^}]*type="supported"/i.test(doc);
          } catch { if (reviewed[id]) { image = reviewed[id].image; tools = reviewed[id].tools; capabilityPolicy = true; } }
        }
      } else {
        isFree = free.has(id) && item.active !== false;
        text = !/whisper|tts|orpheus|guard|safeguard|compound|transcrib/i.test(id);
        // Only a documented table row naming this exact model AND marking
        // tool calling as supported is accepted, never a model-name guess.
        const rows = capabilityDocs.match(/<tr[\s\S]*?<\/tr>/g) || [];
        tools = rows.some(row => {
          const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1].replace(/<[^>]*>/g, ' ').trim());
          return cells[0] === id && /true|✅|yes|^supported$/i.test(cells[1] || '');
        });
        image = /vision|image/i.test(String(item.capabilities?.join?.(',') || ''));
        if (!capabilityDocs && reviewed[id]) { tools = reviewed[id].tools; capabilityPolicy = true; }
        if (!image && reviewed[id]?.image) { image = true; capabilityPolicy = true; }
      }
      if (!text) continue;
      models.push({ provider, id, name: String(item.displayName || item.name || id).slice(0, 150), free: isFree, text, image, tools, context: Number(item.context_length || item.inputTokenLimit || item.context_window || 8192), verifiedAt,
        ...(policyFallback || capabilityPolicy ? { expiresAt: Date.parse(reviewedPolicy.expiresAt) } : {}),
        ...(!isFree ? { reason: '무료 Standard 입력·출력 가격을 확인하지 못해 사용할 수 없습니다.' } : policyFallback ? { reason: `공식 문서 확인본 사용 · ${reviewedPolicy.expiresAt.slice(0, 10)} 만료` } : {}) });
    }
    if (provider === 'gemini' && raw.nextPageToken) throw Error('모델 목록이 한 페이지를 초과했습니다. 불완전한 목록을 사용하지 않았습니다.');
    return models.sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
  }
  async complete(model: AIModel, key: string, messages: WireMessage[], definitions: ToolDefinition[], signal: AbortSignal, onText: (delta: string) => void): Promise<Completion> {
    const provider = model.provider;
    if (!model.free || !model.text) throw Error('확인된 무료 텍스트 모델만 사용할 수 있습니다.');
    if (definitions.length && !model.tools) throw Error('이 모델은 도구 호출 지원이 확인되지 않았습니다.');
    if (messages.some(m => m.image) && !model.image) throw Error('이 모델은 이미지 입력을 지원하지 않습니다.');
    const outputTokens = Math.max(512, Math.min(4096, Math.floor(model.context / 4)));
    const inputBytes = messages.reduce((bytes, message) => bytes + Buffer.byteLength(message.content + JSON.stringify(message.calls || [])), 0) + Buffer.byteLength(JSON.stringify(definitions));
    const estimatedTokens = Math.ceil(inputBytes / 2) + (messages.some(message => message.image) ? 4096 : 0);
    if (inputBytes > 100_000 || estimatedTokens + outputTokens > model.context) throw new ProviderError('invalid', provider, '선택한 모델의 문맥 한도에 비해 내용이 큽니다. 참조 탭을 줄이거나 새 대화·더 큰 무료 모델을 사용해 주세요.');
    let body: any, url: string;
    if (provider === 'gemini') {
      const contents = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          const call = messages.flatMap(previous => previous.calls || []).find(previous => previous.id === m.callId);
          return { role: 'user', parts: [{ functionResponse: { ...(call?.idProvided === false ? {} : { id: m.callId }), name: m.toolName, response: { result: m.content } } }] };
        }
        const parts: any[] = m.content ? [{ text: m.content }] : [];
        if (m.image) parts.push({ inlineData: { mimeType: 'image/jpeg', data: m.image.split(',')[1] } });
        for (const call of m.calls || []) parts.push({ functionCall: { ...(call.idProvided === false ? {} : { id: call.id }), name: call.name, args: call.arguments }, ...(call.signature ? { thoughtSignature: call.signature } : {}) });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: parts.length ? parts : [{ text: '(빈 응답)' }] };
      });
      body = { contents, systemInstruction: { parts: [{ text: messages.filter(m => m.role === 'system').map(m => m.content).join('\n') }] }, generationConfig: { maxOutputTokens: outputTokens }, ...(definitions.length ? { tools: [{ functionDeclarations: definitions.map(({ name, description, parameters }) => ({ name, description, parametersJsonSchema: parameters })) }] } : {}) };
      url = `${API.gemini}/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`;
    } else {
      const native = messages.map(m => ({ role: m.role, content: m.image ? [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: m.image } }] : m.content,
        ...(m.callId ? { tool_call_id: m.callId } : {}), ...(m.calls?.length ? { tool_calls: m.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } : {}) }));
      body = { model: model.id, messages: native, stream: true, max_tokens: outputTokens,
        ...(definitions.length ? { tools: definitions.map(d => ({ type: 'function', function: d })), parallel_tool_calls: false } : {}),
        ...(provider === 'openrouter' ? { provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 }, allow_fallbacks: false } } : {}) };
      url = `${API[provider]}/chat/completions`;
    }
    const response = await this.request(url, { method: 'POST', headers: this.headers(provider, key), body: JSON.stringify(body) }, signal, provider);
    let text = '';
    const calls: ToolCall[] = [], partial = new Map<number, { id: string; name: string; args: string }>();
    for await (const event of sse(response)) {
      signal.throwIfAborted();
      if (event.error) throw classifyProviderError(provider, Number(event.error.code || 500), event, response.headers);
      if (provider === 'gemini') {
        const candidate = event.candidates?.[0];
        if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw Error('제공자가 응답 또는 도구 호출을 중단했습니다.');
        for (const part of candidate?.content?.parts || []) {
          if (part.text && !part.thought) { text += part.text; onText(part.text); }
          if (part.functionCall) calls.push({ id: part.functionCall.id || `call-${randomUUID()}`, idProvided: Boolean(part.functionCall.id), name: part.functionCall.name, arguments: part.functionCall.args || {}, signature: part.thoughtSignature });
        }
      } else {
        const delta = event.choices?.[0]?.delta;
        if (typeof delta?.content === 'string') { text += delta.content; onText(delta.content); }
        for (const tool of delta?.tool_calls || []) {
          const index = tool.index ?? 0;
          if (!Number.isInteger(index) || index < 0 || index > 3) throw Error('도구 호출 개수 제한을 초과했습니다.');
          const call = partial.get(index) || { id: '', name: '', args: '' };
          if (tool.id) call.id = tool.id;
          if (tool.function?.name) call.name += tool.function.name;
          if (tool.function?.arguments) call.args += tool.function.arguments;
          if (call.args.length > 16_000 || partial.size > 4) throw Error('도구 호출 크기 제한을 초과했습니다.');
          partial.set(index, call);
        }
      }
      if (text.length > 48_000 || calls.length > 4) throw Error('AI 응답 크기 제한을 초과했습니다.');
    }
    for (const call of partial.values()) {
      let args; try { args = JSON.parse(call.args || '{}'); } catch { throw Error('잘못된 도구 인수입니다. 실행하지 않았습니다.'); }
      calls.push({ id: call.id, name: call.name, arguments: args });
    }
    if (calls.length > 4 || calls.some(call => typeof call.id !== 'string' || !call.id || call.id.length > 200 || typeof call.name !== 'string' || call.name.length > 100 || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments))) throw Error('잘못된 도구 호출입니다. 실행하지 않았습니다.');
    if (!text && !calls.length) throw Error('AI 제공자가 사용할 수 있는 답변을 반환하지 않았습니다.');
    return { text, calls };
  }
}
