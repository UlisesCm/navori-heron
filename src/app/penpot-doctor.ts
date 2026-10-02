import {
  ExitCode,
  DOCTOR_CHECK_IDS,
  HERON_PROJECT_DOCUMENT,
  type DoctorCheck,
  type DoctorCheckId,
  type DoctorData,
  type HeronProject,
} from "../core/contracts/index.ts";
import { openFileStore, PROJECT_FILE } from "../core/store/file-store.ts";
import type { PenpotFailure } from "../penpot/ports.ts";
import type { AppContext } from "./context.ts";
import { penpotRedactor, resolvePenpotKey, resolvePenpotUrl } from "./penpot-config.ts";
import { penpotFailureResult, withPenpotSession } from "./penpot-session.ts";
import { penpotFileMismatch, penpotVersionFindings } from "./penpot.ts";
import { resolveDirectory, type UseCaseResult } from "./result.ts";

const CHECKS = DOCTOR_CHECK_IDS.filter((id): id is Extract<DoctorCheckId, `penpot.${string}`> =>
  id.startsWith("penpot."),
);
type PenpotCheckId = (typeof CHECKS)[number];
const REMEDIES: Record<PenpotFailure["kind"], string> = {
  unreachable: "Check PENPOT_URL and that your Penpot server is running.",
  rejected: "Create a new MCP key in Your account → Integrations → MCP Server.",
  incompatible: "Use a tested Penpot version with execute_code (docs/penpot.md).",
  "plugin-not-connected":
    "Open the bound file and press Main menu → MCP Server → Connect (one tab only); check that the key matches.",
  timeout: "Keep the Penpot tab in the foreground and try again.",
  "script-failed": "Reconnect the bound file's MCP plugin and try again.",
};

/** Seven ordered checks; one handshake and one inspection; no logger, lock or local writes. */
export async function penpotChecks(
  ctx: AppContext,
  project: HeronProject | null,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const push = (
    id: PenpotCheckId,
    status: DoctorCheck["status"],
    message: string,
    remedy: string | null = null,
    started: number = ctx.clock.now().getTime(),
  ): void => {
    checks.push({
      id,
      kind: id === "penpot.config" || id === "penpot.file" ? "workspace" : "dependency",
      status,
      message,
      remedy,
      durationMs: Math.max(0, ctx.clock.now().getTime() - started),
    });
  };
  const complete = (): DoctorCheck[] => {
    const failed = checks.find((check) => check.status === "FAIL");
    for (const id of CHECKS)
      if (!checks.some((check) => check.id === id))
        push(id, "WARNING", `Skipped: ${failed?.id ?? "a prior check"} failed.`);
    return checks;
  };
  const fileId = project?.penpot.enabled ? project.penpot.fileId : null;
  if (fileId == null) {
    push(
      "penpot.config",
      "FAIL",
      "This workspace is not linked to Penpot.",
      "Run: heron penpot link [path]",
    );
    return complete();
  }
  push("penpot.config", "PASS", "Workspace has a bound Penpot file.");
  const url = resolvePenpotUrl(ctx);
  if (!url.ok) {
    push(
      "penpot.url",
      "FAIL",
      url.result.findings[0]?.message ?? "Invalid PENPOT_URL.",
      "Set PENPOT_URL to your Penpot address (docs/penpot.md).",
    );
    return complete();
  }
  push("penpot.url", "PASS", "PENPOT_URL is a valid local destination.");
  const key = resolvePenpotKey(ctx);
  if (!key.ok) {
    push(
      "penpot.key",
      "FAIL",
      key.result.findings[0]?.message ?? "No MCP key.",
      "Set PENPOT_MCP_KEY or PENPOT_MCP_KEY_FILE.",
    );
    return complete();
  }
  push(
    "penpot.key",
    key.warnings.length > 0 ? "WARNING" : "PASS",
    key.warnings[0]?.message ?? "A local MCP key is available.",
    key.warnings.length > 0 ? "Run chmod 600 on the MCP key file." : null,
  );
  const redact = penpotRedactor(ctx, key.key);
  const started = ctx.clock.now().getTime();
  const result = await withPenpotSession(
    ctx,
    {
      baseUrl: url.baseUrl,
      key: key.key,
      command: "penpot doctor",
      runId: ctx.ids.runId(ctx.clock.now()),
      log: false,
    },
    async (session) => {
      push("penpot.mcp", "PASS", "MCP handshake and execute_code are available.", null, started);
      const readStarted = ctx.clock.now().getTime();
      const inspected = await session.inspect(ctx.penpot.readTimeoutMs);
      if (!inspected.ok || inspected.value.file === null) {
        const error: PenpotFailure = inspected.ok
          ? { kind: "plugin-not-connected", detail: "No file connected" }
          : inspected.failure;
        const mapped = penpotFailureResult(error, {
          template: "inspect@v1",
          timeoutMs: ctx.penpot.readTimeoutMs,
        });
        push(
          "penpot.plugin",
          "FAIL",
          mapped.ok ? "Penpot inspection failed." : mapped.message,
          REMEDIES[error.kind],
          readStarted,
        );
        return { ok: true, data: null, findings: [], next: [] };
      }
      push("penpot.plugin", "PASS", "The connected plugin answered inspect@v1.", null, readStarted);
      if (inspected.value.file.id !== fileId) {
        push(
          "penpot.file",
          "FAIL",
          redact(penpotFileMismatch(inspected.value.file, fileId, "error").message),
          "Open the bound file or run heron penpot link again.",
        );
        return { ok: true, data: null, findings: [], next: [] };
      }
      push(
        "penpot.file",
        "PASS",
        `Connected to the bound file: ${redact(inspected.value.file.name)}.`,
      );
      const findings = penpotVersionFindings(redact(inspected.value.penpotVersion));
      push(
        "penpot.version",
        findings.length > 0 ? "WARNING" : "PASS",
        findings[0]?.message ?? `Penpot ${redact(inspected.value.penpotVersion)} is tested.`,
        findings.length > 0 ? "See the tested versions in docs/penpot.md." : null,
      );
      return { ok: true, data: null, findings: [], next: [] };
    },
  );
  if (!result.ok) {
    const id = checks.some((check) => check.id === "penpot.mcp") ? "penpot.plugin" : "penpot.mcp";
    const code = result.findings[0]?.code;
    const remedy =
      code === "PENPOT_KEY_REJECTED"
        ? REMEDIES.rejected
        : code === "PENPOT_TIMEOUT"
          ? REMEDIES.timeout
          : code === "PENPOT_MCP_INCOMPATIBLE"
            ? REMEDIES.incompatible
            : REMEDIES.unreachable;
    push(id, "FAIL", redact(result.message), remedy, started);
  }
  return complete();
}

/** Dedicated doctor reports an unlinked workspace as FAIL (4), unlike the optional checks in general doctor. */
export async function runPenpotDoctor(
  ctx: AppContext,
  input: { path: string },
): Promise<UseCaseResult<DoctorData>> {
  let project: HeronProject | null = null;
  try {
    const root = resolveDirectory(ctx.fs, input.path);
    if (root !== null)
      project = openFileStore(ctx.fs, root, { create: false }).readDocument(
        PROJECT_FILE,
        HERON_PROJECT_DOCUMENT,
      );
  } catch {
    // An absent or invalid workspace fails penpot.config without echoing filesystem errors.
  }
  const checks = await penpotChecks(ctx, project);
  const failed = checks.filter((check) => check.status === "FAIL");
  const data: DoctorData = { checks };
  if (failed.length === 0) return { ok: true, data, findings: [], next: [] };
  return {
    ok: false,
    code: failed.some((check) => check.kind === "dependency")
      ? ExitCode.DependencyUnavailable
      : ExitCode.ValidationFailed,
    message: `${failed.length} check(s) failed: ${failed.map((check) => check.id).join(", ")}.`,
    findings: [],
    data,
  };
}
