import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { assertDeleteConfirmation } from '../policy.js';
import {
  type CreateProjectInput,
  type OperationResult,
  type ResourceView,
  assertValidResourceUuid,
  createProjectSchema,
  normalizeOperation,
  normalizeResource,
} from './types.js';

export async function listProjects(client: Pick<CoolifyClient, 'request'>): Promise<ResourceView[]> {
  const data = await client.request('GET', '/projects');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid projects payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeResource);
}

export async function getProject(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<ResourceView> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/projects/${uuid}`);
  return normalizeResource(data);
}

export async function createProject(
  client: Pick<CoolifyClient, 'request'>,
  input: CreateProjectInput,
): Promise<OperationResult> {
  const validated = createProjectSchema.parse(input);
  const data = await client.request('POST', '/projects', { body: validated });
  return normalizeOperation(data);
}

export async function deleteProject(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
  confirmResourceUuid: string,
): Promise<OperationResult> {
  assertDeleteConfirmation(resourceUuid, confirmResourceUuid);
  const data = await client.request('DELETE', `/projects/${resourceUuid}`);
  return normalizeOperation(data);
}
