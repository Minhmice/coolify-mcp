import { z } from 'zod';
import { RESOURCE_UUID_REGEX, type LogOptions } from './resources/types.js';

export const resourceIdSchema = z.string().min(1).max(128).regex(RESOURCE_UUID_REGEX);

export function assertDeleteConfirmation(resourceUuid: string, confirmResourceUuid: string): void {
  const target = resourceIdSchema.parse(resourceUuid);
  const confirmation = resourceIdSchema.parse(confirmResourceUuid);
  if (target !== confirmation) {
    throw new Error('Resource confirmation does not match');
  }
}

export function assertEnvDeleteConfirmation(
  resourceUuid: string,
  envUuid: string,
  confirmResourceUuid: string,
  confirmEnvUuid: string,
): void {
  const targetResource = resourceIdSchema.parse(resourceUuid);
  const confirmationResource = resourceIdSchema.parse(confirmResourceUuid);
  if (targetResource !== confirmationResource) {
    throw new Error('Resource confirmation does not match');
  }

  const targetEnv = resourceIdSchema.parse(envUuid);
  const confirmationEnv = resourceIdSchema.parse(confirmEnvUuid);
  if (targetEnv !== confirmationEnv) {
    throw new Error('Environment variable confirmation does not match');
  }
}

export function assertSensitiveRead(options: LogOptions): void {
  const target = resourceIdSchema.parse(options.resourceUuid);
  if (options.includeSensitive !== true) {
    throw new Error('Sensitive read requires includeSensitive=true');
  }
  const confirmation = resourceIdSchema.parse(options.confirmResourceUuid);
  if (target !== confirmation) {
    throw new Error('Resource confirmation does not match');
  }
}
