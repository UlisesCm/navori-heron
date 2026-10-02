// Covers: R1, R5, R10, R12
import { createHash } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../../src/core/contracts/index.ts";
import { runCliCaptured } from "../helpers/cli.ts";
import { copyFixture } from "../helpers/fixtures.ts";
import { nodeFs, type ReadonlyFs } from "../../src/core/store/fs-port.ts";
import { DEFAULT_INPUT_LIMITS } from "../../src/intake/ports.ts";
import { probeFile } from "../../src/intake/probe.ts";
import {
  ACTIVE_UX_READER,
  checkUxFiles,
  PROVISIONAL_UX_READER,
  readUxContract,
  readUxMarkdown,
  UxContractSchema,
} from "../../src/intake/ux-contract.ts";
import { extensionsOf, KNOWN_UX_FIELDS, uxCandidates } from "../../src/intake/ux-model.ts";

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

describe("uxCandidates", () => {
  // Covers: R10
  const FIXTURES = join(import.meta.dir, "..", "..", "fixtures");
  const UX_PATH = "specs/_master/01-mvp/ux.json";
  const fixtureText = (name: string): string =>
    readFileSync(join(FIXTURES, name, "specs", "_master", "01-mvp", "ux.json"), "utf8");
  const map = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const read = ACTIVE_UX_READER.read(bytes, { expectedStage: "01-mvp" });
    if (!read.ok) throw new Error(`invalid ux.json: ${JSON.stringify(read.issues)}`);
    return uxCandidates(JSON.parse(text) as Record<string, unknown>, read.contract, UX_PATH);
  };
  const keysOf = (result: ReturnType<typeof map>, section: string): string[] =>
    result.candidates.filter((c) => c.section === section).map((c) => c.key);

  // Covers: R10
  test("preserves unknown ux.json fields and stable ids", async () => {
    expect(ACTIVE_UX_READER).toBe(PROVISIONAL_UX_READER);
    expect(ACTIVE_UX_READER.id).toBe("provisional-1");

    // membership-product: every harness field is known, ids are the keys, nothing is reported
    const result = map(fixtureText("membership-product"));
    expect(result.findings).toEqual([]);
    expect(result.extensions).toEqual([]);
    expect(keysOf(result, "surfaces")).toEqual(["MOBILE", "DASHBOARD", "PARTNER"]);
    expect(keysOf(result, "actors")).toEqual(["member", "partner", "admin"]);
    expect(keysOf(result, "journeys")).toEqual(["J01", "J02", "J03"]);
    expect(keysOf(result, "flows")).toEqual(["F01", "F02", "F03"]);
    expect(keysOf(result, "screens")).toHaveLength(6);
    expect(keysOf(result, "functionalComponents")).toEqual(["C01", "C02"]);
    expect(keysOf(result, "patterns")).toEqual(["PT01", "PT02"]);
    expect(keysOf(result, "functionalRequirements")).toEqual(["UX-1", "UX-2"]);
    expect(keysOf(result, "traceability")).toEqual(["RF-1", "RF-2", "RF-3", "RF-4"]);
    expect(keysOf(result, "states")).toEqual([
      "loading",
      "empty",
      "membership-expired",
      "success",
      "error",
    ]);
    expect(keysOf(result, "constraints")).toEqual([
      "surface/MOBILE/only active members see benefits",
      "surface/PARTNER/partners never see member data",
      "actor/ACT-MEMBER/needs an active membership",
    ]);
    expect([...result.ids.screens]).toHaveLength(6);
    expect(
      result.candidates.every((c) => c.ref.source === "ux.json" && c.ref.path === UX_PATH),
    ).toBe(true);
    expect(result.candidates.find((c) => c.key === "SCR-MOBILE-02")).toMatchObject({
      ref: { locator: "/screens/1" },
      value: {
        surface: "MOBILE",
        actions: [
          { label: "Show QR code", priority: "primary" },
          { label: "Cancel", priority: "secondary" },
        ],
        navigation: { from: ["SCR-MOBILE-01"], to: [] },
      },
    });
    expect(
      result.candidates.find((c) => c.section === "states" && c.key === "loading")?.value,
    ).toEqual({
      name: "loading",
      global: false,
      screens: [
        "SCR-MOBILE-01",
        "SCR-MOBILE-02",
        "SCR-DASHBOARD-01",
        "SCR-DASHBOARD-02",
        "SCR-PARTNER-01",
        "SCR-PARTNER-02",
      ],
    });

    // unknown fields (root and per element) keep key, order and value, including "__proto__"
    const text = fixtureText("membership-product")
      .replace("{\n", '{\n  "__proto__": {"polluted": 1},\n  "x-extra": [3, 2, 1],\n')
      .replace(
        '"id": "SCR-MOBILE-01",',
        '"id": "SCR-MOBILE-01",\n      "z-ext": null,\n      "__proto__": {"s": 1},',
      );
    const extended = map(text);
    expect(extended.extensions).toEqual([
      { key: "__proto__", value: { polluted: 1 } },
      { key: "x-extra", value: [3, 2, 1] },
    ]);
    const screen = extended.candidates.find((c) => c.key === "SCR-MOBILE-01");
    expect(screen?.section === "screens" && screen.value.extensions).toEqual([
      { key: "z-ext", value: null },
      { key: "__proto__", value: { s: 1 } },
    ]);
    expect(canonicalJson(extended.extensions)).toContain('"__proto__"');
    // the same ids, in the same order, with or without the extensions
    expect(extended.candidates.map((c) => `${c.section}:${c.key}`)).toEqual(
      result.candidates.map((c) => `${c.section}:${c.key}`),
    );
    expect(extensionsOf({ a: 1, id: "X", b: 2 }, ["id"])).toEqual([
      { key: "a", value: 1 },
      { key: "b", value: 2 },
    ]);
    expect(KNOWN_UX_FIELDS.root).toContain("uxRequirements");

    // heron intake leaves ux.json untouched (same sha256)
    const root = copyFixture("membership-product");
    try {
      expect((await runCliCaptured(["init", root])).code).toBe(0);
      const path = join(root, "specs", "_master", "01-mvp", "ux.json");
      const before = createHash("sha256").update(readFileSync(path)).digest("hex");
      expect((await runCliCaptured(["intake", root])).code).toBe(0);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports unexpected types, repeated ids and undeclared references without failing", () => {
    const base = JSON.parse(fixtureText("membership-product")) as Record<string, unknown> & {
      journeys: Record<string, unknown>[];
      actors: Record<string, unknown>[];
      screens: Record<string, unknown>[];
    };
    base.actors[0] = { ...base.actors[0], goal: 7, capabilities: ["ok", 3] };
    base.journeys.push({ ...base.journeys[0], name: "Duplicate" }, { name: "no id" });
    base.screens[0] = {
      ...base.screens[0],
      actors: ["ACT-GHOST"],
      actions: [{ label: "Open", priority: "odd" }, "bad"],
      navigation: { from: [], to: ["SCR-NOPE-01"] },
    };
    base.uxRequirements = "nope";
    const text = JSON.stringify(base);
    const result = map(text);
    const byCode = (code: string): string[] =>
      result.findings.filter((f) => f.code === code).map((f) => f.message);
    expect(byCode("CONTEXT_SECTION_UNREADABLE")).toEqual([
      // collection-level problems first (entries and ids), then fields in section order
      `${UX_PATH} /journeys/4/id: expected string; the value is ignored.`,
      `${UX_PATH} /uxRequirements: expected array; the value is ignored.`,
      `${UX_PATH} /actors/0/goal: expected string; the value is ignored.`,
      `${UX_PATH} /actors/0/capabilities: expected array of strings; the value is ignored.`,
      `${UX_PATH} /screens/0/actions/1: expected object with a label; the value is ignored.`,
    ]);
    expect(byCode("CONTEXT_DUPLICATE_ID")).toEqual([
      `J01 appears more than once in ${UX_PATH} (/journeys/0, /journeys/3); the first one is used.`,
    ]);
    expect(byCode("UX_REFERENCE_UNRESOLVED")).toEqual([
      `/screens/0/actors/0: actor "ACT-GHOST" is not declared in ux.json.`,
      `/screens/0/navigation/to/0: screen "SCR-NOPE-01" is not declared in ux.json.`,
    ]);
    expect(result.candidates.find((c) => c.key === "J01")?.section).toBe("journeys");
    expect(result.candidates.find((c) => c.key === "SCR-MOBILE-01")?.value).toMatchObject({
      actions: [{ label: "Open", priority: null }],
    });
    expect(keysOf(result, "functionalRequirements")).toEqual([]);
    expect(result.findings.every((f) => f.severity === "warning")).toBe(true);

    // the conflict fixture keeps both sides of the actor: capability and forbidden action
    const conflict = map(fixtureText("conflict"));
    const partner = conflict.candidates.find((c) => c.section === "actors" && c.key === "partner");
    expect(partner?.section === "actors" && partner.value.capabilities).toContain(
      "See member data",
    );
  });
});
