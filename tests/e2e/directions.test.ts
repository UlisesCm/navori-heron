import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESPONDERS } from "../../src/agents/adapters/fake/responders.ts";
import type { AppContext } from "../../src/app/context.ts";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  type CliEnvelope,
  type DirectionProposalOutput,
  type DirectionProposeData,
} from "../../src/core/contracts/index.ts";
import { openFileStore } from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { checkContrast } from "../../src/tokens/contrast.ts";
import { countingFake, scriptedProvider, withAgentSettings } from "../helpers/agents.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";
import { hasControlChars, hostileText } from "../helpers/hostile-controls.ts";
import { referenceArgs } from "../helpers/research.ts";

const { initialized } = e2eSetup();

const withProvider = (provider: ReturnType<typeof countingFake>["provider"]): AppContext => {
  const base = fixedContext();
  return { ...base, agents: { ...base.agents, providers: { fake: provider } } };
};

/** A workspace with five references, the creator role on `fake` and (optionally) the research gate approved. */
async function setup(approve = true): Promise<{
  root: string;
  ctx: AppContext;
  requests: ReturnType<typeof countingFake>["requests"];
}> {
  const root = await initialized("no-ux");
  withAgentSettings(root, { roles: { creator: "fake" } });
  expect((await runCliCaptured(["init", root])).code).toBe(ExitCode.Ok);
  for (let n = 1; n <= 5; n += 1) {
    const add = await runCliCaptured([
      ...referenceArgs(root, ["origin"]),
      "--origin",
      `Source ${n}`,
    ]);
    expect(add.code).toBe(ExitCode.Ok);
  }
  if (approve) {
    expect((await runCliCaptured(["gate", "research", "approve", "--yes", root])).code).toBe(
      ExitCode.Ok,
    );
  }
  const { provider, requests } = countingFake();
  return { root, ctx: withProvider(provider), requests };
}

/** The `fake` provider's valid output for three references (SYNTHETIC), to tweak in a test. */
const fakeOutput = (): DirectionProposalOutput =>
  RESPONDERS["direction-propose"](
    ["REF-1", "REF-2", "REF-3"].map((id) => ({
      kind: "reference" as const,
      id,
      trust: "operator" as const,
      priority: 0,
      content: id,
      findings: 0,
    })),
  ) as DirectionProposalOutput;

const data = <T>(stdout: string): T => (JSON.parse(stdout) as CliEnvelope).data as T;
const codes = (stdout: string): string[] =>
  (JSON.parse(stdout) as CliEnvelope).findings.map((finding) => finding.code);
const read = (root: string, path: string): string =>
  readFileSync(join(root, ".heron", path), "utf8");
const phaseOf = (root: string): string => {
  const store = openFileStore(nodeFs, root, { create: false });
  return store.readDocument("state.json", HERON_STATE_DOCUMENT)?.phase ?? "";
};

describe("heron direction propose and select", () => {
  // Covers: R11, R12, R13, R19
  test("proposes three reference-only directions and records a preferred one", async () => {
    const { root, ctx, requests } = await setup();
    const run = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    expect(run.code).toBe(ExitCode.Ok);
    const proposed = data<DirectionProposeData>(run.stdout);
    expect(requests).toHaveLength(1);
    expect(proposed.directions.mode).toBe("reference-only");
    expect(proposed.directions.directions.map((direction) => direction.id)).toEqual([
      "DIR-A",
      "DIR-B",
      "DIR-C",
    ]);
    expect(proposed.phase).toEqual({ from: "research-ready", to: "directions-ready" });
    expect(proposed.written).toContain("research/visual-directions.json");
    expect(phaseOf(root)).toBe("directions-ready");
    expect(read(root, "research/REFERENCES.md")).toContain("## Visual directions");

    // Token economy: the same inputs reuse the stored run and send nothing.
    const settled = hashTree(root, { exclude: [] });
    const again = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    expect(again.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(1);
    expect(hashTree(root, { exclude: [] })).toEqual(settled);
    expect(data<DirectionProposeData>(again.stdout).run).toMatchObject({
      reused: true,
      attempts: 0,
    });
    expect(codes(again.stdout)).toContain("AGENT_RUN_REUSED");
    // --force skips the cache even while it would hit: exactly one more provider call.
    const reasked = await runCliCaptured(["direction", "propose", root, "--force", "--json"], ctx);
    expect(reasked.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(2);
    expect(data<DirectionProposeData>(reasked.stdout).run.reused).toBe(false);
    const text = await runCliCaptured(
      ["direction", "select", "DIR-B", root, "--note", "calm"],
      ctx,
    );
    expect(text.code).toBe(ExitCode.Ok);
    expect(text.stdout).toContain('Preferred direction: DIR-B "');
    expect(text.stdout).toContain("(the direction gate is not approved)");
    const stored = JSON.parse(read(root, "research/visual-directions.json")) as {
      selection: { direction: string; status: string; decidedBy: string; note: string };
    };
    expect(stored.selection).toMatchObject({
      direction: "DIR-B",
      status: "preferred",
      decidedBy: "tester",
      note: "calm",
    });
    expect(phaseOf(root)).toBe("directions-ready");

    const unknown = await runCliCaptured(["direction", "select", "DIR-Z", root, "--json"], ctx);
    expect(unknown.code).toBe(ExitCode.Usage);
    expect(codes(unknown.stdout)).toContain("DIRECTION_NOT_FOUND");

    // --force asks again and clears the preference.
    const forced = await runCliCaptured(["direction", "propose", root, "--force", "--json"], ctx);
    expect(forced.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(3);
    expect(codes(forced.stdout)).toContain("DIRECTION_PREFERENCE_CLEARED");
    expect(data<DirectionProposeData>(forced.stdout).directions.selection).toBeNull();

    // The direction gate stays blocked in reference-only mode.
    const gate = await runCliCaptured(
      ["gate", "direction", "approve", "--yes", root, "--json"],
      ctx,
    );
    expect(gate.code).toBe(ExitCode.Blocked);
    expect(codes(gate.stdout)).toContain("MODE_BLOCKED");
  });

  // Covers: R11
  test("refuses to select before any direction was proposed", async () => {
    const { root, ctx } = await setup();
    const early = await runCliCaptured(["direction", "select", "DIR-A", root, "--json"], ctx);
    expect(early.code).toBe(ExitCode.Blocked);
    expect(codes(early.stdout)).toContain("TRANSITION_NOT_ALLOWED");
    const selected = await runCliCaptured(["direction", "select", "--json"], ctx);
    expect(selected.code).toBe(ExitCode.Usage);
  });

  // Covers: R12
  test("each direction carries a complete visual proposal with deterministic contrast", async () => {
    const { root, ctx } = await setup();
    const run = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    const { directions } = data<DirectionProposeData>(run.stdout).directions;
    for (const direction of directions) {
      const { palette, typeScale, componentSheet, composition, marking } = direction.proposal;
      expect(marking).toBe("SYNTHETIC");
      expect(componentSheet.length).toBeGreaterThanOrEqual(4);
      expect(typeScale.steps.length).toBeGreaterThanOrEqual(4);
      expect(composition.nodes.length).toBeGreaterThanOrEqual(1);
      expect(direction.attributes.references.length).toBeGreaterThanOrEqual(2);
      for (const pair of palette.pairs) {
        const fg = palette.colors.find((color) => color.id === pair.foreground)?.hex ?? "";
        const bg = palette.colors.find((color) => color.id === pair.background)?.hex ?? "";
        expect(pair.contrast).toEqual(checkContrast(fg, bg, pair.usage) as typeof pair.contrast);
        expect(pair.contrast.passes).toBe(true);
      }
    }

    // A pair below its threshold is never stored: three attempts, then exit 4 and nothing written.
    const fresh = await setup();
    const output = fakeOutput();
    const low = structuredClone(output);
    low.directions[0]!.proposal.palette.pairs[0] = {
      foreground: "c2",
      background: "c1",
      usage: "body-text",
    };
    const { provider, requests } = scriptedProvider([
      { output: low },
      { output: low },
      { output: low },
    ]);
    const before = hashTree(join(fresh.root, ".heron"), { exclude: ["logs"] });
    const failed = await runCliCaptured(
      ["direction", "propose", fresh.root, "--json"],
      withProvider(provider),
    );
    expect(failed.code).toBe(ExitCode.ValidationFailed);
    expect(requests).toHaveLength(3);
    expect(codes(failed.stdout)).toContain("AGENT_OUTPUT_INVALID");
    expect(hashTree(join(fresh.root, ".heron"), { exclude: ["logs"] })).toEqual(before);
  });

  // Covers: R11
  test("refuses to propose directions while the research approval is invalid", async () => {
    const unapproved = await setup(false);
    const early = await runCliCaptured(
      ["direction", "propose", unapproved.root, "--json"],
      unapproved.ctx,
    );
    expect(early.code).toBe(ExitCode.Blocked);
    expect(codes(early.stdout)).toContain("TRANSITION_NOT_ALLOWED");
    expect(unapproved.requests).toHaveLength(0);

    const { root, ctx, requests } = await setup();
    expect((await runCliCaptured(["references", "remove", "REF-5", root], ctx)).code).toBe(
      ExitCode.Ok,
    );
    const blocked = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    expect(blocked.code).toBe(ExitCode.Blocked);
    expect(codes(blocked.stdout)).toEqual(
      expect.arrayContaining([expect.stringMatching(/PRECONDITION_UNMET|TRANSITION_NOT_ALLOWED/)]),
    );
    expect(requests).toHaveLength(0);
  });

  // Covers: R20
  test("feeds directions from stored analyses instead of raw sources", async () => {
    const { root, ctx, requests } = await setup();
    expect((await runCliCaptured(["research", "analyze", root], ctx)).code).toBe(ExitCode.Ok);
    expect(requests.map((request) => request.task)).toEqual(["research-analyze"]);
    const run = await runCliCaptured(["direction", "propose", root], ctx);
    expect(run.code).toBe(ExitCode.Ok);
    // One call for the proposal; the analysis was consumed from disk, never re-run.
    expect(requests.map((request) => request.task)).toEqual([
      "research-analyze",
      "direction-propose",
    ]);
    const items = requests[1]?.pack.items ?? [];
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds.has("external-text")).toBe(false);
    expect(kinds.has("reference-origin")).toBe(false);
    expect(items.filter((item) => item.kind === "analysis-note").map((item) => item.id)).toEqual([
      "REF-1",
      "REF-2",
      "REF-3",
      "REF-4",
      "REF-5",
    ]);
    const reference = items.find((item) => item.kind === "reference");
    expect(reference?.content).not.toContain("source:");
    expect(items.some((item) => item.kind === "contrast-policy")).toBe(true);
  });

  // Covers: R13, R20
  test("escapes hostile agent text in the direction views", async () => {
    const { root } = await setup();
    const hostile = JSON.parse(
      readFileSync(
        join(import.meta.dir, "..", "assets", "research", "hostile-direction.json"),
        "utf8",
      ),
    ) as { name: string; summary: string };
    const base = fakeOutput();
    base.directions[0]!.name = hostile.name;
    base.directions[0]!.summary = hostile.summary;
    const { provider } = scriptedProvider([{ output: base }]);
    const run = await runCliCaptured(["direction", "propose", root], withProvider(provider));
    expect(run.stderr).toBe("");
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).not.toContain("\u001b");
    expect(run.stdout).toContain("\\x1b");
    const markdown = read(root, "research/REFERENCES.md");
    expect(markdown).not.toContain("](https://evil.example");
    expect(markdown).not.toMatch(/(^|[^\\])<img/);
    const select = await runCliCaptured(
      ["direction", "select", "DIR-A", root],
      withProvider(provider),
    );
    expect(select.stdout).not.toContain("\u001b");
    expect(select.stdout).toContain("\\x1b");
  });

  // Covers: R13, R20
  test("REFERENCES.md and the text views emit no control characters", async () => {
    const { root } = await setup();
    const base = fakeOutput();
    base.directions[0]!.name = hostileText();
    base.directions[0]!.summary = hostileText();
    const { provider } = scriptedProvider([{ output: base }]);
    const ctx = withProvider(provider);
    const run = await runCliCaptured(["direction", "propose", root], ctx);
    expect(run.code).toBe(ExitCode.Ok);
    expect(hasControlChars(run.stdout)).toBe(false);
    expect(hasControlChars(read(root, "research/REFERENCES.md"))).toBe(false);
    const select = await runCliCaptured(["direction", "select", "DIR-A", root], ctx);
    expect(select.code).toBe(ExitCode.Ok);
    expect(hasControlChars(select.stdout)).toBe(false);
  });

  // Covers: R19
  test("propose after select reuses the run and keeps the selection; edited agent content re-asks", async () => {
    const { root, ctx, requests } = await setup();
    expect((await runCliCaptured(["direction", "propose", root, "--json"], ctx)).code).toBe(
      ExitCode.Ok,
    );
    expect(requests).toHaveLength(1);
    expect((await runCliCaptured(["direction", "select", "DIR-B", root], ctx)).code).toBe(
      ExitCode.Ok,
    );
    const again = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    expect(again.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(1);
    expect(data<DirectionProposeData>(again.stdout).run.reused).toBe(true);
    const kept = JSON.parse(read(root, "research/visual-directions.json")) as {
      selection: { direction: string };
    };
    expect(kept.selection.direction).toBe("DIR-B");

    // Editing agent-produced content by hand invalidates the reuse.
    const path = join(root, ".heron", "research", "visual-directions.json");
    const doc = JSON.parse(readFileSync(path, "utf8")) as {
      directions: { name: string }[];
    };
    doc.directions[0]!.name = "Edited by hand";
    writeFileSync(path, JSON.stringify(doc));
    const reasked = await runCliCaptured(["direction", "propose", root, "--json"], ctx);
    expect(reasked.code).toBe(ExitCode.Ok);
    expect(requests).toHaveLength(2);
    expect(data<DirectionProposeData>(reasked.stdout).run.reused).toBe(false);
  });
});
