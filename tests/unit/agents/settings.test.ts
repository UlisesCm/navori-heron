// Covers: R7
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_AGENT_SETTINGS,
  providerIdForRole,
  resolveAgentSettings,
} from "../../../src/agents/settings.ts";

describe("resolveAgentSettings", () => {
  test("defaults when absent and merges a partial block", () => {
    const none = resolveAgentSettings(undefined);
    expect(none).toEqual({ ok: true, settings: DEFAULT_AGENT_SETTINGS });
    const partial = resolveAgentSettings({
      roles: { creator: "codex-cli" },
      models: { "claude-code": "opus", fake: "f1", "codex-cli": "gpt-x" },
      timeoutMs: 5_000,
      warnTokensPerDay: 2_000,
      unknownKey: true,
    });
    if (!partial.ok) throw new Error("expected ok");
    expect(partial.settings.roles).toEqual({ creator: "codex-cli", reviewer: "codex-cli" });
    expect(partial.settings.models).toEqual({
      "claude-code": "opus",
      "codex-cli": "gpt-x",
      fake: "f1",
    });
    expect(partial.settings.timeoutMs).toBe(5_000);
    expect(partial.settings.warnTokensPerDay).toBe(2_000);
    expect(partial.settings.contextBudgetChars).toBe(120_000);
    expect(providerIdForRole(partial.settings, "creator")).toBe("codex-cli");
    expect(providerIdForRole(partial.settings, "reviewer")).toBe("codex-cli");
    // defaults are never aliased
    if (!none.ok) throw new Error("expected ok");
    none.settings.roles.creator = "fake";
    expect(DEFAULT_AGENT_SETTINGS.roles.creator).toBe("claude-code");
  });

  test("reports invalid blocks with sorted /agents pointers", () => {
    const bad = resolveAgentSettings({
      timeoutMs: 5,
      roles: { creator: "gpt" },
      models: { "claude-code": "--evil" },
    });
    if (bad.ok) throw new Error("expected issues");
    expect(bad.issues.map((i) => i.pointer)).toEqual([
      "/agents/models/claude-code",
      "/agents/roles/creator",
      "/agents/timeoutMs",
    ]);
    const root = resolveAgentSettings("nope");
    if (root.ok) throw new Error("expected issues");
    expect(root.issues[0]?.pointer).toBe("/agents");
    const same = resolveAgentSettings({ roles: { creator: "a", reviewer: "b" } });
    if (same.ok) throw new Error("expected issues");
    expect(same.issues).toHaveLength(2);
  });
});
