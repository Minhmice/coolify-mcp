import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { type EnvScope, type EnvView, assertValidResourceUuid } from './types.js';

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
        message: 'Invalid environment variable item: missing key',
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

    return {
      uuid,
      id,
      key: obj.key,
      isPreview:
        typeof obj.is_preview === 'boolean'
          ? obj.is_preview
          : typeof obj.isPreview === 'boolean'
            ? obj.isPreview
            : undefined,
      isRuntime:
        typeof obj.is_runtime === 'boolean'
          ? obj.is_runtime
          : typeof obj.isRuntime === 'boolean'
            ? obj.isRuntime
            : undefined,
      isBuildtime:
        typeof obj.is_buildtime === 'boolean'
          ? obj.is_buildtime
          : typeof obj.isBuildtime === 'boolean'
            ? obj.isBuildtime
            : undefined,
      isLiteral:
        typeof obj.is_literal === 'boolean'
          ? obj.is_literal
          : typeof obj.isLiteral === 'boolean'
            ? obj.isLiteral
            : undefined,
      isMultiline:
        typeof obj.is_multiline === 'boolean'
          ? obj.is_multiline
          : typeof obj.isMultiline === 'boolean'
            ? obj.isMultiline
            : undefined,
      value: '[REDACTED]',
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
