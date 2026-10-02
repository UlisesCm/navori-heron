import { resolve } from "node:path";
import { ExitCode, type Finding, type HeronProject } from "../core/contracts/index.ts";
import { parsePenpotUrl } from "../penpot/config.ts";
import { createValueRedactor, redactUrl, REDACTED } from "../security/redact.ts";
import type { AppContext } from "./context.ts";
import { failure, makeFinding, type UseCaseResult } from "./result.ts";

type InvalidConfig = { ok: false; result: UseCaseResult<never> };
function invalid(message: string): InvalidConfig {
  return {
    ok: false,
    result: failure(ExitCode.Usage, makeFinding("PENPOT_CONFIG_INVALID", "error", message)),
  };
}
/** Never consult workspace data for the destination of a credential. */
export function resolvePenpotUrl(ctx: AppContext): { ok: true; baseUrl: string } | InvalidConfig {
  const raw = ctx.env["PENPOT_URL"];
  if (raw === undefined || raw === "")
    return {
      ok: false,
      result: failure(
        ExitCode.DependencyUnavailable,
        makeFinding(
          "PENPOT_URL_MISSING",
          "error",
          "PENPOT_URL is not set: export the address of your Penpot (for example http://localhost:9001). Heron never takes it from the workspace.",
        ),
      ),
    };
  const parsed = parsePenpotUrl(raw);
  if (parsed.ok) return parsed;
  if (parsed.reason === "user-token")
    return invalid(
      "PENPOT_URL carries a userToken; set it to the Penpot address and export the key as PENPOT_MCP_KEY.",
    );
  if (parsed.reason === "mcp-path")
    return invalid("PENPOT_URL must be the Penpot address, not its /mcp/stream endpoint.");
  if (parsed.reason === "host")
    return invalid("PENPOT_URL points to a link-local, metadata or reserved address.");
  return invalid(
    "PENPOT_URL must be https (http only for localhost or a loopback address) without credentials, query or fragment.",
  );
}

const MAX_KEY_BYTES = 8_192;
type ResolvedKey = { ok: true; key: string; warnings: Finding[] } | InvalidConfig;
/** Read local env/key file only. Error messages never echo paths, content or raw filesystem exceptions. */
export function resolvePenpotKey(ctx: AppContext): ResolvedKey {
  const direct = ctx.env["PENPOT_MCP_KEY"];
  const file = ctx.env["PENPOT_MCP_KEY_FILE"];
  if (direct !== undefined && file !== undefined)
    return invalid("Set either PENPOT_MCP_KEY or PENPOT_MCP_KEY_FILE, not both.");
  if (direct === undefined && file === undefined)
    return {
      ok: false,
      result: failure(
        ExitCode.DependencyUnavailable,
        makeFinding(
          "PENPOT_KEY_MISSING",
          "error",
          "No MCP key: set PENPOT_MCP_KEY or PENPOT_MCP_KEY_FILE (Penpot: Your account → Integrations → MCP Server).",
        ),
      ),
    };
  let raw = direct;
  const warnings: Finding[] = [];
  if (file !== undefined) {
    if (!file.trim()) return invalid("PENPOT_MCP_KEY_FILE could not be read or is empty.");
    try {
      const path = ctx.fs.realpathSync(resolve(ctx.cwd, file));
      const stat = ctx.fs.lstatSync(path);
      if (!stat.isFile() || stat.size > MAX_KEY_BYTES)
        return invalid("PENPOT_MCP_KEY_FILE could not be read or is empty.");
      const bytes = ctx.fs.readFileSync(path);
      if (bytes.byteLength > MAX_KEY_BYTES)
        return invalid("PENPOT_MCP_KEY_FILE could not be read or is empty.");
      raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if ((stat.mode & 0o077) !== 0)
        warnings.push(
          makeFinding(
            "PENPOT_KEY_FILE_PERMISSIONS",
            "warning",
            "PENPOT_MCP_KEY_FILE is readable by other users; run chmod 600 on it.",
          ),
        );
    } catch {
      return invalid("PENPOT_MCP_KEY_FILE could not be read or is empty.");
    }
  }
  const key = raw?.trim() ?? "";
  // A pasted whole stream URL is not a key. Reject controls, but retain spaces inside opaque credentials.
  if (
    !key ||
    new TextEncoder().encode(raw).byteLength > MAX_KEY_BYTES ||
    // oxlint-disable-next-line no-control-regex -- reject control bytes in local credentials before transport
    /[\u0000-\u001f\u007f]/.test(key) ||
    /^https?:\/\//i.test(key)
  )
    return invalid(
      file !== undefined
        ? "PENPOT_MCP_KEY_FILE could not be read or is empty."
        : "The Penpot MCP key must be nonempty, at most 8192 bytes, and contain no controls or URL.",
    );
  return { ok: true, key, warnings };
}

export type PenpotLink = { fileId: string };
export function readPenpotLink(
  project: HeronProject,
  path: string,
): { ok: true; link: PenpotLink } | InvalidConfig {
  return project.penpot.enabled && project.penpot.fileId !== null
    ? { ok: true, link: { fileId: project.penpot.fileId } }
    : {
        ok: false,
        result: failure(
          ExitCode.Blocked,
          makeFinding(
            "PENPOT_NOT_CONFIGURED",
            "error",
            `This workspace is not linked to Penpot. Run: heron penpot link ${path}`,
          ),
        ),
      };
}

/** Compose value and URL redaction; even short opaque keys (below the general redactor's threshold) stay secret. */
export function penpotRedactor(ctx: AppContext, key: string): (text: string) => string {
  const values = createValueRedactor(ctx.env, [key]);
  const short =
    key.length > 0 && key.length < 8
      ? [...new Set([key, JSON.stringify(key).slice(1, -1), encodeURIComponent(key)])].toSorted(
          (a, b) => b.length - a.length,
        )
      : [];
  return (text: string): string => {
    let clean = text.replace(/https?:\/\/[^\s"'<>]+/gi, (url: string): string => {
      try {
        return redactUrl(new URL(url));
      } catch {
        return REDACTED;
      }
    });
    clean = values.redact(clean).text;
    for (const value of short) clean = clean.replaceAll(value, REDACTED);
    return clean;
  };
}
