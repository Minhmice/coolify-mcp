# Coolify MCP Server Design

**Status:** Design approved for specification
**Date:** 2026-10-12
**Repository:** `Minhmice/coolify-mcp`
**Transport:** local stdio only

## 1. Goal

Build a local Model Context Protocol (MCP) server that lets an AI client operate a self-hosted Coolify instance through Coolify's public REST API. It replaces ad-hoc SSH commands and direct Coolify database edits with typed, auditable API calls.

The server targets full Coolify administration within the team scope of the configured API token. It must support inspection, deployment operations, configuration changes, and resource lifecycle management while preserving explicit confirmation for destructive actions.

## 2. Non-goals

- No remote HTTP MCP transport in first release.
- No arbitrary shell, Docker, SSH, or Coolify database tool.
- No bypass of Coolify team permissions, API access controls, or IP allowlists.
- No secret persistence in source, generated artifacts, tool output, or logs.
- No undocumented Coolify internal endpoints.

## 3. Runtime and configuration

The server runs as a local stdio process. MCP protocol messages use stdout exclusively; diagnostics use stderr.

Required environment:

- `COOLIFY_URL`: Coolify origin, for example `https://coolify.example.com`.
- `COOLIFY_TOKEN`: complete Coolify API Bearer token.

Optional environment:

- `COOLIFY_API_PREFIX`: defaults to `/api/v1`.
- `COOLIFY_REQUEST_TIMEOUT_MS`: bounded request timeout with a documented default.
- `COOLIFY_MAX_LOG_BYTES`: maximum returned log size.

Startup must validate URL shape, normalize the API base URL, and fail clearly if token or URL is missing. It must never print token values. The token is sent only in the `Authorization: Bearer` header over HTTPS; plain HTTP is rejected unless an explicit development override is added later.

## 4. Architecture

Keep layers separate:

1. **MCP adapter** — registers tools, schemas, descriptions, annotations, and confirmation metadata.
2. **Coolify client** — one typed REST transport using native `fetch`, timeout, JSON parsing, response-size limits, and normalized errors.
3. **Resource operations** — small modules grouped by Coolify resource: teams, projects, applications, services, databases, servers, deployments, environment variables, and logs.
4. **Policy layer** — validates identifiers, redacts sensitive response fields, marks destructive operations, and applies output limits.
5. **Configuration** — parses environment and exposes immutable runtime settings.

MCP tools must call the client/resource layer, never construct ad-hoc requests directly.

## 5. Tool surface

Tool names use stable verb-resource naming. Exact endpoint paths and request schemas must be confirmed against the Coolify API version during implementation.

### Read tools

- `coolify_get_current_team`
- `coolify_list_teams`
- `coolify_list_projects`
- `coolify_get_project`
- `coolify_list_applications`
- `coolify_get_application`
- `coolify_list_services`
- `coolify_get_service`
- `coolify_list_databases`
- `coolify_get_database`
- `coolify_list_servers`
- `coolify_get_server`
- `coolify_list_deployments`
- `coolify_get_deployment`
- `coolify_get_application_logs`
- `coolify_get_deployment_logs`
- `coolify_list_environment_variables`
- `coolify_get_environment_variable`

Read tools return normalized JSON with stable IDs, status, timestamps, URLs, and selected metadata. Secrets, passwords, private keys, and token values are redacted unless a separately named sensitive-read tool is explicitly approved.

### Operational tools

- `coolify_deploy_application`
- `coolify_restart_application`
- `coolify_stop_application`
- `coolify_cancel_deployment`
- `coolify_start_service`
- `coolify_stop_service`
- `coolify_restart_service`
- `coolify_start_database`
- `coolify_stop_database`
- `coolify_restart_database`

Operational tools return the Coolify operation ID and current state. They do not poll indefinitely. A separate status/log tool handles follow-up.

### Configuration tools

- `coolify_set_application_environment_variable`
- `coolify_delete_application_environment_variable`
- `coolify_update_application`
- `coolify_update_service`
- `coolify_update_database`

Environment mutation tools accept one variable per call, distinguish literal values from interpolation syntax, and never echo secret values. Responses return key, scope, and change status only.

### Lifecycle tools

- `coolify_create_project`
- `coolify_delete_project`
- `coolify_create_application`
- `coolify_delete_application`
- `coolify_create_service`
- `coolify_delete_service`
- `coolify_create_database`
- `coolify_delete_database`
- `coolify_delete_server`

Create/delete operations are full-admin capabilities. Delete inputs require `resourceUuid` and `confirmResourceUuid` with identical values. This guards against accidental target mismatch, not an autonomous client fabricating approval. Human approval is enforced by the MCP client's per-call permission workflow; destructive tools must not be configured for unattended auto-approval. MCP annotations alone do not enforce approval.

## 6. Safety and authorization

Coolify remains source of truth for authorization. The MCP server adds safety boundaries but must not pretend to grant permissions.

- API token permissions are configured in Coolify, scoped to the active team.
- Recommended first token: `root` only if full resource lifecycle management is required; otherwise use the smallest combination of `read`, `write`, `deploy`, and `read:sensitive`.
- Default reads redact secrets and logs are size-limited.
- `read:sensitive` data requires a separately named operation or an explicit `includeSensitive` input with confirmation metadata.
- Destructive tools are annotated as destructive and require MCP client confirmation.
- Tool errors include HTTP status, Coolify error code/message when safe, and a retryability classification; they exclude Authorization headers and secret values.
- Retries are limited to idempotent reads and explicitly idempotent operations. Never retry delete, deploy, or environment mutation blindly.
- Concurrent operations must not share mutable request state.

## 7. Error handling

Normalize transport failures into:

- configuration error
- authentication/authorization error (`401`/`403`)
- validation error (`400`/`422`)
- not found (`404`)
- conflict (`409`)
- rate limited (`429`, preserve `Retry-After`)
- Coolify server error (`5xx`)
- timeout/network error

Preserve request context using method, endpoint name, resource ID, and status; omit URL query secrets and bearer tokens.

## 8. Testing

Permanent tests must cover observable behavior:

- configuration rejects missing URL/token and insecure URL;
- client sends Bearer auth and normalizes successful/error responses;
- timeout and response-size limits work;
- secret redaction removes token/password/private-key values from tool results and errors;
- read tools map Coolify resources correctly;
- operational tools send correct endpoint/method/body;
- destructive tools expose confirmation metadata and reject missing confirmation identifiers;
- deployment/log results remain bounded;
- MCP stdio server starts and lists tools without writing non-protocol data to stdout.

Use a local fake HTTP server for client tests. Do not call production Coolify from tests. Add one stdio smoke test that starts the process, sends MCP initialize/list-tools messages, and observes valid protocol output.

## 9. Documentation and operations

README must document:

- required Coolify API token permissions;
- environment setup without committing secrets;
- stdio client configuration for OMP/Claude;
- tool groups and destructive-operation behavior;
- token rotation and troubleshooting;
- supported Coolify API version assumptions.

The first implementation must include an example env file containing placeholders only and a minimal launch command. No real server URL or token is committed.

## 10. Acceptance criteria

- Local MCP client can initialize over stdio and list all implemented tools.
- Read tools inspect the configured team and resources through public Coolify API endpoints.
- Deploy/restart/stop operations work for an authorized application and return bounded results.
- Environment variable operations never leak secret values.
- Delete tools require explicit confirmation and correct resource identity.
- API errors remain actionable without exposing credentials.
- Tests and stdio smoke check pass.
