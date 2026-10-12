import type { AppConfig } from '../config.js';
import type { CoolifyClient } from '../coolify/client.js';
import { limitText, redactSecrets } from '../coolify/redaction.js';
import { type LogOptions, type LogResult, assertValidResourceUuid } from './types.js';

function extractText(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.logs === 'string') return obj.logs;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.output === 'string') return obj.output;
    if (typeof obj.message === 'string') return obj.message;
    return JSON.stringify(obj);
  }
  if (raw === undefined || raw === null) {
    return '';
  }
  return String(raw);
}

export async function getApplicationLogs(
  client: Pick<CoolifyClient, 'request'>,
  config: AppConfig,
  options: LogOptions,
): Promise<LogResult> {
  const uuid = assertValidResourceUuid(options.resourceUuid);

  const hasOptIn = options.includeSensitive === true && options.confirmResourceUuid === uuid;
  if (!hasOptIn) {
    return {
      resourceUuid: uuid,
      requiresSensitiveOptIn: true,
      truncated: false,
    };
  }

  const raw = await client.request('GET', `/applications/${uuid}/logs`);
  const rawText = extractText(raw);
  const scrubbed = String(redactSecrets(rawText));
  const maxBytes =
    options.maxBytes !== undefined
      ? Math.max(0, Math.min(options.maxBytes, config.maxLogBytes))
      : config.maxLogBytes;

  const { text, truncated } = limitText(scrubbed, maxBytes);
  return {
    resourceUuid: uuid,
    requiresSensitiveOptIn: false,
    text,
    truncated,
  };
}

export async function getDeploymentLogs(
  client: Pick<CoolifyClient, 'request'>,
  config: AppConfig,
  options: LogOptions,
): Promise<LogResult> {
  const uuid = assertValidResourceUuid(options.resourceUuid);

  const hasOptIn = options.includeSensitive === true && options.confirmResourceUuid === uuid;
  if (!hasOptIn) {
    return {
      resourceUuid: uuid,
      requiresSensitiveOptIn: true,
      truncated: false,
    };
  }

  const raw = await client.request('GET', `/deployments/${uuid}`);
  let rawLogs = '';
  if (typeof raw === 'object' && raw !== null && 'logs' in raw) {
    const logsField = (raw as Record<string, unknown>).logs;
    rawLogs =
      typeof logsField === 'string'
        ? logsField
        : logsField !== null && logsField !== undefined
          ? JSON.stringify(logsField)
          : '';
  } else {
    rawLogs = extractText(raw);
  }

  const scrubbed = String(redactSecrets(rawLogs));
  const maxBytes =
    options.maxBytes !== undefined
      ? Math.max(0, Math.min(options.maxBytes, config.maxLogBytes))
      : config.maxLogBytes;

  const { text, truncated } = limitText(scrubbed, maxBytes);
  return {
    resourceUuid: uuid,
    requiresSensitiveOptIn: false,
    text,
    truncated,
  };
}
