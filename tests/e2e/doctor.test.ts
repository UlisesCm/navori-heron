import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { join } from "node:path";
import { createFakeProvider } from "../../src/agents/adapters/fake/index.ts";
import type { AgentProvider, ProviderProbe } from "../../src/agents/ports.ts";
import { runCheck, withTimeout } from "../../src/app/doctor.ts";
import {
  DOCTOR_CHECK_IDS,
  ExitCode,
  type AgentProviderId,
  type CliEnvelope,
  type DoctorCheck,
  type DoctorData,
} from "../../src/core/contracts/index.ts";
import { fixedContext, runCliCaptured } from "../helpers/cli.ts";
import { withAgentSettings } from "../helpers/agents.ts";
import { e2eSetup } from "../helpers/e2e.ts";
import { hashTree } from "../helpers/fixtures.ts";

const { fresh, initialized } = e2eSetup();

const READY: ProviderProbe = { status: "ready", cliVersion: "9.9.9", minimum: "1.0.0" };

/** A provider whose probe is fixed and whose invoke answers like the fake one (never spawns). */
let invokes = 0;

function stub(id: AgentProviderId, label: string, probe: ProviderProbe): AgentProvider {
  const inner = createFakeProvider([{ output: { status: "ok", facets: ["visual-style"] } }], id);
  return {
    ...inner,
    invoke: (request, services) => {
      invokes += 1;
      return inner.invoke(request, services);
    },
    label,
    minimumVersion: "1.0.0",
    probe: () => Promise.resolve(probe),
  };
}

beforeEach(() => {
  invokes = 0;
});

const hung = (id: AgentProviderId): AgentProvider => ({
  ...stub(id, id, READY),
  probe: () => new Promise(() => {}),
});

const stubbedContext = (
  claude: ProviderProbe = READY,
  codex: ProviderProbe = READY,
  overrides: Parameters<typeof fixedContext>[0] = {},
) => {
  const base = fixedContext();
  return fixedContext({
    agents: {
      ...base.agents,
      providers: {
        "claude-code": stub("claude-code", "Claude Code", claude),
        "codex-cli": stub("codex-cli", "Codex CLI", codex),
      },
    },
    ...overrides,
  });
};

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
    const run = await runCliCaptured(["doctor", root], stubbedContext());
    expect(run.code).toBe(ExitCode.Ok);
    expect(run.stderr).toBe("");
    const lines = run.stdout.trimEnd().split("\n");
    // Base checks plus the two role providers (agents.usage needs a local log; agents.config an invalid block).
    const BASE_CHECKS = [...DOCTOR_CHECK_IDS.slice(0, 6), "agents.claude-code", "agents.codex-cli"];
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
    expect(envelope.data.checks.slice(0, 6).map((check) => check.status)).toEqual([
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

  // Covers: R14
  test("reports agent availability from exit codes without reading credentials", async () => {
    const root = await initialized("no-ux");
    withAgentSettings(root, { roles: { creator: "claude-code", reviewer: "codex-cli" } });
    const reads: string[] = [];
    const watching = {
      ...nodeFs,
      readFileSync: ((path: string, ...rest: unknown[]) => {
        reads.push(String(path));
        return (nodeFs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
      }) as typeof nodeFs.readFileSync,
    };
    const run = await runCliCaptured(
      ["doctor", root, "--json"],
      stubbedContext(
        { status: "outdated", cliVersion: "2.1.200", minimum: "2.1.259", detail: "old" },
        { status: "missing", cliVersion: null, minimum: "0.159.2", detail: "codex is not on PATH" },
        { fs: watching, env: { ANTHROPIC_API_KEY: "sk-ant-canary-123" } },
      ),
    );
    expect(run.code).toBe(ExitCode.Ok);
    const byId = new Map(
      (JSON.parse(run.stdout) as CliEnvelope & { data: DoctorData }).data.checks.map((check) => [
        check.id,
        check,
      ]),
    );
    const claude = byId.get("agents.claude-code");
    expect([claude?.status, claude?.message]).toEqual([
      "WARNING",
      "Claude Code 2.1.200 is older than 2.1.259",
    ]);
    const codex = byId.get("agents.codex-cli");
    expect(codex?.status).toBe("WARNING");
    expect(codex?.message).toBe("Codex CLI was not found on PATH");
    expect(codex?.remedy).toBe("Install Codex CLI 0.159.2 or newer and run: codex login");
    expect(run.stdout).not.toContain("sk-ant-canary-123");
    expect(reads.some((path) => /\.claude|\.codex/.test(path))).toBe(false);

    const out = await runCliCaptured(
      ["doctor", root],
      stubbedContext(READY, { ...READY, status: "ready" }),
    );
    expect(out.stdout).toContain(
      `PASS    agents.claude-code Claude Code 9.9.9 (minimum 1.0.0), logged in; roles: creator`,
    );
    const loggedOut = await runCliCaptured(
      ["doctor", root],
      stubbedContext(READY, {
        status: "logged-out",
        cliVersion: "0.159.3",
        minimum: "0.159.2",
        detail: "x",
      }),
    );
    expect(loggedOut.stdout).toContain("        Remedy: Run: codex login");
    expect(loggedOut.code).toBe(ExitCode.Ok);
  });

  // Covers: R14
  test("warns for the fake provider and for an invalid agents block", async () => {
    const root = await initialized("no-ux");
    withAgentSettings(root, { roles: { creator: "fake", reviewer: "fake" } });
    const fake = await runCliCaptured(["doctor", root]);
    expect(fake.code).toBe(ExitCode.Ok);
    expect(fake.stdout).toContain(
      "WARNING agents.fake        fake provider: outputs are deterministic and SYNTHETIC",
    );
    withAgentSettings(root, { timeoutMs: 5 });
    const invalid = (await checks(root)).find((check) => check.id === "agents.config");
    expect(invalid?.status).toBe("WARNING");
    expect(invalid?.message).toContain('.heron/project.json "agents" is invalid (1 issue(s))');
  });

  // Covers: R14
  test("runs a schema-bound deep probe through each role provider", async () => {
    const root = await initialized("no-ux");
    const ok = await runCliCaptured(["doctor", root, "--deep", "--json"], stubbedContext());
    expect(ok.code).toBe(ExitCode.Ok);
    const probes = (JSON.parse(ok.stdout) as CliEnvelope & { data: DoctorData }).data.checks.filter(
      (check) => check.id.startsWith("probe."),
    );
    expect(probes.map((check) => [check.id, check.status])).toEqual([
      ["probe.claude-code", "PASS"],
      ["probe.codex-cli", "PASS"],
    ]);
    expect(invokes).toBe(2);
    expect(probes[0]?.message).toMatch(/^structured output OK in \d+\.\d s \(model default\)$/);

    const bad = await runCliCaptured(
      ["doctor", root, "--deep"],
      stubbedContext(READY, {
        status: "unsupported",
        cliVersion: "0.159.3",
        minimum: "0.159.2",
        detail: "missing --ignore-user-config",
      }),
    );
    expect(bad.code).toBe(ExitCode.DependencyUnavailable);
    expect(bad.stdout).toContain(
      "FAIL    probe.codex-cli    unsupported: missing --ignore-user-config",
    );
    // Without --deep nothing is invoked and the same provider is only a WARNING.
    invokes = 0;
    const basic = await runCliCaptured(["doctor", root], stubbedContext());
    expect(basic.stdout).not.toContain("probe.");
    expect((await runCliCaptured(["status", root], stubbedContext())).code).toBe(ExitCode.Ok);
    expect(invokes).toBe(0);
  });

  // Covers: R14
  test("bounds a hung deep probe with its own timeout and runs providers in parallel", async () => {
    const root = await initialized("no-ux");
    const base = fixedContext();
    const started = performance.now();
    const run = await runCliCaptured(
      ["doctor", root, "--deep"],
      fixedContext({
        agents: {
          ...base.agents,
          probeTimeoutMs: 100,
          deepTimeoutMs: 400,
          killGraceMs: 10,
          providers: { "claude-code": hung("claude-code"), "codex-cli": hung("codex-cli") },
        },
      }),
    );
    expect(run.code).toBe(ExitCode.DependencyUnavailable);
    expect(run.stdout).toContain("FAIL    probe.claude-code  timed out after 400 ms");
    expect(run.stdout).toContain("WARNING agents.codex-cli");
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  // Covers: R21
  test("reports agent token usage against the soft budget", async () => {
    const root = await initialized("no-ux");
    expect((await checks(root)).some((check) => check.id === "agents.usage")).toBe(false);
    mkdirSync(join(root, ".heron", "logs"), { recursive: true });
    writeFileSync(
      join(root, ".heron", "logs", "2026-09-30.jsonl"),
      `${JSON.stringify({ at: "2026-09-30T10:00:00.000Z", event: "agent.invocation", inputTokens: 900, outputTokens: 300, cachedInputTokens: 0, costUsd: null })}\n`,
    );
    const plain = (await checks(root)).find((check) => check.id === "agents.usage");
    expect([plain?.status, plain?.message]).toEqual(["PASS", "today 1200 tokens in 1 call(s)"]);
    withAgentSettings(root, { warnTokensPerDay: 1000 });
    const over = await runCliCaptured(["doctor", root]);
    expect(over.code).toBe(ExitCode.Ok);
    expect(over.stdout).toContain("WARNING agents.usage");
    expect(over.stdout).toContain("today 1200 tokens exceed the soft budget 1000");
    withAgentSettings(root, { warnTokensPerDay: 5000 });
    const under = (await checks(root)).find((check) => check.id === "agents.usage");
    expect(under?.message).toBe("today 1200 tokens in 1 call(s) (soft budget 5000)");
  });

  // Covers: R14
  test("redacts and caps provider detail in the basic availability check", async () => {
    const root = await initialized("no-ux");
    const detail = `bad flag sk-ant-canary-123 ${"x".repeat(500)}`;
    const run = await runCliCaptured(
      ["doctor", root, "--json"],
      stubbedContext(
        { status: "error", cliVersion: "2.1.300", minimum: "2.1.259", detail },
        READY,
        { env: { ANTHROPIC_API_KEY: "sk-ant-canary-123" } },
      ),
    );
    expect(run.stdout).not.toContain("sk-ant-canary-123");
    const check = (JSON.parse(run.stdout) as CliEnvelope & { data: DoctorData }).data.checks.find(
      (c) => c.id === "agents.claude-code",
    );
    expect(check?.message).toContain("[REDACTED]");
    expect(check?.message.length).toBeLessThan(330);
  });
});
