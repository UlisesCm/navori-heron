import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  CODEX_ALLOWED_EVENT_TYPES,
  CODEX_ALLOWED_ITEM_TYPES,
  codexCliProvider,
  codexLineVerdict,
} from "../../../src/agents/adapters/codex-cli/index.ts";
import { bunProcessRunner } from "../../../src/agents/process/bun-runner.ts";
import type { AgentRequest, ProviderServices } from "../../../src/agents/ports.ts";
import { nodeTempDirs } from "../../../src/core/store/temp-dir.ts";
import { fakeBinEnv, writeFakeAgentBin } from "../../helpers/agents.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "heron-codex-")));
let counter = 0;
const newDir = (): string => join(root, `bin${(counter += 1)}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const Out = z.strictObject({ key: z.string(), tokens: z.string() });
const request: AgentRequest = {
  task: "probe",
  attempt: 1,
  templateId: "shared/probe@v1",
  system: "SYSTEM",
  pack: { text: "PACK" } as AgentRequest["pack"],
  outputSchema: Out,
  model: null,
  timeoutMs: 10_000,
};
const services = (binDir: string): ProviderServices => ({
  runner: bunProcessRunner,
  temp: nodeTempDirs,
  env: fakeBinEnv(binDir),
  probeTimeoutMs: 4_000,
  killGraceMs: 500,
});
const ev = (value: unknown): string => JSON.stringify(value);
/** A fake `codex` that finds the `-o` path, drains stdin and then runs `body` (with `$out` set). */
const fakeCodex = (body: string): string => {
  const dir = newDir();
  writeFakeAgentBin(
    dir,
    "codex",
    `out=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift;; esac; shift; done\ncat >/dev/null\n${body}`,
  );
  return dir;
};
const say = (...events: unknown[]): string => events.map((e) => `echo '${ev(e)}'`).join("\n");
const SECRET = "SECRET-FROM-HOST-FILE";

describe("codex event monitor", () => {
  test("stops codex on the first tool-use event as a policy violation", async () => {
    // Covers: R8
    // real process against a fake binary: shell start-up can be slow on a loaded CI box, hence the explicit timeout
    const marker = join(root, "ran-after-tool-use");
    const dir = fakeCodex(
      `${say({ type: "thread.started", thread_id: "t" }, { type: "turn.started" })}
echo '${ev({ type: "item.started", item: { id: "1", type: "command_execution", command: "cat /etc/passwd", aggregated_output: SECRET } })}'
sleep 1
touch ${marker}
${say({ type: "turn.completed", usage: {} })}`,
    );
    const attempt = await codexCliProvider.invoke(request, services(dir));
    expect(attempt.status).toBe("policy-violation");
    expect(attempt.status === "policy-violation" ? attempt.detail : "").toContain(
      "item.command_execution",
    );
    expect(JSON.stringify(attempt)).not.toContain(SECRET);
    expect(JSON.stringify(attempt)).not.toContain("passwd");
    await Bun.sleep(1_500);
    expect(existsSync(marker)).toBe(false);

    for (const item of ["web_search", "mcp_tool_call", "file_change"]) {
      expect(codexLineVerdict(ev({ type: "item.completed", item: { type: item } }))).toEqual({
        stop: `item.${item}`,
      });
    }
  }, 30_000);

  test("stops codex on an unknown item or event type without exposing the line", () => {
    // Covers: R8
    expect(CODEX_ALLOWED_ITEM_TYPES).toEqual(["agent_message", "reasoning"]);
    for (const type of CODEX_ALLOWED_EVENT_TYPES) {
      const item = type.startsWith("item.") ? { item: { type: "agent_message" } } : {};
      expect(codexLineVerdict(ev({ type, ...item }))).toBe("continue");
    }
    expect(codexLineVerdict(ev({ type: "item.completed", item: { type: "reasoning" } }))).toBe(
      "continue",
    );
    expect(codexLineVerdict("   ")).toBe("continue");

    const hostile = [
      ev({ type: "turn.surprise", aggregated_output: SECRET }),
      ev({ type: "item.completed", item: { type: "todo_list", text: SECRET } }),
      ev({ type: "item.completed", item: { text: SECRET } }),
      ev({ type: "item.completed" }),
      ev({ aggregated_output: SECRET }),
      ev({ type: ["item.completed"], text: SECRET }),
      ev([SECRET]),
      ev(SECRET),
      `not json ${SECRET}`,
      `{"type":"turn.started"} ${SECRET}`,
      ev({ type: `Bad Type ${SECRET}` }),
      ev({ type: "x".repeat(200) }),
      ev({ type: "item.completed", item: { type: `evil ${SECRET}` } }),
    ];
    for (const line of hostile) {
      const verdict = codexLineVerdict(line);
      expect(verdict).not.toBe("continue");
      const token = typeof verdict === "object" ? verdict.stop : "";
      expect(token).toMatch(/^[a-z_.]{1,40}$/);
      expect(token).not.toContain(SECRET);
    }
    expect(codexLineVerdict(ev({ type: "turn.surprise" }))).toEqual({ stop: "turn.surprise" });
    expect(codexLineVerdict("not json")).toEqual({ stop: "unknown" });
  });

  test("maps codex runs to attempts with token usage and never leaks stopped lines", async () => {
    // Covers: R8, R20
    const ok = fakeCodex(
      `${say(
        { type: "thread.started", thread_id: "t" },
        { type: "item.completed", item: { type: "reasoning", text: "hm" } },
        { type: "item.completed", item: { type: "agent_message", text: "{}" } },
        {
          type: "turn.completed",
          usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 },
        },
      )}\nprintf '%s' '{"key":"k","tokens":"t"}' > "$out"`,
    );
    expect(await codexCliProvider.invoke(request, services(ok))).toMatchObject({
      status: "succeeded",
      output: { key: "k", tokens: "t" },
      reportedModels: [],
      usage: { inputTokens: 100, outputTokens: 7, cachedInputTokens: 40, costUsd: null },
    });

    const cases: [string, string, string][] = [
      ["turn.failed", say({ type: "turn.failed", error: { message: SECRET } }), "failed"],
      ["error event", say({ type: "error", message: SECRET }), "failed"],
      ["exit code", "echo boom >&2; exit 3", "failed"],
      ["no last message", say({ type: "turn.completed", usage: {} }), "invalid-output"],
      ["not json", `${say({ type: "turn.completed" })}\nprintf 'prose' > "$out"`, "invalid-output"],
      ["bad schema", `printf '{"key":1}' > "$out"`, "invalid-output"],
    ];
    for (const [label, body, status] of cases) {
      const attempt = await codexCliProvider.invoke(request, services(fakeCodex(body)));
      expect([label, attempt.status]).toEqual([label, status]);
      expect(JSON.stringify(attempt)).not.toContain(SECRET);
    }

    const missing = newDir();
    writeFakeAgentBin(missing, "other", "exit 0");
    expect((await codexCliProvider.invoke(request, services(missing))).status).toBe("unavailable");

    const hung = fakeCodex("sleep 30");
    expect(
      (await codexCliProvider.invoke({ ...request, timeoutMs: 1_000 }, services(hung))).status,
    ).toBe("timeout");
  }, 60_000);
});
