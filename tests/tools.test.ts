import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config.js';
import { createMcpServer } from '../src/server.js';
import { registerTools } from '../src/tools.js';

const EXPECTED_TOOLS = [
  // Read (18)
  'coolify_get_current_team',
  'coolify_list_teams',
  'coolify_list_projects',
  'coolify_get_project',
  'coolify_list_applications',
  'coolify_get_application',
  'coolify_list_services',
  'coolify_get_service',
  'coolify_list_databases',
  'coolify_get_database',
  'coolify_list_servers',
  'coolify_get_server',
  'coolify_list_deployments',
  'coolify_get_deployment',
  'coolify_get_application_logs',
  'coolify_get_deployment_logs',
  'coolify_list_environment_variables',
  'coolify_get_environment_variable',
  // Operations (10)
  'coolify_deploy_application',
  'coolify_restart_application',
  'coolify_stop_application',
  'coolify_cancel_deployment',
  'coolify_start_service',
  'coolify_stop_service',
  'coolify_restart_service',
  'coolify_start_database',
  'coolify_stop_database',
  'coolify_restart_database',
  // Config (5)
  'coolify_set_application_environment_variable',
  'coolify_delete_application_environment_variable',
  'coolify_update_application',
  'coolify_update_service',
  'coolify_update_database',
  // Lifecycle (9)
  'coolify_create_project',
  'coolify_delete_project',
  'coolify_create_application',
  'coolify_delete_application',
  'coolify_create_service',
  'coolify_delete_service',
  'coolify_create_database',
  'coolify_delete_database',
  'coolify_delete_server',
];

function extractFirstText(content: unknown): string {
  if (Array.isArray(content) && content.length > 0) {
    const first = content[0];
    if (first && typeof first === 'object' && 'text' in first && typeof first.text === 'string') {
      return first.text;
    }
  }
  return '';
}

async function setupClient(handler: (req: Request) => Promise<Response> | Response) {
  const config = loadConfig({
    COOLIFY_URL: 'https://coolify.example',
    COOLIFY_TOKEN: 'fixture-token-secret-12345',
  });
  const transport: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    return handler(req);
  };

  const server = createMcpServer(config, transport);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    server,
    config,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

test('tools: exactly 42 tools are registered and listed', async () => {
  const { client, close } = await setupClient(async () => {
    return Response.json({});
  });

  try {
    const res = await client.listTools();
    const toolNames = res.tools.map((t) => t.name).sort();
    assert.equal(toolNames.length, 42);
    assert.deepEqual(toolNames, [...EXPECTED_TOOLS].sort());
  } finally {
    await close();
  }
});

test('tools: destructive annotations and confirmation descriptions are exposed', async () => {
  const { client, close } = await setupClient(async () => {
    return Response.json({});
  });

  try {
    const res = await client.listTools();
    const toolsByName: Record<string, (typeof res.tools)[number]> = {};
    for (const tool of res.tools) {
      toolsByName[tool.name] = tool;
    }

    const destructiveTools = [
      'coolify_stop_application',
      'coolify_cancel_deployment',
      'coolify_stop_service',
      'coolify_stop_database',
      'coolify_delete_application_environment_variable',
      'coolify_update_application',
      'coolify_update_service',
      'coolify_update_database',
      'coolify_delete_project',
      'coolify_delete_application',
      'coolify_delete_service',
      'coolify_delete_database',
      'coolify_delete_server',
    ];

    for (const name of destructiveTools) {
      const tool = toolsByName[name];
      assert.ok(tool, `tool ${name} exists`);
      assert.equal(tool.annotations?.destructiveHint, true, `${name} has destructiveHint: true`);
    }

    const confirmationRequired = [
      'coolify_delete_application',
      'coolify_delete_project',
      'coolify_delete_service',
      'coolify_delete_database',
      'coolify_delete_server',
      'coolify_stop_application',
      'coolify_stop_service',
      'coolify_stop_database',
      'coolify_cancel_deployment',
      'coolify_delete_application_environment_variable',
      'coolify_update_application',
      'coolify_update_service',
      'coolify_update_database',
    ];
    for (const name of confirmationRequired) {
      const tool = toolsByName[name];
      assert.ok(tool, `${name} exists`);
      assert.match(
        tool.description ?? '',
        /confirm/i,
        `${name} description mentions confirmation requirement`,
      );
      const schema = tool.inputSchema;
      const hasConfirmProp =
        schema &&
        typeof schema === 'object' &&
        'properties' in schema &&
        schema.properties &&
        typeof schema.properties === 'object' &&
        'confirmResourceUuid' in schema.properties;
      assert.ok(hasConfirmProp, `${name} accepts confirmResourceUuid`);
    }
  } finally {
    await close();
  }
});

test('tools: calling read tools returns normalized JSON text', async () => {
  const { client, close } = await setupClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/team') {
      return Response.json({ id: 1, name: 'Default Team' });
    }
    if (url.pathname === '/api/v1/applications') {
      return Response.json([
        { uuid: 'app_1', name: 'my-app', status: 'running', created_at: '2026-01-01' },
      ]);
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });

  try {
    const teamRes = await client.callTool({
      name: 'coolify_get_current_team',
      arguments: {},
    });
    assert.equal(teamRes.isError, undefined);
    const teamText = extractFirstText(teamRes.content);
    const teamData = JSON.parse(teamText);
    assert.equal(teamData.id, 1);
    assert.equal(teamData.name, 'Default Team');

    const appsRes = await client.callTool({
      name: 'coolify_list_applications',
      arguments: {},
    });
    assert.equal(appsRes.isError, undefined);
    const appsText = extractFirstText(appsRes.content);
    const appsData = JSON.parse(appsText);
    assert.equal(Array.isArray(appsData), true);
    assert.equal(appsData[0].uuid, 'app_1');
    assert.equal(appsData[0].name, 'my-app');
  } finally {
    await close();
  }
});

test('tools: calling operational tool triggers correct request', async () => {
  let capturedBody: unknown;
  const { client, close } = await setupClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/deploy' && req.method === 'POST') {
      capturedBody = await req.json();
      return Response.json({ message: 'Deployment started', deployment_uuid: 'dep_1' });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_deploy_application',
      arguments: { resourceUuid: 'app_1', force: true },
    });
    assert.equal(res.isError, undefined);
    assert.deepEqual(capturedBody, { uuid: 'app_1', force: true });
    const content = JSON.parse(extractFirstText(res.content));
    assert.equal(content.operationId, 'dep_1');
  } finally {
    await close();
  }
});

test('tools: mutation confirmation mismatch returns isError and makes zero network calls', async () => {
  let networkCalls = 0;
  const { client, close } = await setupClient(async () => {
    networkCalls++;
    return Response.json({ message: 'Deleted' });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_delete_application',
      arguments: { resourceUuid: 'app_target', confirmResourceUuid: 'app_wrong' },
    });
    assert.equal(res.isError, true);
    assert.equal(networkCalls, 0);
    const text = extractFirstText(res.content);
    assert.match(text, /confirmation does not match/i);
  } finally {
    await close();
  }
});

test('tools: stop application confirmation mismatch makes zero network calls', async () => {
  let networkCalls = 0;
  const { client, close } = await setupClient(async () => {
    networkCalls++;
    return Response.json({ message: 'Stopped' });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_stop_application',
      arguments: { resourceUuid: 'app_1', confirmResourceUuid: 'app_2' },
    });
    assert.equal(res.isError, true);
    assert.equal(networkCalls, 0);
    const text = extractFirstText(res.content);
    assert.match(text, /confirmation does not match/i);
  } finally {
    await close();
  }
});

test('tools: environment mutation does not leak secrets in results', async () => {
  const secretValue = 'super-secret-api-key-999';
  const { client, close } = await setupClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/applications/app_1/envs' && req.method === 'POST') {
      return Response.json({
        message: 'Environment variable created.',
        key: 'MY_SECRET',
        value: secretValue,
      });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_set_application_environment_variable',
      arguments: {
        resourceUuid: 'app_1',
        key: 'MY_SECRET',
        value: secretValue,
      },
    });
    assert.equal(res.isError, undefined);
    const text = extractFirstText(res.content);
    assert.equal(text.includes(secretValue), false, 'Tool output must not contain secret value');
    const parsed = JSON.parse(text);
    assert.equal(parsed.key, 'MY_SECRET');
    assert.equal(parsed.changed, true);
  } finally {
    await close();
  }
});

test('tools: delete environment variable requires confirmEnvUuid match', async () => {
  let networkCalls = 0;
  const { client, close } = await setupClient(async () => {
    networkCalls++;
    return Response.json({ message: 'Deleted' });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_delete_application_environment_variable',
      arguments: {
        resourceUuid: 'app_1',
        envUuid: 'env_1',
        confirmResourceUuid: 'app_1',
        confirmEnvUuid: 'wrong_env',
      },
    });
    assert.equal(res.isError, true);
    assert.equal(networkCalls, 0);
    const text = extractFirstText(res.content);
    assert.match(text, /confirmation does not match/i);
  } finally {
    await close();
  }
});

test('tools: error handling returns isError: true and structured safe payload', async () => {
  const { client, close } = await setupClient(async () => {
    return Response.json({ message: 'Project not found.' }, { status: 404 });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_get_project',
      arguments: { resourceUuid: 'missing_uuid' },
    });
    assert.equal(res.isError, true);
    const text = extractFirstText(res.content);
    assert.match(text, /not found/i);
    const parsed = JSON.parse(text);
    assert.equal(parsed.kind, 'not_found');
    assert.equal(parsed.status, 404);
  } finally {
    await close();
  }
});

test('tools: update application maps camelCase fields to snake_case in request body', async () => {
  let capturedBody: unknown;
  const { client, close } = await setupClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/applications/app_1' && req.method === 'PATCH') {
      capturedBody = await req.json();
      return Response.json({ message: 'Application updated.' });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_update_application',
      arguments: {
        resourceUuid: 'app_1',
        confirmResourceUuid: 'app_1',
        buildCommand: 'npm run build',
        buildPack: 'nixpacks',
      },
    });
    assert.equal(res.isError, undefined);
    assert.deepEqual(capturedBody, {
      build_command: 'npm run build',
      build_pack: 'nixpacks',
    });
  } finally {
    await close();
  }
});

test('tools: private application creation exposes credential selectors', async () => {
  let capturedBody: unknown;
  const { client, close } = await setupClient(async (req) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/applications/private-github-app' && req.method === 'POST') {
      capturedBody = await req.json();
      return Response.json({ uuid: 'app_gh_1' });
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_create_application',
      arguments: {
        type: 'private-github-app',
        projectUuid: 'proj_1',
        serverUuid: 'srv_1',
        githubAppUuid: 'gh_app_123',
      },
    });
    assert.equal(res.isError, undefined);
    assert.deepEqual(capturedBody, {
      project_uuid: 'proj_1',
      server_uuid: 'srv_1',
      github_app_uuid: 'gh_app_123',
    });
  } finally {
    await close();
  }
});

test('tools: redacts token value if echoed in successful response message', async () => {
  const { client, close, config } = await setupClient(async () => {
    return Response.json({
      message: `Deploying with token Bearer ${config.token}`,
    });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_deploy_application',
      arguments: { resourceUuid: 'app_1' },
    });
    assert.equal(res.isError, undefined);
    const text = extractFirstText(res.content);
    assert.equal(text.includes(config.token), false);
    assert.match(text, /\[REDACTED\]/);
  } finally {
    await close();
  }
});

test('tools: redacts dockerComposeRaw secrets from updateApplication result echoes and errors', async () => {
  const sensitiveCompose = 'version: "3"\nservices:\n  db:\n    environment:\n      POSTGRES_PASSWORD: my-super-secret-password-123\n';
  const { client, close } = await setupClient(async () => {
    return Response.json({
      message: `Updated configuration with compose: ${sensitiveCompose}`,
    });
  });

  try {
    const res = await client.callTool({
      name: 'coolify_update_application',
      arguments: {
        resourceUuid: 'app_1',
        confirmResourceUuid: 'app_1',
        dockerComposeRaw: sensitiveCompose,
      },
    });
    assert.equal(res.isError, undefined);
    const text = extractFirstText(res.content);
    assert.equal(text.includes('my-super-secret-password-123'), false);
    assert.match(text, /\[REDACTED\]/);
  } finally {
    await close();
  }
});
