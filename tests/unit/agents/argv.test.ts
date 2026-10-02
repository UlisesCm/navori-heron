import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  CLAUDE_FIXED_ARGS,
  CLAUDE_REQUIRED_FLAGS,
  claudeArgv,
  claudeCodeProvider,
} from "../../../src/agents/adapters/claude-code/index.ts";
import {
  CODEX_DISABLED_FEATURES,
  CODEX_FIXED_ARGS,
  codexArgv,
  codexCliProvider,
  codexPrompt,
} from "../../../src/agents/adapters/codex-cli/index.ts";
import { bunProcessRunner } from "../../../src/agents/process/bun-runner.ts";
import type {
  AgentRequest,
  ProcessRunner,
  ProcessSpec,
  ProviderServices,
} from "../../../src/agents/ports.ts";
import { AGENT_TASKS } from "../../../src/agents/tasks.ts";
import { nodeTempDirs } from "../../../src/core/store/temp-dir.ts";
import { fakeBinEnv, refusingRunner, writeFakeAgentBin } from "../../helpers/agents.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "heron-argv-")));
let counter = 0;
const newBin = (): string => join(root, `bin${(counter += 1)}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const Out = z.strictObject({ key: z.string(), tokens: z.string() });
const request = (overrides: Partial<AgentRequest> = {}): AgentRequest => ({
  task: "probe",
  attempt: 1,
  templateId: "shared/probe@v1",
  system: "SYSTEM",
  pack: { text: "PACK" } as AgentRequest["pack"],
  outputSchema: Out,
  model: null,
  timeoutMs: 10_000,
  ...overrides,
});
const services = (
  binDir: string,
  extra: Record<string, string> = {},
  runner: ProcessRunner = bunProcessRunner,
): ProviderServices => ({
  runner,
  temp: nodeTempDirs,
  env: fakeBinEnv(binDir, extra),
  probeTimeoutMs: 4_000,
  killGraceMs: 500,
});
const envelope = (fields: Record<string, unknown>): string =>
  `printf '%s' '${JSON.stringify({ type: "result", subtype: "success", is_error: false, ...fields })}'`;

const probe = (dir: string, level: "basic" | "full") =>
  claudeCodeProvider.probe(services(dir), level);

describe("claude-code argv", () => {
  test("invokes agent CLIs isolated, tool-less and schema-bound", () => {
    // Covers: R1
    const argv = claudeArgv({ schemaJson: '{"type":"object"}', system: "S", model: null });
    expect(argv.slice(0, CLAUDE_FIXED_ARGS.length)).toEqual([...CLAUDE_FIXED_ARGS]);
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    expect(argv[argv.indexOf("--json-schema") + 1]).toBe('{"type":"object"}');
    expect(argv[argv.indexOf("--system-prompt") + 1]).toBe("S");
    expect(argv).toContain("--no-session-persistence");
    expect(argv).not.toContain("--bare");
    expect(argv).not.toContain("--model");
    expect(claudeArgv({ schemaJson: "{}", system: "S", model: "opus" }).slice(-2)).toEqual([
      "--model",
      "opus",
    ]);
    for (const flag of CLAUDE_FIXED_ARGS.filter((a) => a.startsWith("--"))) {
      expect(CLAUDE_REQUIRED_FLAGS).toContain(flag);
    }
    expect(CLAUDE_REQUIRED_FLAGS).toContain("--json-schema");
  });

  test("forwards the allowlisted environment and the output cap, never API keys", async () => {
    // Covers: R1, R20
    const specs: ProcessSpec[] = [];
    const recorder: ProcessRunner = {
      run: (spec) => {
        specs.push(spec);
        return Promise.resolve({ kind: "not-found", command: spec.command });
      },
    };
    const env = {
      ...fakeBinEnv("/x"),
      ANTHROPIC_API_KEY: "sk-secret",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth",
      HERON_SECRET: "h",
    };
    await claudeCodeProvider.invoke(request(), { ...services("/x", {}, recorder), env });
    const [spec] = specs;
    expect(spec?.command).toBe("claude");
    expect(spec?.stdin).toBe("PACK");
    expect(spec?.env["CLAUDE_CODE_MAX_OUTPUT_TOKENS"]).toBe(
      String(AGENT_TASKS.probe.maxOutputTokens),
    );
    expect(spec?.env["CLAUDE_CODE_OAUTH_TOKEN"]).toBe("oauth");
    expect(Object.keys(spec?.env ?? {})).not.toContain("ANTHROPIC_API_KEY");
    expect(Object.keys(spec?.env ?? {})).not.toContain("CLAUDE_CODE_USE_BEDROCK");
    expect(Object.keys(spec?.env ?? {})).not.toContain("HERON_SECRET");
    expect(spec?.args).toContain("--json-schema");
  });

  test("normalizes claude usage: inputTokens totals fresh, cache write and cache read", async () => {
    // Covers: R21, R1, R4
    const real = newBin();
    writeFakeAgentBin(
      real,
      "claude",
      `cat >/dev/null\n${envelope({
        structured_output: { key: "k", tokens: "t" },
        total_cost_usd: 0.0058,
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 40,
          cache_read_input_tokens: 706,
          output_tokens: 82,
          cache_creation: { ephemeral_5m_input_tokens: 40 },
          iterations: [],
          service_tier: "standard",
          speed: "standard",
        },
      })}`,
    );
    expect(await claudeCodeProvider.invoke(request(), services(real))).toMatchObject({
      status: "succeeded",
      usage: { inputTokens: 748, outputTokens: 82, cachedInputTokens: 706, costUsd: 0.0058 },
    });

    const none = newBin();
    writeFakeAgentBin(
      none,
      "claude",
      `cat >/dev/null\n${envelope({ structured_output: { key: "k", tokens: "t" }, usage: { output_tokens: 1 } })}`,
    );
    expect(await claudeCodeProvider.invoke(request(), services(none))).toMatchObject({
      status: "succeeded",
      usage: { inputTokens: null, outputTokens: 1, cachedInputTokens: null },
    });
  }, 30_000);

  test("maps CLI failures, error results and missing binaries to agent statuses", async () => {
    // Covers: R1, R4
    // real processes against fake binaries: shell start-up on a loaded CI box can be slow, hence the explicit timeout
    const missing = newBin();
    writeFakeAgentBin(missing, "other", "exit 0");
    expect((await claudeCodeProvider.invoke(request(), services(missing))).status).toBe(
      "unavailable",
    );

    const crash = newBin();
    writeFakeAgentBin(crash, "claude", "echo boom >&2; exit 2");
    const crashed = await claudeCodeProvider.invoke(request(), services(crash));
    expect(crashed).toMatchObject({ status: "failed", exitCode: 2 });
    expect(crashed.status === "failed" ? crashed.detail : "").toContain("boom");

    const errored = newBin();
    writeFakeAgentBin(
      errored,
      "claude",
      envelope({ subtype: "error_max_turns", is_error: true, result: "x" }),
    );
    const failed = await claudeCodeProvider.invoke(request(), services(errored));
    expect(failed.status).toBe("failed");
    expect(failed.status === "failed" ? failed.detail : "").toContain("error_max_turns");

    const ok = newBin();
    writeFakeAgentBin(
      ok,
      "claude",
      `cat >/dev/null\n${envelope({
        structured_output: { key: "unset", tokens: "unset" },
        total_cost_usd: 0.25,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
        modelUsage: { "claude-b": {}, "claude-a": {} },
      })}`,
    );
    const done = await claudeCodeProvider.invoke(request(), services(ok));
    expect(done).toMatchObject({
      status: "succeeded",
      output: { key: "unset", tokens: "unset" },
      reportedModels: ["claude-a", "claude-b"],
      usage: { inputTokens: 13, outputTokens: 5, cachedInputTokens: 3, costUsd: 0.25 },
    });

    const planB = newBin();
    writeFakeAgentBin(
      planB,
      "claude",
      envelope({ result: '```json\n{"key":"k","tokens":"t"}\n```' }),
    );
    expect(await claudeCodeProvider.invoke(request(), services(planB))).toMatchObject({
      status: "succeeded",
      output: { key: "k", tokens: "t" },
    });

    for (const body of [
      envelope({ result: "not json at all" }),
      envelope({ structured_output: { key: 1 } }),
      envelope({}),
      "echo '<html>'",
    ]) {
      const bad = newBin();
      writeFakeAgentBin(bad, "claude", body);
      expect((await claudeCodeProvider.invoke(request(), services(bad))).status).toBe(
        "invalid-output",
      );
    }

    const hung = newBin();
    writeFakeAgentBin(hung, "claude", "sleep 30");
    expect(
      (await claudeCodeProvider.invoke(request({ timeoutMs: 1_000 }), services(hung))).status,
    ).toBe("timeout");

    const leaky = newBin();
    writeFakeAgentBin(
      leaky,
      "claude",
      `cat >/dev/null\nprintf '{"result":"{\\\\"key\\\\":\\\\"%s\\\\",\\\\"tokens\\\\":\\\\"%s\\\\"}"}' "\${ANTHROPIC_API_KEY:-unset}" "$CLAUDE_CODE_MAX_OUTPUT_TOKENS"`,
    );
    process.env["ANTHROPIC_API_KEY"] = "sk-parent";
    try {
      const run = await claudeCodeProvider.invoke(
        request(),
        services(leaky, { ANTHROPIC_API_KEY: "sk-services" }),
      );
      expect(run).toMatchObject({ status: "succeeded", output: { key: "unset", tokens: "500" } });
    } finally {
      delete process.env["ANTHROPIC_API_KEY"];
    }
  }, 30_000);

  test("probes version, session and capabilities without launching an agent", async () => {
    // Covers: R1
    const flags = CLAUDE_REQUIRED_FLAGS.join(" ");
    const bin = (version: string, authExit: number, help: string): string => {
      const dir = newBin();
      writeFakeAgentBin(
        dir,
        "claude",
        `case "$1" in --version) echo "${version} (Claude Code)";; auth) exit ${authExit};; --help) echo "${help}";; esac`,
      );
      return dir;
    };
    expect(await probe(newBin(), "basic")).toMatchObject({ status: "missing" });
    expect(await probe(bin("2.1.258", 0, flags), "basic")).toMatchObject({
      status: "outdated",
      cliVersion: "2.1.258",
    });
    expect(await probe(bin("2.1.287", 1, flags), "basic")).toMatchObject({ status: "logged-out" });
    expect(await probe(bin("2.1.287", 0, "none"), "basic")).toMatchObject({ status: "ready" });
    expect(await probe(bin("2.1.287", 0, "--print --tools"), "full")).toMatchObject({
      status: "unsupported",
      detail: "missing --output-format",
    });
    expect(await probe(bin("2.1.287", 0, flags), "full")).toMatchObject({
      status: "ready",
      cliVersion: "2.1.287",
      minimum: "2.1.259",
    });
    expect(claudeCodeProvider.minimumVersion).toBe("2.1.259");
  }, 30_000);

  test("never reaches a real CLI through the refusing runner", async () => {
    // Covers: R1
    const attempt = await claudeCodeProvider.invoke(request(), services("/x", {}, refusingRunner));
    expect(attempt.status).toBe("failed");
    expect(
      await claudeCodeProvider.probe(services("/x", {}, refusingRunner), "basic"),
    ).toMatchObject({ status: "error" });
  });
});

const run = (dir: string, level: "basic" | "full") => codexCliProvider.probe(services(dir), level);

const recorder = (specs: ProcessSpec[]): ProcessRunner => ({
  run: (spec) => {
    specs.push(spec);
    return Promise.resolve({ kind: "not-found", command: spec.command });
  },
});

describe("codex-cli argv", () => {
  test("invokes agent CLIs isolated, tool-less and schema-bound", () => {
    // Covers: R1
    const argv = codexArgv({
      schemaFile: "/io/schema.json",
      lastMessageFile: "/io/out.json",
      model: null,
    });
    expect(argv.slice(0, CODEX_FIXED_ARGS.length)).toEqual([...CODEX_FIXED_ARGS]);
    expect(argv.slice(-5)).toEqual([
      "--output-schema",
      "/io/schema.json",
      "-o",
      "/io/out.json",
      "-",
    ]);
    expect(argv).toContain("--ignore-user-config");
    expect(argv).toContain("--ignore-rules");
    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(argv[argv.indexOf("-c") + 1]).toBe('web_search="disabled"');
    for (const feature of CODEX_DISABLED_FEATURES) {
      const at = argv.indexOf(feature);
      expect(argv[at - 1]).toBe("--disable");
    }
    expect(argv).not.toContain("--model");
    expect(codexArgv({ schemaFile: "s", lastMessageFile: "o", model: "gpt-5" }).slice(-3)).toEqual([
      "-m",
      "gpt-5",
      "-",
    ]);
    expect(codexPrompt("SYS", { text: "PACK" } as AgentRequest["pack"])).toBe(
      "<heron-instructions>\nSYS\n</heron-instructions>\n\nPACK",
    );
  });

  test("sends the template by stdin and only allowlisted environment, never API keys", async () => {
    // Covers: R1, R20
    const specs: ProcessSpec[] = [];
    const env = {
      ...fakeBinEnv("/x"),
      OPENAI_API_KEY: "sk-secret",
      CODEX_API_KEY: "sk-codex",
      CODEX_HOME: "/home/codex",
      HERON_SECRET: "h",
    };
    await codexCliProvider.invoke(request(), { ...services("/x", {}, recorder(specs)), env });
    const [spec] = specs;
    expect(spec?.command).toBe("codex");
    expect(spec?.stdin?.startsWith("<heron-instructions>\nSYSTEM\n")).toBe(true);
    expect(spec?.stdin?.endsWith("PACK")).toBe(true);
    expect(spec?.captureStdout).toBe(false);
    expect(spec?.env["CODEX_HOME"]).toBe("/home/codex");
    for (const name of ["OPENAI_API_KEY", "CODEX_API_KEY", "HERON_SECRET"]) {
      expect(Object.keys(spec?.env ?? {})).not.toContain(name);
    }
    expect(spec?.args).toContain("--output-schema");
    expect(spec?.args.join(" ")).not.toContain("PACK");
  });

  test("rejects a model name that could be read as a flag before building argv", async () => {
    // Covers: R1
    for (const model of ["--evil", "-m", " x", "a b", "x".repeat(101), ""]) {
      expect(() => claudeArgv({ schemaJson: "{}", system: "S", model })).toThrow();
      expect(() => codexArgv({ schemaFile: "s", lastMessageFile: "o", model })).toThrow();
    }
    const specs: ProcessSpec[] = [];
    for (const provider of [claudeCodeProvider, codexCliProvider]) {
      const attempt = await provider.invoke(
        request({ model: "--dangerously-bypass" }),
        services("/x", {}, recorder(specs)),
      );
      expect(attempt.status).toBe("failed");
    }
    expect(specs).toEqual([]);
  });

  test("probes version, session and capabilities of codex without launching an agent", async () => {
    // Covers: R1
    const flags = [...new Set(CODEX_FIXED_ARGS.filter((a) => a.startsWith("--")))].join(" ");
    const bin = (version: string, loginExit: number, help: string): string => {
      const dir = newBin();
      writeFakeAgentBin(
        dir,
        "codex",
        `case "$1" in --version) echo "codex-cli ${version}";; login) exit ${loginExit};; exec) echo "${help}";; esac`,
      );
      return dir;
    };
    expect(await run(newBin(), "basic")).toMatchObject({ status: "missing" });
    expect(await run(bin("0.159.1", 0, flags), "basic")).toMatchObject({ status: "outdated" });
    expect(await run(bin("0.160.0", 1, flags), "basic")).toMatchObject({ status: "logged-out" });
    expect(await run(bin("0.160.0", 0, "--json"), "full")).toMatchObject({ status: "unsupported" });
    expect(await run(bin("0.160.0", 0, `${flags} --output-schema`), "full")).toMatchObject({
      status: "ready",
      cliVersion: "0.160.0",
      minimum: "0.159.2",
    });
  }, 30_000);
});
