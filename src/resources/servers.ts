import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { type ResourceView, assertValidResourceUuid, normalizeResource } from './types.js';

export async function listServers(client: Pick<CoolifyClient, 'request'>): Promise<ResourceView[]> {
  const data = await client.request('GET', '/servers');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid servers payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeResource);
}

export async function getServer(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<ResourceView> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/servers/${uuid}`);
  return normalizeResource(data);
}
