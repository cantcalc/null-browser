export const TRANSLATION_LIMITS = Object.freeze({
  maxTranslatableNodes: 1000,
  maxTextChars: 1500,
  maxTextsPerRequest: 8,
  maxRequestChars: 1500,
  maxConcurrentRequests: 3,
});

export type TranslationErrorCode =
  | 'http_403'
  | 'http_429'
  | 'http_error'
  | 'timeout'
  | 'network'
  | 'parse'
  | 'empty'
  | 'invalid_response';

export class TranslationError extends Error {
  public readonly code: TranslationErrorCode;
  public readonly status?: number;

  constructor(code: TranslationErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeTranslationError(error: unknown): TranslationError {
  if (error instanceof TranslationError) return error;
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'AbortError') {
    return new TranslationError('timeout', '온라인 번역 요청 시간이 초과되었습니다.');
  }
  return new TranslationError('network', '온라인 번역 서비스를 사용할 수 없습니다.');
}
