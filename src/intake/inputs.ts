import {
  ManualContextSchema,
  type FindingIssue,
  type ManualContext,
  type UxFileCheck,
} from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { resolveInside, UnsafePathError } from "../core/store/paths.ts";
import type { AdapterDetection, AdapterSelection, DetectRequest, InputLimits } from "./ports.ts";
import { decodeUtf8 } from "./probe.ts";

/** Most `--context` files one selection may name (DR20). */
export const MAX_CONTEXT_INPUTS = 50;
/** Most schema issues reported for one input; a hostile document must not inflate the report. */
const MAX_ISSUES = 20;

export type SelectionCheck =
  | { ok: true; selection: AdapterSelection }
  | {
      ok: false;
      code: "PATH_NOT_FOUND" | "UNSAFE_PATH" | "CONTEXT_INPUT_INVALID";
      message: string;
      issues: FindingIssue[];
    };

const EXTENSIONS = {
  markdown: { list: [".md", ".markdown"], label: "a .md or .markdown file" },
  manual: { list: [".json"], label: "a .json file" },
} as const;

/** RFC 6901 JSON Pointer of a Zod issue path. */
const pointerOf = (path: readonly PropertyKey[]): string =>
  path.map((part) => `/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");

/** Strict UTF-8 -> JSON -> `ManualContextSchema`. Never throws; issues are sorted by pointer then message
 * and capped. Unknown keys (UX sections included) are issues: the schema is a strict object (RN-3). */
export function parseManualContext(
  bytes: Uint8Array,
): { ok: true; value: ManualContext } | { ok: false; issues: FindingIssue[] } {
  const text = decodeUtf8(bytes);
  if (text === null) return { ok: false, issues: [{ pointer: "", message: "not valid UTF-8" }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ pointer: "", message: "not valid JSON" }] };
  }
  const parsed = ManualContextSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map((issue) => ({ pointer: pointerOf(issue.path), message: issue.message }))
    .toSorted((a, b) =>
      a.pointer < b.pointer ? -1 : a.pointer > b.pointer ? 1 : a.message < b.message ? -1 : 1,
    );
  return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
}

const fail = (
  code: Extract<SelectionCheck, { ok: false }>["code"],
  message: string,
  issues: FindingIssue[] = [],
): SelectionCheck => ({ ok: false, code, message, issues });

/** Checks an explicit `markdown`/`manual` selection before anything is written (DR20, DR28): at most
 * {@link MAX_CONTEXT_INPUTS} inputs, the extension the adapter reads, every path inside the repository
 * (symlinks that escape are UNSAFE_PATH), an existing regular file within `limits`, and for `manual` a
 * valid `ManualContext`. The first failing input wins. Never throws. */
export function validateSelection(
  fs: ReadonlyFs,
  root: string,
  selection: AdapterSelection,
  limits: InputLimits,
): SelectionCheck {
  const { adapter, inputs } = selection;
  if (inputs.length > MAX_CONTEXT_INPUTS) {
    return fail(
      "CONTEXT_INPUT_INVALID",
      `Too many --context files (${inputs.length}); the limit is ${MAX_CONTEXT_INPUTS}.`,
    );
  }
  const { list, label } = EXTENSIONS[adapter];
  for (const path of inputs) {
    const lower = path.toLowerCase();
    if (!list.some((extension) => lower.endsWith(extension))) {
      return fail("CONTEXT_INPUT_INVALID", `${path} must be ${label} for the ${adapter} adapter.`);
    }
    let resolved: string;
    try {
      resolved = resolveInside(fs, root, path);
    } catch (error) {
      if (!(error instanceof UnsafePathError)) throw error;
      return fail("UNSAFE_PATH", `${path} resolves outside the repository or is not a safe path.`);
    }
    let size: number;
    try {
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile()) {
        return fail("UNSAFE_PATH", `${path} is not a regular file.`);
      }
      size = stat.size;
    } catch {
      return fail("PATH_NOT_FOUND", `${path} does not exist.`);
    }
    if (size > limits.maxInputBytes) {
      return fail("CONTEXT_INPUT_INVALID", `${path} exceeds ${limits.maxInputBytes} bytes.`);
    }
    if (adapter === "manual") {
      let bytes: Uint8Array;
      try {
        bytes = fs.readFileSync(resolved);
      } catch {
        return fail("PATH_NOT_FOUND", `${path} could not be read.`);
      }
      const parsed = parseManualContext(bytes);
      if (!parsed.ok) {
        const n = parsed.issues.length;
        return fail(
          "CONTEXT_INPUT_INVALID",
          `${path} is not a valid ManualContext (${n} ${n === 1 ? "issue" : "issues"}); nothing was written.`,
          parsed.issues,
        );
      }
    }
  }
  return { ok: true, selection };
}

const NOT_APPLICABLE: UxFileCheck = {
  path: "",
  present: false,
  valid: null,
  sha256: null,
  issues: [],
};

/** Detection of an opt-in adapter: it is detected only when `request.selection` names it (DR28) and never
 * has a UX contract (DR22), so the report carries no UX files and ADAPTER_REFERENCE_ONLY. */
export function detectSelected(
  adapter: AdapterSelection["adapter"],
  request: DetectRequest,
): AdapterDetection {
  if (request.selection?.adapter !== adapter) return { kind: "not-detected" };
  return {
    kind: "detected",
    report: {
      adapter,
      navoriMaster: false,
      specsDir: null,
      stage: null,
      stageStatus: "not-applicable",
      stageNotice: null,
      harness: null,
      artifacts: [],
      uxMarkdown: NOT_APPLICABLE,
      uxJson: { ...NOT_APPLICABLE, reader: "provisional-1", summary: null },
      findings: [
        {
          code: "ADAPTER_REFERENCE_ONLY",
          severity: "info",
          message: `The ${adapter} adapter has no UX contract; Heron stays in REFERENCE ONLY with this source.`,
          paths: [],
          issues: [],
        },
      ],
    },
  };
}
