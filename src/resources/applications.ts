import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { assertDeleteConfirmation } from '../policy.js';
import {
  type CreateApplicationInput,
  type OperationResult,
  type ResourceView,
  type UpdateApplicationInput,
  assertValidResourceUuid,
  createApplicationSchema,
  normalizeOperation,
  normalizeResource,
  toSnakeCaseRecord,
  updateApplicationSchema,
} from './types.js';

export async function listApplications(client: Pick<CoolifyClient, 'request'>): Promise<ResourceView[]> {
  const data = await client.request('GET', '/applications');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid applications payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeResource);
}

export async function getApplication(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<ResourceView> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/applications/${uuid}`);
  return normalizeResource(data);
}

export async function createApplication(
  client: Pick<CoolifyClient, 'request'>,
  input: CreateApplicationInput,
): Promise<OperationResult> {
  const validated = createApplicationSchema.parse(input);
  const { type, ...rest } = validated;

  const projectUuid = rest.project_uuid ?? rest.projectUuid;
  if (!projectUuid) {
    throw new CoolifyError({
      message: 'project_uuid is required to create an application',
      kind: 'validation',
    });
  }

  const serverUuid = rest.server_uuid ?? rest.serverUuid;
  if (!serverUuid) {
    throw new CoolifyError({
      message: 'server_uuid is required to create an application',
      kind: 'validation',
    });
  }

  const body = toSnakeCaseRecord(rest as Record<string, unknown>);
  if (type === 'dockerimage') {
    const raw = rest as Record<string, unknown>;
    const imageName =
      raw.docker_registry_image_name ??
      raw.dockerRegistryImageName ??
      raw.docker_image ??
      raw.dockerImage ??
      raw.image;
    if (imageName) {
      body.docker_registry_image_name = imageName;
    }
    delete body.docker_image;
    delete body.image;
  }
  const data = await client.request('POST', `/applications/${type}`, { body });
  return normalizeOperation(data);
}

export async function updateApplication(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  input: UpdateApplicationInput,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const validated = updateApplicationSchema.parse(input);
  const body = toSnakeCaseRecord(validated as Record<string, unknown>);
  if (body.fqdn !== undefined && body.domains === undefined) {
    body.domains = body.fqdn;
    delete body.fqdn;
  }
  const compose = validated.docker_compose_raw ?? validated.dockerComposeRaw;
  const secretValues = compose ? [compose] : undefined;
  const data = await client.request('PATCH', `/applications/${uuid}`, { body, secretValues });
  return normalizeOperation(data);
}

export async function deleteApplication(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  confirmResourceUuid: string,
): Promise<OperationResult> {
  assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
  const data = await client.request('DELETE', `/applications/${resourceUuid}`);
  return normalizeOperation(data);
}

export async function restartApplication(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/applications/${uuid}/restart`);
  return normalizeOperation(data);
}

export async function stopApplication(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/applications/${uuid}/stop`);
  return normalizeOperation(data);
}
