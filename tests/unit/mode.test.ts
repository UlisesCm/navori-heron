// Covers: R2, R3, R4, R5, R7
import { describe, expect, test } from "bun:test";
import type { DetectionReport, UxFileCheck } from "../../src/core/contracts/index.ts";
import { describeModeBlock, detectMode } from "../../src/core/state/mode.ts";

const HASH = "a".repeat(64);
type Ux = "absent" | "valid" | "invalid";

function file(path: string, state: Ux): UxFileCheck {
  return {
    path,
    present: state !== "absent",
    valid: state === "absent" ? null : state === "valid",
    sha256: state === "absent" ? null : HASH,
    issues: state === "invalid" ? [{ pointer: "/screens/0", message: "bad" }] : [],
  };
}

function report(
  md: Ux,
  json: Ux,
  over: { ux?: string | null; stageStatus?: DetectionReport["stageStatus"] } = {},
): DetectionReport {
  const status = over.stageStatus ?? "selected";
  return {
    adapter: "navori-master",
    navoriMaster: true,
    specsDir: "specs",
    stage: { number: 1, slug: "mvp", dir: "01-mvp", state: "activa", selection: "active" },
    stageStatus: status,
    stageNotice: null,
    harness: over.ux === undefined ? null : { phase: null, mode: null, ux: over.ux },
    artifacts: [],
    uxMarkdown: file("specs/_master/01-mvp/UX.md", md),
    uxJson: {
      ...file("specs/_master/01-mvp/ux.json", json),
      reader: "provisional-1",
      summary: null,
    },
    findings: [],
  };
}

const codes = (r: DetectionReport) => detectMode(r).findings.map((f) => f.code);
const reasons = (r: DetectionReport) => detectMode(r).reasons.map((x) => x.code);

describe("detectMode", () => {
  test("decides the mode from UX files and the harness declaration", () => {
    // both valid, no declaration or md-json or unknown -> full
    for (const ux of [undefined, null, "md-json", "desde-cero"]) {
      const d = detectMode(report("valid", "valid", ux === undefined ? {} : { ux }));
      expect(d.mode).toBe("full");
      expect(d.reasons.map((r) => r.code)).toEqual(["UX_COMPLETE"]);
      expect(d.findings).toEqual([]);
    }
    // none present
    const none = report("absent", "absent");
    expect(detectMode(none).mode).toBe("reference-only");
    expect(reasons(none)).toEqual(["UX_FILES_MISSING"]);
    expect(codes(none)).toEqual([]);
    expect(describeModeBlock(detectMode(none))).toBe("UX.md and ux.json are missing");
    // exactly one present (legacy, no declaration)
    const onlyMd = detectMode(report("valid", "absent"));
    expect(onlyMd.mode).toBe("reference-only");
    expect(onlyMd.findings[0]?.code).toBe("UX_INCONSISTENT");
    expect(onlyMd.findings[0]?.message).toBe(
      "UX.md is present but ux.json is missing (specs/_master/01-mvp/ux.json); Heron will not create or infer it.",
    );
    expect(describeModeBlock(onlyMd)).toBe("ux.json is missing");
    const onlyJson = detectMode(report("absent", "valid"));
    expect(onlyJson.mode).toBe("reference-only");
    expect(describeModeBlock(onlyJson)).toBe("UX.md is missing");
    // invalid
    const invalid = detectMode(report("valid", "invalid"));
    expect(invalid.mode).toBe("reference-only");
    expect(invalid.findings.map((f) => f.code)).toEqual(["UX_CONTRACT_INVALID"]);
    expect(invalid.findings[0]?.message).toBe(
      "specs/_master/01-mvp/ux.json does not satisfy the provisional UX contract reader (1 issue).",
    );
    expect(describeModeBlock(invalid)).toBe("ux.json is invalid");
    // declaration md: always reference-only, md only present -> no inconsistent, no mismatch
    const md = detectMode(report("valid", "absent", { ux: "md" }));
    expect(md.mode).toBe("reference-only");
    expect(md.findings.map((f) => f.code)).toEqual(["UX_DECLARED_MD_ONLY"]);
    expect(md.findings[0]?.message).toBe(
      'The harness declared ux = "md" (UX.md only) in specs/_master/01-mvp/state.json; Heron requires UX.md and ux.json for full product, so it stays in reference-only.',
    );
    expect(describeModeBlock(md)).toBe("the harness declared UX.md only");
    // declaration md with both files -> md-only plus mismatch (D27)
    expect(codes(report("valid", "valid", { ux: "md" }))).toEqual([
      "UX_DECLARATION_MISMATCH",
      "UX_DECLARED_MD_ONLY",
    ]);
    // mismatch forces reference-only even with both valid files (D27)
    const mismatch = detectMode(report("valid", "valid", { ux: "none" }));
    expect(mismatch.mode).toBe("reference-only");
    expect(mismatch.findings[0]?.message).toBe(
      'The harness declares ux = "none" in specs/_master/01-mvp/state.json, but ux.json exists and UX.md exists.',
    );
    expect(describeModeBlock(mismatch)).toBe("the harness UX declaration does not match the files");
    const jsonMissing = detectMode(report("valid", "absent", { ux: "md-json" }));
    expect(jsonMissing.findings.map((f) => f.code)).toEqual([
      "UX_INCONSISTENT",
      "UX_DECLARATION_MISMATCH",
    ]);
    expect(jsonMissing.findings[1]?.message).toContain("but ux.json is missing.");
    expect(codes(report("absent", "absent", { ux: "md-json" }))).toEqual([
      "UX_DECLARATION_MISMATCH",
    ]);
    expect(detectMode(report("absent", "absent", { ux: "none" })).mode).toBe("reference-only");
  });

  test("an unavailable stage forces reference-only", () => {
    for (const stageStatus of ["none", "unknown"] as const) {
      const d = detectMode(report("valid", "valid", { stageStatus }));
      expect(d.mode).toBe("reference-only");
      expect(d.reasons.map((r) => r.code)).toEqual(["STAGE_UNAVAILABLE"]);
      expect(describeModeBlock(d)).toBe("no stage is selected");
    }
    expect(detectMode(report("valid", "valid", { stageStatus: "not-applicable" })).mode).toBe(
      "full",
    );
  });

  test("orders findings by code order then path and pluralizes issues", () => {
    const r = report("invalid", "invalid");
    r.uxJson.issues = [
      { pointer: "/b", message: "z" },
      { pointer: "/a", message: "y" },
    ];
    const d = detectMode(r);
    expect(d.findings.map((f) => f.paths[0])).toEqual([
      "specs/_master/01-mvp/UX.md",
      "specs/_master/01-mvp/ux.json",
    ]);
    expect(d.findings[1]?.message).toContain("(2 issues)");
    expect(d.findings[1]?.issues.map((i) => i.pointer)).toEqual(["/a", "/b"]);
    expect(describeModeBlock(d)).toBe("UX.md and ux.json are invalid");
    expect(describeModeBlock(detectMode(report("valid", "valid")))).toBe("production is available");
  });
});

const asAdapter = (adapter: DetectionReport["adapter"]): DetectionReport => ({
  ...report("valid", "valid"),
  adapter,
});

describe("opt-in adapters", () => {
  test("only the filesystem and navori-master adapters can reach full", () => {
    // Covers: R9
    for (const adapter of ["navori-master", "filesystem"] as const) {
      expect(detectMode(asAdapter(adapter)).mode).toBe("full");
    }
    for (const adapter of ["markdown", "manual"] as const) {
      const decision = detectMode(asAdapter(adapter));
      expect(decision.mode).toBe("reference-only");
      expect(decision.reasons.map((r) => r.code)).toEqual(["UX_FILES_MISSING"]);
    }
  });

  test("explains reference-only for the markdown and manual adapters", () => {
    // Covers: R9
    for (const adapter of ["markdown", "manual"] as const) {
      expect(describeModeBlock(detectMode(asAdapter(adapter)))).toBe(
        `the ${adapter} adapter has no UX contract`,
      );
    }
  });
});
