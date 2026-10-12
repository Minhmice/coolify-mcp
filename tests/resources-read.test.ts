import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { CoolifyError } from '../src/coolify/errors.js';
import {
  normalizeResource,
  normalizeTeam,
  assertValidResourceUuid,
} from '../src/resources/types.js';
import { getCurrentTeam, listTeams } from '../src/resources/teams.js';
import { getProject, listProjects } from '../src/resources/projects.js';
import { getApplication, listApplications } from '../src/resources/applications.js';
import { getService, listServices } from '../src/resources/services.js';
import { getDatabase, listDatabases } from '../src/resources/databases.js';
import { getServer, listServers } from '../src/resources/servers.js';
import { getDeployment, listDeployments } from '../src/resources/deployments.js';
import { getApplicationLogs, getDeploymentLogs } from '../src/resources/logs.js';
import {
  getEnvironmentVariable,
  listEnvironmentVariables,
} from '../src/resources/environment.js';

function createMockClient(handler: (req: Request) => Promise<Response> | Response) {
  const config = loadConfig({
    COOLIFY_URL: 'https://coolify.example',
    COOLIFY_TOKEN: 'fixture-token-secret-12345',
  });
  const transport: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    return handler(req);
  };
  return { config, client: new CoolifyClient(config, transport) };
}

test('assertValidResourceUuid validates opaque non-RFC UUIDs and rejects invalid path segments', () => {
  assert.equal(assertValidResourceUuid('upfsmih7s60gjfi2dh2rmeil'), 'upfsmih7s60gjfi2dh2rmeil');
  assert.equal(assertValidResourceUuid('app_123-abc'), 'app_123-abc');
  assert.equal(assertValidResourceUuid('10'), '10');

  assert.throws(() => assertValidResourceUuid(''), (err: unknown) => {
    assert(err instanceof CoolifyError);
    assert.equal(err.kind, 'validation');
    return true;
  });
  assert.throws(() => assertValidResourceUuid('bad/path'));
  assert.throws(() => assertValidResourceUuid('../evil'));
  assert.throws(() => assertValidResourceUuid('spaces in id'));
  assert.throws(() => assertValidResourceUuid('semi;colon'));
});

test('normalizeResource normalizes fields and redacts secrets in metadata', () => {
  const raw = {
    uuid: 'upfsmih7s60gjfi2dh2rmeil',
    name: 'web-service',
    status: 'running',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    api_token: 'secret-token-value',
    custom_password: 'super-secret-password',
    safe_info: 'visible',
  };

  const res = normalizeResource(raw);
  assert.equal(res.uuid, 'upfsmih7s60gjfi2dh2rmeil');
  assert.equal(res.name, 'web-service');
  assert.equal(res.status, 'running');
  assert.equal(res.createdAt, '2026-01-01T00:00:00Z');
  assert.equal(res.updatedAt, '2026-01-02T00:00:00Z');
  assert.equal(res.metadata.safe_info, 'visible');
  assert.equal(res.metadata.api_token, '[REDACTED]');
  assert.equal(res.metadata.custom_password, '[REDACTED]');

  // Non-object or missing UUID throws validation error
  assert.throws(() => normalizeResource(null));
  assert.throws(() => normalizeResource([]));
  assert.throws(() => normalizeResource({ name: 'missing-uuid' }));
});

test('teams: getCurrentTeam and listTeams parse numeric IDs and string names', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/team') {
      return Response.json({ id: 0, name: 'Root Team' });
    }
    if (url.pathname === '/api/v1/teams') {
      return Response.json([
        { id: '1', name: 'Dev Team' },
        { id: 2, name: 'Ops Team' },
      ]);
    }
    return new Response('Not found', { status: 404 });
  });

  const current = await getCurrentTeam(client);
  assert.deepEqual(current, { id: 0, name: 'Root Team' });

  const teams = await listTeams(client);
  assert.deepEqual(teams, [
    { id: 1, name: 'Dev Team' },
    { id: 2, name: 'Ops Team' },
  ]);
});

test('projects: listProjects and getProject map resource views', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/projects') {
      return Response.json([
        { uuid: 'proj_1', name: 'Project Alpha', status: 'active', created_at: 100 },
        { uuid: 'proj_2', name: 'Project Beta' },
      ]);
    }
    if (url.pathname === '/api/v1/projects/proj_1') {
      return Response.json({
        uuid: 'proj_1',
        name: 'Project Alpha',
        status: 'active',
        created_at: 100,
        secret_key: 'top-secret',
      });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = await listProjects(client);
  assert.equal(list.length, 2);
  assert.equal(list[0]?.uuid, 'proj_1');
  assert.equal(list[0]?.name, 'Project Alpha');
  assert.equal(list[1]?.uuid, 'proj_2');

  const single = await getProject(client, 'proj_1');
  assert.equal(single.uuid, 'proj_1');
  assert.equal(single.metadata.secret_key, '[REDACTED]');

  await assert.rejects(getProject(client, 'bad/uuid'), { name: 'CoolifyError' });
});

test('applications: listApplications and getApplication map resource views', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/applications') {
      return Response.json([{ uuid: 'app_1', name: 'My App', status: 'running' }]);
    }
    if (url.pathname === '/api/v1/applications/app_1') {
      return Response.json({ uuid: 'app_1', name: 'My App', status: 'running' });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = await listApplications(client);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.uuid, 'app_1');

  const app = await getApplication(client, 'app_1');
  assert.equal(app.uuid, 'app_1');
  assert.equal(app.status, 'running');
});

test('services: listServices and getService map resource views', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/services') {
      return Response.json([{ uuid: 'svc_1', name: 'Redis Stack', status: 'exited' }]);
    }
    if (url.pathname === '/api/v1/services/svc_1') {
      return Response.json({ uuid: 'svc_1', name: 'Redis Stack', status: 'exited' });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = await listServices(client);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.uuid, 'svc_1');

  const svc = await getService(client, 'svc_1');
  assert.equal(svc.uuid, 'svc_1');
});

test('databases: listDatabases and getDatabase map resource views', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/databases') {
      return Response.json([{ uuid: 'db_1', name: 'Postgres Prod', status: 'running' }]);
    }
    if (url.pathname === '/api/v1/databases/db_1') {
      return Response.json({ uuid: 'db_1', name: 'Postgres Prod', status: 'running' });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = await listDatabases(client);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.uuid, 'db_1');

  const db = await getDatabase(client, 'db_1');
  assert.equal(db.uuid, 'db_1');
});

test('servers: listServers and getServer map resource views', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/servers') {
      return Response.json([{ uuid: 'srv_1', name: 'Localhost', ip: '127.0.0.1' }]);
    }
    if (url.pathname === '/api/v1/servers/srv_1') {
      return Response.json({ uuid: 'srv_1', name: 'Localhost', ip: '127.0.0.1' });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = await listServers(client);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.uuid, 'srv_1');

  const srv = await getServer(client, 'srv_1');
  assert.equal(srv.uuid, 'srv_1');
});

test('deployments: listDeployments and getDeployment redact secrets in payloads', async () => {
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/deployments') {
      return Response.json([
        { id: 'dep_1', status: 'finished', secret_token: 'secret-val' },
      ]);
    }
    if (url.pathname === '/api/v1/deployments/dep_1') {
      return Response.json({
        id: 'dep_1',
        status: 'finished',
        logs: 'build success',
        private_key: 'top-secret',
      });
    }
    return new Response('Not found', { status: 404 });
  });

  const list = (await listDeployments(client)) as Array<Record<string, unknown>>;
  assert.equal(list.length, 1);
  assert.equal(list[0]?.secret_token, '[REDACTED]');

  const dep = (await getDeployment(client, 'dep_1')) as Record<string, unknown>;
  assert.equal(dep.id, 'dep_1');
  assert.equal(dep.private_key, '[REDACTED]');
});

test('logs: getApplicationLogs requires sensitive opt-in and bounds output size', async () => {
  let requestCount = 0;
  const { config, client } = createMockClient(async (req) => {
    requestCount++;
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/applications/app_1/logs') {
      return Response.json({ logs: 'Hello World with Bearer secret-tok and password=secret123' });
    }
    return new Response('Not found', { status: 404 });
  });

  // 1. Without includeSensitive, returns requiresSensitiveOptIn: true and no network call
  const optInReq1 = await getApplicationLogs(client, config, {
    resourceUuid: 'app_1',
  });
  assert.equal(optInReq1.requiresSensitiveOptIn, true);
  assert.equal(optInReq1.text, undefined);
  assert.equal(requestCount, 0);

  // 2. With includeSensitive true but mismatched confirmResourceUuid, also blocked
  const optInReq2 = await getApplicationLogs(client, config, {
    resourceUuid: 'app_1',
    includeSensitive: true,
    confirmResourceUuid: 'wrong_app',
  });
  assert.equal(optInReq2.requiresSensitiveOptIn, true);
  assert.equal(optInReq2.text, undefined);
  assert.equal(requestCount, 0);

  // 3. With confirmed opt-in, makes call and redacts Bearer tokens
  const logs = await getApplicationLogs(client, config, {
    resourceUuid: 'app_1',
    includeSensitive: true,
    confirmResourceUuid: 'app_1',
  });
  assert.equal(requestCount, 1);
  assert.equal(logs.requiresSensitiveOptIn, false);
  assert.equal(logs.truncated, false);
  assert(logs.text?.includes('Bearer [REDACTED]'));

  // 4. Output bounding truncates if log exceeds maxBytes
  const boundedLogs = await getApplicationLogs(client, config, {
    resourceUuid: 'app_1',
    includeSensitive: true,
    confirmResourceUuid: 'app_1',
    maxBytes: 10,
  });
  assert.equal(boundedLogs.truncated, true);
  assert.equal(Buffer.byteLength(boundedLogs.text ?? '', 'utf8') <= 10, true);
});

test('logs: getDeploymentLogs extracts logs field from deployment endpoint and bounds output', async () => {
  let calledPath = '';
  const { config, client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    calledPath = url.pathname;
    if (url.pathname === '/api/v1/deployments/dep_1') {
      return Response.json({
        id: 'dep_1',
        status: 'finished',
        logs: 'Step 1: cloning\nStep 2: build complete',
      });
    }
    return new Response('Not found', { status: 404 });
  });

  // Opt-in required
  const noOptIn = await getDeploymentLogs(client, config, { resourceUuid: 'dep_1' });
  assert.equal(noOptIn.requiresSensitiveOptIn, true);
  assert.equal(calledPath, '');

  // With opt-in: calls /deployments/{uuid}, NOT /deployments/{uuid}/logs
  const res = await getDeploymentLogs(client, config, {
    resourceUuid: 'dep_1',
    includeSensitive: true,
    confirmResourceUuid: 'dep_1',
  });
  assert.equal(calledPath, '/api/v1/deployments/dep_1');
  assert.equal(res.requiresSensitiveOptIn, false);
  assert(res.text?.includes('Step 1: cloning'));
});

test('environment: listEnvironmentVariables routes by scope and redacts all values', async () => {
  const routesCalled: string[] = [];
  const { client } = createMockClient(async (req) => {
    const url = new URL(req.url);
    routesCalled.push(url.pathname);
    return Response.json([
      {
        id: 1,
        uuid: 'env_1',
        key: 'DATABASE_URL',
        value: 'postgres://admin:password@host/db',
        real_value: 'postgres://admin:password@host/db',
        is_preview: false,
        is_runtime: true,
      },
      {
        id: 2,
        uuid: 'env_2',
        key: 'PUBLIC_URL',
        value: 'https://example.com',
      },
    ]);
  });

  const appEnvs = await listEnvironmentVariables(client, { kind: 'application', resourceUuid: 'app_1' });
  assert.equal(routesCalled.at(-1), '/api/v1/applications/app_1/envs');
  assert.equal(appEnvs.length, 2);
  assert.equal(appEnvs[0]?.key, 'DATABASE_URL');
  assert.equal(appEnvs[0]?.value, '[REDACTED]');
  assert.equal(appEnvs[1]?.key, 'PUBLIC_URL');
  assert.equal(appEnvs[1]?.value, '[REDACTED]');
  // Ensure no secret value leaked anywhere in serialized output
  assert.equal(JSON.stringify(appEnvs).includes('postgres://admin'), false);
  assert.equal(JSON.stringify(appEnvs).includes('https://example.com'), false);

  await listEnvironmentVariables(client, { kind: 'service', resourceUuid: 'svc_1' });
  assert.equal(routesCalled.at(-1), '/api/v1/services/svc_1/envs');

  await listEnvironmentVariables(client, { kind: 'database', resourceUuid: 'db_1' });
  assert.equal(routesCalled.at(-1), '/api/v1/databases/db_1/envs');

  await listEnvironmentVariables(client, { kind: 'server', resourceUuid: 'srv_1' });
  assert.equal(routesCalled.at(-1), '/api/v1/servers/srv_1/envs');

  await listEnvironmentVariables(client, { kind: 'project', resourceUuid: 'proj_1' });
  assert.equal(routesCalled.at(-1), '/api/v1/projects/proj_1/envs');

  await listEnvironmentVariables(client, { kind: 'team' });
  assert.equal(routesCalled.at(-1), '/api/v1/team/envs');
});

test('environment: getEnvironmentVariable matches by uuid or id and throws not_found if missing', async () => {
  const { client } = createMockClient(async () => {
    return Response.json([
      { id: 10, uuid: 'env_10', key: 'API_KEY', value: 'secret10' },
      { id: 20, uuid: 'env_20', key: 'OTHER_KEY', value: 'secret20' },
    ]);
  });

  const envByUuid = await getEnvironmentVariable(
    client,
    { kind: 'application', resourceUuid: 'app_1' },
    'env_10',
  );
  assert.equal(envByUuid.key, 'API_KEY');
  assert.equal(envByUuid.value, '[REDACTED]');

  const envById = await getEnvironmentVariable(
    client,
    { kind: 'application', resourceUuid: 'app_1' },
    '20',
  );
  assert.equal(envById.key, 'OTHER_KEY');
  assert.equal(envById.value, '[REDACTED]');

  await assert.rejects(
    getEnvironmentVariable(client, { kind: 'application', resourceUuid: 'app_1' }, 'nonexistent'),
    (err: unknown) => {
      assert(err instanceof CoolifyError);
      assert.equal(err.kind, 'not_found');
      assert.equal(err.status, 404);
      return true;
    },
  );
});
