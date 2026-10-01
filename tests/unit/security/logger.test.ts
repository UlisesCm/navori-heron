// Covers: R15
import { describe, expect, test } from "bun:test";
import { createLogger, nullLogger } from "../../../src/security/logger.ts";
import { createValueRedactor } from "../../../src/security/redact.ts";

const SECRET = "sk-ant-supersecret-123";
const clock = { now: () => new Date("2026-10-01T12:00:00.000Z") };

describe("createLogger", () => {
  // Covers: R15
  test("redacts loaded secret values by key and by value before any sink", () => {
    const lines: string[] = [];
    const logger = createLogger(
      [
        {
          write() {
            throw new Error("sink down");
          },
        },
        { write: (line) => lines.push(line) },
      ],
      createValueRedactor({ ANTHROPIC_API_KEY: SECRET }),
      clock,
    );
    logger.event("agent.invocation", {
      runId: "r1",
      detail: `failed with ${SECRET}`,
      apiToken: "short",
      inputTokens: 12,
      at: "forged",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(SECRET);
    expect(lines[0]).not.toContain("short");
    expect(JSON.parse(lines[0] as string)).toEqual({
      apiToken: "[REDACTED]",
      at: "2026-10-01T12:00:00.000Z",
      detail: "failed with [REDACTED]",
      event: "agent.invocation",
      inputTokens: 12,
      runId: "r1",
    });
    expect(() => nullLogger.event("security.finding", {})).not.toThrow();
  });

  // Covers: R15
  test("writes one compact key-sorted line per event and never throws", () => {
    const lines: string[] = [];
    const logger = createLogger(
      [{ write: (line) => lines.push(line) }],
      createValueRedactor({}),
      clock,
    );
    const fields: Record<string, string | number | boolean | null> = {
      z: 1,
      durationMs: Number.NaN,
      b: true,
    };
    Object.defineProperty(fields, "__proto__", { value: "kept", enumerable: true });
    logger.event("agent.invocation", fields);
    expect(lines[0]).not.toContain("\n");
    expect(lines[0]).toBe(
      '{"__proto__":"kept","at":"2026-10-01T12:00:00.000Z","b":true,"durationMs":null,"event":"agent.invocation","z":1}',
    );
    // round-trips as a JSONL file: lines joined by "\n", each parses alone
    const file = `${lines.join("\n")}\n`;
    expect(
      file
        .trimEnd()
        .split("\n")
        .map((l) => JSON.parse(l) as unknown),
    ).toHaveLength(1);
    const broken = createLogger([{ write: (line) => lines.push(line) }], createValueRedactor({}), {
      now: () => {
        throw new Error("clock");
      },
    });
    expect(() => broken.event("security.finding", {})).not.toThrow();
    expect(lines[1]).toBe('{"event":"logger.serialization_failed"}');
  });
});
