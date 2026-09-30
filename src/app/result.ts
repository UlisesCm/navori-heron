import { resolve } from "node:path";
import {
  ExitCode,
  InvalidDocumentError,
  UnsupportedSchemaVersionError,
  formatUnsupportedVersionMessage,
  type Finding,
  type FindingCode,
  type FindingSeverity,
  type ModeDecision,
} from "../core/contracts/index.ts";
import { describeModeBlock } from "../core/state/mode.ts";
import type { TransitionRejection } from "../core/state/transitions.ts";
import { HERON_DIR, StateRevisionConflictError } from "../core/store/file-store.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { LockBusyError } from "../core/store/lock.ts";
import { UnsafePathError } from "../core/store/paths.ts";
import type { StageError } from "../intake/ports.ts";

export type UseCaseResult<T> =
  | { ok: true; data: T; findings: Finding[]; next: string[] }
  | {
      ok: false;
      code: Exclude<ExitCode, 0>;
      message: string;
      findings: Finding[];
      data: T | null;
    };

/** Builds a finding without issues. */
export function makeFinding(
  code: FindingCode,
  severity: FindingSeverity,
  message: string,
  paths: string[] = [],
): Finding {
  return { code, severity, message, paths, issues: [] };
}

/** Failed result whose single finding carries the message. */
export function failure<T>(
  code: Exclude<ExitCode, 0>,
  finding: Finding,
  message: string = finding.message,
): UseCaseResult<T> {
  return { ok: false, code, message, findings: [finding], data: null };
}

/** Finding for a `canTransition` rejection. A MODE_BLOCKED reason gains the cause
 * `({describeModeBlock(decision)})` before its final period (design.md, Mensajes de findings). */
export function rejectionToFinding(
  rejection: TransitionRejection,
  decision: ModeDecision,
): Finding {
  const message =
    rejection.code === "MODE_BLOCKED"
      ? `${rejection.reason.replace(/\.$/, "")} (${describeModeBlock(decision)}).`
      : rejection.reason;
  return makeFinding(rejection.code, "error", message);
}

/** Real path of `path` when it is an existing directory, otherwise null. */
export function resolveDirectory(fs: ReadonlyFs, path: string): string | null {
  try {
    const real = fs.realpathSync(resolve(path));
    return fs.lstatSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export function pathNotFound<T>(path: string): UseCaseResult<T> {
  return failure(
    ExitCode.Usage,
    makeFinding("PATH_NOT_FOUND", "error", `Path not found or not a directory: ${path}`, [path]),
  );
}

/** Exit 2 with the stage error message plus the `Available stages:` line. */
export function stageErrorResult<T>(error: StageError): UseCaseResult<T> {
  const available =
    error.available.length === 0
      ? "none"
      : error.available.map((stage) => `${stage.dir} (${stage.state})`).join(", ");
  return failure(
    ExitCode.Usage,
    makeFinding(error.code, "error", error.message),
    `${error.message}\nAvailable stages: ${available}`,
  );
}

/** Maps the expected store and document errors to a failed result; null for anything else. */
export function storeErrorResult<T>(error: unknown): UseCaseResult<T> | null {
  if (error instanceof UnsafePathError) {
    const message =
      error.path === HERON_DIR
        ? ".heron/ must be a regular directory inside the repository."
        : `${error.path} resolves outside the repository or is not a regular path; it is ignored.`;
    return failure(ExitCode.Blocked, makeFinding("UNSAFE_PATH", "error", message, [error.path]));
  }
  if (error instanceof UnsupportedSchemaVersionError) {
    return failure(
      ExitCode.Blocked,
      makeFinding(
        "SCHEMA_VERSION_UNSUPPORTED",
        "error",
        formatUnsupportedVersionMessage(error.file, error.kind, error.found, error.supported),
        [`${HERON_DIR}/${error.file}`],
      ),
    );
  }
  if (error instanceof InvalidDocumentError) {
    const finding = makeFinding(
      "DOCUMENT_INVALID",
      "error",
      `${HERON_DIR}/${error.file} is not a valid ${error.kind} document (${error.issues.length} issue(s)); restore it from Git.`,
      [`${HERON_DIR}/${error.file}`],
    );
    return failure(ExitCode.Blocked, { ...finding, issues: error.issues });
  }
  if (error instanceof LockBusyError) {
    const { holder } = error;
    const message =
      holder === null
        ? ".heron/ is locked by another Heron command (owner unreadable)."
        : `.heron/ is locked by "${holder.command}" (pid ${holder.pid} on ${holder.hostname}, run ${holder.runId}, since ${holder.acquiredAt}).`;
    return failure(ExitCode.LockBusy, makeFinding("LOCK_BUSY", "error", message));
  }
  if (error instanceof StateRevisionConflictError) {
    return failure(
      ExitCode.LockBusy,
      makeFinding(
        "LOCK_BUSY",
        "error",
        `.heron/state.json changed during the command (expected revision ${error.expected}, found ${error.found}).`,
      ),
    );
  }
  return null;
}
