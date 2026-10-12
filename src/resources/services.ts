import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { type ResourceView, assertValidResourceUuid, normalizeResource } from './types.js';

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
