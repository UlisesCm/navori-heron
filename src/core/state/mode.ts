import {
  FINDING_CODES,
  type DetectionReport,
  type Finding,
  type ModeDecision,
  type ModeReason,
  type StoredFinding,
  type StoredModeDecision,
  type UxFileCheck,
} from "../contracts/index.ts";
import { compareStrings } from "./stale.ts";

type Declaration = "none" | "md" | "md-json";
const DECLARATIONS: readonly string[] = ["none", "md", "md-json"];

function isDeclaration(value: string | null): value is Declaration {
  return value !== null && DECLARATIONS.includes(value);
}

function harnessStatePath(report: DetectionReport): string {
  const dir = report.stage?.dir;
  return dir === undefined
    ? "the harness state.json"
    : `${report.specsDir ?? "specs"}/_master/${dir}/state.json`;
}

function mismatchDetail(declared: Declaration, md: boolean, json: boolean): string[] {
  const wantMd = declared !== "none";
  const wantJson = declared === "md-json";
  const details: string[] = [];
  if (wantJson && !json) details.push("ux.json is missing");
  if (wantMd && !md) details.push("UX.md is missing");
  if (!wantJson && json) details.push("ux.json exists");
  if (!wantMd && md) details.push("UX.md exists");
  return details;
}

function invalidFinding(file: UxFileCheck): Finding {
  const issues = file.issues.toSorted(
    (a, b) => compareStrings(a.pointer, b.pointer) || compareStrings(a.message, b.message),
  );
  const n = issues.length;
  return {
    code: "UX_CONTRACT_INVALID",
    severity: "error",
    message: `${file.path} does not satisfy the provisional UX contract reader (${n} ${n === 1 ? "issue" : "issues"}).`,
    paths: [file.path],
    issues,
  };
}

/** Known codes keep their FINDING_CODES position; any other persisted code sorts after them (then by text). */
const codeOrder = (f: StoredFinding): number => {
  const index = (FINDING_CODES as readonly string[]).indexOf(f.code);
  return index === -1 ? FINDING_CODES.length : index;
};

function sortFindings<F extends StoredFinding>(findings: F[]): F[] {
  return findings.toSorted(
    (a, b) => codeOrder(a) - codeOrder(b) || compareStrings(a.paths[0] ?? "", b.paths[0] ?? ""),
  );
}

/** Pure. Rules, all applied, findings accumulated:
 * 1. stageStatus "none" or "unknown" -> reference-only, STAGE_UNAVAILABLE ("selected" and "not-applicable" go on).
 * 2. For each present UX file with valid = false -> UX_CONTRACT_INVALID (one finding per file, with issues).
 * 3. Exactly one UX file present -> UX_INCONSISTENT naming the missing file, unless harness.ux = "md" and only UX.md is present.
 * 4. harness.ux = "md" -> UX_DECLARED_MD_ONLY and reference-only (D6).
 * 5. Declaration vs presence (none: neither; md: UX.md only; md-json: both) differs -> UX_DECLARATION_MISMATCH and reference-only (DP11, D27).
 * 6. Both absent -> UX_FILES_MISSING. 7. Otherwise, both present and valid -> full with reason UX_COMPLETE. */
export function detectMode(report: DetectionReport): ModeDecision {
  const reasons: ModeReason[] = [];
  const findings: Finding[] = [];
  const { uxMarkdown: md, uxJson: json } = report;
  const declared = report.harness?.ux ?? null;

  if (report.stageStatus === "none" || report.stageStatus === "unknown") {
    reasons.push({ code: "STAGE_UNAVAILABLE", message: "No harness stage is selected." });
  }

  for (const file of [md, json]) {
    if (file.present && file.valid === false) {
      findings.push(invalidFinding(file));
      reasons.push({ code: "UX_CONTRACT_INVALID", message: `${file.path} is invalid.` });
    }
  }

  const onlyMd = md.present && !json.present;
  if (md.present !== json.present && !(declared === "md" && onlyMd)) {
    const [present, missing] = md.present ? ([md, json] as const) : ([json, md] as const);
    const name = (file: UxFileCheck): string => (file === md ? "UX.md" : "ux.json");
    findings.push({
      code: "UX_INCONSISTENT",
      severity: "warning",
      message: `${name(present)} is present but ${name(missing)} is missing (${missing.path}); Heron will not create or infer it.`,
      paths: [present.path],
      issues: [],
    });
    reasons.push({ code: "UX_INCONSISTENT", message: `${name(missing)} is missing.` });
  }

  const statePath = harnessStatePath(report);
  if (declared === "md") {
    findings.push({
      code: "UX_DECLARED_MD_ONLY",
      severity: "info",
      message: `The harness declared ux = "md" (UX.md only) in ${statePath}; Heron requires UX.md and ux.json for full product, so it stays in reference-only.`,
      paths: [statePath],
      issues: [],
    });
    reasons.push({ code: "UX_DECLARED_MD_ONLY", message: "The harness declared UX.md only." });
  }

  if (isDeclaration(declared)) {
    const details = mismatchDetail(declared, md.present, json.present);
    if (details.length > 0) {
      findings.push({
        code: "UX_DECLARATION_MISMATCH",
        severity: "warning",
        message: `The harness declares ux = "${declared}" in ${statePath}, but ${details.join(" and ")}.`,
        paths: [statePath],
        issues: [],
      });
      reasons.push({
        code: "UX_DECLARATION_MISMATCH",
        message: "The harness declaration does not match the UX files.",
      });
    }
  }

  if (!md.present && !json.present) {
    reasons.push({ code: "UX_FILES_MISSING", message: "UX.md and ux.json are both missing." });
  }

  const full = reasons.length === 0;
  if (full)
    reasons.push({ code: "UX_COMPLETE", message: "UX.md and ux.json are present and valid." });
  return {
    kind: "ModeDecision",
    schemaVersion: 1,
    mode: full ? "full" : "reference-only",
    reasons,
    findings: sortFindings(findings),
    detection: report,
  };
}

/** Short English cause for MODE_BLOCKED, e.g. "ux.json is missing", "ux.json is invalid",
 * "the harness declared UX.md only", "no stage is selected". */
export function describeModeBlock(decision: StoredModeDecision): string {
  const has = (code: ModeReason["code"]): boolean => decision.reasons.some((r) => r.code === code);
  const { uxMarkdown: md, uxJson: json } = decision.detection;
  if (decision.mode === "full") return "production is available";
  if (has("STAGE_UNAVAILABLE")) return "no stage is selected";
  if (has("UX_DECLARED_MD_ONLY")) return "the harness declared UX.md only";
  if (has("UX_CONTRACT_INVALID")) {
    const bad = [md, json].filter((file) => file.present && file.valid === false);
    const names = bad.map((file) => (file === md ? "UX.md" : "ux.json")).join(" and ");
    return `${names} ${bad.length === 1 ? "is" : "are"} invalid`;
  }
  if (has("UX_FILES_MISSING")) return "UX.md and ux.json are missing";
  if (has("UX_INCONSISTENT")) return md.present ? "ux.json is missing" : "UX.md is missing";
  return "the harness UX declaration does not match the files";
}
