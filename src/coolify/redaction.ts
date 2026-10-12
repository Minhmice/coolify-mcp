const SECRET_KEY_PATTERN = /token|password|secret|private_key|key|auth|credential/i;
const COMPOSE_KEY_PATTERN = /(?:docker_)?compose(?:_raw)?/i;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9_\-.~+/]+=*/gi;

function scrubString(str: string, knownSecrets?: readonly string[]): string {
  let result = str.replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
  if (knownSecrets && knownSecrets.length > 0) {
    const validSecrets = knownSecrets
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      .sort((a, b) => b.length - a.length);

    for (const secret of validSecrets) {
      result = result.replaceAll(secret, '[REDACTED]');
    }
  }
  return result;
}

export function redactSecrets(value: unknown, knownSecrets?: readonly string[]): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return scrubString(value, knownSecrets);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, knownSecrets));
  }

  if (value instanceof Error) {
    const scrubbedMsg = scrubString(value.message, knownSecrets);
    const scrubbedErr = new Error(scrubbedMsg);
    scrubbedErr.name = value.name;
    if (value.cause !== undefined) {
      scrubbedErr.cause = redactSecrets(value.cause, knownSecrets);
    }
    return scrubbedErr;
  }

  const obj = value as Record<string, unknown>;
  const isEnvVar = 'key' in obj && ('value' in obj || 'real_value' in obj);
  const result: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (isEnvVar && k === 'key') {
      result[k] = redactSecrets(v, knownSecrets);
    } else if (isEnvVar && (k === 'value' || k === 'real_value')) {
      result[k] = '[REDACTED]';
    } else if (SECRET_KEY_PATTERN.test(k) || COMPOSE_KEY_PATTERN.test(k)) {
      result[k] = '[REDACTED]';
    } else {
      result[k] = redactSecrets(v, knownSecrets);
    }
  }

  return result;
}

export function limitText(value: string, maxBytes: number): { text: string; truncated: boolean } {
  if (maxBytes <= 0) {
    return { text: '', truncated: value.length > 0 };
  }

  const buf = Buffer.from(value, 'utf8');
  if (buf.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) {
    end--;
  }

  return {
    text: buf.subarray(0, end).toString('utf8'),
    truncated: true,
  };
}
