import type { AppConfig } from '../config.js';
import { MAX_JSON_RESPONSE_BYTES } from '../config.js';
import { CoolifyError, mapStatusToKind, parseRetryAfter } from './errors.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  readonly query?: Record<string, string | number | boolean>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly secretValues?: readonly string[];
}

export class CoolifyClient {
  private readonly config: AppConfig;
  private readonly transport: typeof fetch;

  constructor(config: AppConfig, transport: typeof fetch = fetch) {
    this.config = config;
    this.transport = transport;
  }

  async request(method: HttpMethod, path: string, options?: RequestOptions): Promise<unknown> {
    const knownSecrets = [this.config.token, ...(options?.secretValues ?? [])];

    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      throw new CoolifyError({
        kind: 'validation',
        message: 'Invalid request path: must be a relative path starting with /',
        knownSecrets,
      });
    }

    const segments = path.split('/');
    if (segments.includes('..')) {
      throw new CoolifyError({
        kind: 'validation',
        message: 'Invalid request path: path traversal is not allowed',
        knownSecrets,
      });
    }

    const baseOrigin = new URL(this.config.baseUrl).origin;
    const prefix = this.config.apiPrefix.endsWith('/')
      ? this.config.apiPrefix.slice(0, -1)
      : this.config.apiPrefix;
    const fullPath = `${prefix}${path}`;
    const url = new URL(fullPath, this.config.baseUrl);

    if (url.origin !== baseOrigin) {
      throw new CoolifyError({
        kind: 'validation',
        message: 'Invalid request path: origin mismatch',
        knownSecrets,
      });
    }

    if (options?.query) {
      for (const [key, val] of Object.entries(options.query)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const headers = new Headers();
    headers.set('authorization', `Bearer ${this.config.token}`);
    headers.set('accept', 'application/json');

    let bodyPayload: string | undefined;
    if (options?.body !== undefined) {
      headers.set('content-type', 'application/json');
      bodyPayload = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let timedOut = false;

    if (this.config.requestTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException('Request timed out', 'TimeoutError'));
      }, this.config.requestTimeoutMs);
    }

    const onExternalAbort = () => {
      controller.abort(options?.signal?.reason);
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    try {
      const response = await this.transport(url.toString(), {
        method,
        headers,
        body: bodyPayload,
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.status >= 300 && response.status < 400) {
        throw new CoolifyError({
          kind: 'network',
          message: `Unexpected redirect response (${response.status}) with redirect: 'error'`,
          status: response.status,
          retryable: true,
          knownSecrets,
        });
      }

      if (response.status === 204) {
        return undefined;
      }

      const maxBytes = options?.maxBytes ?? MAX_JSON_RESPONSE_BYTES;
      const contentLengthHeader = response.headers.get('content-length');
      if (contentLengthHeader) {
        const parsedLength = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(parsedLength) && parsedLength > maxBytes) {
          throw new CoolifyError({
            kind: 'oversized',
            message: `Response Content-Length (${parsedLength}) exceeds limit of ${maxBytes} bytes`,
            status: response.status,
            retryable: false,
            knownSecrets,
          });
        }
      }

      let rawText = '';
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              await reader.cancel();
              throw new CoolifyError({
                kind: 'oversized',
                message: `Response size exceeds limit of ${maxBytes} bytes`,
                status: response.status,
                retryable: false,
                knownSecrets,
              });
            }
            chunks.push(value);
          }
        }
        rawText = Buffer.concat(chunks).toString('utf8');
      } else {
        rawText = await response.text();
        if (Buffer.byteLength(rawText, 'utf8') > maxBytes) {
          throw new CoolifyError({
            kind: 'oversized',
            message: `Response size exceeds limit of ${maxBytes} bytes`,
            status: response.status,
            retryable: false,
            knownSecrets,
          });
        }
      }

      if (!response.ok) {
        const kind = mapStatusToKind(response.status);
        const retryAfter = kind === 'rate_limited'
          ? parseRetryAfter(response.headers.get('retry-after'))
          : undefined;

        let errorDetails: unknown = rawText;
        let errorMessage = `Coolify API error: HTTP ${response.status}`;

        if (rawText.trim().length > 0) {
          try {
            const parsed = JSON.parse(rawText) as Record<string, unknown>;
            errorDetails = parsed;
            if (typeof parsed?.message === 'string') {
              errorMessage = parsed.message;
            } else if (typeof parsed?.error === 'string') {
              errorMessage = parsed.error;
            }
          } catch {
            // Keep rawText as errorDetails
          }
        }

        throw new CoolifyError({
          kind,
          status: response.status,
          retryAfter,
          message: errorMessage,
          details: errorDetails,
          knownSecrets,
        });
      }

      if (rawText.trim().length === 0) {
        return undefined;
      }

      try {
        return JSON.parse(rawText);
      } catch (err) {
        throw new CoolifyError({
          kind: 'server_error',
          status: response.status,
          message: 'Failed to parse JSON response from Coolify API',
          details: rawText,
          knownSecrets,
          cause: err,
        });
      }
    } catch (err) {
      if (err instanceof CoolifyError) {
        throw err;
      }

      if (timedOut) {
        throw new CoolifyError({
          kind: 'timeout',
          message: 'Request timed out',
          retryable: true,
          knownSecrets,
          cause: err,
        });
      }

      if (options?.signal?.aborted) {
        throw new CoolifyError({
          kind: 'timeout',
          message: 'Request was aborted',
          retryable: false,
          knownSecrets,
          cause: err,
        });
      }

      const errName = (err as Error)?.name;
      if (errName === 'TimeoutError') {
        throw new CoolifyError({
          kind: 'timeout',
          message: 'Request timed out',
          retryable: true,
          knownSecrets,
          cause: err,
        });
      }

      if (errName === 'AbortError') {
        throw new CoolifyError({
          kind: 'timeout',
          message: 'Request was aborted',
          retryable: false,
          knownSecrets,
          cause: err,
        });
      }

      throw new CoolifyError({
        kind: 'network',
        message: (err as Error)?.message || 'Network request failed',
        retryable: true,
        knownSecrets,
        cause: err,
      });
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }
}
