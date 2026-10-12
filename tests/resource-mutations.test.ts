import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { CoolifyError } from '../src/coolify/errors.js';
import {
  assertDeleteConfirmation,
  assertEnvDeleteConfirmation,
  resourceIdSchema,
} from '../src/policy.js';
import {
  createApplication,
  updateApplication,
  deleteApplication,
  restartApplication,
  stopApplication,
} from '../src/resources/applications.js';
import {
  createProject,
  deleteProject,
} from '../src/resources/projects.js';
import {
  createService,
  updateService,
  deleteService,
  startService,
  restartService,
  stopService,
} from '../src/resources/services.js';
import {
  createDatabase,
  updateDatabase,
  deleteDatabase,
  startDatabase,
  restartDatabase,
  stopDatabase,
} from '../src/resources/databases.js';
import {
  deleteServer,
} from '../src/resources/servers.js';
import {
  deployApplication,
  cancelDeployment,
} from '../src/resources/deployments.js';
import {
  setApplicationEnvironmentVariable,
  deleteApplicationEnvironmentVariable,
} from '../src/resources/environment.js';
import { createApplicationSchema } from '../src/resources/types.js';
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

// ---------------------------------------------------------------------------
// 1. Policy Tests
// ---------------------------------------------------------------------------
test('resourceIdSchema validates opaque IDs and rejects invalid formats', () => {
  assert.equal(resourceIdSchema.parse('upfsmih7s60gjfi2dh2rmeil'), 'upfsmih7s60gjfi2dh2rmeil');
  assert.equal(resourceIdSchema.parse('app_123-prod'), 'app_123-prod');
  assert.equal(resourceIdSchema.parse('42'), '42');

  assert.throws(() => resourceIdSchema.parse(''));
  assert.throws(() => resourceIdSchema.parse('has space'));
  assert.throws(() => resourceIdSchema.parse('../traversal'));
  assert.throws(() => resourceIdSchema.parse('semi;colon'));
  assert.throws(() => resourceIdSchema.parse('slash/id'));
  assert.throws(() => resourceIdSchema.parse('a'.repeat(129)));
});

test('assertDeleteConfirmation passes on match and throws on mismatch or invalid ID', () => {
  assert.doesNotThrow(() => assertDeleteConfirmation('app-1', 'app-1'));
  assert.throws(() => assertDeleteConfirmation('app-1', 'app-2'), /Resource confirmation does not match/);
  assert.throws(() => assertDeleteConfirmation('invalid/id', 'invalid/id'));
  assert.throws(() => assertDeleteConfirmation('', ''));
});

test('assertEnvDeleteConfirmation passes on dual match and throws on any mismatch', () => {
  assert.doesNotThrow(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-1', 'env-1'));
  assert.throws(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-2', 'env-1'));
  assert.throws(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-1', 'env-2'));
  assert.throws(() => assertEnvDeleteConfirmation('bad/app', 'env-1', 'bad/app', 'env-1'));
  assert.throws(() => assertEnvDeleteConfirmation('app-1', 'bad/env', 'app-1', 'bad/env'));
});

// ---------------------------------------------------------------------------
// 2. Application Mutations
// ---------------------------------------------------------------------------
test('deleteApplication rejects mismatched confirmation before network call', async () => {
  let requests = 0;
  const { client } = createMockClient(() => {
    requests++;
    return Response.json({ message: 'Deleted' });
  });

  await assert.rejects(deleteApplication(client, 'app-1', 'app-wrong'));
  assert.equal(requests, 0);
});

test('deleteApplication rejects invalid UUID characters before network call', async () => {
  let requests = 0;
  const { client } = createMockClient(() => {
    requests++;
    return Response.json({ message: 'Deleted' });
  });

  await assert.rejects(deleteApplication(client, 'bad/uuid', 'bad/uuid'));
  assert.equal(requests, 0);
});

test('deleteApplication sends DELETE to /applications/{uuid} on match', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ message: 'Application deleted', uuid: 'app-1' });
  });

  const result = await deleteApplication(client, 'app-1', 'app-1');
  assert.equal(capturedMethod, 'DELETE');
  assert.equal(capturedPath, '/api/v1/applications/app-1');
  assert.equal(result.resourceUuid, 'app-1');
  assert.equal(result.message, 'Application deleted');
});

test('createApplication dispatches to /applications/{type} and strips type from body', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ uuid: 'new-app-1', message: 'Application created' }, { status: 201 });
  });

  const result = await createApplication(client, {
    type: 'public',
    project_uuid: 'proj-1',
    server_uuid: 'srv-1',
    git_repository: 'https://github.com/coollabsio/coolify',
    git_branch: 'main',
    build_pack: 'nixpacks',
  });

  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/applications/public');
  assert.equal((capturedBody as Record<string, unknown>).type, undefined);
  assert.equal((capturedBody as Record<string, unknown>).git_repository, 'https://github.com/coollabsio/coolify');
  assert.equal(result.resourceUuid, 'new-app-1');
});
test('createApplication maps dockerImage/image to docker_registry_image_name for dockerimage type', async () => {
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ uuid: 'app-img-1' }, { status: 201 });
  });

  await createApplication(client, {
    type: 'dockerimage',
    project_uuid: 'proj-1',
    server_uuid: 'srv-1',
    dockerImage: 'redis:alpine',
  });

  assert.equal(capturedPath, '/api/v1/applications/dockerimage');
  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.docker_registry_image_name, 'redis:alpine');
  assert.equal(body.docker_image, undefined);
  assert.equal(body.image, undefined);
});

test('createApplicationSchema accepts buildPack and build_pack across git variants', () => {
  const publicWithCamel = createApplicationSchema.parse({
    type: 'public',
    projectUuid: 'p1',
    serverUuid: 's1',
    buildPack: 'nixpacks',
  });
  assert.equal(publicWithCamel.type, 'public');
  if (publicWithCamel.type === 'public') {
    assert.equal(publicWithCamel.buildPack, 'nixpacks');
  }

  const publicWithSnake = createApplicationSchema.parse({
    type: 'public',
    projectUuid: 'p1',
    serverUuid: 's1',
    build_pack: 'static',
  });
  assert.equal(publicWithSnake.type, 'public');
  if (publicWithSnake.type === 'public') {
    assert.equal(publicWithSnake.build_pack, 'static');
  }

  const ghApp = createApplicationSchema.parse({
    type: 'private-github-app',
    projectUuid: 'p1',
    serverUuid: 's1',
    buildPack: 'dockerfile',
  });
  assert.equal(ghApp.type, 'private-github-app');
  if (ghApp.type === 'private-github-app') {
    assert.equal(ghApp.buildPack, 'dockerfile');
  }

  const deployKey = createApplicationSchema.parse({
    type: 'private-deploy-key',
    projectUuid: 'p1',
    serverUuid: 's1',
    build_pack: 'nixpacks',
  });
  assert.equal(deployKey.type, 'private-deploy-key');
  if (deployKey.type === 'private-deploy-key') {
    assert.equal(deployKey.build_pack, 'nixpacks');
  }
});


test('createApplication rejects unsupported application type before network call', async () => {
  let requests = 0;
  const { client } = createMockClient(() => {
    requests++;
    return Response.json({});
  });

  await assert.rejects(
    // @ts-expect-error Testing invalid runtime input
    createApplication(client, { type: 'unsupported-type', project_uuid: 'p1', server_uuid: 's1' })
  );
  assert.equal(requests, 0);
});

test('updateApplication sends PATCH to /applications/{uuid}', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ message: 'Application updated', uuid: 'app-1' });
  });

  const result = await updateApplication(client, 'app-1', {
    name: 'new-name',
    description: 'updated description',
  });

  assert.equal(capturedMethod, 'PATCH');
  assert.equal(capturedPath, '/api/v1/applications/app-1');
  assert.deepEqual(capturedBody, { name: 'new-name', description: 'updated description' });
  assert.equal(result.resourceUuid, 'app-1');
});

test('restartApplication sends POST to /applications/{uuid}/restart and returns operationId', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ message: 'Restart queued', deployment_uuid: 'dep-restart-1' });
  });

  const result = await restartApplication(client, 'app-1');
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/applications/app-1/restart');
  assert.equal(result.operationId, 'dep-restart-1');
  assert.equal(result.message, 'Restart queued');
});

test('stopApplication sends POST to /applications/{uuid}/stop', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ message: 'Application stopped', uuid: 'app-1' });
  });

  const result = await stopApplication(client, 'app-1');
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/applications/app-1/stop');
  assert.equal(result.resourceUuid, 'app-1');
  assert.equal(result.message, 'Application stopped');
});

// ---------------------------------------------------------------------------
// 3. Project Mutations
// ---------------------------------------------------------------------------
test('createProject sends POST to /projects', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ uuid: 'proj-new', message: 'Project created' }, { status: 201 });
  });

  const result = await createProject(client, { name: 'My Project', description: 'Cool project' });
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/projects');
  assert.deepEqual(capturedBody, { name: 'My Project', description: 'Cool project' });
  assert.equal(result.resourceUuid, 'proj-new');
});

test('deleteProject enforces confirmation and sends DELETE /projects/{uuid}', async () => {
  let requests = 0;
  const { client } = createMockClient((req) => {
    requests++;
    assert.equal(req.method, 'DELETE');
    assert.equal(new URL(req.url).pathname, '/api/v1/projects/proj-1');
    return Response.json({ message: 'Project deleted' });
  });

  await assert.rejects(deleteProject(client, 'proj-1', 'proj-2'));
  assert.equal(requests, 0);

  const result = await deleteProject(client, 'proj-1', 'proj-1');
  assert.equal(requests, 1);
  assert.equal(result.message, 'Project deleted');
});

// ---------------------------------------------------------------------------
// 4. Service Mutations
// ---------------------------------------------------------------------------
test('createService sends POST to /services', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ uuid: 'srvc-1', message: 'Service created' });
  });

  const result = await createService(client, {
    project_uuid: 'proj-1',
    server_uuid: 'server-1',
    type: 'gitea-with-mysql',
    name: 'my-gitea',
  });

  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/services');
  assert.equal((capturedBody as Record<string, unknown>).type, 'gitea-with-mysql');
  assert.equal(result.resourceUuid, 'srvc-1');
});

test('updateService sends PATCH to /services/{uuid}', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ uuid: 'srvc-1', message: 'Service updated' });
  });

  const result = await updateService(client, 'srvc-1', {
    name: 'updated-name',
  });

  assert.equal(capturedMethod, 'PATCH');
  assert.equal(capturedPath, '/api/v1/services/srvc-1');
  assert.deepEqual(capturedBody, { name: 'updated-name' });
  assert.equal(result.resourceUuid, 'srvc-1');
});
test('createService encodes unencoded compose to base64 and preserves unencoded in secretValues', async () => {
  let capturedBody: unknown;
  const rawCompose = 'services:\n  web:\n    image: nginx\n';
  const { client } = createMockClient(async (req) => {
    capturedBody = await req.json();
    return Response.json({
      uuid: 'srvc-compose-1',
      echoed: rawCompose,
    });
  });

  const result = await createService(client, {
    project_uuid: 'proj-1',
    server_uuid: 'server-1',
    docker_compose_raw: rawCompose,
  });

  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.docker_compose_raw, Buffer.from(rawCompose, 'utf8').toString('base64'));
  assert.equal(result.resourceUuid, 'srvc-compose-1');
});

test('createService does not double-encode already base64 compose', async () => {
  let capturedBody: unknown;
  const rawCompose = 'services:\n  web:\n    image: nginx\n';
  const b64 = Buffer.from(rawCompose, 'utf8').toString('base64');
  const { client } = createMockClient(async (req) => {
    capturedBody = await req.json();
    return Response.json({ uuid: 'srvc-compose-2' });
  });

  await createService(client, {
    project_uuid: 'proj-1',
    server_uuid: 'server-1',
    docker_compose_raw: b64,
  });

  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.docker_compose_raw, b64);
});

test('updateService encodes unencoded compose to base64', async () => {
  let capturedBody: unknown;
  const rawCompose = 'services:\n  app:\n    image: node:alpine\n';
  const { client } = createMockClient(async (req) => {
    capturedBody = await req.json();
    return Response.json({ uuid: 'srvc-1' });
  });

  await updateService(client, 'srvc-1', {
    dockerComposeRaw: rawCompose,
  });

  const body = capturedBody as Record<string, unknown>;
  assert.equal(body.docker_compose_raw, Buffer.from(rawCompose, 'utf8').toString('base64'));
});


test('deleteService enforces confirmation and sends DELETE /services/{uuid}', async () => {
  let requests = 0;
  const { client } = createMockClient((req) => {
    requests++;
    assert.equal(req.method, 'DELETE');
    assert.equal(new URL(req.url).pathname, '/api/v1/services/srvc-1');
    return Response.json({ message: 'Service deleted' });
  });

  await assert.rejects(deleteService(client, 'srvc-1', 'srvc-wrong'));
  assert.equal(requests, 0);

  const result = await deleteService(client, 'srvc-1', 'srvc-1');
  assert.equal(requests, 1);
  assert.equal(result.message, 'Service deleted');
});

test('service lifecycle: start, restart, stop send POST to /services/{uuid}/{action}', async () => {
  const actionsCalled: string[] = [];
  const { client } = createMockClient((req) => {
    const action = req.url.split('/').pop();
    actionsCalled.push(`${req.method} ${action}`);
    return Response.json({ message: `${action} queued` });
  });

  const startRes = await startService(client, 'srvc-1');
  assert.equal(startRes.message, 'start queued');

  const restartRes = await restartService(client, 'srvc-1');
  assert.equal(restartRes.message, 'restart queued');

  const stopRes = await stopService(client, 'srvc-1');
  assert.equal(stopRes.message, 'stop queued');

  assert.deepEqual(actionsCalled, ['POST start', 'POST restart', 'POST stop']);
});

// ---------------------------------------------------------------------------
// 5. Database Mutations
// ---------------------------------------------------------------------------
test('createDatabase dispatches to /databases/{type} and rejects unsupported types', async () => {
  let capturedPath = '';
  const { client } = createMockClient(async (req) => {
    capturedPath = new URL(req.url).pathname;
    return Response.json({ uuid: 'db-1', message: 'PostgreSQL created' });
  });

  const result = await createDatabase(client, {
    type: 'postgresql',
    project_uuid: 'proj-1',
    server_uuid: 'srv-1',
    postgres_db: 'mydb',
    postgres_user: 'myuser',
    postgres_password: 'mypassword',
  });

  assert.equal(capturedPath, '/api/v1/databases/postgresql');
  assert.equal(result.resourceUuid, 'db-1');

  // Rejects unsupported database engine before network
  let requests = 0;
  const { client: failingClient } = createMockClient(() => {
    requests++;
    return Response.json({});
  });
  await assert.rejects(
    // @ts-expect-error Testing invalid runtime engine
    createDatabase(failingClient, { type: 'oracle', project_uuid: 'p', server_uuid: 's' })
  );
  assert.equal(requests, 0);
});

test('updateDatabase sends PATCH to /databases/{uuid}', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ uuid: 'db-1', message: 'Database updated' });
  });

  const result = await updateDatabase(client, 'db-1', { name: 'renamed-db' });
  assert.equal(capturedMethod, 'PATCH');
  assert.equal(capturedPath, '/api/v1/databases/db-1');
  assert.equal(result.resourceUuid, 'db-1');
});

test('deleteDatabase enforces confirmation and sends DELETE /databases/{uuid}', async () => {
  let requests = 0;
  const { client } = createMockClient((req) => {
    requests++;
    assert.equal(req.method, 'DELETE');
    assert.equal(new URL(req.url).pathname, '/api/v1/databases/db-1');
    return Response.json({ message: 'Database deleted' });
  });

  await assert.rejects(deleteDatabase(client, 'db-1', 'db-wrong'));
  assert.equal(requests, 0);

  const result = await deleteDatabase(client, 'db-1', 'db-1');
  assert.equal(requests, 1);
  assert.equal(result.message, 'Database deleted');
});

test('database lifecycle: start, restart, stop send POST to /databases/{uuid}/{action}', async () => {
  const actionsCalled: string[] = [];
  const { client } = createMockClient((req) => {
    const action = req.url.split('/').pop();
    actionsCalled.push(`${req.method} ${action}`);
    return Response.json({ message: `${action} queued` });
  });

  await startDatabase(client, 'db-1');
  await restartDatabase(client, 'db-1');
  await stopDatabase(client, 'db-1');

  assert.deepEqual(actionsCalled, ['POST start', 'POST restart', 'POST stop']);
});

// ---------------------------------------------------------------------------
// 6. Server Mutations
// ---------------------------------------------------------------------------
test('deleteServer enforces confirmation and sends DELETE /servers/{uuid}', async () => {
  let requests = 0;
  const { client } = createMockClient((req) => {
    requests++;
    assert.equal(req.method, 'DELETE');
    assert.equal(new URL(req.url).pathname, '/api/v1/servers/srv-1');
    return Response.json({ message: 'Server deleted' });
  });

  await assert.rejects(deleteServer(client, 'srv-1', 'srv-wrong'));
  assert.equal(requests, 0);

  const result = await deleteServer(client, 'srv-1', 'srv-1');
  assert.equal(requests, 1);
  assert.equal(result.message, 'Server deleted');
});

// ---------------------------------------------------------------------------
// 7. Deployments Mutations
// ---------------------------------------------------------------------------
test('deployApplication sends POST /deploy with uuid and force, parsing deployment array', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({
      deployments: [
        {
          message: 'Deployment queued.',
          resource_uuid: 'app-1',
          deployment_uuid: 'dep-uuid-999',
        },
      ],
    });
  });

  const result = await deployApplication(client, { resourceUuid: 'app-1', force: true });
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/deploy');
  assert.deepEqual(capturedBody, { uuid: 'app-1', force: true });
  assert.equal(result.operationId, 'dep-uuid-999');
  assert.equal(result.resourceUuid, 'app-1');
  assert.equal(result.message, 'Deployment queued.');
});

test('cancelDeployment sends POST /deployments/{uuid}/cancel', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ message: 'Deployment cancelled', deployment_uuid: 'dep-1' });
  });

  const result = await cancelDeployment(client, 'dep-1');
  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/deployments/dep-1/cancel');
  assert.equal(result.operationId, 'dep-1');
  assert.equal(result.message, 'Deployment cancelled');
});

// ---------------------------------------------------------------------------
// 8. Environment Variable Mutations
// ---------------------------------------------------------------------------
test('setApplicationEnvironmentVariable routes POST when envUuid omitted', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  let capturedBody: unknown;
  const { client } = createMockClient(async (req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    capturedBody = await req.json();
    return Response.json({ message: 'Created', value: 'secret-val-echoed' });
  });

  const result = await setApplicationEnvironmentVariable(client, {
    resourceUuid: 'app-1',
    key: 'API_KEY',
    value: 'secret-api-key-val',
    isLiteral: true,
  });

  assert.equal(capturedMethod, 'POST');
  assert.equal(capturedPath, '/api/v1/applications/app-1/envs');
  assert.equal((capturedBody as Record<string, unknown>).key, 'API_KEY');
  assert.equal((capturedBody as Record<string, unknown>).value, 'secret-api-key-val');
  assert.equal((capturedBody as Record<string, unknown>).is_literal, true);

  // Result never echoes secret value
  assert.equal(result.key, 'API_KEY');
  assert.equal(result.scope, 'application');
  assert.equal(result.changed, true);
  assert.equal('value' in result, false);
});

test('setApplicationEnvironmentVariable routes PATCH when envUuid is supplied', async () => {
  let capturedMethod = '';
  let capturedPath = '';
  const { client } = createMockClient((req) => {
    capturedMethod = req.method;
    capturedPath = new URL(req.url).pathname;
    return Response.json({ message: 'Updated' });
  });

  const result = await setApplicationEnvironmentVariable(client, {
    resourceUuid: 'app-1',
    envUuid: 'env-123',
    key: 'API_KEY',
    value: 'new-secret-val',
  });

  assert.equal(capturedMethod, 'PATCH');
  assert.equal(capturedPath, '/api/v1/applications/app-1/envs');
  assert.equal(result.key, 'API_KEY');
  assert.equal(result.changed, true);
});

test('setApplicationEnvironmentVariable redacts secret from error messages on failure', async () => {
  const secret = 'super-secret-password-xyz';
  const { client } = createMockClient(() => {
    return new Response(JSON.stringify({ error: `Failed to set value ${secret}` }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  });

  await assert.rejects(
    setApplicationEnvironmentVariable(client, {
      resourceUuid: 'app-1',
      key: 'PASSWORD',
      value: secret,
    }),
    (err: unknown) => {
      assert(err instanceof CoolifyError);
      const str = String(err.message) + JSON.stringify(err.details);
      assert.equal(str.includes(secret), false, 'Secret was leaked in error!');
      return true;
    }
  );
});

test('deleteApplicationEnvironmentVariable enforces dual confirmation before network call', async () => {
  let requests = 0;
  const { client } = createMockClient((req) => {
    requests++;
    assert.equal(req.method, 'DELETE');
    assert.equal(new URL(req.url).pathname, '/api/v1/applications/app-1/envs/env-1');
    return Response.json({ message: 'Deleted' });
  });

  // Resource mismatch
  await assert.rejects(
    deleteApplicationEnvironmentVariable(client, 'app-1', 'env-1', 'app-2', 'env-1')
  );
  assert.equal(requests, 0);

  // Env mismatch
  await assert.rejects(
    deleteApplicationEnvironmentVariable(client, 'app-1', 'env-1', 'app-1', 'env-2')
  );
  assert.equal(requests, 0);

  // Both match
  const result = await deleteApplicationEnvironmentVariable(client, 'app-1', 'env-1', 'app-1', 'env-1');
  assert.equal(requests, 1);
  assert.equal(result.key, 'env-1');
  assert.equal(result.scope, 'application');
  assert.equal(result.changed, true);
});
