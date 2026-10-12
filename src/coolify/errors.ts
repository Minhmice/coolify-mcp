import { redactSecrets } from './redaction.js';

export type CoolifyErrorKind =
  | 'config'
  | 'auth'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server_error'
  | 'timeout'
  | 'network'
  | 'oversized';

export interface CoolifyErrorOptions {
  message: string;
  kind: CoolifyErrorKind;
  status?: number;
  retryAfter?: string;
  retryable?: boolean;
  details?: unknown;
  cause?: unknown;
  knownSecrets?: readonly string[];
}

export class CoolifyError extends Error {
  readonly kind: CoolifyErrorKind;
  readonly status?: number;
  readonly retryAfter?: string;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(options: CoolifyErrorOptions) {
    const scrubbedMessage = String(redactSecrets(options.message, options.knownSecrets));
    super(scrubbedMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CoolifyError';
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.retryable = options.retryable ?? (
      options.kind === 'rate_limited' ||
      options.kind === 'server_error' ||
      options.kind === 'timeout' ||
      options.kind === 'network'
    );
    this.details = options.details !== undefined
      ? redactSecrets(options.details, options.knownSecrets)
      : undefined;
  }
}


export function mapStatusToKind(status: number): CoolifyErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'validation';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status <= 599) return 'server_error';
  return 'validation';
}

export function parseRetryAfter(headerValue: string | null | undefined): string | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return trimmed;
  }
  return undefined;
}
