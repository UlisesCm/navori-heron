import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Readable } from "node:stream";
import { createDefaultContext, randomRunIds, systemClock } from "../../src/app/context.ts";
import { HERON_VERSION } from "../../src/app/version.ts";
import { RunIdSchema } from "../../src/core/contracts/index.ts";
import { processIo } from "../../src/cli/io.ts";

const spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe("app context", () => {
  // Covers: R10
  test("systemClock honors SOURCE_DATE_EPOCH and ignores invalid values", () => {
    expect(systemClock({ SOURCE_DATE_EPOCH: "1790769600" }).now().toISOString()).toBe(
      "2026-09-30T12:00:00.000Z",
    );
    for (const invalid of ["abc", "", "-5", "1.5", "99999999999999999"]) {
      const before = Date.now();
      const now = systemClock({ SOURCE_DATE_EPOCH: invalid }).now().getTime();
      expect(now).toBeGreaterThanOrEqual(before);
    }
    expect(systemClock({}).now().getTime()).toBeGreaterThan(0);
  });

  // Covers: R10
  test("randomRunIds builds valid, distinct run ids from the clock", () => {
    const ids = randomRunIds();
    const now = new Date("2026-09-30T12:00:00.000Z");
    const a = ids.runId(now);
    const b = ids.runId(now);
    expect(RunIdSchema.safeParse(a).success).toBe(true);
    expect(a.startsWith("run-20260930T120000Z-")).toBe(true);
    expect(a).not.toBe(b);
  });

  // Covers: R9, R10
  test("createDefaultContext wires the process, identity and confirmation", async () => {
    const answers = ["Yes", "no", null];
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    spies.push(write);
    const ctx = createDefaultContext({
      isTTY: true,
      readLine: async () => answers.shift() ?? null,
    });
    expect(ctx.heronVersion).toBe(HERON_VERSION);
    expect(ctx.isTTY).toBe(true);
    expect(ctx.process.pid).toBe(process.pid);
    expect(ctx.identity.current()).not.toBe("");
    expect(await ctx.confirm("Approve? ")).toBe(true);
    expect(await ctx.confirm("Approve? ")).toBe(false);
    expect(await ctx.confirm("Approve? ")).toBe(false);
    expect(write).toHaveBeenCalledWith("Approve? ");
  });

  // Covers: R1
  test("processIo writes to the process streams and reads one stdin line", async () => {
    const out = spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = spyOn(process.stderr, "write").mockImplementation(() => true);
    spies.push(out, err);
    const io = processIo(Readable.from(["first\nsecond\n"]));
    io.stdout("to stdout");
    io.stderr("to stderr");
    expect(out).toHaveBeenCalledWith("to stdout");
    expect(err).toHaveBeenCalledWith("to stderr");
    expect(typeof io.isTTY).toBe("boolean");
    expect(await io.readLine()).toBe("first");
    expect(await processIo(Readable.from([])).readLine()).toBeNull();
  });
});
