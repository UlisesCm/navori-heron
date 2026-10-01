// Covers: R1, R5, R12
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeFs, type ReadonlyFs } from "../../src/core/store/fs-port.ts";
import { DEFAULT_INPUT_LIMITS } from "../../src/intake/ports.ts";
import { probeFile } from "../../src/intake/probe.ts";
import {
  checkUxFiles,
  readUxContract,
  readUxMarkdown,
  UxContractSchema,
} from "../../src/intake/ux-contract.ts";

const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v));
const valid = {
  schemaVersion: 1,
  masterStage: "01-mvp",
  surfaces: [{ id: "MOBILE", name: "Mobile" }],
  screens: [{ id: "SCR-MOBILE-01", surface: "MOBILE" }],
  flows: [{ id: "F01", screens: ["SCR-MOBILE-01"] }],
  patterns: [],
};
const invalid = {
  ...valid,
  screens: [
    { id: "SCR-MOBILE-01", surface: "MOBILE" },
    { id: "SCR-KIOSK-01", surface: "KIOSK" },
  ],
  flows: [{ id: "F01", screens: ["SCR-MOBILE-01", "SCR-MOBILE-09"] }],
  patterns: "none",
};
const stage = { expectedStage: "01-mvp" };

const msg = (bytes: Uint8Array): string => {
  const r = readUxContract(bytes, stage);
  return r.ok ? "ok" : `${r.issues[0]?.pointer}|${r.issues[0]?.message}`;
};

describe("readUxContract", () => {
  test("rejects broken relations and preserves unknown fields", () => {
    // Covers: R5
    const extra = {
      ...valid,
      actors: [{ id: "A1", x: 1 }],
      screens: [{ id: "SCR-MOBILE-01", surface: "MOBILE", extra: true }],
    };
    const ok = readUxContract(enc(extra), stage);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.contract.actors).toEqual([{ id: "A1", x: 1 }]);
    expect(ok.contract.screens[0]?.extra).toBe(true);
    expect(ok.summary).toEqual({ surfaces: ["MOBILE"], screens: 1, flows: 1, patterns: 0 });
    expect(UxContractSchema.safeParse(extra).success).toBe(true);

    const bad = readUxContract(enc(invalid), stage);
    expect(bad).toEqual({
      ok: false,
      issues: [
        {
          pointer: "/flows/0/screens/1",
          message: 'screen "SCR-MOBILE-09" is not declared in screens',
        },
        { pointer: "/patterns", message: expect.any(String) },
        { pointer: "/screens/1/surface", message: 'surface "KIOSK" is not declared in surfaces' },
      ],
    });
    expect(UxContractSchema.safeParse({ ...invalid, patterns: [] }).success).toBe(false);
  });

  test("reports duplicates, stage mismatch and pattern relations", () => {
    // Covers: R5
    const dup = {
      ...valid,
      masterStage: "02-x",
      surfaces: [{ id: "MOBILE" }, { id: "MOBILE" }],
      patterns: [{ id: "PT1", screens: ["NOPE"] }, 7],
    };
    const r = readUxContract(enc(dup), stage);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.pointer)).toEqual([
      "/masterStage",
      "/patterns/0/screens/0",
      "/patterns/1",
      "/surfaces/1/id",
    ]);
    expect(readUxContract(enc(dup), { expectedStage: null }).ok).toBe(false);
    expect(readUxContract(enc(valid), { expectedStage: null }).ok).toBe(true);
  });

  test("gates encoding, JSON, object shape and schemaVersion", () => {
    // Covers: R5
    expect(msg(new Uint8Array([0xff, 0xfe]))).toBe("|file is not valid UTF-8");
    expect(msg(new TextEncoder().encode("{nope"))).toStartWith("|file is not valid JSON");
    expect(msg(enc([1]))).toBe("|expected a JSON object");
    expect(msg(enc({ ...valid, schemaVersion: 2 }))).toBe(
      "/schemaVersion|schemaVersion 2 is not supported; Heron reads ux.json schemaVersion 1",
    );
    expect(msg(enc({ surfaces: [] }))).toStartWith("/flows|");
  });
});

describe("readUxMarkdown", () => {
  test("accepts text, rejects blank and non-UTF-8 at pointer root", () => {
    // Covers: R5
    expect(readUxMarkdown(new TextEncoder().encode("# UX"))).toEqual({ ok: true });
    for (const bytes of [new TextEncoder().encode(" \n\t "), new Uint8Array([0xc3, 0x28])]) {
      const r = readUxMarkdown(bytes);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0]?.pointer).toBe("");
    }
  });
});

describe("probeFile and checkUxFiles", () => {
  const base = mkdtempSync(join(tmpdir(), "heron-ux-"));
  const root = join(base, "repo");
  mkdirSync(root);
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(root, "UX.md"), "# UX\n");
  writeFileSync(join(root, "ux.json"), JSON.stringify(valid));
  writeFileSync(join(base, "outside.md"), "secret");
  symlinkSync(join(base, "outside.md"), join(root, "link.md"));
  mkdirSync(join(root, "dir.md"));
  writeFileSync(join(root, "big.md"), "x".repeat(20));

  test("probes presence, hash, symlink escape, directories and size", () => {
    // Covers: R1, R12
    const limits = { maxInputBytes: 10 };
    const ok = probeFile(nodeFs, root, "UX.md", DEFAULT_INPUT_LIMITS);
    expect(ok.present).toBe(true);
    expect(ok.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(probeFile(nodeFs, root, "missing.md", DEFAULT_INPUT_LIMITS)).toMatchObject({
      present: false,
      finding: null,
    });
    for (const rel of ["link.md", "dir.md", "../outside.md"]) {
      const p = probeFile(nodeFs, root, rel, DEFAULT_INPUT_LIMITS);
      expect(p.present).toBe(false);
      expect(p.finding?.code).toBe("UNSAFE_PATH");
    }
    const big = probeFile(nodeFs, root, "big.md", limits);
    expect(big.finding?.code).toBe("INPUT_TOO_LARGE");
    expect(big.bytes).toBeNull();
    expect(probeFile(nodeFs, join(base, "nope"), "UX.md", DEFAULT_INPUT_LIMITS).present).toBe(
      false,
    );
  });

  test("reports summary for valid files and issues for invalid ones", () => {
    // Covers: R5
    const paths = { markdown: "UX.md", json: "ux.json" };
    const good = checkUxFiles(nodeFs, root, paths, "01-mvp", DEFAULT_INPUT_LIMITS);
    expect(good.uxMarkdown.valid).toBe(true);
    expect(good.uxJson).toMatchObject({
      valid: true,
      reader: "provisional-1",
      summary: { screens: 1 },
    });
    expect(good.findings).toEqual([]);
    writeFileSync(join(root, "ux.json"), JSON.stringify(invalid));
    const bad = checkUxFiles(nodeFs, root, paths, "01-mvp", DEFAULT_INPUT_LIMITS);
    expect(bad.uxJson.valid).toBe(false);
    expect(bad.uxJson.issues).toHaveLength(3);
    const none = checkUxFiles(
      nodeFs,
      root,
      { markdown: "a.md", json: "link.md" },
      null,
      DEFAULT_INPUT_LIMITS,
    );
    expect(none.uxMarkdown).toMatchObject({ present: false, valid: null });
    expect(none.findings.map((f) => f.code)).toEqual(["UNSAFE_PATH"]);
  });
});

const failRead = (error: unknown): ReadonlyFs => ({
  ...nodeFs,
  readFileSync: () => {
    throw error;
  },
});

describe("probeFile read failures", () => {
  test("a read error becomes HARNESS_UNREADABLE instead of throwing", () => {
    // Covers: R1
    const root = mkdtempSync(join(tmpdir(), "heron-probe-"));
    writeFileSync(join(root, "a.md"), "x");
    try {
      const first = probeFile(failRead(new Error("EACCES")), root, "a.md", DEFAULT_INPUT_LIMITS);
      expect(first.finding?.message).toBe("a.md could not be read: EACCES.");
      const second = probeFile(failRead("boom"), root, "a.md", DEFAULT_INPUT_LIMITS);
      expect(second.finding?.message).toBe("a.md could not be read: boom.");
      const failStat: ReadonlyFs = {
        ...nodeFs,
        realpathSync: () => {
          throw new Error("EIO");
        },
      };
      expect(probeFile(failStat, root, "a.md", DEFAULT_INPUT_LIMITS)).toMatchObject({
        present: false,
        finding: null,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
