import type { CoolifyClient } from '../coolify/client.js';
import { CoolifyError } from '../coolify/errors.js';
import { type TeamView, normalizeTeam } from './types.js';

export async function getCurrentTeam(client: Pick<CoolifyClient, 'request'>): Promise<TeamView> {
  const data = await client.request('GET', '/team');
  return normalizeTeam(data);
}

export async function listTeams(client: Pick<CoolifyClient, 'request'>): Promise<TeamView[]> {
  const data = await client.request('GET', '/teams');
  if (!Array.isArray(data)) {
    throw new CoolifyError({
      message: 'Invalid teams payload: expected an array',
      kind: 'validation',
    });
  }
  return data.map(normalizeTeam);
}
