// Covers: R1
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runInit } from "../../../src/app/init.ts";
import {
  withWriteRun,
  type WriteBodyResult,
  type WriteRunOptions,
} from "../../../src/app/write-run.ts";
import { ExitCode } from "../../../src/core/contracts/index.ts";
import { copyFixture } from "../../helpers/fixtures.ts";
import { fixedContext } from "../../helpers/cli.ts";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function initializedRoot(): Promise<string> {
  const root = copyFixture("no-ux");
  roots.push(root);
  const init = await runInit(fixedContext(), { path: root, stage: null, dryRun: false });
  expect(init.ok).toBe(true);
  return root;
}

const options = (root: string, expectedRevision: number | null): WriteRunOptions => ({
  path: root,
  command: "references add",
  create: false,
  requireState: true,
  expectedRevision,
});

const SKIPPED: WriteBodyResult<string> = {
  kind: "skip",
  result: { ok: true, data: "noop", findings: [], next: [] },
};

describe("withWriteRun", () => {
  test("releases the lock and discards staging when the body fails or skips", async () => {
    const root = await initializedRoot();
    const heron = join(root, ".heron");
    const ctx = fixedContext();

    const failed = withWriteRun<string>(ctx, root, options(root, null), ({ tx }) => {
      tx.put("research/probe.txt", "staged");
      throw new Error("boom");
    });
    await expect(failed).rejects.toThrow("boom");
    expect(existsSync(join(heron, ".lock"))).toBe(false);
    expect(existsSync(join(heron, "staging", "run-20260930T120000Z-00000001"))).toBe(false);

    const skipped = await withWriteRun<string>(ctx, root, options(root, null), ({ tx }) => {
      tx.put("research/probe.txt", "staged");
      return SKIPPED;
    });
    expect(skipped).toEqual({ ok: true, data: "noop", findings: [], next: [] });
    expect(existsSync(join(heron, ".lock"))).toBe(false);
    expect(existsSync(join(heron, "research", "probe.txt"))).toBe(false);
    expect(existsSync(join(heron, "staging", "run-20260930T120000Z-00000002"))).toBe(false);
  });

  test("rejects a stale snapshot revision with exit 6", async () => {
    const root = await initializedRoot();
    let bodyRan = false;
    const stale = await withWriteRun<string>(fixedContext(), root, options(root, 7), () => {
      bodyRan = true;
      return SKIPPED;
    });
    expect(bodyRan).toBe(false);
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected a failure");
    expect(stale.code).toBe(ExitCode.LockBusy);
    expect(stale.message).toBe(
      ".heron/state.json changed during the command (expected revision 7, found 1).",
    );
    expect(existsSync(join(root, ".heron", ".lock"))).toBe(false);

    const bare = copyFixture("no-ux");
    roots.push(bare);
    const absent = await withWriteRun<string>(
      fixedContext(),
      bare,
      options(bare, null),
      () => SKIPPED,
    );
    expect(absent.ok).toBe(false);
    if (absent.ok) throw new Error("expected a failure");
    expect(absent.code).toBe(ExitCode.Blocked);
    expect(absent.findings[0]?.code).toBe("NOT_INITIALIZED");
  });

  test("recovers orphan staging and reports it with the findings of the result", async () => {
    const root = await initializedRoot();
    mkdirSync(join(root, ".heron", "staging", "run-20260101T000000Z-deadbeef"), {
      recursive: true,
    });
    writeFileSync(join(root, ".heron", "staging", "run-20260101T000000Z-deadbeef", "x"), "x");
    const result = await withWriteRun<string>(
      fixedContext(),
      root,
      options(root, 1),
      () => SKIPPED,
    );
    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toEqual(["STAGING_RECOVERED"]);
    expect(existsSync(join(root, ".heron", "staging", "run-20260101T000000Z-deadbeef"))).toBe(
      false,
    );
  });
});
