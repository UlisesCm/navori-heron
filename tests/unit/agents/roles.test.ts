import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { executeAgentStep } from "../../../src/app/agent-task.ts";
import { ExitCode } from "../../../src/core/contracts/index.ts";
import {
  BRIEF_OUTPUT,
  briefStep,
  initializedRoot,
  openWorkspace,
  scriptedProvider,
  withAgentSettings,
} from "../../helpers/agents.ts";
import { fixedContext } from "../../helpers/cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const RUN_ID = "run-20260930T120000Z-0000000a";

describe("agent roles", () => {
  test("resolves role providers from configuration", async () => {
    // Covers: R7
    const ctx = fixedContext();
    const root = await initializedRoot(ctx);
    roots.push(root);
    const claude = scriptedProvider([{ output: BRIEF_OUTPUT }], "claude-code");
    const codex = scriptedProvider([{ output: BRIEF_OUTPUT }], "codex-cli");
    const withBoth = {
      ...ctx,
      agents: {
        ...ctx.agents,
        providers: {
          "claude-code": claude.provider,
          "codex-cli": codex.provider,
        },
      },
    };

    // No configuration: the creator role defaults to claude-code, without a model.
    await executeAgentStep(withBoth, briefStep(openWorkspace(ctx, root)), RUN_ID);
    expect(claude.requests.map((r) => r.model)).toEqual([null]);
    expect(codex.requests).toHaveLength(0);

    // Configured: creator -> codex-cli with its model and timeout.
    withAgentSettings(root, {
      roles: { creator: "codex-cli" },
      models: { "codex-cli": "gpt-test" },
      timeoutMs: 2_000,
    });
    const step = await executeAgentStep(withBoth, briefStep(openWorkspace(ctx, root)), RUN_ID);
    expect(step).toMatchObject({ ok: true, reused: false });
    expect(codex.requests.map((r) => [r.model, r.timeoutMs])).toEqual([["gpt-test", 2_000]]);
    expect(step.ok && !step.reused && step.draft.provider).toBe("codex-cli");
    expect(step.ok && !step.reused && step.draft.outputSchema.dialect).toBe("openai-strict");

    // A provider that is not registered is unavailable (exit 5), never a crash.
    const missing = await executeAgentStep(
      { ...ctx, agents: { ...ctx.agents, providers: {} } },
      briefStep(openWorkspace(ctx, root)),
      RUN_ID,
    );
    if (missing.ok || missing.result.ok) throw new Error("expected a failure");
    expect(missing.result.code).toBe(ExitCode.DependencyUnavailable);
    expect(missing.result.findings[0]?.code).toBe("AGENT_UNAVAILABLE");

    // Invalid configuration is reported lazily with /agents pointers (DR21).
    withAgentSettings(root, { roles: { creator: "gpt" }, timeoutMs: 5 });
    const invalid = await executeAgentStep(withBoth, briefStep(openWorkspace(ctx, root)), RUN_ID);
    if (invalid.ok || invalid.result.ok) throw new Error("expected a failure");
    expect(invalid.result.code).toBe(ExitCode.Usage);
    const finding = invalid.result.findings[0];
    expect(finding?.code).toBe("AGENT_CONFIG_INVALID");
    expect(finding?.issues.every((issue) => issue.pointer.startsWith("/agents"))).toBe(true);
    expect(finding?.issues.length).toBeGreaterThanOrEqual(2);
  });

  test("rejects over-budget packs before any provider call", async () => {
    // Covers: R20
    const ctx = fixedContext();
    const root = await initializedRoot(ctx);
    roots.push(root);
    withAgentSettings(root, { contextBudgetChars: 10_000 });
    const { provider, requests } = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const step = briefStep(openWorkspace(ctx, root));
    const first = step.items[0];
    if (first === undefined) throw new Error("fixture item missing");
    const result = await executeAgentStep(
      {
        ...ctx,
        agents: { ...ctx.agents, providers: { "claude-code": provider } },
      },
      { ...step, items: [{ ...first, content: "x".repeat(20_000) }] },
      RUN_ID,
    );
    if (result.ok || result.result.ok) throw new Error("expected a failure");
    expect(result.result.code).toBe(ExitCode.Usage);
    expect(result.result.findings[0]?.code).toBe("CONTEXT_PACK_OVER_BUDGET");
    expect(requests).toHaveLength(0);
  });
});
