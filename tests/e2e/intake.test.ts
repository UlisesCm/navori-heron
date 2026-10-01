import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  type CliEnvelope,
  type HeronState,
  type IntakeData,
} from "../../src/core/contracts/index.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";

const { fresh, initialized } = e2eSetup();
const FILES = ["intake/product-context.json", "intake/conflicts.json"];
const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");

const envelope = (stdout: string): CliEnvelope & { ok: true; data: IntakeData } =>
  JSON.parse(stdout) as CliEnvelope & { ok: true; data: IntakeData };
const readState = (root: string): HeronState =>
  HERON_STATE_DOCUMENT.schema.parse(
    JSON.parse(readFileSync(join(root, ".heron", "state.json"), "utf8")),
  );
const mtimes = (root: string): number[] =>
  FILES.map((file) => statSync(join(root, ".heron", file)).mtimeMs);

describe("heron intake", () => {
  // Covers: R8
  test("writes the product context and its conflicts once and skips unchanged runs", async () => {
    const root = await initialized("membership-product");
    const first = await runCliCaptured(["intake", "--json", root]);
    expect(first.code).toBe(ExitCode.Ok);
    const written = envelope(first.stdout).data;
    expect(written).toMatchObject({ mode: "full", written: true, dryRun: false, conflicts: [] });
    expect(written.counts).toMatchObject({ surfaces: 3, screens: 6, flows: 3, patterns: 2 });
    const state = readState(root);
    expect(state.stateRevision).toBe(written.stateRevision ?? -1);
    expect(state.artifacts.map((a) => a.path)).toEqual(expect.arrayContaining(FILES));

    // Back-date both files: an unchanged run must leave the mtimes (and the state) untouched.
    for (const file of FILES) utimesSync(join(root, ".heron", file), LONG_AGO, LONG_AGO);
    const stateBefore = readFileSync(join(root, ".heron", "state.json"), "utf8");
    const second = await runCliCaptured(["intake", root]);
    expect(second.code).toBe(ExitCode.Ok);
    expect(second.stdout).toContain("- intake/product-context.json: unchanged");
    expect(mtimes(root)).toEqual([LONG_AGO.getTime(), LONG_AGO.getTime()]);
    expect(readFileSync(join(root, ".heron", "state.json"), "utf8")).toBe(stateBefore);

    // A content change writes again, advances the revision and keeps nothing stale for the regenerated files.
    const master = join(root, "specs", "_master", "01-mvp", "MASTER.md");
    writeFileSync(
      master,
      readFileSync(master, "utf8").replace("Members can browse benefits.", "Members browse perks."),
    );
    const third = envelope((await runCliCaptured(["intake", "--json", root])).stdout).data;
    expect(third.written).toBe(true);
    expect(third.stateRevision).toBe(state.stateRevision + 1);
    const after = readState(root);
    expect(after.stale.filter((entry) => FILES.includes(entry.path))).toEqual([]);
    expect(readFileSync(join(root, ".heron", FILES[0] ?? ""), "utf8")).toContain(
      "Members browse perks.",
    );
  });

  // Covers: R8
  test("previews the product context with --dry-run without a workspace", async () => {
    const root = fresh("membership-product");
    const before = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(["intake", "--dry-run", "--json", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(envelope(run.stdout).data).toMatchObject({
      mode: "full",
      dryRun: true,
      written: false,
      stateRevision: null,
      conflicts: [],
    });
    expect(existsSync(join(root, ".heron"))).toBe(false);
    expect(hashTree(root, { exclude: [] })).toEqual(before);

    const text = await runCliCaptured(["intake", "--dry-run", root]);
    expect(text.stdout).toContain("Dry run: nothing was written to .heron/");
    expect(text.stdout).toContain("intake/conflicts.json: not written (dry run)");
  });

  // Covers: R8
  test("accepts --refresh as an alias without effect and reports a missing workspace", async () => {
    const root = fresh("membership-product");
    const missing = await runCliCaptured(["intake", root]);
    expect(missing.code).toBe(ExitCode.Blocked);
    expect(missing.stdout + missing.stderr).toContain(".heron/state.json not found");
    const ready = await initialized("membership-product");
    const run = await runCliCaptured(["intake", "--refresh", "--json", ready]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(envelope(run.stdout).data.written).toBe(true);
  });

  // Covers: R8
  test("records the open conflicts of the conflict fixture and previews over a workspace", async () => {
    const root = await initialized("conflict");
    const preview = await runCliCaptured(["intake", "--dry-run", "--json", root]);
    expect(preview.code).toBe(ExitCode.Ok);
    expect(envelope(preview.stdout).data).toMatchObject({ written: false, stateRevision: 1 });
    expect(existsSync(join(root, ".heron", "intake", "conflicts.json"))).toBe(false);

    const run = await runCliCaptured(["intake", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain("Conflicts: 1 open, 1 not acknowledged");
    expect(run.stdout).toContain("- CONFLICT-001 ");
    expect(run.stdout).toContain(`CONFLICT_OPEN: CONFLICT-001 (permission-contradiction) on`);
    expect(run.stdout).toContain(`Run: heron conflicts ack CONFLICT-001 ${root} --note <text>`);
  });

  // Covers: R8
  test("fails with PATH_NOT_FOUND for a missing path, with or without --dry-run", async () => {
    for (const args of [
      ["intake", "/no/such/dir"],
      ["intake", "--dry-run", "/no/such/dir"],
    ]) {
      const run = await runCliCaptured(args);
      expect(run.code).toBe(ExitCode.Usage);
    }
  });
});
