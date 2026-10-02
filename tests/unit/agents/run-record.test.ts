import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runResearchBrief } from "../../../src/app/research.ts";
import {
  AGENT_RUN_DOCUMENT,
  RESEARCH_BRIEF_DOCUMENT,
  type ResearchBriefOutput,
} from "../../../src/core/contracts/index.ts";
import { openFileStore } from "../../../src/core/store/file-store.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import { initializedRoot, scriptedProvider, withAgentSettings } from "../../helpers/agents.ts";
import { fixedContext, runCliCaptured } from "../../helpers/cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Every file under `dir`, recursively (the secret scan covers logs, runs and views alike). */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe("agent run record", () => {
  // Covers: R6, R15
  test("records reproducibility fields and never leaks secrets", async () => {
    const secret = "sk-synthetic-secret-0123456789";
    const output: ResearchBriefOutput = {
      queries: ["visual-style", "flow", "ui-element"].map((facet, index) => ({
        facet,
        job: `SYNTHETIC job ${index}`,
        query: index === 0 ? `SYNTHETIC ${secret} query` : `SYNTHETIC query ${index}`,
        question: `SYNTHETIC question ${index}`,
        rationale: `SYNTHETIC rationale ${index}`,
      })),
    } as ResearchBriefOutput;
    const { provider } = scriptedProvider([{ output }]);
    const base = fixedContext();
    const ctx = {
      ...base,
      env: { ANTHROPIC_API_KEY: secret },
      agents: { ...base.agents, providers: { fake: provider } },
    };
    const root = await initializedRoot(ctx);
    roots.push(root);
    withAgentSettings(root, { roles: { creator: "fake" } });
    expect((await runCliCaptured(["init", root], ctx)).code).toBe(0);

    const result = await runResearchBrief(ctx, {
      path: root,
      queries: ["screen-type:membership card"],
      resetQueries: false,
      force: false,
    });
    if (!result.ok) throw new Error(result.message);
    const codes = result.findings.map((finding) => finding.code);
    expect(codes).toContain("SECRET_REDACTED");
    expect(codes).toContain("AGENT_ENV_IGNORED");

    const store = openFileStore(nodeFs, root, { create: false });
    const brief = store.readDocument("research/brief.json", RESEARCH_BRIEF_DOCUMENT);
    const run = store.readDocument(result.data.run.path, AGENT_RUN_DOCUMENT);
    if (brief === null || run === null) throw new Error("brief and run record are written");
    // The brief points at its run, which points back at the exact bytes it produced.
    expect(brief.run).toMatchObject({
      runId: run.runId,
      provider: "fake",
      cacheKey: run.cacheKey,
      template: run.invocations[0]?.template,
    });
    expect(run.cacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(run.pack.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.outputSchema).toMatchObject({ task: "research-brief", dialect: "claude" });
    expect(run).toMatchObject({ task: "research-brief", role: "creator", status: "succeeded" });
    expect(run.heronVersion).not.toBe("");
    expect(run.invocations[0]?.usage.inputTokens).toBeGreaterThan(0);
    expect(run.outputs).toEqual([
      {
        path: "research/brief.json",
        sha256: sha256Hex(new Uint8Array(readFileSync(join(root, ".heron/research/brief.json")))),
      },
    ]);
    expect(run.inputs.map((input) => input.path)).not.toContain("research/brief.json");

    // No stored file (documents, views, run record, local log) holds the secret value.
    for (const file of filesUnder(join(root, ".heron"))) {
      expect(readFileSync(file, "utf8")).not.toContain(secret);
    }
    expect(JSON.stringify(brief)).toContain("[REDACTED]");
  });
});
