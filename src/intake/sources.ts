import type {
  ContextSourceRecord,
  Finding,
  RelativeArtifactPath,
  SourceKind,
} from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { resolveInside, UnsafePathError } from "../core/store/paths.ts";
import type { InputLimits } from "./ports.ts";
import { decodeUtf8, probeFile } from "./probe.ts";

/** Most Markdown files read from one context directory (DR20). */
export const MAX_CONTEXT_FILES = 50;

/** `text` is the strict UTF-8 content, or null when the source is absent or unreadable. */
export type LoadedSource = { record: ContextSourceRecord; text: string | null };

/** Reads one source as text. Absent -> `absent`; symlink escape, non-regular file, size over the limit,
 * read error or invalid UTF-8 -> `unreadable` with the matching finding. A readable source is `read`
 * until {@link settleSource} knows whether it contributed. Never throws. */
export function readSource(
  fs: ReadonlyFs,
  root: string,
  path: RelativeArtifactPath,
  source: SourceKind,
  limits: InputLimits,
): { loaded: LoadedSource; finding: Finding | null } {
  const probe = probeFile(fs, root, path, limits);
  const record = (status: ContextSourceRecord["status"]): ContextSourceRecord => ({
    source,
    path,
    status,
  });
  if (probe.finding !== null) {
    return { loaded: { record: record("unreadable"), text: null }, finding: probe.finding };
  }
  if (!probe.present || probe.bytes === null) {
    return { loaded: { record: record("absent"), text: null }, finding: null };
  }
  const text = decodeUtf8(probe.bytes);
  if (text === null) {
    return {
      loaded: { record: record("unreadable"), text: null },
      finding: {
        code: "HARNESS_UNREADABLE",
        severity: "warning",
        message: `${path} could not be read: file is not valid UTF-8.`,
        paths: [path],
        issues: [],
      },
    };
  }
  return { loaded: { record: record("read"), text }, finding: null };
}

/** A source that produced elements is `used`; one that parsed without any stays `read` and reports
 * SOURCE_NO_ELEMENTS (info). Absent, unreadable or excluded sources pass through untouched. */
export function settleSource(
  record: ContextSourceRecord,
  elements: number,
): { record: ContextSourceRecord; finding: Finding | null } {
  if (record.status !== "read") return { record, finding: null };
  if (elements > 0) return { record: { ...record, status: "used" }, finding: null };
  return {
    record,
    finding: {
      code: "SOURCE_NO_ELEMENTS",
      severity: "info",
      message: `${record.path} was read but has no section Heron extracts elements from.`,
      paths: [record.path],
      issues: [],
    },
  };
}

/** `*.md` entries of `dir` (not recursive, directories skipped), sorted by name, capped at
 * {@link MAX_CONTEXT_FILES} with INPUT_TOO_LARGE. A missing directory is empty; an unsafe one is UNSAFE_PATH. */
export function listContextMarkdown(
  fs: ReadonlyFs,
  root: string,
  dir: RelativeArtifactPath,
  _limits: InputLimits, // part of the adapter-facing signature; per-file sizes are enforced by readSource
): { paths: RelativeArtifactPath[]; findings: Finding[] } {
  let names: string[];
  try {
    const resolved = resolveInside(fs, root, dir);
    if (!fs.lstatSync(resolved).isDirectory()) return { paths: [], findings: [] };
    names = fs.readdirSync(resolved).filter((name) => {
      if (!name.endsWith(".md")) return false;
      try {
        return !fs.lstatSync(resolveInside(fs, root, `${dir}/${name}`)).isDirectory();
      } catch (error) {
        // an escaping symlink stays listed so readSource reports it as UNSAFE_PATH
        return error instanceof UnsafePathError;
      }
    });
  } catch (error) {
    if (!(error instanceof UnsafePathError)) return { paths: [], findings: [] };
    return {
      paths: [],
      findings: [
        {
          code: "UNSAFE_PATH",
          severity: "warning",
          message: `${dir} resolves outside the repository or is not a regular path; it is ignored.`,
          paths: [dir],
          issues: [],
        },
      ],
    };
  }
  const markdown = names.toSorted();
  const findings: Finding[] = [];
  if (markdown.length > MAX_CONTEXT_FILES) {
    findings.push({
      code: "INPUT_TOO_LARGE",
      severity: "warning",
      message: `${dir} has ${markdown.length} Markdown files; only the first ${MAX_CONTEXT_FILES} by name are read.`,
      paths: [dir],
      issues: [],
    });
  }
  return { paths: markdown.slice(0, MAX_CONTEXT_FILES).map((name) => `${dir}/${name}`), findings };
}
