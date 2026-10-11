# Coolify MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local stdio MCP server that safely exposes full Coolify administration through the public REST API.

**Architecture:** TypeScript MCP adapter over a typed native-`fetch` Coolify client. Resource modules own endpoint mappings; a policy layer owns validation, redaction, bounded output, destructive-operation checks, and retry rules. Stdout is reserved for MCP JSON-RPC; diagnostics go to stderr.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.6.6, `tsx` 4.23.15, native `fetch`, Node test runner, local fake HTTP server.

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
- `AppConfig` contains `baseUrl: string`, `token: string`, `requestTimeoutMs: number`, `maxLogBytes: number`, `apiPrefix: string`. Store URL as a string because freezing a `URL` object does not freeze its setters.

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
  assert.equal(config.baseUrl, 'https://coolify.example/');
  assert.equal(config.apiPrefix, '/api/v1');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

First create only package/test-runner configuration and install pinned dependencies, then run `node --import tsx --test tests/config.test.ts` directly. Expected: missing config module. This is harness setup, not evidence of a behavioral red test. Once implementation exists, exercise the rejection cases above.

- [ ] **Step 3: Add minimal project configuration**

`package.json` must define:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "node --import tsx --test tests/*.test.ts"
  }
}
```

Use the dependency versions in Tech Stack; record resolved versions in `package-lock.json`. Resolve `@types/node` for Node 22 at setup and pin it. Do not add a second HTTP client. Compile only `src/**/*.ts` with `rootDir: src`, `outDir: dist`, `module/moduleResolution: NodeNext`, `target: ES2022`, and `strict: true`; typecheck tests with a separate `tsconfig.test.json` using `noEmit`. Add `typecheck: tsc -p tsconfig.test.json --noEmit`.

- [ ] **Step 4: Implement `loadConfig`**

Reject absent/blank URL or token, URL userinfo/query/hash, non-root URL paths, non-HTTPS scheme, and tokens containing CR/LF. Normalize origin and `/api/v1` prefix; reject absolute/protocol-relative prefixes and traversal. Timeout defaults to 30,000 ms (allowed 1–120,000); log budget defaults to 65,536 bytes (allowed 1–1,048,576). JSON response budget is 1,048,576 bytes. Return frozen plain settings, never log values.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node --import tsx --test tests/config.test.ts && npm run build`
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
- Produces `CoolifyClient` with `constructor(config: AppConfig, transport?: typeof fetch)` and `request(method: HttpMethod, path: string, options?: RequestOptions): Promise<unknown>`.
- `RequestOptions` contains optional `query: Record<string, string | number | boolean>`, `body: unknown`, `signal: AbortSignal`, `maxBytes: number`, and `secretValues: readonly string[]`. No retry flag or secret-bypass flag.
- `HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'`. `CoolifyError` contains `kind`, `status?: number`, `retryAfter?: string`, `retryable: boolean`, and safe `details`.
- Produces `redactSecrets(value: unknown, knownSecrets?: readonly string[]): unknown` and `limitText(value: string, maxBytes: number): { text: string; truncated: boolean }`.

- [ ] **Step 1: Write failing client tests with injected transport**

Cover Bearer auth, encoded query, 204, malformed JSON, timeout including body reads, limits on chunked responses, redaction, and status mapping. Pure client tests inject `fetch`; integration tests use a local HTTP fixture reached ONLY by a test-owned transport adapter that maps the validated HTTPS test origin onto loopback. Production configuration remains HTTPS-only.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';

test('sends bearer auth and parses JSON', async () => {
  const calls: Request[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push(new Request(input, init));
    return Response.json({ uuid: 'app-1', status: 'running' });
  };
  const client = new CoolifyClient(
    loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'test-token' }), fetchStub,
  );
  assert.deepEqual(await client.request('GET', '/applications/app-1'), { uuid: 'app-1', status: 'running' });
  assert.equal(calls[0]?.headers.get('authorization'), 'Bearer test-token');
});
```

- [ ] **Step 2: Run tests and verify expected failures**

Run: `node --import tsx --test tests/coolify-client.test.ts`
Expected: FAIL because client, errors, and redaction modules do not exist.

- [ ] **Step 3: Implement safe error and redaction primitives**

Map statuses to the spec's error kinds. Preserve validated numeric/date `Retry-After` as metadata, never sleep for unbounded values. Recursively redact secret keys and all environment `value`/`real_value` fields regardless of variable name; never return raw Compose content. Scrub the configured bearer token and per-request secret input values from strings before truncation. Free-text logs are sensitive and require explicit `includeSensitive: true` plus `confirmResourceUuid`; redact known credentials and common credential forms but document that arbitrary application secrets cannot be guaranteed redacted. Default log reads return metadata, not raw text.

- [ ] **Step 4: Implement `CoolifyClient`**

Build same-origin URLs from origin, validated prefix and resource-owned paths; reject traversal or absolute request paths. Use `redirect: 'error'` so credentials cannot follow redirects. Maintain timeout until response body completes; count streamed bytes and cancel on overflow even without Content-Length. Parse external data through Zod at resource boundaries, never trust an unchecked generic `T`. No automatic retry in first implementation: classify retryability and expose `Retry-After`; let caller choose another call. This stays within the spec's retry restriction without duplicate mutations.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node --import tsx --test tests/coolify-client.test.ts && npm run build`
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
Each module exports the plain functions defined in Appendix A. All schemas parse real external response shapes; teams have numeric IDs and must not be forced into UUID objects. Coolify UUIDs are opaque non-RFC strings, such as `upfsmih7s60gjfi2dh2rmeil`; use a bounded path-segment schema rather than `z.string().uuid()`.
Logs return `{ resourceUuid, requiresSensitiveOptIn, text?, truncated }`; no raw text without explicit opt-in. Environment lookup means fetching `/envs` then matching environment UUID locally; there is no invented single-variable GET route.
Use the endpoint mapping in Appendix B. Deployment log retrieval extracts `logs` from `GET /deployments/{uuid}`; do not invent `/deployments/{uuid}/logs`. Validate upstream version and response schemas against public reference/controller annotations before running mutations on an instance.

- [ ] **Step 1: Write failing mapping tests**

Use the real CoolifyClient with injected fetch or a loopback fixture adapter. Assert consumer-visible normalized results, invalid-response errors, secret redaction, empty lists, opaque UUIDs and numeric team IDs. Do not keep recorder-only tests that merely repeat method/path constants; exercise the MCP-to-resource-to-client request with distinct fixture responses as shown in Appendix C.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --import tsx --test tests/resources-read.test.ts`
Expected: FAIL because resource modules do not exist.

- [ ] **Step 3: Implement resource modules in independent slices**

Implement teams/projects, applications, services/databases, servers, deployments/logs, and environment reads as separate modules. Use the current public routes (`GET /team`, `GET /teams`, `GET /projects`, `GET /applications`, `GET /services`, `GET /databases`, `GET /servers`, `GET /deployments`, `GET /applications/{uuid}/logs`, `GET /databases/{uuid}/logs`, `GET /services/{uuid}/logs`, and resource `/envs` routes); keep endpoint constants in each module and do not duplicate request construction.

- [ ] **Step 4: Run focused tests**

Run: `node --import tsx --test tests/resources-read.test.ts`
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

Test deploy/restart/stop/cancel return actual operation IDs (not fabricated status), env set/delete omit values even when upstream echoes them, and resource deletion uses correct target. Test matched delete calls through the real resource layer plus fake HTTP transport; mismatched/blank IDs must reject before transport. No duplicate state mutations after timeout/429.

```ts
test('rejects delete confirmation mismatch before network access', async () => {
  let requests = 0;
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'fixture-token' });
  const transport: typeof fetch = async () => { requests++; return Response.json({ message: 'deleted' }); };
  const client = new CoolifyClient(config, transport);
  await assert.rejects(deleteApplication(client, 'app1', 'app2'));
  assert.equal(requests, 0);
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --import tsx --test tests/resource-mutations.test.ts`
Expected: FAIL because mutation functions and policy do not exist.

- [ ] **Step 3: Implement policy and mutation modules**

Use only documented Coolify REST routes: project CRUD under `/projects`, application CRUD/actions under `/applications`, service CRUD/actions under `/services`, database CRUD/actions under `/databases`, deployment actions under `/deploy` and `/deployments`, and environment operations under each resource's `/envs`. Mark deletes as destructive in operation metadata. Validate UUIDs and non-empty required fields before calling the client. Do not retry deploy/delete/env mutations. For environment writes, accept `{ key, value, isPreview?, isLiteral?, isMultiline? }`; never include `value` in returned data or thrown messages.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `node --import tsx --test tests/resource-mutations.test.ts && npm run build`
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
Produces `createMcpServer(config: AppConfig, transport?: typeof fetch): McpServer`. Dependency injection is only the HTTP transport; resource operations remain real in tests.
`registerTools(server: McpServer, client: CoolifyClient, config: AppConfig): void` builds resource operations and registers handlers. Do not add a one-implementation factory/interface for every tool.
Registers exact tool names from the spec: read, operational, configuration, and lifecycle groups.
Each tool input is Zod-validated before resource operation calls.
Tool result is JSON-safe bounded content; errors are safe normalized messages.

- [ ] **Step 1: Write failing tool registration tests**

Use official SDK Client with InMemoryTransport to invoke real handlers over fixture HTTP transport. Assert read content, env secret omission, typed bad-input errors, and invalid delete does not reach network. Check destructive annotations through tools/list as protocol compatibility smoke, not an additional permanent wiring-only test.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --import tsx --test tests/tools.test.ts`
Expected: FAIL because MCP adapter does not exist.

- [ ] **Step 3: Implement `src/tools.ts`**

Create tool schemas and handlers. Keep handlers thin: parse input, call resource operation, redact/bound output, return MCP content. Do not put raw fetch calls in handlers. Use destructive descriptions stating that client confirmation is required.

- [ ] **Step 4: Implement `createMcpServer`**

Instantiate the MCP server with the official SDK, register tools from `src/tools.ts`, and inject configured client/resource dependencies. Keep stdout untouched except SDK protocol output.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `node --import tsx --test tests/tools.test.ts && npm run build`
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

Spawn the built `dist/index.js` using the official SDK `Client` and `StdioClientTransport`, with synthetic HTTPS URL/token. Initialization and `tools/list` must not contact Coolify; no fixture network server is needed for this smoke. Invoke invalid delete input and prove a safe MCP error before any network access. Parse stdout as protocol messages; keep stderr separate. For a real transport integration exercise, use the loopback fixture adapter described in Task 2, never disable production TLS validation.

- [ ] **Step 2: Run smoke test and verify failure**

Run: `node --import tsx --test tests/stdio-smoke.test.ts`
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

Run: `npm run build && npm run typecheck && npm test`. Build must run before smoke because it starts `dist/index.js`.
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

## Appendix A: Shared contracts and parallel execution

Execution method is **subagent-driven**, as requested by the user. Planning and integration owner use **6.1 Sol**. Requested builder tiers: **3.8 Flash low** for deterministic files/docs; **3.8 Flash high** for transport, validation, resource operations, and protocol integration. Before dispatch, verify that the runtime exposes the exact model IDs and reasoning settings. Agent names (`task`, `sonic`, `reviewer`) are not model guarantees. Do not claim an exact model was used without observing routing metadata, and do not silently replace unavailable tiers. This planning session does not change global model configuration.

### Ownership and dependency waves

1. Parent locks configuration, request, policy, tool, and response contracts below. Setup is done inline by integration owner; do not delegate a standalone tiny scaffold job.
2. Wave 1 has two independent substantive slices: **transport + safe error handling** and **redaction + input policy**. Both use Flash high; parent owns configuration and package files. Redaction owner creates `src/policy.ts`, transport owner does not edit it.
3. After shared core exists, Wave 2 dispatches **applications + deployments**, **services + databases**, and **teams + projects + servers + environment** concurrently. Each owner implements both read AND mutation methods in their module and its behavioral tests; do not have separate read/mutation agents editing the same files. Tasks 3 and 4 are logical acceptance gates, not separate ownership waves.
4. Wave 3: parent integrates tool registrations and stdio entrypoint; independent Flash low worker writes README/client examples from the now-fixed manifest. Do not delegate sub-30-line edits or run a worker merely to consume a tier.
5. Fresh reviewer examines full branch, concentrating on root-token exposure, redirects, env/log secrets, destructive confirmation, and actual SDK input validation. Sol owns final corrections and evidence.

All workers receive the approved spec, this plan, exact owned file list and shared contract. Workers **skip build/lint/tests/formatters mid-flight**. Parent runs the relevant red/green check at each wave gate, then one complete build/typecheck/test and executable smoke after integration. Do not commit shared working tree while workers are editing. No worker changes SDK versions or exported interfaces without sending a message to integration owner.

### Exact exported interfaces

Keep operations as plain functions grouped within modules. No per-resource factory abstraction is required. Every function's first parameter is `client: Pick<CoolifyClient, 'request'>` unless indicated otherwise.

```ts
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';
export interface RequestOptions {
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  signal?: AbortSignal;
  maxBytes?: number;
  secretValues?: readonly string[];
}
export interface ResourceView {
  uuid: string;
  name?: string;
  status?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  metadata: Record<string, unknown>;
}
export interface TeamView { id: number; name?: string }
export interface OperationResult {
  resourceUuid?: string;
  operationId?: string;
  message?: string;
  status?: string;
}
export interface LogOptions {
  resourceUuid: string;
  includeSensitive?: boolean;
  confirmResourceUuid?: string;
  maxBytes?: number;
}
export interface LogResult {
  resourceUuid: string;
  requiresSensitiveOptIn: boolean;
  text?: string;
  truncated: boolean;
}
export type EnvScope =
  | { kind: 'application' | 'service' | 'database' | 'server' | 'project'; resourceUuid: string }
  | { kind: 'team' };
export interface EnvView {
  uuid?: string;
  id?: number;
  key: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
  value: '[REDACTED]';
}
export interface EnvInput {
  resourceUuid: string;
  envUuid?: string;
  key: string;
  value: string;
  isPreview?: boolean;
  isRuntime?: boolean;
  isBuildtime?: boolean;
  isLiteral?: boolean;
  isMultiline?: boolean;
}
export interface EnvChange { key: string; scope: string; changed: boolean }
```

Required exports by module:

- `teams.ts`: `getCurrentTeam(client): Promise<TeamView>`, `listTeams(client): Promise<TeamView[]>`.
- `projects.ts`: `listProjects(client): Promise<ResourceView[]>`, `getProject(client, resourceUuid): Promise<ResourceView>`, `createProject(client, input): Promise<OperationResult>`, `deleteProject(client, resourceUuid, confirmResourceUuid): Promise<OperationResult>`.
- `applications.ts`: `listApplications`, `getApplication`, `createApplication`, `updateApplication`, `deleteApplication`, `restartApplication`, `stopApplication`.
- `services.ts`: `listServices`, `getService`, `createService`, `updateService`, `deleteService`, `startService`, `restartService`, `stopService`.
- `databases.ts`: `listDatabases`, `getDatabase`, `createDatabase`, `updateDatabase`, `deleteDatabase`, `startDatabase`, `restartDatabase`, `stopDatabase`.
- `servers.ts`: `listServers`, `getServer`, `deleteServer`.
- `deployments.ts`: `listDeployments`, `getDeployment`, `deployApplication`, `cancelDeployment`.
- `environment.ts`: `listEnvironmentVariables(client, scope): Promise<EnvView[]>`, `getEnvironmentVariable(client, scope, envUuid): Promise<EnvView>`, `setApplicationEnvironmentVariable(client, input: EnvInput): Promise<EnvChange>`, `deleteApplicationEnvironmentVariable(client, resourceUuid, envUuid, confirmResourceUuid): Promise<EnvChange>`.
- `logs.ts`: `getApplicationLogs(client, config, options: LogOptions): Promise<LogResult>` and `getDeploymentLogs(client, config, options: LogOptions): Promise<LogResult>`.
- `types.ts`: all interfaces above plus schema validators and `normalizeResource(raw: unknown): ResourceView`, `normalizeOperation(raw: unknown): OperationResult`. Keep API parsing close to the operation if different endpoints use different shapes.
- `policy.ts`: `resourceIdSchema`, `assertDeleteConfirmation(resourceUuid, confirmResourceUuid): void`, and `assertSensitiveRead(options: LogOptions): void`.

All list/get names above take only `client` and optional `resourceUuid` respectively and return `Promise<ResourceView[]>` / `Promise<ResourceView>`, except teams and deployment lists. Mutation action names take `client, resourceUuid` and return `Promise<OperationResult>`; deletes also take `confirmResourceUuid`. Create/update inputs are strict resource-specific Zod schemas confirmed from public Coolify controller/OpenAPI definitions, never `Record<string, unknown>` payload pass-through. Deploy accepts `{ resourceUuid, force?: boolean }`. Lists preserve actual pagination metadata if present instead of claiming completeness.

Database creation is a discriminated union of the documented types `postgresql`, `mysql`, `mariadb`, `mongodb`, `redis`, `clickhouse`, `dragonfly`, `keydb`, and `sqlite`. Application creation is a discriminated union of `public`, `private-github-app`, `private-deploy-key`, `dockerfile`, and `dockerimage`. Unsupported variants on the target version must fail explicitly; never dispatch to an invented generic POST collection.

## Appendix B: Public endpoint manifest

Sources read while planning:

- `https://coolify.io/docs/api/overview`
- `https://coolify.io/docs/api/permissions`
- `https://raw.githubusercontent.com/coollabsio/coolify/main/routes/api.php`
- `https://api.github.com/repos/coollabsio/coolify/contents/routes`

Upstream main is mutable and may be ahead of the installed instance. Before code, record upstream commit/version and snapshot the needed public request/response schemas; read the relevant controllers named in `routes/api.php` for create/update request validation. Run only read-only `/version` against an authorized instance during manual compatibility smoke. No database inspection needed.

| Tool group | API method and route | Notes |
| --- | --- | --- |
| Current team / teams | `GET /team`, `GET /teams` | Current main uses `/team`; choose supported route for the pinned version rather than silently retrying aliases. |
| Projects | `GET/POST /projects`, `GET/DELETE /projects/{uuid}` | Create requires documented name fields. |
| Applications | `GET /applications`, `GET/PATCH/DELETE /applications/{uuid}` | Create uses `POST /applications/{creationType}` union above. |
| Services | `GET/POST /services`, `GET/PATCH/DELETE /services/{uuid}` | Compose input is sensitive; never echo it. |
| Databases | `GET /databases`, `GET/PATCH/DELETE /databases/{uuid}` | Create uses `POST /databases/{type}`. |
| Servers | `GET /servers`, `GET/DELETE /servers/{uuid}` | No shell or server cleanup commands. |
| Deploy application | `POST /deploy` | Documented body with `uuid`; never `GET` for side effects. |
| Restart / stop app | `POST /applications/{uuid}/restart`, `POST /applications/{uuid}/stop` | May return message or deployment ID, not always status. |
| Start / restart / stop service | `POST /services/{uuid}/{action}` | Explicit action enum; no arbitrary suffix. |
| Start / restart / stop database | `POST /databases/{uuid}/{action}` | Explicit action enum. |
| Deployments | `GET /deployments`, `GET /deployments/{uuid}`, `POST /deployments/{uuid}/cancel` | Build logs live inside deployment response. |
| Application logs | `GET /applications/{uuid}/logs` | Requires `read:sensitive` or root, plus local opt-in. |
| Env list | `GET /applications/{uuid}/envs` and service/database/server/project/team equivalents | Responses always redact values. |
| App env set | `POST /applications/{uuid}/envs` for create, `PATCH /applications/{uuid}/envs` for supplied `envUuid` update | Do not invent PUT/upsert; map SDK input flags to documented snake_case. |
| App env delete | `DELETE /applications/{uuid}/envs/{env_uuid}` | Identity check binds both app UUID and env UUID; explicit client approval required. |

## Appendix C: Runnable check patterns

These examples use final function exports and must be adapted only for verified response schema differences. Assertions cover real policy/consumer behavior, not source text or mock forwarding.

### Input and delete guard implementation

```ts
import { z } from 'zod';

export const resourceIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
export function assertDeleteConfirmation(resourceUuid: string, confirmResourceUuid: string): void {
  const target = resourceIdSchema.parse(resourceUuid);
  const confirmation = resourceIdSchema.parse(confirmResourceUuid);
  if (target !== confirmation) throw new Error('Resource confirmation does not match');
}
```

Never put caller-supplied IDs in an error if they may contain credentials; fixed validation message is sufficient.

### Missing confirmation prevents deletion

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { deleteApplication } from '../src/resources/applications.js';

test('mismatched target confirmation cannot delete an application', async () => {
  let requests = 0;
  const transport: typeof fetch = async () => {
    requests++;
    return Response.json({ message: 'Application deletion queued.' });
  };
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'fixture-token' });
  const client = new CoolifyClient(config, transport);
  await assert.rejects(deleteApplication(client, 'upfsmih7s60gjfi2dh2rmeil', 'wrong_target'));
  assert.equal(requests, 0);
});
```

### Secret value cannot leak from environment response

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { listEnvironmentVariables } from '../src/resources/environment.js';

test('environment inspection redacts even non-secret-looking variable names', async () => {
  const transport: typeof fetch = async () => Response.json([
    { uuid: 'env_1', key: 'CUSTOM_CONFIG', value: 'private-value', real_value: 'private-value', is_preview: false },
  ]);
  const config = loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'fixture-token' });
  const rows = await listEnvironmentVariables(new CoolifyClient(config, transport), {
    kind: 'application', resourceUuid: 'app_1',
  });
  assert.equal(rows[0]?.key, 'CUSTOM_CONFIG');
  assert.equal(rows[0]?.value, '[REDACTED]');
  assert.equal(JSON.stringify(rows).includes('private-value'), false);
});
```

### JSON-RPC process smoke

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('built stdio process initializes and denies mismatched deletion', async () => {
  const client = new Client({ name: 'smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { ...process.env, COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'fixture-token' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'coolify_delete_application'));
    const result = await client.callTool({ name: 'coolify_delete_application', arguments: {
      resourceUuid: 'app_1', confirmResourceUuid: 'app_2',
    } });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
```

SDK schema/rejection semantics must be checked against version 1.32.1. Whether invalid input returns `isError` or raises a protocol error, retain the safety assertion that no endpoint is called. No initialized process may attempt network access just to list tools.

### Five review-focus cases assigned to tests

1. Config tests: reject HTTP, embedded userinfo, credential query/hash, whitespace/CRLF token, protocol-relative/traversing prefix; errors never echo inputs.
2. Client tests: streaming body over budget without Content-Length; body stalls after headers until deadline; malformed/non-JSON 5xx containing bearer token is scrubbed.
3. Client tests: table of 401/403/404/409/422/429/500, safe `kind`, correct status, `Retry-After` retained; mutations are issued once even on timeout or 429; redirects rejected before credentials cross origin.
4. Policy/MCP tests: blank/mismatched target confirmation, malformed opaque UUID, env secret echoed by upstream, delete response for a different target rejected.
5. Smoke: built process handshake, tools/list and invalid deletion through official client; failure to initialize if stdout contains diagnostics, missing-config exit is nonzero and stderr never contains token.

## Final handoff and verification order

- The requested model selection is a routing requirement, not implemented by naming agents. Verify available routing before starting builders.
- Parent owns one integration branch in `/Users/minhmice/Documents/Projects/coolify-mcp`; keep license-platform repo unchanged.
- Build before all tests because stdio smoke consumes compiled artifact: `npm run build && npm run typecheck && npm test`.
- After tests, run actual `node dist/index.js` through the SDK client and observe handshake and tool errors. Then, using an explicitly approved sandbox Coolify app, verify read, env mutation, deploy and deployment result; destructive exercises only on disposable resources. Missing authorized sandbox prevents live claim, not local completion proof.
- Update README/changelog after executable smoke evidence. Do not claim live success from mocked HTTP tests.
- Human reviews this plan before any product code is written. The preserved execution choice is subagent-driven; no need to ask which execution method again.

## Appendix D: Coverage and execution checks

| Spec requirement | Owner / executable evidence |
| --- | --- |
| Config + HTTPS + stdout discipline | Tasks 1/6; config rejection cases and built-process MCP smoke |
| All 42 named tools | Tasks 3/4/5; manifest below and tools/list smoke |
| Typed create/update requests | Task 4; discriminated app/database variants, strict Zod schemas from pinned API |
| Safe environment read/write | Tasks 2/3/4; env value omission, interpolation flags, echoed-secret error tests |
| Destructive safety | Tasks 4/5; rejected IDs before network, client permission configuration documented |
| Bounded logs/errors/results | Tasks 2/3/5; UTF-8 byte limits, truncated flag, protocol output budget |
| No duplicate mutation | Tasks 2/4; zero automatic retries, no follow-up action from reads |
| Real MCP execution | Tasks 6/7; SDK client talks to built process, observes results and safe errors |
| Full-admin token team boundary | Task 7/manual sandbox; authorization failures preserve 401/403, no scope bypass |

Required tool manifest (18 reads, 10 operations, 5 configuration, 9 lifecycle; total 42):

```text
coolify_get_current_team
coolify_list_teams
coolify_list_projects
coolify_get_project
coolify_list_applications
coolify_get_application
coolify_list_services
coolify_get_service
coolify_list_databases
coolify_get_database
coolify_list_servers
coolify_get_server
coolify_list_deployments
coolify_get_deployment
coolify_get_application_logs
coolify_get_deployment_logs
coolify_list_environment_variables
coolify_get_environment_variable
coolify_deploy_application
coolify_restart_application
coolify_stop_application
coolify_cancel_deployment
coolify_start_service
coolify_stop_service
coolify_restart_service
coolify_start_database
coolify_stop_database
coolify_restart_database
coolify_set_application_environment_variable
coolify_delete_application_environment_variable
coolify_update_application
coolify_update_service
coolify_update_database
coolify_create_project
coolify_delete_project
coolify_create_application
coolify_delete_application
coolify_create_service
coolify_delete_service
coolify_create_database
coolify_delete_database
coolify_delete_server
```

Do not expand to service/database log tools just because resource routes exist; the approved tool manifest covers application and deployment logs. Safe helpers may support shared formats without adding new public tools. Env list/get supports the explicit scopes in Appendix A; writes remain application-specific.

Tool output encodes normalized JSON as `content: [{ type: 'text', text: JSON.stringify(safeValue) }]`; safe tool failures return `isError: true`. Catch validation errors without reflecting invalid input. Do not return raw upstream data in `structuredContent`. Lists are bounded by the 1 MiB JSON transport budget, never silently sliced; oversized responses return a safe limit error. Log text clips at UTF-8 codepoint boundary with `truncated: true`. Stop/cancel, updates that overwrite configuration, env deletion, and all resource deletions are annotated destructive. Creation/deploy remains non-read-only and not idempotent. No tool has an HTTP method or URL override argument.

Environment deletion input additionally includes `envUuid` and `confirmEnvUuid` and requires both matches before sending a request; confirming only the app cannot authorize deleting a different variable. Source resource UUID and env UUID are path segments validated by policy, not arbitrary strings. Never claim a deletion has completed if API only queued it.

Transport returns raw bounded `unknown` internally; resource normalization removes secrets before MCP exposure. Existing `maxOutputTokens`, unrelated provider settings, SSH passwords, domain names and developer license keys from the preceding license-platform conversation do not belong in this repo.

Self-review resolved: no automatic mutation retries, no fake HTTP config bypass, no RFC-UUID assumption, no fictitious deployment log route, no tool/server per-resource factories, and no model-name guarantee based solely on agent labels. README examples use placeholders only. Build precedes smoke; no production changes during plan creation.
