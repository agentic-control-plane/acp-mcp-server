// Packaging smoke tests: the library entry must import with no environment,
// and the server entry must fail loudly (not silently) without OAUTH_ISSUER.
import { test } from "node:test";
import assert from "node:assert/strict";

test("library entry imports without environment", async () => {
  delete process.env.OAUTH_ISSUER;
  const mod = await import("../dist/index.js");
  assert.equal(typeof mod.mcpToolDescriptors, "function");
  assert.equal(typeof mod.executeGovernanceTool, "function");
  assert.equal(typeof mod.summarizeToolResult, "function");
  assert.ok(Array.isArray(mod.REQUIRED_SCOPES));
  const names = mod.mcpToolDescriptors().map((t) => t.name).sort();
  assert.deepEqual(names, ["acp_check", "acp_permission_prompt", "acp_status"]);
});

test("server entry requires OAUTH_ISSUER", async () => {
  delete process.env.OAUTH_ISSUER;
  await assert.rejects(
    () => import("../dist/server/expressServer.js"),
    /OAUTH_ISSUER env var is required/
  );
});
