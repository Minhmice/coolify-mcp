import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { assertEnvDeleteConfirmation } from '../policy.js';
import {
  type EnvChange,
  type EnvInput,
  type EnvScope,
  type EnvView,
  assertValidResourceUuid,
} from './types.js';

export async function listEnvironmentVariables(
  client: Pick<CoolifyClient, 'request'>,
  scope: EnvScope,
): Promise<EnvView[]> {
  const route =
    scope.kind === 'team'
      ? '/team/envs'
      : `/${scope.kind === 'project' ? 'projects' : scope.kind === 'application' ? 'applications' : scope.kind === 'service' ? 'services' : scope.kind === 'database' ? 'databases' : 'servers'}/${assertValidResourceUuid(scope.resourceUuid)}/envs`;

  const data = await client.request('GET', route);
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid environment variables payload: expected an array',
      kind: 'validation',
    });
  }

  return data.map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CoolifyError({
        message: 'Invalid environment variable item: expected an object',
        kind: 'validation',
      });
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.key !== 'string' || obj.key.trim().length === 0) {
      throw new CoolifyError({
        message: 'Environment variable item missing non-empty key',
        kind: 'validation',
      });
    }

    const uuid = typeof obj.uuid === 'string' ? obj.uuid : undefined;
    const parsedId =
      typeof obj.id === 'number'
        ? obj.id
        : typeof obj.id === 'string'
          ? Number.parseInt(obj.id, 10)
          : undefined;
    const id = parsedId !== undefined && !Number.isNaN(parsedId) ? parsedId : undefined;

    const isPreview =
      typeof obj.is_preview === 'boolean'
        ? obj.is_preview
        : typeof obj.isPreview === 'boolean'
          ? obj.isPreview
          : undefined;

    const isRuntime =
      typeof obj.is_runtime === 'boolean'
        ? obj.is_runtime
        : typeof obj.isRuntime === 'boolean'
          ? obj.isRuntime
          : undefined;

    const isBuildtime =
      typeof obj.is_buildtime === 'boolean'
        ? obj.is_buildtime
        : typeof obj.isBuildtime === 'boolean'
          ? obj.isBuildtime
          : undefined;

    const isLiteral =
      typeof obj.is_literal === 'boolean'
        ? obj.is_literal
        : typeof obj.isLiteral === 'boolean'
          ? obj.isLiteral
          : undefined;

    const isMultiline =
      typeof obj.is_multiline === 'boolean'
        ? obj.is_multiline
        : typeof obj.isMultiline === 'boolean'
          ? obj.isMultiline
          : undefined;

    return {
      uuid,
      id,
      key: obj.key,
      isPreview,
      isRuntime,
      isBuildtime,
      isLiteral,
      isMultiline,
      value: '[REDACTED]' as const,
    };
  });
}

export async function getEnvironmentVariable(
  client: Pick<CoolifyClient, 'request'>,
  scope: EnvScope,
  envUuid: string,
): Promise<EnvView> {
  assertValidResourceUuid(envUuid);
  const list = await listEnvironmentVariables(client, scope);
  const found = list.find(
    (item) => item.uuid === envUuid || (item.id !== undefined && String(item.id) === envUuid),
  );
  if (!found) {
    throw new CoolifyError({
      message: 'Environment variable not found',
      kind: 'not_found',
      status: 404,
    });
  }
  return found;
}

export async function setApplicationEnvironmentVariable(
  client: Pick<CoolifyClient, 'request'>,
  input: EnvInput,
): Promise<EnvChange> {
  const resourceUuid = assertValidResourceUuid(input.resourceUuid);
  if (input.envUuid !== undefined) {
    assertValidResourceUuid(input.envUuid);
  }
  if (typeof input.key !== 'string' || input.key.trim().length === 0) {
    throw new CoolifyError({
      message: 'Environment variable key must be a non-empty string',
      kind: 'validation',
    });
  }
  if (typeof input.value !== 'string') {
    throw new CoolifyError({
      message: 'Environment variable value must be a string',
      kind: 'validation',
    });
  }

  const body: Record<string, unknown> = {
    key: input.key,
    value: input.value,
  };
  if (input.isPreview !== undefined) body.is_preview = input.isPreview;
  if (input.isLiteral !== undefined) body.is_literal = input.isLiteral;
  if (input.isMultiline !== undefined) body.is_multiline = input.isMultiline;
  if (input.isRuntime !== undefined) body.is_runtime = input.isRuntime;
  if (input.isBuildtime !== undefined) body.is_buildtime = input.isBuildtime;

  if (input.envUuid) {
    await client.request('PATCH', `/applications/${resourceUuid}/envs`, {
      body,
      secretValues: [input.value],
    });
  } else {
    await client.request('POST', `/applications/${resourceUuid}/envs`, {
      body,
      secretValues: [input.value],
    });
  }

  return {
    key: input.key,
    scope: 'application',
    changed: true,
  };
}

export async function deleteApplicationEnvironmentVariable(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  envUuid: string,
  confirmResourceUuid: string,
  confirmEnvUuid: string,
): Promise<EnvChange> {
  assertEnvDeleteConfirmation(resourceUuid, envUuid, confirmResourceUuid, confirmEnvUuid);
  await client.request('DELETE', `/applications/${resourceUuid}/envs/${envUuid}`);
  return {
    key: envUuid,
    scope: 'application',
    changed: true,
  };
}
