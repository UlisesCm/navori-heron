import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeAgentStep, finalizeAgentRun } from "../../../src/app/agent-task.ts";
import { summarizeAgentUsage } from "../../../src/app/agent-usage.ts";
import { AGENT_TASKS } from "../../../src/agents/tasks.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import type { RelativeArtifactPath } from "../../../src/core/contracts/index.ts";
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
const RUN = "run-20260930T120000Z-0000000a";
const NOW = new Date("2026-09-30T12:00:00.000Z");
const event = (at: string, input: number | null, output: number | null, cost: number | null) => ({
  event: "agent.invocation",
  at,
  inputTokens: input,
  outputTokens: output,
  cachedInputTokens: input === null ? null : Math.floor(input / 2),
  costUsd: cost,
});

describe("agent usage", () => {
  test("totals tokens by day from the local log and warns over the soft budget", async () => {
    // Covers: R21
    const summary = summarizeAgentUsage(
      [
        event("2026-09-30T00:00:00.000Z", 100, 20, 0.5),
        event("2026-09-30T11:59:59.000Z", 50, null, null),
        event("2026-09-29T23:59:59.000Z", 1_000, 100, 1),
        event("2026-08-01T00:00:00.000Z", 9_999, 9_999, 9),
        {
          event: "security.finding",
          at: "2026-09-30T01:00:00.000Z",
          inputTokens: 5_000,
        },
        { event: "agent.invocation", at: "garbage", inputTokens: 5_000 },
      ],
      NOW,
      { windowDays: 30, softBudget: 160 },
    );
    expect(summary.today).toEqual({
      invocations: 2,
      inputTokens: 150,
      outputTokens: 20,
      cachedInputTokens: 75,
      costUsd: 0.5,
    });
    expect(summary.window).toMatchObject({
      invocations: 3,
      inputTokens: 1_150,
      days: 30,
    });
    expect(summary.overBudget).toBe(true); // 170 > 160
    expect(
      summarizeAgentUsage([event("2026-09-30T01:00:00.000Z", 100, 20, null)], NOW, {
        windowDays: 30,
        softBudget: null,
      }),
    ).toMatchObject({ overBudget: false, today: { costUsd: null } });

    // End to end: the fake provider logs deterministic usage; over the budget only warns.
    const ctx = fixedContext();
    const root = await initializedRoot(ctx);
    roots.push(root);
    withAgentSettings(root, { warnTokensPerDay: 1_000 });
    const { provider } = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const step = await executeAgentStep(
      {
        ...ctx,
        agents: {
          ...ctx.agents,
          providers: { fake: provider, "claude-code": provider },
        },
      },
      briefStep(openWorkspace(ctx, root)),
      RUN,
    );
    expect(step.ok).toBe(true);
    expect(step.ok && step.findings.map((f) => f.code)).not.toContain("AGENT_BUDGET_WARNING");

    withAgentSettings(root, { warnTokensPerDay: 1_000 });
    const noisy = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const logs = join(root, ".heron", "logs", "2026-09-30.jsonl");
    writeFileSync(logs, `${JSON.stringify(event("2026-09-30T08:00:00.000Z", 5_000, 10, null))}\n`, {
      flag: "a",
    });
    const warned = await executeAgentStep(
      {
        ...ctx,
        agents: { ...ctx.agents, providers: { "claude-code": noisy.provider } },
      },
      briefStep(openWorkspace(ctx, root)),
      RUN,
    );
    expect(warned.ok).toBe(true);
    expect(warned.ok && warned.findings.map((f) => f.code)).toContain("AGENT_BUDGET_WARNING");
  });

  test("sends nothing and adds no usage when the stored run is reused", async () => {
    // Covers: R19, R21
    const ctx = fixedContext();
    const root = await initializedRoot(ctx);
    roots.push(root);
    const { provider, requests } = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const live = {
      ...ctx,
      agents: { ...ctx.agents, providers: { "claude-code": provider } },
    };
    const first = await executeAgentStep(live, briefStep(openWorkspace(ctx, root)), RUN);
    if (!first.ok || first.reused) throw new Error("expected a fresh run");
    expect(requests).toHaveLength(1);

    // Persist what a use case would: the document and its run (the file store is not needed for this check).
    const documentPath = "research/brief.json" as RelativeArtifactPath;
    const text = `${JSON.stringify(first.output)}\n`;
    mkdirSync(join(root, ".heron", "research"), { recursive: true });
    mkdirSync(join(root, ".heron", "runs"), { recursive: true });
    writeFileSync(join(root, ".heron", documentPath), text);
    const run = finalizeAgentRun(
      first.draft,
      [
        {
          path: documentPath,
          sha256: sha256Hex(new TextEncoder().encode(text)),
        },
      ],
      [
        { kind: "ResearchBrief", schemaVersion: 1 },
        { kind: "AgentRun", schemaVersion: 1 },
      ],
    );
    const runPath = `runs/${RUN}.json` as RelativeArtifactPath;
    writeFileSync(join(root, ".heron", runPath), `${JSON.stringify(run)}\n`);
    const previous = {
      run: {
        runId: RUN,
        path: runPath,
        provider: run.provider,
        template: AGENT_TASKS["research-brief"].template.ref,
        cacheKey: run.cacheKey,
      },
      documentPath,
    } as const;
    const logPath = join(root, ".heron", "logs", "2026-09-30.jsonl");
    const logBefore = readFileSync(logPath, "utf8");

    const second = await executeAgentStep(
      live,
      briefStep(openWorkspace(ctx, root), { previous }),
      "run-20260930T120000Z-0000000b",
    );
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(second.ok && second.findings.map((f) => f.code)).toContain("AGENT_RUN_REUSED");
    expect(requests).toHaveLength(1); // 0 provider calls
    expect(readFileSync(logPath, "utf8")).toBe(logBefore); // usage totals unchanged

    // A corrupt run file is never trusted.
    const runFile = join(root, ".heron", runPath);
    const goodRun = readFileSync(runFile, "utf8");
    writeFileSync(runFile, "{not json");
    const corrupt = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const reAsked = await executeAgentStep(
      { ...ctx, agents: { ...ctx.agents, providers: { "claude-code": corrupt.provider } } },
      briefStep(openWorkspace(ctx, root), { previous }),
      "run-20260930T120000Z-0000000d",
    );
    expect(reAsked).toMatchObject({ ok: true, reused: false });
    expect(corrupt.requests).toHaveLength(1);
    writeFileSync(runFile, goodRun);

    // With the run and document untouched, --force and a changed projected input still ask exactly once.
    const forced = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const forcedCtx = {
      ...ctx,
      agents: { ...ctx.agents, providers: { "claude-code": forced.provider } },
    };
    const forcedRun = await executeAgentStep(
      forcedCtx,
      briefStep(openWorkspace(ctx, root), { previous, force: true }),
      "run-20260930T120000Z-0000000e",
    );
    expect(forcedRun).toMatchObject({ ok: true, reused: false });
    expect(forced.requests).toHaveLength(1);

    const changed = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const base = briefStep(openWorkspace(ctx, root), { previous });
    const item = base.items[0];
    if (item === undefined) throw new Error("fixture item missing");
    const changedRun = await executeAgentStep(
      { ...ctx, agents: { ...ctx.agents, providers: { "claude-code": changed.provider } } },
      { ...base, items: [{ ...item, content: `${item.content}\nvalid ids: REF-2` }] },
      "run-20260930T120000Z-0000000f",
    );
    expect(changedRun).toMatchObject({ ok: true, reused: false });
    expect(changed.requests).toHaveLength(1);
    expect(changedRun.ok && !changedRun.reused && changedRun.draft.cacheKey).not.toBe(
      previous.run.cacheKey,
    );

    // An edited document, asks again.
    writeFileSync(join(root, ".heron", documentPath), `${text} `);
    const edited = scriptedProvider([{ output: BRIEF_OUTPUT }]);
    const asked = await executeAgentStep(
      {
        ...ctx,
        agents: {
          ...ctx.agents,
          providers: { "claude-code": edited.provider },
        },
      },
      briefStep(openWorkspace(ctx, root), { previous }),
      "run-20260930T120000Z-0000000c",
    );
    expect(asked).toMatchObject({ ok: true, reused: false });
    expect(edited.requests).toHaveLength(1);
  });
});
