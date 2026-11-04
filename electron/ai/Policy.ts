import type { AIProvider } from '../../shared/ai';
import { lookup } from 'node:dns/promises';

export function redact(value: string): string {
  return value.replace(/\bBearer\s+[^\s<>]+/gi, '[인증 정보 제외]')
    .replace(/\b(?:sk-[\w-]{12,}|AIza[\w-]{16,}|gsk_[\w-]{12,}|gh[pousr]_[\w]{20,}|github_pat_[\w]{20,}|xox[baprs]-[\w-]{12,}|ya29\.[\w-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[인증 정보 제외]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[개인 키 제외]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[이메일 제외]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[숫자 정보 제외]')
    .replace(/\b(?:0\d{1,2}[- .]\d{3,4}|\d{3}[- .]\d{3})[- .]\d{4}\b/g, '[전화번호 제외]')
    .replace(/\b(?:password|passwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s,;<>]+/gi, '[민감 정보 제외]');
}
export function publicURL(value: string): string {
  try {
    const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol)) return '';
    u.username = ''; u.password = ''; u.search = ''; u.hash = '';
    const decoded = decodeURIComponent(u.pathname);
    if (redact(decoded) !== decoded) u.pathname = '/';
    return u.href;
  } catch { return ''; }
}
export function isWebURL(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
export function isAgentURL(value: unknown): value is string {
  if (!isWebURL(value)) return false;
  const host = new URL(value).hostname.toLowerCase();
  return !/^(?:localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|2130706433$)/.test(host) && !/\.(?:localhost|local|internal)$/.test(host);
}
function publicAddress(address: string) {
  if (address.includes(':')) return !/^(?:f[cd]|fe[89ab]|ff|::|0+:)/i.test(address);
  const parts = address.split('.').map(Number), [a, b] = parts;
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
    !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b)));
}
export async function requirePublicAgentURL(value: unknown, signal: AbortSignal) {
  if (!isAgentURL(value)) throw Error('공개 웹 주소로만 이동할 수 있습니다.');
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout>;
  try {
    const addresses = await Promise.race([
      lookup(new URL(value).hostname, { all: true }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('주소를 확인하지 못했습니다.')), 5000); }),
    ]);
    signal.throwIfAborted();
    if (!addresses.length || !addresses.every(item => publicAddress(item.address))) throw Error('비공개 네트워크 주소에 접근하지 않았습니다.');
  } finally { clearTimeout(timer!); }
  return value;
}
export const consequential = /(?:\b(?:delete|remove|destroy|log\s*out|sign\s*out|checkout|purchase|payment|buy|subscribe|unsubscribe|send|publish|post|upload|transfer|save|authorize|connect|grant|revoke|follow|unfollow|like|unlike|allow|accept|install)\b|삭제|전송|보내|등록|구매|결제|게시|구독|동의|허용|좋아요|저장(?!소))/i;
export function riskyNavigation(value: string) {
  try {
    const url = new URL(value);
    const segments = decodeURIComponent(url.pathname).split(/[\/._-]+/);
    return segments.some(segment => /^(?:delete|remove|destroy|logout|signout|checkout|purchase|payment|subscribe|unsubscribe|send|publish|authorize|grant|revoke|reset|삭제|결제|전송|허용)$/i.test(segment)) ||
      /\.(?:exe|dmg|pkg|msi|zip|crx|sh|bat|cmd|ps1)(?:$|\/)/i.test(url.pathname) ||
      [...url.searchParams.keys()].some(key => /^(?:action|op|operation|cmd|command|execute|delete|remove|destroy|update|save|send|submit|confirm|checkout|purchase|pay|logout|authorize|grant|revoke|token|password|secret|code)$/i.test(key));
  } catch { return true; }
}

export function requiresInteractionApproval(element: { label: string; href?: string; downloadName?: string; submit?: boolean; formMethod?: string; formAction?: string; searchControl?: boolean; context?: string; role?: string }) {
  if (consequential.test(element.label)) return true;
  if (element.href && riskyNavigation(element.href)) return true;
  if (element.submit && element.formAction && riskyNavigation(element.formAction)) return true;
  if (element.downloadName && /\.(?:exe|dmg|pkg|msi|zip|crx|sh|bat|cmd|ps1)$/i.test(element.downloadName)) return true;
  // Search submits and ordinary UI controls are already authorized by the
  // task. A generic write-form submission remains a distinct external action.
  if (element.submit && element.formMethod !== 'get' && !element.searchControl) return true;
  if (/^(?:ok|yes|confirm|continue|submit|done|proceed|확인|예|계속|완료|진행)(?:\s|$)/i.test(element.label.trim()) && !element.searchControl) return true;
  if (/switch|checkbox/i.test(element.role || '') && /security|password|permission|privacy|2fa|two.factor|보안|비밀번호|권한|개인정보/i.test(element.context || '')) return true;
  return !element.label.trim() && !element.searchControl;
}

// A named site's public landing page is already within a request mentioning
// that site. This never authorizes a different host, query, or action path.
export function requestedHomepage(value: string, request: string) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^www\./,'').toLowerCase();
    if (url.pathname !== '/' || url.search || url.hash || !isAgentURL(value)) return false;
    if (request.toLowerCase().includes(host)) return true;
    const names: Record<string, RegExp> = {
      'youtube.com': /유튜브|\byoutube\b/i, 'google.com': /구글|\bgoogle\b/i,
      'github.com': /깃허브|깃헙|\bgithub\b/i, 'naver.com': /네이버|\bnaver\b/i,
      'chatgpt.com': /챗지피티|챗GPT|\bchatgpt\b/i,
    };
    return names[host]?.test(request) === true;
  } catch { return false; }
}
export function requestedDestination(request: string): { hostname: string; pathname: string } | undefined {
  const match = request.trim().match(/^(?:(?:please|지금|그냥|좀)\s*)?(?:(?:open|visit|go to)\s+(.+?)|(.+?)\s*(?:열어|켜|띄워|접속해|이동해)\s*(?:줘|주세요|줄래|요)?)[.!?]*$/i);
  if (!match) return;
  let target = (match[1] || match[2]).trim().replace(/\s*(?:please|사이트|홈페이지|페이지|좀)$/i,'').trim();
  const names: Record<string,string> = { '유튜브':'https://www.youtube.com/',youtube:'https://www.youtube.com/','구글':'https://www.google.com/',google:'https://www.google.com/','깃허브':'https://github.com/','깃헙':'https://github.com/',github:'https://github.com/','네이버':'https://www.naver.com/',naver:'https://www.naver.com/',chatgpt:'https://chatgpt.com/','챗지피티':'https://chatgpt.com/' };
  target = names[target.toLowerCase()] || target;
  if (/\s/.test(target)) return;
  if (!isAgentURL(target)) return;
  const url = new URL(target);
  return { hostname:url.hostname.replace(/^www\./,''),pathname:url.pathname };
}

export class ProviderError extends Error {
  constructor(public kind: 'quota' | 'auth' | 'network' | 'server' | 'invalid', public provider: AIProvider, message: string) { super(message); }
}
export function classifyProviderError(provider: AIProvider, status: number, body: any, headers: Headers): ProviderError {
  const error = body?.error || body || {};
  const message = String(error.message || '');
  let quota = false;
  if (status === 429 && !/capacity|overload|ddos|temporar(?:y|ily) unavailable/i.test(message)) {
    if (provider === 'gemini') quota = error.status === 'RESOURCE_EXHAUSTED' && (
      error.details?.some((d: any) => String(d['@type']).endsWith('QuotaFailure') && d.violations?.some((v: any) => /request|token/i.test(String(v.quotaMetric || v.quotaId)))) || /quota.*(?:request|token)|(?:request|token).*quota/i.test(message));
    if (provider === 'groq') quota = error.code === 'rate_limit_exceeded' && /request|token/i.test(message);
    if (provider === 'openrouter') quota = /free[_ -]model|free-models|requests? per|tokens? per|daily.*limit|rate.limit.*(?:request|token)/i.test(message + ' ' + String(error.metadata?.limit_source || '')) && (headers.has('x-ratelimit-limit') || /free|request|token/i.test(String(error.metadata?.limit_source || message)));
  }
  const invalidKey = error.details?.some?.((detail: any) => detail.reason === 'API_KEY_INVALID') || /api key (?:not valid|is invalid)/i.test(message);
  const kind = quota ? 'quota' : status === 401 || status === 403 || invalidKey ? 'auth' : status >= 500 ? 'server' : 'invalid';
  const safe = quota ? '제공자가 요청량 또는 토큰 한도 초과를 반환했습니다.' : kind === 'auth' ? 'API 키 또는 접근 권한을 확인해 주세요.' : status === 402 ? '계정 크레딧 또는 결제 제한입니다. 다른 모델로 자동 전환하지 않았습니다.' : kind === 'server' ? '제공자 서버 오류입니다. 잠시 후 다시 시도해 주세요.' : `AI 요청을 처리하지 못했습니다 (HTTP ${status}).`;
  return new ProviderError(kind, provider, safe);
}

// Pricing must explicitly state zero/free in the Standard input AND output
// cells. Batch/Priority tables, prose and links to replacement models cannot
// accidentally classify a paid Standard model as free.
export function geminiFreeCatalog(markdown: string): Set<string> {
  const result = new Set<string>();
  const sections = markdown.split(/^## /m).slice(1);
  for (const section of sections) {
    const id = section.match(/\{% id="([a-z0-9.-]+)"/i)?.[1];
    const standard = section.match(/\{% tab title="Standard" %\}([\s\S]*?)\{% \/tab %\}/)?.[1];
    if (!id?.startsWith('gemini-') || /tts|audio|live|transcrib|translate|image|robotics/i.test(id) || !standard) continue;
    const free = /\* Input price[^\n]*\n\s*\* Free of charge\s*\n/.test(standard) && /\* Output price[^\n]*\n\s*\* Free of charge\s*\n/.test(standard);
    if (free) result.add(id);
  }
  return result;
}
export function groqFreeCatalog(html: string): Set<string> {
  const first = html.slice(html.indexOf('Free Plan Limits')).match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1] || '';
  return new Set(Array.from(first.matchAll(/<tr[^>]*>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/g), m => m[1].replace(/<[^>]*>/g, '').trim()).filter(id => /^[a-z0-9/._-]+$/.test(id)));
}
