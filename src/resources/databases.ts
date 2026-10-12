import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { assertDeleteConfirmation } from '../policy.js';
import {
  type CreateDatabaseInput,
  type OperationResult,
  type ResourceView,
  type UpdateDatabaseInput,
  assertValidResourceUuid,
  createDatabaseSchema,
  normalizeOperation,
  normalizeResource,
  toSnakeCaseRecord,
  updateDatabaseSchema,
} from './types.js';

export async function listDatabases(client: Pick<CoolifyClient, 'request'>): Promise<ResourceView[]> {
  const data = await client.request('GET', '/databases');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid databases payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeResource);
}

export async function getDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<ResourceView> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/databases/${uuid}`);
  return normalizeResource(data);
}

export async function createDatabase(
  client: Pick<CoolifyClient, 'request'>,
  input: CreateDatabaseInput,
): Promise<OperationResult> {
  const validated = createDatabaseSchema.parse(input);
  const { type, ...rest } = validated;

  const projectUuid = rest.project_uuid ?? rest.projectUuid;
  if (!projectUuid) {
    throw new CoolifyError({
      message: 'project_uuid is required to create a database',
      kind: 'validation',
    });
  }

  const serverUuid = rest.server_uuid ?? rest.serverUuid;
  if (!serverUuid) {
    throw new CoolifyError({
      message: 'server_uuid is required to create a database',
      kind: 'validation',
    });
  }

  const body = toSnakeCaseRecord(rest as Record<string, unknown>);

  // Collect potential database secrets for scrubbing
  const secretValues: string[] = [];
  for (const [key, val] of Object.entries(body)) {
    if (typeof val === 'string' && key.toLowerCase().includes('password')) {
      secretValues.push(val);
    }
  }

  const data = await client.request('POST', `/databases/${type}`, {
    body,
    secretValues: secretValues.length > 0 ? secretValues : undefined,
  });
  return normalizeOperation(data);
}

export async function updateDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  input: UpdateDatabaseInput,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const validated = updateDatabaseSchema.parse(input);
  const body = toSnakeCaseRecord(validated as Record<string, unknown>);
  const data = await client.request('PATCH', `/databases/${uuid}`, { body });
  return normalizeOperation(data);
}

export async function deleteDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  confirmResourceUuid: string,
): Promise<OperationResult> {
  assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
  const data = await client.request('DELETE', `/databases/${resourceUuid}`);
  return normalizeOperation(data);
}

export async function startDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/databases/${uuid}/start`);
  return normalizeOperation(data);
}

export async function restartDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/databases/${uuid}/restart`);
  return normalizeOperation(data);
}

export async function stopDatabase(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/databases/${uuid}/stop`);
  return normalizeOperation(data);
}
