# Coolify MCP Server

Local stdio Model Context Protocol (MCP) server for managing self-hosted Coolify instances through Coolify's public REST API.

## Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0

## Configuration

The server is configured via environment variables. Copy `.env.example` to `.env` or set in your MCP client configuration:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `COOLIFY_URL` | Yes | - | Coolify HTTPS origin (e.g. `https://coolify.example.com`). Path, query, hash, and userinfo are rejected. Plain HTTP is rejected. |
| `COOLIFY_TOKEN` | Yes | - | Coolify API Bearer token. Tokens with carriage return or newline characters are rejected. |
| `COOLIFY_API_PREFIX` | No | `/api/v1` | Coolify API path prefix. Trailing slashes are stripped; traversal and protocol-relative values are rejected. |
| `COOLIFY_REQUEST_TIMEOUT_MS` | No | `30000` | HTTP request timeout in milliseconds (allowed: 1 – 120,000). |
| `COOLIFY_MAX_LOG_BYTES` | No | `65536` | Maximum log response size budget in bytes (allowed: 1 – 1,048,576). |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Typecheck
npm run typecheck

# Build
npm run build

# Start server (after build)
npm start
```

## Security & Safety

- **HTTPS Only**: Plain HTTP is rejected to ensure tokens are never transmitted in cleartext.
- **Credential Protection**: API tokens are never echoed in errors, diagnostics, or output logs.
- **Strict URL Validation**: Base URLs must be root origin URLs without userinfo, query parameters, fragments, or path components.
