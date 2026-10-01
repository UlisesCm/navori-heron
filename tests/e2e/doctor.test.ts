import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCheck, withTimeout } from "../../src/app/doctor.ts";
import {
  DOCTOR_CHECK_IDS,
  ExitCode,
  type CliEnvelope,
  type DoctorCheck,
  type DoctorData,
} from "../../src/core/contracts/index.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";

const { fresh, initialized } = e2eSetup();

function lockOwner(pid: number): string {
  return JSON.stringify({
    runId: "run-20260930T110000Z-deadbeef",
    pid,
    hostname: "test-host",
    command: "init",
    acquiredAt: "2026-09-30T11:00:00.000Z",
  });
}

async function checks(root: string): Promise<DoctorCheck[]> {
  const run = await runCliCaptured(["doctor", root, "--json"]);
  return (JSON.parse(run.stdout) as CliEnvelope & { data: DoctorData }).data.checks;
}

describe("heron doctor", () => {
  // Covers: R11, R18
  test("reports every base check as PASS on an initialized workspace without writing", async () => {
    const root = await initialized("membership-product");
    const before = hashTree(root, { exclude: [] });
    const run = await runCliCaptured(["doctor", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    const lines = run.stdout.trimEnd().split("\n");
    // TODO(P3 doctor task): the agent checks (agents.*, probe.*) join this list when `doctor` emits them.
    const BASE_CHECKS = DOCTOR_CHECK_IDS.slice(0, 6);
    expect(lines.slice(0, BASE_CHECKS.length).map((line) => line.slice(0, 26))).toEqual(
      BASE_CHECKS.map((id) => `${"PASS".padEnd(7)} ${id.padEnd(18)}`),
    );
    expect(lines.at(-1)).toBe(`Summary: ${BASE_CHECKS.length} PASS, 0 WARNING, 0 FAIL`);
    expect(lines[BASE_CHECKS.indexOf("harness.detection")]).toContain(
      "adapter navori-master, stage 01-mvp",
    );
    expect(hashTree(root, { exclude: [] })).toEqual(before);
  });

  // Covers: R11
  test("warns with a remedy when the workspace is not initialized and still exits 0", async () => {
    const root = fresh("membership-product");
    const run = await runCliCaptured(["doctor", root]);
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stdout).toContain(
      `${"WARNING".padEnd(7)} ${"heron.documents".padEnd(18)} Not initialized\n        Remedy: Run: heron init ${root}\n`,
    );
    expect(run.stdout).toContain(`${"PASS".padEnd(7)} ${"heron.lock".padEnd(18)} No lock held`);
    expect(run.stdout).toContain("WARNING heron.gitignore");
  });

  // Covers: R11
  test("exits 5 when a dependency check fails and 4 when a workspace check fails", async () => {
    const root = await initialized("no-ux");
    const old = await runCliCaptured(
      ["doctor", root],
      fixedContext({ process: { pid: 1, hostname: "test-host", bunVersion: "1.3.9" } }),
    );
    expect(old.code).toBe(ExitCode.DependencyUnavailable);
    expect(old.stdout).toContain("FAIL    runtime.bun");
    expect(old.stdout).toContain("        Remedy: Install Bun 1.4.2 or newer.");

    const missing = await runCliCaptured(["doctor", join(root, "nope"), "--json"]);
    expect(missing.code).toBe(ExitCode.ValidationFailed);
    const envelope = JSON.parse(missing.stdout) as CliEnvelope & { data: DoctorData };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe(ExitCode.ValidationFailed);
    expect(envelope.data.checks.map((check) => check.status)).toEqual([
      "PASS",
      "FAIL",
      "WARNING",
      "WARNING",
      "WARNING",
      "WARNING",
    ]);

    writeFileSync(join(root, ".heron", "state.json"), "{ not json");
    const corrupt = await runCliCaptured(["doctor", root]);
    expect(corrupt.code).toBe(ExitCode.ValidationFailed);
    expect(corrupt.stdout).toContain("FAIL    heron.documents");
    expect(corrupt.stdout).toContain("        Remedy: Restore .heron/ from Git.");
  });

  // Covers: R11
  test("reports a live or a stale lock as a warning with a remedy", async () => {
    const root = await initialized("no-ux");
    const lockPath = join(root, ".heron", ".lock");
    writeFileSync(lockPath, lockOwner(process.pid));
    const live = (await checks(root)).find((check) => check.id === "heron.lock");
    expect(live?.status).toBe("WARNING");
    expect(live?.message).toContain("Locked by another Heron command");
    expect(live?.remedy).not.toBeNull();

    const dead = await runCliCaptured(
      ["doctor", root, "--json"],
      fixedContext({ lock: { staleAfterMs: 1, corruptGraceMs: 1, isProcessAlive: () => false } }),
    );
    const stale = (JSON.parse(dead.stdout) as CliEnvelope & { data: DoctorData }).data.checks.find(
      (check) => check.id === "heron.lock",
    );
    expect(stale?.message).toContain("Stale lock");
    expect(dead.code).toBe(ExitCode.Ok);
  });

  // Covers: R11
  test("warns about a modified .gitignore and about detection findings", async () => {
    const root = await initialized("ux-only-md");
    writeFileSync(join(root, ".heron", ".gitignore"), "# edited\n");
    const all = await checks(root);
    expect(all.find((check) => check.id === "heron.gitignore")?.status).toBe("WARNING");
    const detection = all.find((check) => check.id === "harness.detection");
    expect(detection?.status).toBe("WARNING");
    expect(detection?.message).toContain("UX_INCONSISTENT");
  });

  // Covers: R11
  test("turns a timeout or a throw of a check into a FAIL", async () => {
    const never = await runCheck(
      { id: "heron.lock", kind: "workspace", run: () => new Promise(() => {}) },
      20,
    );
    expect(never.status).toBe("FAIL");
    expect(never.message).toBe("timed out after 20 ms");
    const thrown = await runCheck(
      {
        id: "heron.lock",
        kind: "workspace",
        run: () => {
          throw new Error("boom");
        },
      },
      1000,
    );
    expect(thrown.message).toBe("check failed: boom");
    expect(await withTimeout(() => 7, 1000)).toEqual({ timedOut: false, value: 7 });
  });

  // Covers: R11
  test("rejects an unsafe .heron symlink", async () => {
    const root = fresh("no-ux");
    const elsewhere = fresh("no-ux");
    mkdirSync(join(elsewhere, "x"));
    symlinkSync(join(elsewhere, "x"), join(root, ".heron"));
    const run = await runCliCaptured(["doctor", root]);
    expect(run.code).toBe(ExitCode.ValidationFailed);
    expect(run.stdout).toContain("FAIL    heron.documents");
  });
});
