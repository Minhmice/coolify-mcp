import { z } from 'zod';
import { redactSecrets } from '../coolify/redaction.js';
import { CoolifyError } from '../coolify/errors.js';

export const RESOURCE_UUID_REGEX = /^[A-Za-z0-9_-]+$/;
export const resourceUuidSchema = z.string().min(1).max(128).regex(RESOURCE_UUID_REGEX);

export function assertValidResourceUuid(uuid: unknown): string {
  if (typeof uuid !== 'string' || !RESOURCE_UUID_REGEX.test(uuid)) {
    throw new CoolifyError({
      message: 'Invalid resource identifier format',
      kind: 'validation',
    });
  }
  return uuid;
}

export interface ResourceView {
  uuid: string;
  name?: string;
  status?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  metadata: Record<string, unknown>;
}

export interface TeamView {
  id: number;
  name?: string;
}

export interface OperationResult {
  resourceUuid?: string;
  operationId?: string;
  message?: string;
  status?: string;
}

export interface LogOptions {
  resourceUuid: string;
  includeSensitive?: boolean;
  confirmResourceUuid?: string;
  maxBytes?: number;
}

export interface LogResult {
  resourceUuid: string;
  requiresSensitiveOptIn: boolean;
  text?: string;
  truncated: boolean;
}

export type EnvScope =
  | { kind: 'application' | 'service' | 'database' | 'server' | 'project'; resourceUuid: string }
  | { kind: 'team' };

export interface EnvView {
  uuid?: string;
  id?: number;
  key: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
  value: '[REDACTED]';
}

export interface EnvInput {
  resourceUuid: string;
  envUuid?: string;
  key: string;
  value: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
}

export interface EnvChange {
  key: string;
  scope: string;
  changed: boolean;
}

export function normalizeResource(raw: unknown): ResourceView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CoolifyError({
      message: 'Invalid resource payload: expected an object',
      kind: 'validation',
    });
  }

  const obj = raw as Record<string, unknown>;
  const rawUuid = obj.uuid ?? obj.id;
  if (typeof rawUuid !== 'string' || !RESOURCE_UUID_REGEX.test(rawUuid)) {
    throw new CoolifyError({
      message: 'Invalid resource identifier in payload',
      kind: 'validation',
    });
  }

  const name = typeof obj.name === 'string' ? obj.name : undefined;
  const status = typeof obj.status === 'string' ? obj.status : undefined;
  const createdAt =
    typeof obj.created_at === 'string' || typeof obj.created_at === 'number'
      ? obj.created_at
      : typeof obj.createdAt === 'string' || typeof obj.createdAt === 'number'
        ? obj.createdAt
        : undefined;
  const updatedAt =
    typeof obj.updated_at === 'string' || typeof obj.updated_at === 'number'
      ? obj.updated_at
      : typeof obj.updatedAt === 'string' || typeof obj.updatedAt === 'number'
        ? obj.updatedAt
        : undefined;

  const metadata = (redactSecrets(obj) as Record<string, unknown>) ?? {};

  return {
    uuid: rawUuid,
    name,
    status,
    createdAt,
    updatedAt,
    metadata,
  };
}

export function normalizeTeam(raw: unknown): TeamView {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CoolifyError({
      message: 'Invalid team payload: expected an object',
      kind: 'validation',
    });
  }

  const obj = raw as Record<string, unknown>;
  const parsedId = typeof obj.id === 'number' ? obj.id : Number.parseInt(String(obj.id), 10);
  if (Number.isNaN(parsedId)) {
    throw new CoolifyError({
      message: 'Invalid team id in payload',
      kind: 'validation',
    });
  }

  return {
    id: parsedId,
    name: typeof obj.name === 'string' ? obj.name : undefined,
  };
}

export function normalizeOperation(raw: unknown): OperationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  return {
    resourceUuid:
      typeof obj.resourceUuid === 'string'
        ? obj.resourceUuid
        : typeof obj.uuid === 'string'
          ? obj.uuid
          : undefined,
    operationId:
      typeof obj.operationId === 'string'
        ? obj.operationId
        : typeof obj.operation_id === 'string'
          ? obj.operation_id
          : typeof obj.id === 'string' || typeof obj.id === 'number'
            ? String(obj.id)
            : undefined,
    message: typeof obj.message === 'string' ? obj.message : undefined,
    status: typeof obj.status === 'string' ? obj.status : undefined,
  };
}
