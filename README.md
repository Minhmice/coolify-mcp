# Coolify MCP Server

Local stdio Model Context Protocol (MCP) server for managing self-hosted Coolify instances through Coolify's public REST API.

## Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0

## Installation & Setup

1. Clone and install dependencies:

```bash
git clone https://github.com/Minhmice/coolify-mcp.git
cd coolify-mcp
npm install
```

2. Build the server:

```bash
npm run build
```

3. (Optional) Run tests and typecheck:

```bash
npm test
npm run typecheck
```

## Client Configuration

The server runs over standard I/O (stdio). MCP protocol messages use stdout exclusively; all errors and diagnostics use stderr.

### OMP / Claude Desktop Configuration

Add the server to your MCP client configuration (e.g. `claude_desktop_config.json` or OMP configuration):

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

Replace `/absolute/path/to/coolify-mcp/dist/index.js` with the absolute path to your compiled entrypoint.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `COOLIFY_URL` | Yes | - | Coolify HTTPS origin (e.g. `https://coolify.example.com`). Path, query, hash, and userinfo are rejected. Plain HTTP is rejected. |
| `COOLIFY_TOKEN` | Yes | - | Coolify API Bearer token. Tokens with carriage return or newline characters are rejected. |
| `COOLIFY_API_PREFIX` | No | `/api/v1` | Coolify API path prefix. Trailing slashes are stripped; traversal and protocol-relative values are rejected. |
| `COOLIFY_REQUEST_TIMEOUT_MS` | No | `30000` | HTTP request timeout in milliseconds (allowed: 1 – 120,000). |
| `COOLIFY_MAX_LOG_BYTES` | No | `65536` | Maximum log response size budget in bytes (allowed: 1 – 1,048,576). |

A `.env.example` file is provided for local reference with placeholder values:

```bash
cp .env.example .env
```

## Permissions & Scope

- **API Token**: Generate a Bearer token in the Coolify dashboard under Keys & Tokens / API tokens. The token requires appropriate permissions (read/write/admin) matching the tools you intend to use.
- **Team Scope**: Coolify tokens are scoped to the team that created them. All resource operations (projects, applications, databases, services, servers) act strictly within that team's scope.
- **Token Rotation**: To rotate tokens, generate a new token in Coolify, update the `COOLIFY_TOKEN` environment variable in your client configuration, and restart the client. Revoke the old token in Coolify afterwards.

## Security & Safety

- **HTTPS Only**: Plain HTTP is rejected at startup to guarantee credentials are never transmitted in cleartext.
- **Secret Redaction**: Sensitive fields—including `COOLIFY_TOKEN`, environment variable values (`value`, `real_value`), Docker Compose secrets, passwords, and API keys—are automatically masked as `[REDACTED]` in tool output, error responses, and stderr logs.
- **Strict URL Validation**: Base URLs must be root HTTPS origin URLs without userinfo, query parameters, fragments, or path components.
- **Destructive Operation Confirmation**: Destructive tools (`coolify_delete_application`, `coolify_delete_service`, `coolify_delete_database`, `coolify_delete_project`, `coolify_delete_server`, `coolify_delete_application_environment_variable`) require an explicit confirmation identifier (`confirmResourceUuid`). If the confirmation does not match the target resource ID, execution aborts immediately before any HTTP request is dispatched.

## Supported Coolify API Assumptions

- Built against Coolify v4 REST API (`/api/v1`).
- Assumes standard REST JSON response formats.
- Network operations enforce request timeouts (`COOLIFY_REQUEST_TIMEOUT_MS`) and max response size limits.

## Development Commands

```bash
# Install dependencies
npm install

# Run full test suite
npm test

# Typecheck source and tests
npm run typecheck

# Build TypeScript to dist/
npm run build

# Start local stdio server
npm start
```
