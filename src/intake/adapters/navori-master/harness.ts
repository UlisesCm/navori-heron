import { z } from "zod";
import {
  RelativeArtifactPathSchema,
  type Finding,
  type Sha256Hex,
} from "../../../core/contracts/index.ts";
import type { ReadonlyFs } from "../../../core/store/fs-port.ts";
import type { InputLimits } from "../../ports.ts";
import { decodeUtf8, probeFile } from "../../probe.ts";
import { STAGE_DIR_PATTERN } from "./stage.ts";

export const SUPPORTED_HARNESS_VERSION = 1 as const;
export const HARNESS_UX_DECLARATIONS = ["none", "md", "md-json"] as const;

export type HarnessReadResult<T> =
  | { status: "absent" }
  | { status: "ok"; value: T; sha256: Sha256Hex }
  | { status: "unreadable"; finding: Finding } // HARNESS_UNREADABLE | UNSAFE_PATH | INPUT_TOO_LARGE
  | { status: "unsupported-version"; found: number; finding: Finding }; // HARNESS_VERSION_UNSUPPORTED

function finding(
  code: Finding["code"],
  path: string,
  message: string,
  severity: Finding["severity"] = "warning",
): Finding {
  return { code, severity, message, paths: [path], issues: [] };
}

const unreadable = (path: string, why: string): { status: "unreadable"; finding: Finding } => ({
  status: "unreadable",
  finding: finding("HARNESS_UNREADABLE", path, `${path} could not be read: ${why}.`),
});

type Parsed =
  | { status: "ok"; json: unknown; sha256: Sha256Hex }
  | { status: "absent" }
  | {
      status: "unreadable";
      finding: Finding;
    };

function readJsonFile(fs: ReadonlyFs, root: string, path: string, limits: InputLimits): Parsed {
  const probe = probeFile(fs, root, path, limits);
  if (probe.finding !== null) return { status: "unreadable", finding: probe.finding };
  if (!probe.present || probe.bytes === null || probe.sha256 === null) return { status: "absent" };
  const text = decodeUtf8(probe.bytes);
  if (text === null) return unreadable(path, "file is not valid UTF-8");
  try {
    return { status: "ok", json: JSON.parse(text), sha256: probe.sha256 };
  } catch (error) {
    return unreadable(path, error instanceof Error ? error.message : "invalid JSON");
  }
}

/** Runs `view` on a versioned harness file (index.json, state.json): version must be the number 1. */
function readVersioned<T>(
  fs: ReadonlyFs,
  root: string,
  path: string,
  limits: InputLimits,
  view: (raw: Record<string, unknown>) => { value: T } | { error: string },
): HarnessReadResult<T> {
  const parsed = readJsonFile(fs, root, path, limits);
  if (parsed.status !== "ok") return parsed;
  const raw = parsed.json;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return unreadable(path, "expected a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const found = record.version;
  if (typeof found !== "number") return unreadable(path, "missing numeric version");
  if (found !== SUPPORTED_HARNESS_VERSION) {
    return {
      status: "unsupported-version",
      found,
      finding: finding(
        "HARNESS_VERSION_UNSUPPORTED",
        path,
        `${path} has version ${found}; Heron reads version ${SUPPORTED_HARNESS_VERSION}.`,
      ),
    };
  }
  const result = view(record);
  if ("error" in result) return unreadable(path, result.error);
  return { status: "ok", value: result.value, sha256: parsed.sha256 };
}

// ---- navori.config.json -------------------------------------------------

export type NavoriConfigView = { specsDir: string };
const ConfigShape = z.looseObject({
  sdd: z.looseObject({ specsDir: z.string().optional() }).optional(),
});
export const CONFIG_PATH = "navori.config.json";

/** sdd.specsDir ?? "specs". A hostile specsDir (absolute, "..", backslash, escaping symlink) is
 * reported as UNSAFE_PATH and the caller falls back to "specs". */
export function readNavoriConfig(
  fs: ReadonlyFs,
  root: string,
  limits: InputLimits,
): HarnessReadResult<NavoriConfigView> {
  const parsed = readJsonFile(fs, root, CONFIG_PATH, limits);
  if (parsed.status !== "ok") return parsed;
  const config = ConfigShape.safeParse(parsed.json);
  if (!config.success) return unreadable(CONFIG_PATH, "unexpected shape");
  const specsDir = (config.data.sdd?.specsDir ?? "specs").replace(/\/+$/, "");
  const safe = RelativeArtifactPathSchema.safeParse(specsDir).success;
  const probeDir = safe ? probeFile(fs, root, `${specsDir}/_master/index.json`, limits) : null;
  if (!safe || probeDir?.finding?.code === "UNSAFE_PATH") {
    return {
      status: "unreadable",
      finding: finding(
        "UNSAFE_PATH",
        CONFIG_PATH,
        `${CONFIG_PATH} sdd.specsDir resolves outside the repository or is not a regular path; it is ignored.`,
      ),
    };
  }
  return { status: "ok", value: { specsDir }, sha256: parsed.sha256 };
}

// ---- _master/index.json ---------------------------------------------------

export type MasterStageView = {
  number: number;
  slug: string;
  dir: string;
  state: string;
  closedAt: string | null;
};
export type MasterIndexView = { version: 1; stages: MasterStageView[]; skipped: Finding[] };

const StageShape = z.looseObject({
  number: z.number().int(),
  slug: z.string(),
  dir: z.string(),
  state: z.string(),
  closedAt: z.string().nullable().optional(),
});

/** Entries with a dir outside STAGE_DIR_PATTERN are skipped with UNSAFE_PATH; malformed ones with HARNESS_UNREADABLE. */
export function readMasterIndex(
  fs: ReadonlyFs,
  root: string,
  specsDir: string,
  limits: InputLimits,
): HarnessReadResult<MasterIndexView> {
  const path = `${specsDir}/_master/index.json`;
  return readVersioned<MasterIndexView>(fs, root, path, limits, (raw) => {
    if (!Array.isArray(raw.stages)) return { error: "stages must be an array" };
    const stages: MasterStageView[] = [];
    const skipped: Finding[] = [];
    raw.stages.forEach((entry: unknown, at: number) => {
      const parsed = StageShape.safeParse(entry);
      if (!parsed.success) {
        skipped.push(
          finding(
            "HARNESS_UNREADABLE",
            path,
            `${path} could not be read: stages[${at}] is malformed.`,
          ),
        );
      } else if (!STAGE_DIR_PATTERN.test(parsed.data.dir)) {
        skipped.push(
          finding(
            "UNSAFE_PATH",
            path,
            `${path} stages[${at}].dir resolves outside the repository or is not a regular path; it is ignored.`,
          ),
        );
      } else {
        const { number, slug, dir, state, closedAt } = parsed.data;
        stages.push({ number, slug, dir, state, closedAt: closedAt ?? null });
      }
    });
    return { value: { version: 1, stages, skipped } };
  });
}

// ---- <stage>/state.json ---------------------------------------------------

export type StageStateView = {
  version: 1;
  phase: string | null;
  mode: string | null;
  ux: string | null;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Unknown phase/mode/ux strings are accepted as-is (D6); non-strings become null. */
export function readStageState(
  fs: ReadonlyFs,
  root: string,
  stageRelativeDir: string,
  limits: InputLimits,
): HarnessReadResult<StageStateView> {
  return readVersioned<StageStateView>(
    fs,
    root,
    `${stageRelativeDir}/state.json`,
    limits,
    (raw) => ({
      value: { version: 1, phase: str(raw.phase), mode: str(raw.mode), ux: str(raw.ux) },
    }),
  );
}
