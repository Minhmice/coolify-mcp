import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { redactSecrets } from '../coolify/redaction.js';
import {
  type DeployApplicationInput,
  type OperationResult,
  assertValidResourceUuid,
  normalizeOperation,
} from './types.js';

export async function listDeployments(client: Pick<CoolifyClient, 'request'>): Promise<unknown[]> {
  const data = await client.request('GET', '/deployments');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid deployments payload: expected an array',
      kind: 'validation',
    });
  }
  return redactSecrets(data) as unknown[];
}

export async function getDeployment(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<unknown> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('GET', `/deployments/${uuid}`);
  return redactSecrets(data);
}

export async function deployApplication(
  client: Pick<CoolifyClient, 'request'>,
  input: DeployApplicationInput,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(input.resourceUuid);
  const body: Record<string, unknown> = { uuid };
  if (input.force !== undefined) {
    body.force = input.force;
  }
  const data = await client.request('POST', '/deploy', { body });
  return normalizeOperation(data);
}

export async function cancelDeployment(
  client: Pick<CoolifyClient, 'request'>,
  resourceUuid: string,
): Promise<OperationResult> {
  const uuid = assertValidResourceUuid(resourceUuid);
  const data = await client.request('POST', `/deployments/${uuid}/cancel`);
  return normalizeOperation(data);
}
