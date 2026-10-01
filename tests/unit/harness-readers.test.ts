// Covers: R1, R4, R7, R12
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import {
  readMasterIndex,
  readNavoriConfig,
  readParts,
  readStageState,
} from "../../src/intake/adapters/navori-master/harness.ts";
import { navoriMasterAdapter } from "../../src/intake/adapters/navori-master/index.ts";
import { filesystemAdapter } from "../../src/intake/adapters/filesystem/index.ts";
import { detectProject } from "../../src/intake/detect.ts";
import { DEFAULT_INPUT_LIMITS, type DetectRequest } from "../../src/intake/ports.ts";

const limits = DEFAULT_INPUT_LIMITS;
const base = mkdtempSync(join(tmpdir(), "heron-harness-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
let counter = 0;

/** Fresh repo root with the given files (path -> content; objects are JSON-encoded). */
function repo(files: Record<string, string | object>): string {
  const root = join(base, `r${counter++}`);
  mkdirSync(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return root;
}
const req = (root: string, stage: string | null = null): DetectRequest => ({
  root,
  stage,
  fs: nodeFs,
  limits,
});
const index = (stages: unknown[]): object => ({ version: 1, stages });
const stageEntry = {
  number: 1,
  slug: "mvp",
  dir: "01-mvp",
  state: "activa",
  openedAt: "2026-09-30",
  closedAt: null,
  spec: null,
};
const MASTER = "specs/_master";
const uxJson = {
  schemaVersion: 1,
  masterStage: "01-mvp",
  surfaces: [{ id: "MOBILE" }],
  screens: [{ id: "S1", surface: "MOBILE" }],
  flows: [{ id: "F01", screens: ["S1"] }],
  patterns: [],
};

describe("navori.config.json reader", () => {
  test("defaults, overrides and rejects hostile specsDir", () => {
    // Covers: R12
    expect(readNavoriConfig(nodeFs, repo({}), limits)).toEqual({ status: "absent" });
    const dflt = readNavoriConfig(nodeFs, repo({ "navori.config.json": { name: "x" } }), limits);
    expect(dflt).toMatchObject({ status: "ok", value: { specsDir: "specs" } });
    const custom = readNavoriConfig(
      nodeFs,
      repo({ "navori.config.json": { sdd: { specsDir: "docs/s/" } } }),
      limits,
    );
    expect(custom).toMatchObject({ status: "ok", value: { specsDir: "docs/s" } });
    for (const specsDir of ["/etc", "../x", "a/../../b", "", "a\\b"]) {
      const r = readNavoriConfig(
        nodeFs,
        repo({ "navori.config.json": { sdd: { specsDir } } }),
        limits,
      );
      expect(r.status).toBe("unreadable");
      if (r.status === "unreadable") expect(r.finding.code).toBe("UNSAFE_PATH");
    }
    const link = repo({ "navori.config.json": { sdd: { specsDir: "sp" } } });
    const outside = repo({ "_master/index.json": index([]) });
    symlinkSync(outside, join(link, "sp"));
    const esc = readNavoriConfig(nodeFs, link, limits);
    expect(esc.status === "unreadable" && esc.finding.code).toBe("UNSAFE_PATH");
  });

  test("unreadable config gives HARNESS_UNREADABLE and the adapter falls back to specs", () => {
    // Covers: R1
    for (const content of ["{broken", '{"sdd":{"specsDir":7}}', "[]"]) {
      const root = repo({
        "navori.config.json": content,
        [`${MASTER}/index.json`]: index([stageEntry]),
      });
      const r = readNavoriConfig(nodeFs, root, limits);
      expect(r.status === "unreadable" && r.finding.code).toBe("HARNESS_UNREADABLE");
      const d = navoriMasterAdapter.detect(req(root));
      expect(d.kind).toBe("detected");
      if (d.kind === "detected") {
        expect(d.report.specsDir).toBe("specs");
        expect(d.report.findings.map((f) => f.code)).toContain("HARNESS_UNREADABLE");
      }
    }
    const bin = repo({ "navori.config.json": "" });
    writeFileSync(join(bin, "navori.config.json"), new Uint8Array([0xff, 0xfe]));
    expect(readNavoriConfig(nodeFs, bin, limits).status).toBe("unreadable");
  });

  test("files over the size limit are INPUT_TOO_LARGE", () => {
    // Covers: R12
    const root = repo({ "navori.config.json": { name: "x".repeat(50) } });
    const r = readNavoriConfig(nodeFs, root, { maxInputBytes: 10 });
    expect(r.status === "unreadable" && r.finding.code).toBe("INPUT_TOO_LARGE");
  });
});

describe("index and state readers", () => {
  test("accept the real index.json and state.json of this repo", () => {
    // Covers: R7
    const real = resolve(import.meta.dir, "../..");
    const idx = readMasterIndex(nodeFs, real, "specs", limits);
    expect(idx.status).toBe("ok");
    if (idx.status === "ok") expect(idx.value.stages.map((s) => s.dir)).toContain("01-heron");
    const st = readStageState(nodeFs, real, "specs/_master/01-heron", limits);
    expect(st).toMatchObject({
      status: "ok",
      value: { phase: "executing", mode: "template", ux: null },
    });
  });

  test("index: versions, malformed entries and unsafe dirs", () => {
    // Covers: R1, R12
    const v2 = repo({ [`${MASTER}/index.json`]: { version: 2, stages: [] } });
    expect(readMasterIndex(nodeFs, v2, "specs", limits)).toMatchObject({
      status: "unsupported-version",
      found: 2,
      finding: {
        code: "HARNESS_VERSION_UNSUPPORTED",
        message: "specs/_master/index.json has version 2; Heron reads version 1.",
      },
    });
    for (const content of ['{"stages":[]}', "{oops", '{"version":1,"stages":"x"}']) {
      const r = readMasterIndex(
        nodeFs,
        repo({ [`${MASTER}/index.json`]: content }),
        "specs",
        limits,
      );
      expect(r.status === "unreadable" && r.finding.code).toBe("HARNESS_UNREADABLE");
    }
    const mixed = repo({
      [`${MASTER}/index.json`]: index([
        stageEntry,
        { ...stageEntry, number: 2, dir: "../../etc" },
        "junk",
      ]),
    });
    const r = readMasterIndex(nodeFs, mixed, "specs", limits);
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.value.stages.map((s) => s.dir)).toEqual(["01-mvp"]);
      expect(r.value.skipped.map((f) => f.code)).toEqual(["UNSAFE_PATH", "HARNESS_UNREADABLE"]);
    }
  });

  test("state: tolerant of unknown values and non-string fields", () => {
    // Covers: R7
    const root = repo({
      [`${MASTER}/01-mvp/state.json`]: {
        version: 1,
        phase: "ux-review",
        mode: "desde-cero-v9",
        ux: 5,
        futureField: true,
      },
    });
    expect(readStageState(nodeFs, root, `${MASTER}/01-mvp`, limits)).toMatchObject({
      status: "ok",
      value: { phase: "ux-review", mode: "desde-cero-v9", ux: null },
    });
    expect(readStageState(nodeFs, root, `${MASTER}/02-x`, limits)).toEqual({ status: "absent" });
    const v3 = repo({ [`${MASTER}/01-mvp/state.json`]: { version: 3 } });
    expect(readStageState(nodeFs, v3, `${MASTER}/01-mvp`, limits).status).toBe(
      "unsupported-version",
    );
  });
});

describe("language and parts.json", () => {
  // Covers: R15, R16
  test("reads the harness language and a tolerant parts.json", () => {
    const language = (value: unknown): unknown => {
      const r = readNavoriConfig(
        nodeFs,
        repo({ "navori.config.json": { name: " Acme ", language: value } }),
        limits,
      );
      return r.status === "ok"
        ? [r.value.name, r.value.language, r.value.unknownLanguage]
        : r.status;
    };
    expect(language("es")).toEqual(["Acme", "es", null]);
    expect(language("en")).toEqual(["Acme", "en", null]);
    // anything else is data, not a reader failure; the adapter decides what to report
    expect(language("fr")).toEqual(["Acme", null, "fr"]);
    expect(language("ES")).toEqual(["Acme", null, "ES"]);
    expect(language(7)).toEqual(["Acme", null, null]);
    expect(language(undefined)).toEqual(["Acme", null, null]);
    const nameless = readNavoriConfig(
      nodeFs,
      repo({ "navori.config.json": { name: "  ", sdd: {} } }),
      limits,
    );
    expect(nameless).toMatchObject({ status: "ok", value: { name: null, specsDir: "specs" } });

    const stage = `${MASTER}/01-mvp`;
    const parts = readParts(
      nodeFs,
      repo({
        [`${stage}/parts.json`]: {
          version: 1,
          extra: { anything: true },
          parts: [
            {
              id: "P1",
              title: "Member experience",
              futureField: 1,
              seedRequirements: ["RF-1", 3, "RF-2"],
              acceptance: [
                { id: "A1", method: "comando", extra: 1 },
                { id: "A2" },
                { id: "A1" },
                "A3",
                null,
              ],
            },
            { id: "P2", acceptance: "not a list", seedRequirements: "RF-3" },
            { title: "no id" },
            "garbage",
            { id: "P1", title: "again" },
            { id: "P3", title: 9 },
          ],
        },
      }),
      stage,
      limits,
    );
    if (parts.status !== "ok") throw new Error(`expected ok, got ${parts.status}`);
    expect(parts.value.parts).toEqual([
      {
        id: "P1",
        title: "Member experience",
        seedRequirements: ["RF-1", "RF-2"],
        acceptance: ["A1", "A2"],
        pointer: "/parts/0",
      },
      { id: "P2", title: null, seedRequirements: [], acceptance: [], pointer: "/parts/1" },
      { id: "P3", title: null, seedRequirements: [], acceptance: [], pointer: "/parts/5" },
    ]);
    expect(parts.value.skipped.map((f) => [f.code, f.message])).toEqual([
      ["HARNESS_UNREADABLE", `${stage}/parts.json could not be read: parts[2] is malformed.`],
      ["HARNESS_UNREADABLE", `${stage}/parts.json could not be read: parts[3] is malformed.`],
      [
        "CONTEXT_DUPLICATE_ID",
        `P1 appears more than once in ${stage}/parts.json (/parts/0, /parts/4); the first one is used.`,
      ],
    ]);

    // version 2 is not used; a missing or non-array parts list is unreadable; absent is absent
    const v2 = readParts(
      nodeFs,
      repo({ [`${stage}/parts.json`]: { version: 2, parts: [] } }),
      stage,
      limits,
    );
    expect(v2).toMatchObject({ status: "unsupported-version", found: 2 });
    expect(v2.status === "unsupported-version" && v2.finding.code).toBe(
      "HARNESS_VERSION_UNSUPPORTED",
    );
    expect(
      readParts(nodeFs, repo({ [`${stage}/parts.json`]: { version: 1 } }), stage, limits).status,
    ).toBe("unreadable");
    expect(readParts(nodeFs, repo({}), stage, limits)).toEqual({ status: "absent" });
  });
});

describe("adapters", () => {
  const config = { "navori.config.json": { name: "p", sdd: { specsDir: "specs" } } };

  test("navori-master reports 7 artifacts, UX summary and the harness declaration", () => {
    // Covers: R1, R4, R7
    const files: Record<string, string | object> = {
      ...config,
      [`${MASTER}/index.json`]: index([stageEntry]),
    };
    for (const f of [
      "MASTER.md",
      "DECISIONS.md",
      "UX.md",
      "context/DIGEST.md",
      "context/CODEBASE.md",
    ])
      files[`${MASTER}/01-mvp/${f}`] = "# x";
    files[`${MASTER}/01-mvp/parts.json`] = {};
    files[`${MASTER}/01-mvp/ux.json`] = uxJson;
    files[`${MASTER}/01-mvp/state.json`] = {
      version: 1,
      phase: "executing",
      mode: "template",
      ux: "md-json",
    };
    const d = detectProject(req(repo(files)));
    expect(d.kind).toBe("detected");
    if (d.kind !== "detected") return;
    const r = d.report;
    expect(r.adapter).toBe("navori-master");
    expect(r.stage).toMatchObject({ dir: "01-mvp", selection: "active" });
    expect(r.artifacts.map((a) => [a.name, a.present])).toEqual([
      ["MASTER.md", true],
      ["DECISIONS.md", true],
      ["parts.json", true],
      ["UX.md", true],
      ["ux.json", true],
      ["DIGEST.md", true],
      ["CODEBASE.md", true],
    ]);
    expect(r.harness).toEqual({ phase: "executing", mode: "template", ux: "md-json" });
    expect(r.uxJson).toMatchObject({ valid: true, summary: { screens: 1, flows: 1, patterns: 0 } });
    expect(r.uxMarkdown.valid).toBe(true);
    expect(r.findings).toEqual([]);
  });

  test("navori-master: stage states, unknown declaration, unsafe entries, missing state", () => {
    // Covers: R1, R7
    const v2 = navoriMasterAdapter.detect(
      req(repo({ ...config, [`${MASTER}/index.json`]: { version: 2 } })),
    );
    expect(v2).toMatchObject({
      kind: "detected",
      report: { navoriMaster: true, stageStatus: "unknown", stage: null },
    });
    const empty = navoriMasterAdapter.detect(
      req(repo({ ...config, [`${MASTER}/index.json`]: index([]) })),
    );
    expect(empty).toMatchObject({ kind: "detected", report: { stageStatus: "none" } });
    if (empty.kind === "detected")
      expect(empty.report.findings.map((f) => f.code)).toEqual(["NO_STAGE"]);
    const unknown = navoriMasterAdapter.detect(
      req(
        repo({
          ...config,
          [`${MASTER}/index.json`]: index([stageEntry]),
          [`${MASTER}/01-mvp/state.json`]: { version: 1, ux: "md-json-v2" },
        }),
      ),
    );
    if (unknown.kind !== "detected") throw new Error("expected detected");
    expect(unknown.report.harness?.ux).toBe("md-json-v2");
    expect(unknown.report.findings.map((f) => f.code)).toEqual(["HARNESS_UNKNOWN_VALUE"]);
    const legacy = navoriMasterAdapter.detect(
      req(repo({ ...config, [`${MASTER}/index.json`]: index([stageEntry]) })),
    );
    expect(legacy).toMatchObject({ kind: "detected", report: { harness: null, findings: [] } });
    const badState = navoriMasterAdapter.detect(
      req(
        repo({
          ...config,
          [`${MASTER}/index.json`]: index([stageEntry]),
          [`${MASTER}/01-mvp/state.json`]: { version: 9 },
        }),
      ),
    );
    if (badState.kind === "detected")
      expect(badState.report.findings.map((f) => f.code)).toEqual(["HARNESS_VERSION_UNSUPPORTED"]);
    const stageErr = navoriMasterAdapter.detect(
      req(repo({ ...config, [`${MASTER}/index.json`]: index([stageEntry]) }), "99-x"),
    );
    expect(stageErr).toMatchObject({ kind: "stage-error", code: "STAGE_NOT_FOUND" });
  });

  test("navori-master: symlinked artifact is reported, not followed", () => {
    // Covers: R12
    const root = repo({ ...config, [`${MASTER}/index.json`]: index([stageEntry]) });
    const secret = repo({ "s.md": "secret" });
    mkdirSync(join(root, `${MASTER}/01-mvp`), { recursive: true });
    symlinkSync(join(secret, "s.md"), join(root, `${MASTER}/01-mvp/MASTER.md`));
    symlinkSync(join(secret, "s.md"), join(root, `${MASTER}/01-mvp/UX.md`));
    const d = navoriMasterAdapter.detect(req(root));
    if (d.kind !== "detected") throw new Error("expected detected");
    expect(d.report.artifacts[0]).toMatchObject({ name: "MASTER.md", present: false });
    expect(d.report.uxMarkdown.present).toBe(false);
    expect(d.report.findings.map((f) => [f.code, f.paths[0]])).toEqual([
      ["UNSAFE_PATH", `${MASTER}/01-mvp/MASTER.md`],
      ["UNSAFE_PATH", `${MASTER}/01-mvp/UX.md`],
    ]);
  });

  test("detection order: config without index and plain repos use the filesystem adapter", () => {
    // Covers: R1
    expect(navoriMasterAdapter.detect(req(repo({})))).toEqual({ kind: "not-detected" });
    expect(navoriMasterAdapter.detect(req(repo(config)))).toEqual({ kind: "not-detected" });
    const plain = detectProject(req(repo({ "UX.md": "# ux", "ux.json": uxJson })));
    if (plain.kind !== "detected") throw new Error("expected detected");
    expect(plain.report).toMatchObject({
      adapter: "filesystem",
      navoriMaster: false,
      stageStatus: "not-applicable",
      specsDir: null,
    });
    expect(plain.report.uxMarkdown.valid).toBe(true);
    expect(plain.report.uxJson.valid).toBe(true);
    const none = detectProject(req(repo({})), []);
    expect(none).toMatchObject({ kind: "detected", report: { adapter: "filesystem" } });
  });

  test("load is not available until P4", () => {
    // Covers: R1
    const request = req(repo({}));
    const d = filesystemAdapter.detect(request);
    if (d.kind !== "detected") throw new Error("expected detected");
    for (const adapter of [filesystemAdapter, navoriMasterAdapter]) {
      expect(adapter.load({ ...request, report: d.report })).toMatchObject({
        ok: false,
        code: "LOAD_NOT_AVAILABLE",
      });
    }
  });
});
