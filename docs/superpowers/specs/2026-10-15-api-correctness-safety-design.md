# Plan 1 — Coolify API Correctness & Safety

Status: proposed written specification; roadmap approved, implementation not approved.
Date: 2026-10-15
Repository: Minhmice/coolify-mcp

## 1. Intent and roadmap

The owner approved improving all three areas as separate projects:
1. API correctness and safety (this document).
2. Deploy/debug workflows, using the corrected contracts.
3. Packaging/onboarding, distributing the verified server.

This project makes the existing 42-tool local stdio server trustworthy against an identified Coolify version. Success means requests perform the advertised operation, responses describe observed state, and secrets or destructive actions cannot escape their intended boundaries. Passing synthetic fixtures alone is not live compatibility evidence.

The approved constraints remain: full administration within the configured token's team; local stdio; public REST API only; no arbitrary shell, SSH, internal database access, or remote MCP transport.

## 2. Observed starting point

The repository has configuration validation, a bounded fetch client, resource modules, a 42-tool adapter, and stdio tests. The previous delivery reported 96 passing tests; this specification does not assert a fresh run.

The current README describes generic Coolify v4 compatibility rather than a verified release. Resource schemas accept multiple aliases, and creation fields such as repository, branch, and build pack are optional in existing application schemas. These observations motivate a contract audit; they are not proof that every endpoint is broken.

## 3. Approach and alternatives

Selected approach: pin public API evidence for one explicitly identified target version, manually maintain the small existing tool surface, and verify it end-to-end. Keep official SDK and native fetch.

Alternatives considered:
- Generate the whole MCP surface from OpenAPI: wider coverage, but weak control over secret handling and destructive semantics; unnecessary for the current scope.
- Add ad-hoc fixes whenever a tool fails: smaller initial work, but retains silent field stripping and undocumented compatibility assumptions.

No second HTTP client, generic arbitrary-URL tool, or capability plugin framework is needed.

## 4. Version evidence and contract inventory

Before changing endpoint mappings, obtain the target's version via public read-only API with authorized credentials. Record the exact version and immutable upstream source commit or release reference. Do not use mutable upstream main as the sole authority for an older deployed instance.

Maintain a contract inventory for all 42 tools containing tool name, method, route, required/optional input, request encoding, response shape, permissions, destructive/sensitive status, and upstream source reference. Include application creation variants and database types already advertised. Explicitly identify unavailable variants instead of pretending they work.

No version is claimed supported until its inventory and verification evidence exist. If a target is incompatible, return a safe actionable error; never silently try alternate mutation endpoints. Version inspection is explicit and read-only, not an undocumented network requirement during MCP initialize/tools-list.

Record non-secret evidence in docs: version, source references, tested tool/variant, result, and verification date. Credentials, real resource inventory, raw logs, Compose bodies and customer data do not belong in evidence files.

## 5. Input schemas and request mapping

Use one canonical public field spelling per tool: preserve currently documented camelCase inputs. Remove duplicate snake_case/public aliases from the tool-facing contract during a documented clean cutover. API body names remain the exact snake_case names required by the pinned target.

Resource and MCP schemas must share their validation definitions rather than independently redefining fields and losing values at the adapter boundary. Every advertised field reaches the supported upstream field, or is rejected before dispatch with a safe explanation. Unknown fields must fail validation, not be silently stripped.

Application creation is a discriminated union. Each variant requires its actual upstream prerequisites: project/server placement, environment selector and variant-specific repository/build-pack/credential/image/Dockerfile fields as specified by pinned API evidence. Credentials selectors are resource identifiers, not tokens. Database variants follow the same rule for their documented requirements.

Reject empty updates. Do not accept unsupported Dockerfile/Compose replacements via an application PATCH endpoint. Map domain input only to a supported upstream field. Service Compose inputs are explicitly raw UTF-8 text; encode exactly once when upstream requires base64. Never guess whether a user's string is already encoded. Secret tracking includes original and encoded representations.

Validate opaque Coolify identifiers as bounded path segments, not RFC UUIDs. Validate enum, numeric ranges, booleans and mutually exclusive fields before HTTP dispatch. No caller-controlled URL, HTTP method or arbitrary path suffix.

## 6. Response semantics

Parse external responses at resource boundaries. Support only observed documented shapes for the pinned version, including pagination wrappers. Preserve pagination metadata; never report a partial list as complete. Avoid fabricating operation IDs, completion status, or successful changes from empty/malformed responses.

A deploy/create/delete response may mean queued or accepted. Return the actual operation/resource ID and upstream status/message when available. Do not label an operation completed until observed. This project does not add a deployment-wait workflow; that belongs to Plan 2.

Ordinary deployment reads omit logs, including nested/wrapped records. Dedicated log tools remain the only route to log text. All MCP results and errors obey byte limits after normalization/serialization; logs clip at valid UTF-8 boundaries and report truncation. Oversized structured results return a safe limit error rather than silently slicing JSON.

## 7. Secret handling

Redact at the final MCP output boundary for both success and error results, in addition to resource-level filtering. Known credentials must be removed before pattern-based replacement so Sanctum tokens containing `|` cannot be partially leaked.

Always hide environment value/real_value, connection-string credentials, API/password/private-key fields, and raw Compose content in ordinary reads. Keep safe variable key names and resource IDs useful. Database URL fields must not expose userinfo or credential query parameters.

Per-request secret values include submitted environment values, credential-bearing configuration, and raw/encoded Compose. Carry them through transport errors and result normalization without persisting them globally. Concurrent calls must not share mutable secret sets.

Unexpected exceptions and validation failures must not echo input objects, submitted secrets, request headers, raw upstream bodies, causes, or stacks. Return a fixed safe error category where detailed text cannot be proven safe.

Arbitrary application logs can contain secrets that no pattern can reliably detect. Log text therefore requires explicit sensitive opt-in with matching resource identity and client approval. Known-secret/pattern redaction is defense in depth, not a promise that all possible log secrets are detected.

## 8. Mutation safety and errors

Full admin does not mean unattended destructive approval. Delete operations require matching target confirmation. Environment deletion binds both application and environment identities. Existing stop/cancel/config-overwrite confirmation behavior stays consistent across schema, handler and documentation.

MCP destructive annotations describe risk; they do not enforce human approval. Document client permission settings and prohibit recommending auto-approval for destructive tools. Never claim a repeated UUID proves human consent.

A failed validation or confirmation produces zero requests. No automatic retries for mutations, including timeouts and rate limiting. Ambiguous network outcomes report uncertainty rather than attempting the mutation again. Read calls do not start deployments or mutate resources.

Errors preserve safe kind, HTTP status, retryability and Retry-After when available. Distinguish validation, forbidden, not found, conflict, rate limit, server, timeout, network, and response-contract failure. Preserve 401/403 team/permission failures without attempting bypasses.

The transport rejects redirects and origin/path escapes, enforces deadline through body consumption, and cancels oversized streamed responses even without Content-Length. A caller's cancellation must propagate without retaining listeners/timers.

## 9. Verification

### Automated behavioral checks

- SDK client invokes real MCP handlers, resource mappings and HTTP client against independent version-derived fixtures.
- Each creation variant proves required fields reach the API; missing/unknown fields reject before network.
- Configuration updates prove actual changes and reject empty/unsupported payloads.
- Fixtures exercise numeric team IDs, opaque IDs, pagination, malformed JSON and incompatible response shapes.
- Secret cases include Sanctum tokens, nested deployment logs, credential URLs, env values, Compose success/error echoes and concurrent requests with different secrets.
- Destructive and sensitive calls reject missing/mismatched confirmation with zero requests.
- Timeout after headers, chunked over-budget bodies, redirect rejection and cancellation are exercised.
- Built stdio process initializes/lists tools and executes safe error scenarios through the official MCP client; stdout contains protocol only.

Do not add tests that merely mirror a route constant or check source strings. Assertions target caller-visible results, dispatch rejection, actual fixture state transitions, and invariants.

### Authorized sandbox verification

Read-only inspection may identify the instance and token team without changing production. Mutation checks require explicit authorization for a disposable sandbox project/server placement. Test create, inspect, update, env write/read redaction, deploy, stop/restart and deletion only within that sandbox. Never use production applications/databases for destructive smoke tests.

Record which tools/variants were actually exercised. A representative sandbox run does not certify unexercised database engines or Git credential variants. Unavailable credentials/resources are explicit verification limits. Finish reachable local work but do not label live compatibility complete until required sandbox evidence is obtained.

Cleanup targets only IDs created by the sandbox exercise, with identity checks and approval for destructive cleanup. Never delete unrelated resources. Do not commit keys or plaintext credential artifacts.

## 10. Deliverables

- Corrected shared schemas, API mappings, response normalization and security boundaries for the existing tool surface.
- Version-pinned contract inventory and non-secret compatibility evidence.
- Behavioral regressions and built-process smoke proof.
- Updated README covering canonical inputs, errors, sensitive logs, destructive approval and verified compatibility limitations.
- No Plan 2 orchestration features or Plan 3 publishing/install features in this change.

## 11. Acceptance criteria

1. Every existing tool and advertised variant has a referenced contract or explicit target-version unsupported result.
2. Required inputs cannot disappear between MCP validation and HTTP payload construction; unknown/empty/unsupported mutations fail before dispatch.
3. No successful fixture or error case leaks configured/submitted credentials; ordinary deployment reads never expose logs.
4. Confirmation is consistently enforced before network; no mutation is retried automatically.
5. Pagination, operation acceptance/completion and byte limits are represented truthfully.
6. Full build/typecheck/behavioral checks and actual built stdio smoke succeed.
7. Authorized sandbox evidence identifies tested version and exercised operations; untested variants and blockers remain explicit.
8. README and contract inventory match the implemented public schemas. No production resource modifications or secret material are committed.

## 12. Review gate

Roadmap approval authorized writing this specification, not product implementation. The owner reviews this file before the implementation plan is written. After plan review, execute with independent subagent ownership and an integration owner, retaining the prior requested model-tier preferences only when actual routing can be verified.
