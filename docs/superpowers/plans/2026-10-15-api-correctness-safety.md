# Plan 1: Coolify API Correctness & Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the 42-tool Coolify MCP server into a fully verified, strictly validated, and secret-safe administrative toolset pinned to Coolify v4 API contracts.

**Architecture:** A single canonical camelCase Zod schema layer shared directly between MCP tool registrations and HTTP resource operations. Safe request transformation with strict rejection of unknown/empty inputs, zero-network-call policy enforcement on confirmation mismatches, comprehensive output-boundary secret/URL redaction, and log isolation.

**Tech Stack:** Node.js 22+, TypeScript 7.0.2, `@modelcontextprotocol/sdk` 1.32.1, `zod` 4.6.6, `tsx` 4.23.15, native `fetch`, Node.js built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-15-api-correctness-safety-design.md`

## Global Constraints

- Full administration within configured token's team scope; no team bypass.
- Local stdio transport only; stdout strictly reserved for MCP JSON-RPC protocol frames; diagnostics use stderr.
- Public Coolify REST API only (`/api/v1`); no arbitrary shell, Docker, SSH, or direct database tools.
- HTTPS required; plain HTTP rejected at startup.
- Token sent exclusively in `Authorization: Bearer` header; never in logs, stdout, error details, or documentation.
- One canonical public field spelling per tool: camelCase only. Duplicate snake_case/public aliases removed.
- Resource schemas and MCP schemas share validation definitions; unknown fields rejected (`.strict()`).
- Delete operations require identical `resourceUuid` and `confirmResourceUuid`.
- Environment deletion requires matching `resourceUuid`/`confirmResourceUuid` AND matching `envUuid`/`confirmEnvUuid`.
- Environment variable values, database credentials, Sanctum tokens (`id|secret`), and Compose content redacted from all responses and errors.
- Ordinary deployment reads never include logs; logs only accessible via dedicated log tools with explicit sensitive opt-in.
- Tests never call production Coolify; live verification restricted to authorized sandbox environments.

## Review Focus

- **Sanctum token leak via partial match**: Tokens with pipe `id|secret` must be completely scrubbed before pattern replacement runs — Task 3 test.
- **Credential disclosure in database connection strings**: URLs like `postgres://user:password@host:port/db` must have passwords replaced with `[REDACTED]` — Task 3 test.
- **Silent parameter drop between MCP and API**: CamelCase inputs (e.g. `buildCommand`, `isPublic`, `gitRepository`) must reach upstream snake_case payload without being stripped by Zod — Task 2 test.
- **Unconfirmed destructive configuration overwrite**: Updates with `destructiveHint: true` must reject mismatched or missing confirmations before network access — Task 4 test.
- **Build log leakage in deployment queries**: `listDeployments` and `getDeployment` must strip `logs` even when Coolify returns them — Task 5 test.

---

### Task 1: Contract Inventory & Version Pinning Document

**Files:**
- Create: `docs/contracts/coolify-v4-contract.md`
- Create: `src/resources/contract.ts`
- Test: `tests/contract.test.ts`

**Interfaces:**
- Produces: `COOLIFY_PINNED_VERSION: string` and `TOOL_CONTRACTS: Record<string, ToolContractDef>`.
- `ToolContractDef` contains `name`, `method: HttpMethod`, `route: string`, `requiredInputs: string[]`, `optionalInputs: string[]`, `destructive: boolean`, `sensitive: boolean`.

- [ ] **Step 1: Write failing contract test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CONTRACTS, COOLIFY_PINNED_VERSION } from '../src/resources/contract.js';

test('contract inventory covers all 42 tools with exact definitions', () => {
  assert.equal(typeof COOLIFY_PINNED_VERSION, 'string');
  assert.ok(COOLIFY_PINNED_VERSION.length > 0);
  const toolNames = Object.keys(TOOL_CONTRACTS);
  assert.equal(toolNames.length, 42);
  assert.ok(TOOL_CONTRACTS.coolify_delete_application.destructive);
  assert.ok(TOOL_CONTRACTS.coolify_get_application_logs.sensitive);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/contract.test.ts`
Expected: FAIL (cannot find module `contract.js`).

- [ ] **Step 3: Implement contract documentation and TypeScript definitions**

Create `docs/contracts/coolify-v4-contract.md` detailing all 42 tools with upstream route mappings, methods, parameters, and version notes against Coolify v4.
Implement `src/resources/contract.ts` exporting typed constants `COOLIFY_PINNED_VERSION` and `TOOL_CONTRACTS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/contracts/coolify-v4-contract.md src/resources/contract.ts tests/contract.test.ts
git commit -m "docs(contract): pin Coolify v4 API contract inventory for all 42 tools"
```

---

### Task 2: Strict Canonical camelCase Schemas & Request Translation

**Files:**
- Modify: `src/resources/types.ts`
- Modify: `src/resources/applications.ts`
- Modify: `src/resources/databases.ts`
- Modify: `src/resources/services.ts`
- Modify: `src/resources/projects.ts`
- Modify: `src/resources/environment.ts`
- Test: `tests/schemas-strict.test.ts`

**Interfaces:**
- Consumes: `TOOL_CONTRACTS` from `src/resources/contract.js`.
- Produces: Strictly typed Zod schemas (.strict()) for every tool input using canonical camelCase.
- Produces: Request transformer mapping camelCase inputs to exact Coolify snake_case body properties.

- [ ] **Step 1: Write failing strict schema tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationSchema, updateApplicationSchema } from '../src/resources/types.js';

test('schemas reject unknown fields and require canonical camelCase', () => {
  assert.throws(() => {
    createApplicationSchema.parse({
      type: 'public',
      projectUuid: 'p1',
      serverUuid: 's1',
      unknownProperty: 'illegal',
    });
  }, /unrecognized_keys/i);

  const parsed = updateApplicationSchema.parse({
    buildCommand: 'npm run build',
    isAutoDeployEnabled: true,
  });
  assert.equal(parsed.buildCommand, 'npm run build');
  assert.equal(parsed.isAutoDeployEnabled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/schemas-strict.test.ts`
Expected: FAIL (schemas currently allow unknown keys or rely on duplicate snake_case aliases).

- [ ] **Step 3: Refactor schemas in `src/resources/types.ts`**

1. Convert all tool-facing schemas to canonical camelCase only (`buildCommand`, `buildPack`, `portsExposes`, `gitRepository`, `gitBranch`, `isPublic`, `publicPort`, `isAutoDeployEnabled`, `isForceHttpsEnabled`).
2. Add `.strict()` to input schemas to reject unrecognized fields.
3. Update `toSnakeCaseRecord` or payload builders in resource files so every camelCase property maps directly to the exact snake_case parameter expected by Coolify REST API.
4. Support variant-specific fields: `githubAppUuid`, `privateKeyUuid` for private Git applications; `dockerRegistryImageName` for `dockerimage`.

- [ ] **Step 4: Run tests and typecheck to verify pass**

Run: `node --import tsx --test tests/schemas-strict.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/resources/ tests/schemas-strict.test.ts
git commit -m "refactor(schemas): enforce strict canonical camelCase inputs and clean payload mapping"
```

---

### Task 3: Secret Redaction Hardening (Database URLs, Sanctum Tokens & Per-Request Secrets)

**Files:**
- Modify: `src/coolify/redaction.ts`
- Modify: `src/resources/databases.ts`
- Modify: `src/resources/types.ts`
- Test: `tests/redaction-hardening.test.ts`

**Interfaces:**
- Produces: `redactSecrets(value: unknown, knownSecrets?: readonly string[]): unknown` with:
  - First: exact replacement of `knownSecrets`.
  - Second: Sanctum Bearer token regex supporting `id|secret`.
  - Third: Database connection string regex masking passwords in `protocol://user:password@host:port/path`.
  - Fourth: Key-based masking for credentials, tokens, Compose raw, and database URLs (`internal_db_url`, `external_db_url`).

- [ ] **Step 1: Write failing redaction hardening tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/coolify/redaction.js';

test('redactSecrets completely scrubs Sanctum tokens with pipe separator', () => {
  const token = '123|abc456def789ghijk_secret_token';
  const input = `Authenticated with Bearer ${token}`;
  const output = redactSecrets(input, [token]) as string;
  assert.equal(output.includes('abc456def789ghijk'), false);
  assert.equal(output, 'Authenticated with Bearer [REDACTED]');
});

test('redactSecrets masks passwords in database URLs', () => {
  const input = {
    internal_db_url: 'postgres://postgres:SuperSecretPassword123@coolify-db:5432/main',
    external_db_url: 'mysql://root:RootPassWord456@100.73.175.42:3306/prod',
  };
  const output = redactSecrets(input) as typeof input;
  assert.equal(output.internal_db_url.includes('SuperSecretPassword123'), false);
  assert.equal(output.external_db_url.includes('RootPassWord456'), false);
  assert.match(output.internal_db_url, /postgres:\/\/postgres:\[REDACTED\]@coolify-db/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/redaction-hardening.test.ts`
Expected: FAIL (connection URLs not masked or pipe token partially exposed).

- [ ] **Step 3: Implement redaction hardening in `src/coolify/redaction.ts`**

1. Prioritize scrubbing `knownSecrets` before regex execution.
2. Update Bearer regex to `/Bearer\s+[A-Za-z0-9_\-|.~+/]+=*/gi`.
3. Add URI credential replacement regex: `/(https?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis(?:s)?|clickhouse):\/\/([^:@\s]+):([^@\s]+)@/gi` -> `$1://$2:[REDACTED]@`.
4. Ensure `internal_db_url` and `external_db_url` have passwords masked both when stringified and when parsed in resource metadata.

- [ ] **Step 4: Run tests and typecheck to verify pass**

Run: `node --import tsx --test tests/redaction-hardening.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/coolify/redaction.ts tests/redaction-hardening.test.ts
git commit -m "fix(security): scrub Sanctum tokens and mask connection string passwords"
```

---

### Task 4: Destructive Operation & Confirmation Consistency

**Files:**
- Modify: `src/policy.ts`
- Modify: `src/tools.ts`
- Modify: `src/resources/applications.ts`
- Modify: `src/resources/services.ts`
- Modify: `src/resources/databases.ts`
- Modify: `src/resources/servers.ts`
- Modify: `src/resources/projects.ts`
- Modify: `src/resources/deployments.ts`
- Modify: `src/resources/environment.ts`
- Test: `tests/confirmation-policy.test.ts`

**Interfaces:**
- `assertDeleteConfirmation(resourceUuid: string, confirmResourceUuid: string): void`
- `assertEnvDeleteConfirmation(resourceUuid: string, envUuid: string, confirmResourceUuid: string, confirmEnvUuid: string): void`
- Every destructive tool (delete, stop, cancel, update) strictly enforces matching confirmation and aborts with zero network calls on mismatch.

- [ ] **Step 1: Write failing confirmation policy tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDeleteConfirmation, assertEnvDeleteConfirmation } from '../src/policy.js';

test('assertDeleteConfirmation rejects empty, whitespace, or mismatched confirmation', () => {
  assert.throws(() => assertDeleteConfirmation('app-1', ''));
  assert.throws(() => assertDeleteConfirmation('app-1', '  '));
  assert.throws(() => assertDeleteConfirmation('app-1', 'app-2'));
  assert.doesNotThrow(() => assertDeleteConfirmation('app-1', 'app-1'));
});

test('assertEnvDeleteConfirmation requires dual matching pairs', () => {
  assert.throws(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-1', 'env-2'));
  assert.throws(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-2', 'env-1'));
  assert.doesNotThrow(() => assertEnvDeleteConfirmation('app-1', 'env-1', 'app-1', 'env-1'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/confirmation-policy.test.ts`
Expected: FAIL if empty or whitespace strings are not rejected properly.

- [ ] **Step 3: Refactor policy and tool handlers in `src/policy.ts` and `src/tools.ts`**

1. Validate that confirmations are trimmed and non-empty.
2. Ensure all destructive tools have `destructiveHint: true` annotation and description mentioning confirmation.
3. Verify that `coolify_stop_application`, `coolify_stop_service`, `coolify_stop_database`, `coolify_cancel_deployment`, `coolify_update_application`, `coolify_update_service`, `coolify_update_database`, and all `coolify_delete_*` tools call confirmation assertions BEFORE any network request.

- [ ] **Step 4: Run tests and typecheck to verify pass**

Run: `node --import tsx --test tests/confirmation-policy.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/policy.ts src/tools.ts tests/confirmation-policy.test.ts
git commit -m "fix(policy): unify destructive confirmation guards across all operational and lifecycle tools"
```

---

### Task 5: Response Parsing, Pagination Preservation & Deployment Log Isolation

**Files:**
- Modify: `src/resources/deployments.ts`
- Modify: `src/resources/logs.ts`
- Modify: `src/resources/types.ts`
- Test: `tests/response-semantics.test.ts`

**Interfaces:**
- `listDeployments(client)` and `getDeployment(client, uuid)` strip `logs` unconditionally.
- `getDeploymentLogs(client, config, options)` extracts logs safely with sensitive opt-in and byte bounding.
- Pagination wrappers in list responses are preserved in `metadata.pagination`.

- [ ] **Step 1: Write failing response semantics test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { listDeployments, getDeployment } from '../src/resources/deployments.js';
import { CoolifyClient } from '../src/coolify/client.js';
import { loadConfig } from '../src/config.js';

test('deployments list and get unconditionally strip logs field', async () => {
  const fakeTransport: typeof fetch = async () => {
    return Response.json([
      { id: 1, commit: 'abc', status: 'finished', logs: 'sensitive build logs should never be here' },
    ]);
  };
  const client = new CoolifyClient(loadConfig({ COOLIFY_URL: 'https://coolify.example', COOLIFY_TOKEN: 'token' }), fakeTransport);
  const result = await listDeployments(client) as Array<Record<string, unknown>>;
  assert.equal(result[0].logs, undefined);
  assert.equal(JSON.stringify(result).includes('sensitive build logs'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/response-semantics.test.ts`
Expected: FAIL if nested logs remain or normalization fails.

- [ ] **Step 3: Implement clean response normalization in `src/resources/deployments.ts` & `src/resources/types.ts`**

1. Recursively strip `logs` from deployment list and detail responses.
2. In `getDeploymentLogs`, extract `logs` text, enforce `includeSensitive: true` and matching `confirmResourceUuid`, clip at UTF-8 boundary using `limitText`, and return `{ resourceUuid, requiresSensitiveOptIn, text, truncated }`.
3. Preserve pagination fields if returned by Coolify (e.g. `current_page`, `last_page`, `total`, `per_page`).

- [ ] **Step 4: Run tests and typecheck to verify pass**

Run: `node --import tsx --test tests/response-semantics.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/resources/deployments.ts src/resources/logs.ts src/resources/types.ts tests/response-semantics.test.ts
git commit -m "fix(resources): isolate deployment logs and preserve response pagination metadata"
```

---

### Task 6: Comprehensive Behavioral & Stdio Test Suite Update

**Files:**
- Modify: `tests/tools.test.ts`
- Modify: `tests/resource-mutations.test.ts`
- Modify: `tests/resources-read.test.ts`
- Modify: `tests/stdio-smoke.test.ts`
- Modify: `src/tools.ts`
- Modify: `src/server.ts`

**Interfaces:**
- All 42 tools tested against exact contract fixtures.
- Stdio smoke test tests compiled `dist/index.js` over stdio transport using official SDK client.
- Zero network requests on validation errors or confirmation mismatches.

- [ ] **Step 1: Update behavioral and integration tests**

Add tests for:
- All 42 tool definitions and input schemas.
- Empty update payload rejection.
- Database creation variants (`postgresql`, `mysql`, `redis`, `mongodb`, `sqlite`, etc.) with credential and port options.
- Application creation variants (`public`, `dockerfile`, `dockerimage`, `private-github-app`, `private-deploy-key`).
- Error status preservation (`status`, `kind`, `retryable`, `retryAfter`).

- [ ] **Step 2: Run tests and observe any failures**

Run: `npm test`
Expected: Identify any discrepancies between tools and resource layers.

- [ ] **Step 3: Align `src/tools.ts` and `src/server.ts`**

Resolve any schema discrepancies, ensure `wrapHandler` returns safe structured JSON errors, and verify tool annotations.

- [ ] **Step 4: Run full verification suite**

Run: `npm run build && npm run typecheck && npm test`
Expected: All tests pass with pristine output, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add tests/ src/tools.ts src/server.ts
git commit -m "test(mcp): update behavioral and stdio smoke tests across all 42 tools"
```

---

### Task 7: Sandbox Verification Script & Documentation

**Files:**
- Create: `scripts/verify-sandbox.ts`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `scripts/verify-sandbox.ts` runnable CLI that connects to an authorized sandbox Coolify instance via `CoolifyClient` or MCP client.
- Safely performs read-only version check (`/version`), creates sandbox test project, sets env var, tests redaction, and cleans up the sandbox project with explicit confirmation.
- Never touches production resources or hardcodes credentials.

- [ ] **Step 1: Write sandbox verification script**

Implement `scripts/verify-sandbox.ts`:
1. Reads `COOLIFY_URL` and `COOLIFY_TOKEN` from environment.
2. Checks `/api/v1/version` and logs Coolify version.
3. Tests read tools (`coolify_get_current_team`, `coolify_list_projects`).
4. Creates a temporary project `mcp-sandbox-test-${Date.now()}`.
5. Verifies project exists, then deletes it with matching confirmation.
6. Catches all errors safely; exits 0 on success, 1 on failure.

- [ ] **Step 2: Add npm script and document sandbox procedure**

In `package.json`: add `"verify:sandbox": "node --import tsx scripts/verify-sandbox.ts"`.
In `README.md`: document the sandbox verification command and prerequisite API permissions (`read`, `write`, `deploy`, `read:sensitive` or `root`).

- [ ] **Step 3: Run typecheck and full test suite**

Run: `npm run build && npm run typecheck && npm test`
Expected: PASS, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-sandbox.ts README.md package.json
git commit -m "feat(verify): add non-destructive sandbox verification runner and documentation"
```

---

## Appendix: Subagent Execution Mapping

Per user instructions, implement using subagents:
- **Task 1 & Task 2**: Builder subagent (3.8 Flash High) for contract document and strict schemas.
- **Task 3 & Task 4**: Builder subagent (3.8 Flash High) for redaction hardening and confirmation policy.
- **Task 5 & Task 6**: Builder subagent (3.8 Flash High) for response semantics and test suite updates.
- **Task 7**: Builder subagent (3.8 Flash Low) for sandbox verification script and README updates.
- **Integration & Review**: Main controller (6.1 Sol) oversees wave gates, typecheck, build, and whole-branch review.
