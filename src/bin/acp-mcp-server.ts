#!/usr/bin/env node
// Command entry: start the ACP governance MCP server.
// OAuth config (OAUTH_ISSUER etc.) is read when this runs, not when the
// package is imported.
import "../server/expressServer.js";
