import type {
  ExternalContent,
  FetchRecord,
  InputFileRecord,
  SecurityFinding,
} from "../core/contracts/index.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { scanUntrustedText } from "../security/untrusted.ts";
import { displayPath, readInputFile } from "./input-file.ts";
import {
  captureFailure,
  type CapturedFile,
  type CaptureFailure,
  type CaptureServices,
  type InputFileRef,
} from "./ports.ts";

export const PAGE_MEDIA_TYPES = [
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "text/markdown",
] as const;
export const DESIGN_MD_MEDIA_TYPES = ["text/markdown", "text/x-markdown", "text/plain"] as const;
export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

export type TextCapture = {
  content: ExternalContent;
  file: CapturedFile;
  fetch: FetchRecord | null;
  input: InputFileRecord | null; // basename + location when the text came from a local file (D28)
  securityFindings: SecurityFinding[];
};
export type TextResult =
  | { ok: true; capture: TextCapture }
  | { ok: false; failure: CaptureFailure };
export type FetchedTextResult =
  | { ok: true; capture: TextCapture & { fetch: FetchRecord } }
  | { ok: false; failure: CaptureFailure };

/** Fatal UTF-8 decode (a BOM is dropped, which is also how the stored offsets are measured); null when invalid. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Every instruction-shaped phrase and hidden character of `text` as data (R12); nothing reads them to decide. */
function scanFindings(text: string, path: string): SecurityFinding[] {
  return scanUntrustedText(text).findings.map((found) => ({
    code: found.code,
    severity: "warning",
    message:
      found.code === "SUSPICIOUS_INSTRUCTION"
        ? `Instruction-shaped text (${found.rule}) at line ${found.line}, offset ${found.offset}; stored as data and never followed.`
        : `Hidden or bidirectional control character ${found.phrase} at line ${found.line}, offset ${found.offset}.`,
    path,
    offset: found.offset,
    line: found.line,
    phrase: found.phrase,
    rule: found.rule,
  }));
}

/** Stores `bytes` as received (untrusted) under research/sources/{sha256}.{extension}. */
function storeText(
  bytes: Uint8Array,
  text: string,
  mediaType: string,
  extension: "md" | "txt",
): Pick<TextCapture, "content" | "file" | "securityFindings"> {
  const sha256 = sha256Hex(bytes);
  const path = `research/sources/${sha256}.${extension}`;
  return {
    content: { path, sha256, mediaType, bytes: bytes.length, trust: "untrusted" },
    file: { path, sha256, bytes },
    securityFindings: scanFindings(text, path),
  };
}

/** Fetches through the injected SSRF-safe Fetcher; the body must be strict UTF-8. `extension` "by-media-type" stores
 * text/markdown as .md and everything else (HTML included, DR19) as .txt. Never throws. */
export async function fetchExternalText(request: {
  services: CaptureServices;
  url: string;
  allowLocal: boolean;
  accept: readonly string[];
  maxBytes: number;
  extension: "md" | "txt" | "by-media-type";
}): Promise<FetchedTextResult> {
  const result = await request.services.fetcher.fetch({
    url: request.url,
    accept: request.accept,
    maxBytes: request.maxBytes,
    allowLocal: request.allowLocal,
  });
  if (!result.ok) return captureFailure(result.code, result.message);
  const text = decodeUtf8(result.body);
  if (text === null) {
    return captureFailure("UNSUPPORTED_MEDIA_TYPE", `${result.finalUrl} is not valid UTF-8 text.`);
  }
  const extension =
    request.extension === "by-media-type"
      ? result.mediaType === "text/markdown"
        ? "md"
        : "txt"
      : request.extension;
  const stored = storeText(result.body, text, result.mediaType, extension);
  const last = result.hops.at(-1);
  const fetched: FetchRecord = {
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    status: result.status,
    redirects: result.hops.slice(1).map((hop) => hop.url),
    address: last?.address ?? "",
    local: result.local !== null,
  };
  if (result.local !== null) {
    stored.securityFindings.push({
      code: "LOCAL_TARGET_ALLOWED",
      severity: "info",
      message: `Fetched ${result.local.address} (${result.local.range}) because --allow-local was passed.`,
      path: null,
      offset: null,
      line: null,
      phrase: result.local.address,
      rule: result.local.range,
    });
  }
  return { ok: true, capture: { ...stored, fetch: fetched, input: null } };
}

/** A local DESIGN.md (D28): .md or .markdown when it lives outside the repo; one read; stored as .md. Never throws. */
export function readExternalTextFile(request: {
  services: CaptureServices;
  file: InputFileRef;
  maxBytes: number;
}): TextResult {
  const input = readInputFile({
    fs: request.services.fs,
    root: request.services.root,
    file: request.file,
    maxBytes: request.maxBytes,
    externalExtensions: MARKDOWN_EXTENSIONS,
  });
  if (!input.ok) return input;
  const text = decodeUtf8(input.bytes);
  if (text === null) {
    const shown = displayPath(request.file.path);
    return captureFailure("UNSUPPORTED_MEDIA_TYPE", `${shown} is not valid UTF-8 text.`, [shown]);
  }
  const stored = storeText(input.bytes, text, "text/markdown", "md");
  return { ok: true, capture: { ...stored, fetch: null, input: input.record } };
}
