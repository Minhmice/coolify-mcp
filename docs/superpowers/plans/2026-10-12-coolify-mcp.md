# Coolify MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local stdio MCP server that safely exposes full Coolify administration through the public REST API.

**Architecture:** TypeScript MCP adapter over a typed native-`fetch` Coolify client. Resource modules own endpoint mappings; a policy layer owns validation, redaction, bounded output, destructive-operation checks, and retry rules. Stdout is reserved for MCP JSON-RPC; diagnostics go to stderr.

**Tech Stack:** Node.js 22+, TypeScript, official MCP TypeScript SDK, native `fetch`, Zod, Node test runner, local fake HTTP server.

**Spec:** `docs/superpowers/specs/2026-10-12-coolify-mcp-design.md`

## Global Constraints

- Local stdio only; no HTTP MCP transport in first release.
- Required env: `COOLIFY_URL`, `COOLIFY_TOKEN`.
- Optional env: `COOLIFY_API_PREFIX` default `/api/v1`, `COOLIFY_REQUEST_TIMEOUT_MS`, `COOLIFY_MAX_LOG_BYTES`.
- Coolify API remains authorization source of truth; resources stay team-scoped.
- Token only in `Authorization: Bearer`; never source, output, logs, or errors.
- HTTPS required; no arbitrary shell, Docker, SSH, or Coolify DB tool.
- Reads redact secret/password/private-key/token values by default.
- Delete inputs require identical `resourceUuid` and `confirmResourceUuid`; MCP annotations do not replace client confirmation.
- Retry only idempotent reads and explicitly idempotent operations; never blindly retry delete, deploy, or env mutation.
- Tests never call production Coolify.

## Review Focus

- Missing or insecure configuration must fail before MCP startup without leaking token — Task 1 test.
- Malformed JSON, non-JSON, oversized, and secret-bearing Coolify responses must normalize safely — Task 2 tests.
- `401`, `403`, `404`, `409`, `422`, `429`, `5xx`, timeout, and network failures must preserve useful safe context — Task 2 tests.
- Destructive calls with mismatched confirmation IDs must make no HTTP request — Task 5 tests.
- stdout must contain only MCP protocol frames while logs/errors go to stderr — Task 6 stdio smoke test.

---

### Task 1: Project scaffold and immutable configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Create: `README.md`

**Interfaces:**
- Produces `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`.
- `AppConfig` contains `baseUrl: URL`, `token: string`, `requestTimeoutMs: number`, `maxLogBytes: number`, `apiPrefix: string`.

- [ ] **Step 1: Write failing configuration tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('rejects missing Coolify URL and token', () => {
  assert.throws(() => loadConfig({}), /COOLIFY_URL/);
  assert.throws(() => loadConfig({ COOLIFY_URL: 'https://coolify.example' }), /COOLIFY_TOKEN/);
});

test('rejects plain HTTP and normalizes API prefix', () => {
  assert.throws(() => loadConfig({ COOLIFY_URL: 'http://coolify.example', COOLIFY_TOKEN: 'x' }), /HTTPS/);
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example/', COOLIFY_TOKEN: 'x', COOLIFY_API_PREFIX: '/api/v1/' });
  assert.equal(config.baseUrl.toString(), 'https://coolify.example/');
  assert.equal(config.apiPrefix, '/api/v1');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL because `src/config.ts` and project scripts do not exist.

- [ ] **Step 3: Add minimal project configuration**

`package.json` must define:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "node --import tsx --test"
  }
}
```

Use the official MCP TypeScript SDK, `zod`, `tsx`, `typescript`, and Node type definitions. Pin dependency versions during implementation from the current stable release; do not add a second HTTP client.

- [ ] **Step 4: Implement `loadConfig`**

Reject absent `COOLIFY_URL`/`COOLIFY_TOKEN`, reject non-HTTPS URLs, strip trailing slash from `apiPrefix`, parse positive finite timeout and max-log-byte values, and return a frozen `AppConfig`. Do not log token or full config.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/config.test.ts && npm run build`
Expected: PASS and exit code 0.

- [ ] **Step 6: Commit scaffold**

```bash
git add package.json tsconfig.json .gitignore .env.example src/config.ts tests/config.test.ts README.md
git commit -m "chore: scaffold local Coolify MCP server"
```

---

### Task 2: Typed Coolify REST client, errors, redaction, and bounds

**Files:**
- Create: `src/coolify/errors.ts`
- Create: `src/coolify/redaction.ts`
- Create: `src/coolify/client.ts`
- Create: `tests/coolify-client.test.ts`

**Interfaces:**
- Produces `CoolifyClient` with `request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T>`.
- `RequestOptions` contains optional `query`, `body`, `signal`, `retryable`, and `maxBytes`.
- `CoolifyError` contains `kind`, `status?: number`, `coolifyCode?: string`, `retryable: boolean`, and safe `details`.
- Produces `redactSecrets(value: unknown): unknown` and `limitText(value: string, maxBytes: number): string`.

- [ ] **Step 1: Write failing client tests against a local fake HTTP server**

Cover: Bearer header, JSON success, 204 success, timeout, invalid JSON, response limit, redaction of keys matching `token`, `password`, `secret`, `private_key`, and status mapping for 401/403/404/409/422/429/5xx.

```ts
test('sends bearer auth and parses JSON', async () => {
  const server = await createFakeServer((request) => {
    assert.equal(request.headers.get('authorization'), 'Bearer test-token');
    return Response.json({ uuid: 'app-1', status: 'running' });
  });
  const client = new CoolifyClient(loadConfig({ COOLIFY_URL: server.url, COOLIFY_TOKEN: 'test-token' }), fetch);
  assert.deepEqual(await client.request('GET', '/applications/app-1'), { uuid: 'app-1', status: 'running' });
  await server.close();
});
```

- [ ] **Step 2: Run tests and verify expected failures**

Run: `npm test -- tests/coolify-client.test.ts`
Expected: FAIL because client, errors, and redaction modules do not exist.

- [ ] **Step 3: Implement safe error and redaction primitives**

Map HTTP statuses to the spec's error kinds, preserve `Retry-After` for 429, truncate response details, and strip credentials recursively from objects and arrays. Redaction must work for both object keys and serialized error bodies.

- [ ] **Step 4: Implement `CoolifyClient`**

Build URLs from `baseUrl`, `apiPrefix`, path, and encoded query values. Create an `AbortController` timeout. Send JSON only when a body exists. Parse bounded response bytes before JSON parsing. Retry one time only for retryable idempotent requests after a bounded delay; never retry mutation methods unless `options.retryable === true` is explicitly passed by a resource operation.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/coolify-client.test.ts && npm run build`
Expected: PASS and exit code 0.

- [ ] **Step 6: Commit client layer**

```bash
git add src/coolify tests/coolify-client.test.ts
git commit -m "feat: add typed Coolify REST client with safe errors"
```

---

### Task 3: Resource API modules and normalized read operations

**Files:**
- Create: `src/resources/types.ts`
- Create: `src/resources/teams.ts`
- Create: `src/resources/projects.ts`
- Create: `src/resources/applications.ts`
- Create: `src/resources/services.ts`
- Create: `src/resources/databases.ts`
- Create: `src/resources/servers.ts`
- Create: `src/resources/deployments.ts`
- Create: `src/resources/logs.ts`
- Create: `src/resources/environment.ts`
- Create: `tests/resources-read.test.ts`

**Interfaces:**
- Every resource module consumes `CoolifyClient` and exports typed functions with UUID/string inputs.
- Read functions return `NormalizedResource` objects with `uuid`, `name?`, `status?`, `createdAt?`, `updatedAt?`, and safe `metadata`.
- `getApplicationLogs(uuid, maxBytes)` and `getDeploymentLogs(uuid, maxBytes)` return bounded text.
- Endpoint paths must match the Coolify API reference validated during implementation; unsupported endpoint shapes must produce `CoolifyError`, not guessed requests.

- [ ] **Step 1: Write failing mapping tests**

Use a fake client/request recorder. Verify each read operation calls the expected public `/api/v1` route, passes UUIDs as path segments, redacts secret fields, and normalizes response shape. Include empty list and missing optional fields.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/resources-read.test.ts`
Expected: FAIL because resource modules do not exist.

- [ ] **Step 3: Implement resource modules in independent slices**

Implement teams/projects, applications, services/databases, servers, deployments/logs, and environment reads as separate modules. Keep endpoint constants in each module; do not duplicate request construction.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/resources-read.test.ts`
Expected: PASS with all route/mapping/redaction assertions.

- [ ] **Step 5: Commit resource read layer**

```bash
git add src/resources tests/resources-read.test.ts
git commit -m "feat: add normalized Coolify resource reads"
```

---

### Task 4: Operational, configuration, and lifecycle resource mutations

**Files:**
- Modify: `src/resources/applications.ts`
- Modify: `src/resources/services.ts`
- Modify: `src/resources/databases.ts`
- Modify: `src/resources/deployments.ts`
- Modify: `src/resources/environment.ts`
- Modify: `src/resources/projects.ts`
- Modify: `src/resources/servers.ts`
- Create: `src/policy.ts`
- Create: `tests/resource-mutations.test.ts`

**Interfaces:**
- `policy.assertDeleteConfirmation(resourceUuid: string, confirmResourceUuid: string): void`.
- Mutation functions return `{ operationId?: string; status?: string; resourceUuid?: string }` without secret values.
- Environment mutation returns `{ key: string; scope: string; changed: boolean }`.

- [ ] **Step 1: Write failing mutation and safety tests**

Test deploy/restart/stop/cancel method/body mappings, service/database actions, environment set/delete without echoing values, create/delete calls, and zero HTTP calls for mismatched delete confirmations.

```ts
test('rejects delete confirmation mismatch before HTTP call', async () => {
  const client = fakeClientThatCountsRequests();
  await assert.rejects(() => deleteApplication(client, 'app-1', 'app-2'), /confirmation/i);
  assert.equal(client.requestCount, 0);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/resource-mutations.test.ts`
Expected: FAIL because mutation functions and policy do not exist.

- [ ] **Step 3: Implement policy and mutation modules**

Use only documented Coolify REST routes. Mark deletes as destructive in operation metadata. Validate UUIDs and non-empty required fields before calling the client. Do not retry deploy/delete/env mutations. For environment writes, accept `{ key, value, isPreview?, isLiteral?, isMultiline? }`; never include `value` in returned data or thrown messages.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- tests/resource-mutations.test.ts && npm run build`
Expected: PASS and exit code 0.

- [ ] **Step 5: Commit mutation layer**

```bash
git add src/resources src/policy.ts tests/resource-mutations.test.ts
git commit -m "feat: add Coolify operations and lifecycle mutations"
```

---

### Task 5: MCP tool adapter and destructive metadata

**Files:**
- Create: `src/tools.ts`
- Create: `src/server.ts`
- Create: `tests/tools.test.ts`

**Interfaces:**
- Produces `createMcpServer(config: AppConfig): McpServer`.
- Registers exact tool names from the spec: read, operational, configuration, and lifecycle groups.
- Each tool input is Zod-validated before resource operation calls.
- Tool result is JSON-safe bounded content; errors are safe normalized messages.

- [ ] **Step 1: Write failing tool registration tests**

Assert all specified tool names are registered, read tools are non-destructive, mutation tools have correct descriptions/annotations, and delete input requires matching confirmation IDs. Invoke at least one read and one mutation through a fake resource/client dependency.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/tools.test.ts`
Expected: FAIL because MCP adapter does not exist.

- [ ] **Step 3: Implement `src/tools.ts`**

Create tool schemas and handlers. Keep handlers thin: parse input, call resource operation, redact/bound output, return MCP content. Do not put raw fetch calls in handlers. Use destructive descriptions stating that client confirmation is required.

- [ ] **Step 4: Implement `createMcpServer`**

Instantiate the MCP server with the official SDK, register tools from `src/tools.ts`, and inject configured client/resource dependencies. Keep stdout untouched except SDK protocol output.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- tests/tools.test.ts && npm run build`
Expected: PASS and exit code 0.

- [ ] **Step 6: Commit MCP adapter**

```bash
git add src/tools.ts src/server.ts tests/tools.test.ts
git commit -m "feat: expose Coolify operations as MCP tools"
```

---

### Task 6: stdio entrypoint, smoke test, README, and client configuration

**Files:**
- Create: `src/index.ts`
- Create: `tests/stdio-smoke.test.ts`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- `src/index.ts` loads config, creates the MCP server, and connects stdio transport.
- Startup failures go to stderr and exit non-zero; no token value appears in output.

- [ ] **Step 1: Write failing stdio smoke test**

Spawn `node --import tsx src/index.ts` with placeholder HTTPS URL/token and a local fake server. Send MCP `initialize` then `tools/list` JSON-RPC frames over stdin. Assert valid protocol frames on stdout, expected tool names, and no diagnostics mixed into stdout.

- [ ] **Step 2: Run smoke test and verify failure**

Run: `npm test -- tests/stdio-smoke.test.ts`
Expected: FAIL because the entrypoint and transport wiring do not exist.

- [ ] **Step 3: Implement stdio entrypoint**

Load and validate config, construct client/resource/tool dependencies, connect official stdio transport, and catch startup errors with a safe stderr message. Never print environment values.

- [ ] **Step 4: Document installation and OMP/Claude configuration**

README must include:

```json
{
  "mcpServers": {
    "coolify": {
      "command": "node",
      "args": ["/absolute/path/to/coolify-mcp/dist/index.js"],
      "env": {
        "COOLIFY_URL": "https://coolify.example.com",
        "COOLIFY_TOKEN": "<stored-secret>"
      }
    }
  }
}
```

Document token permissions, team scope, secret redaction, destructive-tool confirmation, token rotation, build/start/test commands, and supported Coolify API assumptions. `.env.example` contains placeholders only.

- [ ] **Step 5: Run complete verification**

Run: `npm test && npm run build`
Expected: all tests pass, TypeScript build exits 0, no stdout diagnostics.

- [ ] **Step 6: Commit runnable server**

```bash
git add src/index.ts tests/stdio-smoke.test.ts README.md .env.example package.json
 git commit -m "feat: add runnable local stdio Coolify MCP server"
```

---

### Task 7: Whole-branch review and release readiness

**Files:**
- Review: all files in `src/`, `tests/`, `README.md`, `.env.example`, `package.json`
- Modify: only files required by review findings

- [ ] **Step 1: Run full tests and build**

```bash
npm test
npm run build
```

- [ ] **Step 2: Run secret and protocol checks**

Confirm `git grep` finds no real Coolify token, `COOLIFY_TOKEN` values never appear in stdout/error snapshots, and stdio output parses as JSON-RPC only.

- [ ] **Step 3: Review every spec acceptance criterion**

Check local initialization/tool listing, read operations, bounded deploy/restart/stop results, env redaction, delete confirmation, safe errors, and test/smoke coverage. Add a regression test for any uncovered criterion before modifying implementation.

- [ ] **Step 4: Commit review fixes**

```bash
git add .
git commit -m "chore: harden Coolify MCP release"
```
