# acp-mcp-server

An MCP server that lets Claude, ChatGPT, Cursor and other MCP clients ask [Agentic Control Plane](https://agenticcontrolplane.com) whether a tool call would be allowed, and read their own workspace's status.

If you use a coding agent with the ACP hook installed ([acp-install](https://github.com/agentic-control-plane/acp-install)), tool calls are already checked automatically. You need this server for MCP clients that have no hook, such as Claude.ai and ChatGPT.

**Limit:** `acp_check` is advisory. The client has to call it, and nothing stops a client that doesn't. It returns `allow`, `deny` or `cant_predict`, and a call that needs a person's approval comes back as `deny` with "requires human approval" in the reason. If the gateway can't read your policy it answers `allow` with `governed: false`. The self-hosted bridge also answers `allow` (reason `acp-network-error` or `acp-http-error`) when it can't reach the gateway. Either way it fails open. For enforcement you need the hook.

## Connect

The hosted server is at **`https://api.agenticcontrolplane.com/mcp`**. Add it as a connector in your MCP client.

**Claude Desktop and Claude.ai:**
```
URL: https://api.agenticcontrolplane.com/mcp
Auth: OAuth (you sign in through ACP)
```

**ChatGPT, Cursor, Cline and other MCP clients:** add the same URL. Clients that support MCP OAuth sign you in the same way; for the rest, use a bearer key as below.

**Your own agent code:**
```http
POST https://api.agenticcontrolplane.com/mcp
Authorization: Bearer gsk_<your-acp-api-key>
Content-Type: application/json
```

You need an ACP workspace. Free up to 5 initiating agents, with unlimited calls. Sign up at [cloud.agenticcontrolplane.com/login](https://cloud.agenticcontrolplane.com/login).

## Tools

The hosted endpoint serves these eleven tools by default; a workspace with a customised tool allowlist may show fewer. None of them can approve a held call or apply a policy.

| Tool | What it does |
|---|---|
| `acp_check` | Would this call be allowed? Returns `allow`, `deny` or `cant_predict`, plus a reason. Advisory (see the limit above). |
| `acp_status` | Check the connection and your workspace identity and mode. |
| `acp_audit`, `acp_cost`, `acp_optimize`, `acp_trace`, `acp_usage`, `acp_recommendations` | Read your workspace's own audit, spend and savings data. |
| `acp_propose_rule` | Draft a policy rule. A human confirms it in the console. It never applies policy itself. |
| `acp_wait_approval` | Wait for a person to decide a held call, then report approved, denied, expired or pending. It never approves anything. |
| `acp_deny_approval` | Withdraw a pending hold you raised. It can only stop a call. |

The source in this repo (`src/tools/tools.ts`) defines only `acp_check`, `acp_status` and `acp_permission_prompt`. The hosted endpoint is the reference. If you self-host this repo, you get those three, not the hosted set above.

## Self-host

For air-gapped setups, or to point at a self-hosted ACP gateway:

```bash
git clone https://github.com/agentic-control-plane/acp-mcp-server
cd acp-mcp-server
npm install
npm run build

# Point at the ACP API (default: https://api.agenticcontrolplane.com)
export ACP_API_BASE=https://your-acp-gateway.example.com

# Required: the OAuth issuer that signs your users' tokens
# (the server refuses to start without it)
export OAUTH_ISSUER=https://your-tenant.us.auth0.com

# Optional: service-level API key for OAuth users (ChatGPT, Claude.ai)
# whose JWTs aren't directly usable as ACP tokens
export ACP_SERVICE_KEY=gsk_workspace_...

npm start
# MCP endpoint:   POST http://0.0.0.0:3000/mcp
# OAuth discovery: GET /.well-known/oauth-protected-resource
```

The bridge speaks streamable-HTTP MCP and forwards to ACP's `/govern/tool-use` endpoint.

## How a call flows

```
your AI client        this MCP server           ACP gateway
Claude / ChatGPT  ->  api.agenticcontrolplane  ->  POST /govern/tool-use
Cursor / Cline        POST /mcp (acp_check)         policy + audit + identity
                                                    -> allow / deny / ask
```

Each call writes an audit row. On the hosted endpoint it's attributed to the signed-in person; a self-hosted bridge using `ACP_SERVICE_KEY` attributes calls to that key. One workspace shows every governed call from every MCP client your team uses.

## Auth

1. **OAuth** for human-driven clients (Claude.ai, ChatGPT). The client signs in against ACP's identity provider, and the Auth0 JWT identifies the person. The bridge uses an `ACP_SERVICE_KEY` to make the governance call on their behalf.
2. **Bearer `gsk_` API key** for programmatic clients. The key's identity is the actor. No OAuth.

OAuth discovery metadata is at `/.well-known/oauth-protected-resource`, per the MCP authorization spec.

## Develop

```bash
npm install
npm run dev        # tsx hot reload
```

Tools: `src/tools/tools.ts`. JSON-RPC handler: `src/handlers/mcpHandler.ts`. Express entry point and rate limits: `src/server/expressServer.ts`.

## Links

[ACP](https://agenticcontrolplane.com) · [Sign up](https://cloud.agenticcontrolplane.com/login) · [AgentGovBench](https://github.com/agentic-control-plane/agentgovbench) · [Issues](https://github.com/agentic-control-plane/acp-mcp-server/issues) · MIT, see [LICENSE](LICENSE) · Email: su***************************om
