// src/tools/tools.ts
// ACP Governance tools — exposed via MCP for Claude, ChatGPT, Lovable, etc.

const ACP_API = process.env.ACP_API_BASE || "https://api.agenticcontrolplane.com";

// For OAuth users (ChatGPT, Claude), their Auth0 JWT can't be used
// directly with the governance API. Use a service-level API key as fallback.
const ACP_SERVICE_KEY = process.env.ACP_SERVICE_KEY || "";

// ── Scope mapping (governance tools require no special scopes) ──────
export const TOOL_SCOPES: Record<string, string[]> = {
  acp_check: [],
  acp_status: [],
  acp_permission_prompt: [],
};

export const REQUIRED_SCOPES = Array.from(
  new Set(Object.values(TOOL_SCOPES).flat())
).sort();

// ── Tool descriptors for MCP tools/list ─────────────────────────────
export function mcpToolDescriptors() {
  return [
    {
      name: "acp_check",
      description:
        "Answers 'would this call be allowed?' for a specific tool call — use for explicit policy " +
        "questions or pre-flight planning. If this harness has ACP hooks installed (PreToolUse/PostToolUse), " +
        "every tool call is already governed automatically — do not call this per tool in that case. " +
        "Returns allow/deny decision.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tool_name: {
            type: "string",
            description: "Name of the tool being called (e.g., 'notion.readPage', 'jira.createIssue')",
          },
          tool_input: {
            type: "string",
            description: "JSON string of the tool input/arguments",
          },
          client_name: {
            type: "string",
            description: "Name of the calling client (e.g., 'Lovable', 'ChatGPT', 'Claude')",
          },
          agent_tier: {
            type: "string",
            description: "Agent autonomy tier: 'interactive' (human supervising), 'subagent', 'background' (autonomous), or 'api'. When omitted, the gateway resolves the least-trusted applicable tier for the credential — report 'interactive' only when a human is actually watching this call.",
          },
        },
        required: ["tool_name", "tool_input"],
        additionalProperties: false,
      },
    },
    {
      name: "acp_permission_prompt",
      description:
        "Answer a Claude Code permission prompt from ACP policy when nobody is at the terminal. " +
        "Use as `claude -p --permission-prompt-tool mcp__acp__acp_permission_prompt`. Evaluates the call at the " +
        "background tier; if policy says ask, creates an approval, notifies the workspace's humans, and waits for " +
        "their decision (default up to 24 hours). Returns {behavior: allow|deny, message}. Unanswered or unreachable = deny.",
      inputSchema: {
        type: "object" as const,
        properties: {
          tool_name: { type: "string", description: "The tool Claude Code wants to run (e.g. Bash, Edit, mcp__github__create_issue)" },
          input: { description: "The tool's input, as Claude Code passes it (object or JSON string)" },
          tool_use_id: { type: "string", description: "Claude Code's id for this tool use, when provided" },
          hold_seconds: { type: "number", description: "How long to wait for a human decision before answering deny. Default 86400 (24 h)." },
        },
        required: ["tool_name", "input"],
        additionalProperties: true,
      },
      annotations: {
        title: "ACP Permission Prompt",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    {
      name: "acp_status",
      description: "Check ACP governance status and connectivity for your workspace.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

// ── Tool execution ──────────────────────────────────────────────────

export async function executeGovernanceTool(
  toolName: string,
  args: Record<string, unknown>,
  bearerToken: string
): Promise<{ ok: boolean; result: string }> {
  // Use gsk_ key directly if provided, otherwise fall back to service key
  const governToken = bearerToken.startsWith("gsk_") ? bearerToken : (ACP_SERVICE_KEY || bearerToken);
  if (toolName === "acp_check") {
    return acpCheck(args, governToken);
  }
  if (toolName === "acp_status") {
    return acpStatus(governToken);
  }
  if (toolName === "acp_permission_prompt") {
    return acpPermissionPrompt(args, bearerToken);
  }
  return { ok: false, result: `Unknown tool: ${toolName}` };
}

async function acpCheck(
  args: Record<string, unknown>,
  bearerToken: string
): Promise<{ ok: boolean; result: string }> {
  const toolName = String(args.tool_name || "");
  const toolInput = String(args.tool_input || "{}");
  const clientName = String(args.client_name || "MCP Client");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(`${ACP_API}/govern/tool-use`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "X-GS-Client": `${clientName.toLowerCase().replace(/\s+/g, "-")}-mcp/0.1.0`,
      },
      body: JSON.stringify({
        tool_name: toolName,
        tool_input: toolInput,
        // gatewaystack-connect#692: never invent "interactive" for callers
        // that didn't say so — omission lets the gateway resolve the
        // least-trusted applicable tier instead of the loosest one.
        ...(typeof args.agent_tier === "string" && args.agent_tier
          ? { agent_tier: String(args.agent_tier) }
          : {}),
        client: { name: clientName, version: "0.1.0" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      return { ok: true, result: JSON.stringify({ decision: "allow", reason: "acp-http-error", tool: toolName }) };
    }

    const data = (await res.json()) as { decision: string; reason?: string };
    return {
      ok: true,
      result: JSON.stringify({ decision: data.decision, reason: data.reason || data.decision, tool: toolName }),
    };
  } catch {
    return { ok: true, result: JSON.stringify({ decision: "allow", reason: "acp-network-error", tool: toolName }) };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Claude Code `--permission-prompt-tool` (#930). Claude Code calls this
 * wherever a permission prompt would have appeared in `claude -p`, and
 * parses the returned text as JSON: {behavior: "allow"} | {behavior:
 * "deny", message}. Unlike acp_check this is ENFORCEMENT for an unattended
 * session, so every failure path answers deny: a gateway error, a network
 * error, an approval that times out, or a human who says no.
 */
async function acpPermissionPrompt(
  args: Record<string, unknown>,
  bearerToken: string
): Promise<{ ok: boolean; result: string }> {
  const toolName = String(args.tool_name || "");
  const rawInput = args.input;
  const toolInput = typeof rawInput === "string" ? safeJson(rawInput) : (rawInput ?? {});
  const holdRaw = Number(args.hold_seconds);
  const holdSeconds = Number.isFinite(holdRaw) && holdRaw > 0 ? Math.min(holdRaw, 7 * 24 * 3600) : 24 * 3600;
  const deny = (message: string) => ({ ok: true, result: JSON.stringify({ behavior: "deny", message }) });
  const allow = (message?: string) => ({ ok: true, result: JSON.stringify(message ? { behavior: "allow", message } : { behavior: "allow" }) });
  if (!toolName) return deny("[ACP] permission prompt: tool_name missing");

  let data: { decision?: string; reason?: string; approval_id?: string; approval_status?: string; kind?: string };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${ACP_API}/govern/tool-use`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "X-GS-Client": "claude-code-permission-prompt/0.3.0",
      },
      body: JSON.stringify({
        tool_name: toolName,
        tool_input: toolInput,
        call_id: typeof args.tool_use_id === "string" ? args.tool_use_id : undefined,
        agent_tier: "background",
        permission_mode: "headless",
        hook_event_name: "PermissionRequest",
        client: { name: "claude-code-permission-prompt", version: "0.3.0" },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return deny(`[ACP] permission prompt: gateway answered ${res.status}; unattended calls fail closed`);
    data = (await res.json()) as typeof data;
  } catch (e) {
    return deny(`[ACP] permission prompt: gateway unreachable (${(e as Error)?.message ?? "error"}); unattended calls fail closed`);
  }

  if (data.decision === "allow") return allow(data.reason && data.reason !== "allow" ? `[ACP] ${data.reason}` : undefined);
  if (data.approval_status === "pre_approved") return allow("[ACP] pre-approved by a standing grant");
  if (!data.approval_id) return deny(`[ACP] ${data.reason || "denied by policy"}`);

  // Policy said ask. A human has been notified (email with one-tap links,
  // web push). Hold here, long-polling the gateway, until they decide or
  // the hold window ends.
  const deadline = Date.now() + holdSeconds * 1000;
  while (Date.now() < deadline) {
    const remaining = Math.max(1, Math.min(25, Math.ceil((deadline - Date.now()) / 1000)));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), (remaining + 10) * 1000);
      const res = await fetch(`${ACP_API}/aarm/approvals/${encodeURIComponent(data.approval_id)}/wait?seconds=${remaining}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!res.ok) {
        if (res.status === 404) return deny("[ACP] approval record disappeared; unattended calls fail closed");
        await sleep(2000);
        continue;
      }
      const w = (await res.json()) as { effectiveStatus?: string; resolved?: boolean };
      if (!w.resolved) continue;
      if (w.effectiveStatus === "approved" || w.effectiveStatus === "auto_resolved") return allow("[ACP] approved by a workspace owner or admin");
      if (w.effectiveStatus === "denied") return deny("[ACP] a workspace owner or admin denied this call; hand the human the step you were about to take");
      if (w.effectiveStatus === "timeout") return deny("[ACP] no one answered the approval before it expired; hand the human the step you were about to take");
      return deny(`[ACP] approval ended as ${w.effectiveStatus ?? "unknown"}`);
    } catch {
      await sleep(2000);
    }
  }
  return deny(`[ACP] no decision within the ${Math.round(holdSeconds / 3600)}h hold; hand the human the step you were about to take`);
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return { raw: s }; }
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
async function acpStatus(bearerToken: string): Promise<{ ok: boolean; result: string }> {
  try {
    const res = await fetch(`${ACP_API}/govern/health`);
    const data = (await res.json()) as { mode?: string };
    return {
      ok: true,
      result: `ACP: Connected. Mode: ${data.mode || "unknown"}. Dashboard: https://cloud.agenticcontrolplane.com`,
    };
  } catch {
    return { ok: false, result: "ACP: Cannot reach governance API" };
  }
}

// ── Tool result summarizer ──────────────────────────────────────────
export function summarizeToolResult(name: string, payload: any): string {
  if (name === "acp_check") {
    try {
      const d = typeof payload === "string" ? JSON.parse(payload) : payload;
      return `ACP governance: ${d.decision} (${d.reason}) for tool ${d.tool}`;
    } catch {
      return String(payload);
    }
  }
  if (name === "acp_status") {
    return String(payload);
  }
  if (name === "acp_permission_prompt") {
    // Claude Code parses this text as the {behavior, message} JSON — pass
    // the exact string through, never double-encode it.
    return typeof payload === "string" ? payload : JSON.stringify(payload);
  }
  return JSON.stringify(payload);
}
