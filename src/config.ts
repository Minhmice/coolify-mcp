export interface AppConfig {
  readonly baseUrl: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
  readonly maxLogBytes: number;
  readonly apiPrefix: string;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_LOG_BYTES = 65_536;
export const DEFAULT_API_PREFIX = '/api/v1';
export const MAX_JSON_RESPONSE_BYTES = 1_048_576;

const MIN_REQUEST_TIMEOUT_MS = 1;
const MAX_REQUEST_TIMEOUT_MS = 120_000;
const MIN_LOG_BYTES = 1;
const MAX_LOG_BYTES = 1_048_576;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawUrl = env.COOLIFY_URL?.trim();
  if (!rawUrl) {
    throw new Error('COOLIFY_URL is required and cannot be empty');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error('COOLIFY_URL must be a valid URL');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('COOLIFY_URL must use HTTPS protocol');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('COOLIFY_URL must not contain userinfo');
  }

  if (parsedUrl.search) {
    throw new Error('COOLIFY_URL must not contain query parameters');
  }

  if (parsedUrl.hash) {
    throw new Error('COOLIFY_URL must not contain a URL hash fragment');
  }

  if (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '') {
    throw new Error('COOLIFY_URL must not contain a path component');
  }

  const rawToken = env.COOLIFY_TOKEN;
  if (!rawToken || rawToken.trim() === '') {
    throw new Error('COOLIFY_TOKEN is required and cannot be empty');
  }

  if (rawToken.includes('\r') || rawToken.includes('\n')) {
    throw new Error('COOLIFY_TOKEN must not contain carriage return or newline characters');
  }

  const token = rawToken.trim();

  let apiPrefix = DEFAULT_API_PREFIX;
  const rawPrefix = env.COOLIFY_API_PREFIX?.trim();
  if (rawPrefix) {
    if (rawPrefix.startsWith('//') || rawPrefix.startsWith('\\\\')) {
      throw new Error('COOLIFY_API_PREFIX must not be protocol-relative');
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawPrefix)) {
      throw new Error('COOLIFY_API_PREFIX must not be an absolute URL');
    }
    if (rawPrefix.split('/').some((segment) => segment === '..') || rawPrefix.includes('..')) {
      throw new Error('COOLIFY_API_PREFIX must not contain path traversal');
    }

    const withLeading = rawPrefix.startsWith('/') ? rawPrefix : `/${rawPrefix}`;
    apiPrefix = withLeading.replace(/\/+$/, '') || '';
  }

  let requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
  const rawTimeout = env.COOLIFY_REQUEST_TIMEOUT_MS?.trim();
  if (rawTimeout) {
    if (!/^\d+$/.test(rawTimeout)) {
      throw new Error(
        `COOLIFY_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}`,
      );
    }
    requestTimeoutMs = Number.parseInt(rawTimeout, 10);
    if (requestTimeoutMs < MIN_REQUEST_TIMEOUT_MS || requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS) {
      throw new Error(
        `COOLIFY_REQUEST_TIMEOUT_MS must be an integer between ${MIN_REQUEST_TIMEOUT_MS} and ${MAX_REQUEST_TIMEOUT_MS}`,
      );
    }
  }

  let maxLogBytes = DEFAULT_MAX_LOG_BYTES;
  const rawLogBytes = env.COOLIFY_MAX_LOG_BYTES?.trim();
  if (rawLogBytes) {
    if (!/^\d+$/.test(rawLogBytes)) {
      throw new Error(`COOLIFY_MAX_LOG_BYTES must be an integer between ${MIN_LOG_BYTES} and ${MAX_LOG_BYTES}`);
    }
    maxLogBytes = Number.parseInt(rawLogBytes, 10);
    if (maxLogBytes < MIN_LOG_BYTES || maxLogBytes > MAX_LOG_BYTES) {
      throw new Error(`COOLIFY_MAX_LOG_BYTES must be an integer between ${MIN_LOG_BYTES} and ${MAX_LOG_BYTES}`);
    }
  }

  return Object.freeze({
    baseUrl: `${parsedUrl.origin}/`,
    token,
    requestTimeoutMs,
    maxLogBytes,
    apiPrefix,
  });
}
