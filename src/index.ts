// src/index.ts
// Library entry for @gatewaystack/acp-mcp-server.
//
// Everything exported here can be imported without any environment set. The
// HTTP server (which requires OAUTH_ISSUER and friends) is deliberately not
// re-exported from this module — run it with the `acp-mcp-server` bin or
// import "@gatewaystack/acp-mcp-server/server" explicitly.

export {
  TOOL_SCOPES,
  REQUIRED_SCOPES,
  mcpToolDescriptors,
  executeGovernanceTool,
  summarizeToolResult,
} from "./tools/tools.js";
