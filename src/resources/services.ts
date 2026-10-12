import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { assertDeleteConfirmation } from '../policy.js';
import {
  type CreateServiceInput,
  type OperationResult,
  type ResourceView,
  type UpdateServiceInput,
  assertValidResourceUuid,
  createServiceSchema,
  normalizeOperation,
  normalizeResource,
  toSnakeCaseRecord,
  updateServiceSchema,
} from './types.js';

export async function listServices(client: Pick<CoolifyClient, 'request'>): Promise<ResourceView[]> {
  const data = await client.request('GET', '/services');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid services payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeResource);
}

export async function getService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<ResourceView> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/services/${uuid}`);
  return normalizeResource(data);
}
function isBase64(str: string): boolean {
  if (typeof str !== 'string' || str.length === 0) return false;
  const trimmed = str.trim();
  if (trimmed.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return false;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    return Buffer.from(decoded, 'utf8').toString('base64') === trimmed;
  } catch {
    return false;
  }
}

export async function createService(
  client: Pick<CoolifyClient, 'request'>,
  input: CreateServiceInput,
): Promise<OperationResult> {
  const validated = createServiceSchema.parse(input);
  const projectUuid = validated.project_uuid ?? validated.projectUuid;
  if (!projectUuid) {
    throw new CoolifyError({
      message: 'project_uuid is required to create a service',
      kind: 'validation',
    });
  }

  const serverUuid = validated.server_uuid ?? validated.serverUuid;
  if (!serverUuid) {
    throw new CoolifyError({
      message: 'server_uuid is required to create a service',
      kind: 'validation',
    });
  }

  const body = toSnakeCaseRecord(validated as Record<string, unknown>);
  const compose = validated.docker_compose_raw ?? validated.dockerComposeRaw;
  let secretValues: string[] | undefined;
  if (compose) {
    if (isBase64(compose)) {
      const decoded = Buffer.from(compose, 'base64').toString('utf8');
      secretValues = [decoded, compose];
    } else {
      secretValues = [compose];
      body.docker_compose_raw = Buffer.from(compose, 'utf8').toString('base64');
    }
  }
  const data = await client.request('POST', '/services', { body, secretValues });
  return normalizeOperation(data);
}

export async function updateService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  input: UpdateServiceInput,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const validated = updateServiceSchema.parse(input);
  const body = toSnakeCaseRecord(validated as Record<string, unknown>);
  const compose = validated.docker_compose_raw ?? validated.dockerComposeRaw;
  let secretValues: string[] | undefined;
  if (compose) {
    if (isBase64(compose)) {
      const decoded = Buffer.from(compose, 'base64').toString('utf8');
      secretValues = [decoded, compose];
    } else {
      secretValues = [compose];
      body.docker_compose_raw = Buffer.from(compose, 'utf8').toString('base64');
    }
  }
  const data = await client.request('PATCH', `/services/${uuid}`, { body, secretValues });
  return normalizeOperation(data);
}

export async function deleteService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  confirmResourceUuid: string,
): Promise<OperationResult> {
  assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
  const data = await client.request('DELETE', `/services/${resourceUuid}`);
  return normalizeOperation(data);
}

export async function startService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/services/${uuid}/start`);
  return normalizeOperation(data);
}

export async function restartService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/services/${uuid}/restart`);
  return normalizeOperation(data);
}

export async function stopService(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/services/${uuid}/stop`);
  return normalizeOperation(data);
}
