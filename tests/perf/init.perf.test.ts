// Covers: R13
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode } from "../../src/core/contracts/index.ts";
import { copyFixture } from "../helpers/fixtures.ts";

const RUNS = 20;
const P95_LIMIT_MS = 2000;
const TEST_TIMEOUT_MS = 120_000;
const HERON_BIN = new URL("../../bin/heron.ts", import.meta.url).pathname;

const copies: string[] = [];
afterAll(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

/** Runs `bun bin/heron.ts <command> <root>` as a real process; returns wall time in ms and exit code. */
async function timedRun(command: "init" | "status" | "intake", root: string) {
  const start = performance.now();
  const proc = Bun.spawn(["bun", HERON_BIN, command, root], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  return { code, ms: performance.now() - start };
}

/** p95 with the nearest-rank method: sorted[ceil(0.95 * n) - 1]. */
const p95 = (samples: readonly number[]): number => {
  const sorted = samples.toSorted((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1] ?? Number.POSITIVE_INFINITY;
};

/** Bun's `expect` has no custom-message arg, so throw explicitly to print the measured p95 and sorted samples. */
function assertP95(label: string, samples: readonly number[]): void {
  const measured = p95(samples);
  if (measured > P95_LIMIT_MS) {
    const sorted = samples.toSorted((a, b) => a - b).map((ms) => Math.round(ms));
    throw new Error(
      `${label} p95=${Math.round(measured)}ms > ${P95_LIMIT_MS}ms samples=[${sorted.join(", ")}]`,
    );
  }
}

describe("heron latency", () => {
  test(
    "init and status p95 under 2000 ms on membership-product",
    async () => {
      const initTimes: number[] = [];
      const statusTimes: number[] = [];
      let lastRoot = "";
      for (let i = 0; i < RUNS; i++) {
        lastRoot = copyFixture("membership-product");
        copies.push(lastRoot);
        const run = await timedRun("init", lastRoot);
        expect(run.code).toBe(ExitCode.Ok);
        initTimes.push(run.ms);
      }
      for (let i = 0; i < RUNS; i++) {
        const run = await timedRun("status", lastRoot);
        expect(run.code).toBe(ExitCode.Ok);
        statusTimes.push(run.ms);
      }
      assertP95("init", initTimes);
      assertP95("status", statusTimes);
    },
    TEST_TIMEOUT_MS,
  );

  // Covers: R14
  test(
    "status p95 under 2000 ms with a product context and 50 context files",
    async () => {
      const root = copyFixture("membership-product");
      copies.push(root);
      const contextDir = join(root, "specs", "_master", "01-mvp", "context", "md");
      mkdirSync(contextDir, { recursive: true });
      for (let i = 0; i < 50; i++) {
        const name = `notes-${String(i).padStart(2, "0")}.md`;
        writeFileSync(
          join(contextDir, name),
          `# Notes ${i}\n\n## Context\n\n${"Some prose. ".repeat(200)}\n`,
        );
      }
      expect((await timedRun("init", root)).code).toBe(ExitCode.Ok);
      expect((await timedRun("intake", root)).code).toBe(ExitCode.Ok);
      const statusTimes: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        const run = await timedRun("status", root);
        expect(run.code).toBe(ExitCode.Ok);
        statusTimes.push(run.ms);
      }
      assertP95("status with a product context", statusTimes);
    },
    TEST_TIMEOUT_MS,
  );
});
