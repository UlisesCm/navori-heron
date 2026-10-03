import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  type AgentSettingsInput,
  type CliEnvelope,
  type ResearchAnalyzeData,
  type ResearchBriefData,
} from "../../src/core/contracts/index.ts";
import type { AppContext } from "../../src/app/context.ts";
import { countingFake, withAgentSettings } from "../helpers/agents.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();

/** project.json is a bound artifact: a hand edit of "agents" is re-bound by `heron init`, which keeps it (DR17). */
async function configure(root: string, agents: AgentSettingsInput): Promise<void> {
  withAgentSettings(root, agents);
  expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
}

/** A workspace whose creator role is the counting `fake` provider, with one reference. */
async function setup(): Promise<{
  root: string;
  ctx: AppContext;
  requests: ReturnType<typeof countingFake>["requests"];
}> {
  const root = await initialized("no-ux");
  await configure(root, { roles: { creator: "fake" } });
  expect((await runCliCaptured(referenceArgs(root))).code).toBe(ExitCode.Ok);
  const { provider, requests } = countingFake();
  const base = fixedContext();
  const ctx = { ...base, agents: { ...base.agents, providers: { fake: provider } } };
  return { root, ctx, requests };
}

const read = (root: string, path: string): string =>
  readFileSync(join(root, ".heron", path), "utf8");

describe("heron research brief and analyze", () => {
  // Covers: R9, R16
  test("rejects an overlong operator query before spending tokens or writing", async () => {
    const { root, ctx, requests } = await setup();
    const before = hashTree(join(root, ".heron"), { exclude: [] });
    const bad = await runCliCaptured(
      ["research", "brief", root, "--query", `screen-type:${"x".repeat(121)}`, "--json"],
      ctx,
    );
    expect(bad.code).toBe(ExitCode.Usage);
    expect(bad.stdout).toContain("RESEARCH_QUERY_INVALID");
    expect(requests).toHaveLength(0);
    expect(hashTree(join(root, ".heron"), { exclude: [] })).toEqual(before);
    const good = await runCliCaptured(
      ["research", "brief", root, "--query", `screen-type:${"x".repeat(120)}`, "--json"],
      ctx,
    );
    expect(good.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(1);
  });

  // Covers: R9, R16
  test("formulates a faceted brief with the fake provider and rejects facet-less operator queries", async () => {
    const { root, ctx, requests } = await setup();
    const run = await runCliCaptured(
      ["research", "brief", root, "--query", "screen-type:membership card", "--json"],
      ctx,
    );
    expect(run.code).toBe(ExitCode.Ok);
    const data = (JSON.parse(run.stdout) as CliEnvelope).data as ResearchBriefData;
    expect(requests).toHaveLength(1);
    expect(data.run.reused).toBe(false);
    expect(data.brief.queries.filter((query) => query.origin === "provided")).toHaveLength(1);
    expect(new Set(data.brief.queries.map((query) => query.facet)).size).toBeGreaterThanOrEqual(3);
    expect(data.written).toContain("research/brief.json");

    const text = await runCliCaptured(["research", "brief", root, "--force"], ctx);
    expect(text.stdout).toContain("Research brief (REFERENCE ONLY):");
    expect(text.stdout).toContain("Agent: fake");

    const before = requests.length;
    for (const raw of ["pricing", "modern", "nope:pricing table"]) {
      const bad = await runCliCaptured(["research", "brief", root, "--query", raw], ctx);
      expect(bad.code).toBe(ExitCode.Usage);
      expect(bad.stderr).toContain(`Query "${raw}"`);
    }
    expect(requests).toHaveLength(before);
  });

  // Covers: R10, R16
  test("analyzes references as inferred notes without touching human fields", async () => {
    const { root, ctx } = await setup();
    const referencesBefore = read(root, "research/references.json");
    const run = await runCliCaptured(["research", "analyze", root, "--json"], ctx);
    expect(run.code).toBe(ExitCode.Ok);
    const data = (JSON.parse(run.stdout) as CliEnvelope).data as ResearchAnalyzeData;
    expect(data.analyzed).toEqual(["REF-1"]);
    expect(data.analysis?.analyses.map((entry) => entry.origin)).toEqual(["inferred"]);
    expect(read(root, "research/references.json")).toBe(referencesBefore);

    const unknown = await runCliCaptured(["research", "analyze", root, "--ref", "REF-9"], ctx);
    expect(unknown.code).toBe(ExitCode.Usage);
    expect(unknown.stderr).toContain(
      "Reference REF-9 not found or removed; active references: REF-1.",
    );
  });

  // Covers: R16
  test("renders agent sections only when agent documents exist", async () => {
    const { root, ctx } = await setup();
    expect(read(root, "research/REFERENCES.md")).not.toContain("## Research brief");
    expect((await runCliCaptured(["research", "brief", root], ctx)).code).toBe(ExitCode.Ok);
    expect((await runCliCaptured(["research", "analyze", root], ctx)).code).toBe(ExitCode.Ok);
    const markdown = read(root, "research/REFERENCES.md");
    expect(markdown).toContain("## Research brief");
    expect(markdown).toContain("## Inferred notes");
    expect(markdown).toContain("SYNTHETIC");
  });

  // Covers: R6, R19
  test("reuses the stored run when inputs are unchanged unless --force", async () => {
    const { root, ctx, requests } = await setup();
    expect((await runCliCaptured(["research", "brief", root], ctx)).code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(1);
    const before = hashTree(root, { exclude: [] });
    const again = await runCliCaptured(["research", "brief", root, "--json"], ctx);
    expect(again.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(1);
    expect(hashTree(root, { exclude: [] })).toEqual(before);
    const envelope = JSON.parse(again.stdout) as CliEnvelope;
    expect((envelope.data as ResearchBriefData).run).toMatchObject({ reused: true, attempts: 0 });
    expect(envelope.findings.map((finding) => finding.code)).toContain("AGENT_RUN_REUSED");
    expect((await runCliCaptured(["research", "brief", root, "--force"], ctx)).code).toBe(
      ExitCode.Ok,
    );
    expect(requests).toHaveLength(2);

    // Analyze: the saved analysis is reused while the reference and the configuration are unchanged.
    expect((await runCliCaptured(["research", "analyze", root], ctx)).code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(3);
    const settled = hashTree(root, { exclude: [] });
    const quiet = await runCliCaptured(["research", "analyze", root], ctx);
    expect(quiet.stdout).toContain("nothing was sent to the agent");
    expect(requests).toHaveLength(3);
    expect(hashTree(root, { exclude: [] })).toEqual(settled);
    expect((await runCliCaptured(["research", "analyze", root, "--force"], ctx)).code).toBe(
      ExitCode.Ok,
    );
    expect(requests).toHaveLength(4);

    // A new reference is the only one sent.
    expect((await runCliCaptured(referenceArgs(root), ctx)).code).toBe(ExitCode.Ok);
    expect((await runCliCaptured(["research", "analyze", root], ctx)).code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(5);
    const sent = requests[4]?.pack.items.filter((item) => item.kind === "reference");
    expect(sent?.map((item) => item.id)).toEqual(["REF-2"]);

    // Changing the model invalidates the saved notes (input key), without --force.
    await configure(root, { roles: { creator: "fake" }, models: { fake: "other-model" } });
    expect((await runCliCaptured(["research", "analyze", root], ctx)).code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(6);
  });
});
