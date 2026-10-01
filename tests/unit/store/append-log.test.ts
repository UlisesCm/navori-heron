// Covers: R15, R21
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs } from "../../../src/core/store/fs-port.ts";
import { openAppendLog, pruneLogs, readLogEvents } from "../../../src/core/store/append-log.ts";
import { withFaultInjection } from "../../helpers/faulty-fs.ts";

const dirs: string[] = [];
const heronDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "heron-log-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-10-01T12:00:00Z");

describe("append-log", () => {
  test("appends JSONL lines and prunes files older than the retention", () => {
    const dir = heronDir();
    const logs = join(dir, "logs");
    mkdirSync(logs);
    writeFileSync(join(logs, "2026-08-01.jsonl"), '{"old":1}\n'); // 61 days: pruned
    writeFileSync(join(logs, "2026-09-01.jsonl"), '{"edge":1}\n'); // exactly 30 days: kept
    writeFileSync(join(logs, "2026-09-20.jsonl"), '{"recent":1}\nnot json\n[1]\n{"recent":2}\n');
    writeFileSync(join(logs, "notes.txt"), "keep");
    writeFileSync(join(logs, "2026-08-01.jsonl.bak"), "keep");

    const sink = openAppendLog(nodeFs, dir, NOW, { retentionDays: 30 });
    sink.write('{"n":1}');
    sink.write('{"n":2}');
    openAppendLog(nodeFs, dir, NOW, { retentionDays: 30 }).write('{"n":3}'); // append, not truncate

    expect(readdirSync(logs).toSorted()).toEqual([
      "2026-08-01.jsonl.bak",
      "2026-09-01.jsonl",
      "2026-09-20.jsonl",
      "2026-10-01.jsonl",
      "notes.txt",
    ]);
    expect(readFileSync(join(logs, "2026-10-01.jsonl"), "utf8")).toBe(
      '{"n":1}\n{"n":2}\n{"n":3}\n',
    );

    // window: since 2026-09-20 skips the 09-01 file; corrupt and non-object lines are skipped
    expect(readLogEvents(nodeFs, dir, new Date("2026-09-20T23:00:00Z"))).toEqual([
      { recent: 1 },
      { recent: 2 },
      { n: 1 },
      { n: 2 },
      { n: 3 },
    ]);
    expect(readLogEvents(nodeFs, dir, new Date("2026-10-02T00:00:00Z"))).toEqual([]);
    expect(readLogEvents(nodeFs, join(dir, "absent"), NOW)).toEqual([]);

    pruneLogs(nodeFs, dir, NOW, 5);
    expect(readdirSync(logs).filter((f) => f.endsWith(".jsonl"))).toEqual(["2026-10-01.jsonl"]);
  });

  test("swallows filesystem errors on every mutation", () => {
    const dir = heronDir();
    // K = mutations of a clean open + two writes; failing at each one must never throw
    const probe = withFaultInjection(nodeFs, null);
    const clean = openAppendLog(probe.fs, dir, NOW, { retentionDays: 30 });
    clean.write("a");
    clean.write("b");
    const total = probe.mutations();
    expect(total).toBeGreaterThan(0);
    for (let failAt = 1; failAt <= total; failAt++) {
      const faulty = withFaultInjection(nodeFs, failAt);
      expect(() => {
        const sink = openAppendLog(faulty.fs, dir, NOW, { retentionDays: 30 });
        sink.write("a");
        sink.write("b");
      }).not.toThrow();
      expect(faulty.tripped()).toBe(true);
    }
  });
});
