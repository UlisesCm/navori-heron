import {
  AgentSettingsInputSchema,
  type AgentProviderId,
  type AgentRole,
  type FindingIssue,
} from "../core/contracts/index.ts";

export type AgentSettings = {
  roles: Record<AgentRole, AgentProviderId>;
  models: Partial<Record<AgentProviderId, string>>;
  timeoutMs: number;
  contextBudgetChars: number;
  warnTokensPerDay: number | null;
};
export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  roles: { creator: "claude-code", reviewer: "codex-cli" },
  models: {},
  timeoutMs: 600_000,
  contextBudgetChars: 120_000,
  warnTokensPerDay: null,
};

/** RFC 6901 token escaping for one path segment. */
const escapeToken = (segment: string): string =>
  segment.replaceAll("~", "~0").replaceAll("/", "~1");

/**
 * Parses `project.agents` lazily (DR21): only agent commands call this, so a broken `agents` block never breaks
 * the other commands. `undefined` means "not configured" and yields the defaults.
 */
export function resolveAgentSettings(
  raw: unknown,
): { ok: true; settings: AgentSettings } | { ok: false; issues: FindingIssue[] } {
  if (raw === undefined) return { ok: true, settings: structuredClone(DEFAULT_AGENT_SETTINGS) };
  const parsed = AgentSettingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      pointer: ["/agents", ...issue.path.map((part) => escapeToken(String(part)))].join("/"),
      message: issue.message,
    }));
    issues.sort((a, b) =>
      a.pointer === b.pointer ? (a.message < b.message ? -1 : 1) : a.pointer < b.pointer ? -1 : 1,
    );
    return { ok: false, issues };
  }
  const input = parsed.data;
  const models: Partial<Record<AgentProviderId, string>> = {};
  for (const id of ["claude-code", "codex-cli", "fake"] as const) {
    const model = input.models?.[id];
    if (model !== undefined) models[id] = model;
  }
  return {
    ok: true,
    settings: {
      roles: {
        creator: input.roles?.creator ?? DEFAULT_AGENT_SETTINGS.roles.creator,
        reviewer: input.roles?.reviewer ?? DEFAULT_AGENT_SETTINGS.roles.reviewer,
      },
      models,
      timeoutMs: input.timeoutMs ?? DEFAULT_AGENT_SETTINGS.timeoutMs,
      contextBudgetChars: input.contextBudgetChars ?? DEFAULT_AGENT_SETTINGS.contextBudgetChars,
      warnTokensPerDay: input.warnTokensPerDay ?? null,
    },
  };
}

export function providerIdForRole(settings: AgentSettings, role: AgentRole): AgentProviderId {
  return settings.roles[role];
}
