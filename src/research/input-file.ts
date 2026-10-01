import type { InputFileRecord } from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { INPUT_PATH_REASONS, resolveInputFile, UnsafePathError } from "../core/store/paths.ts";
import { captureFailure, type CaptureFailure, type InputFileRef } from "./ports.ts";

export type InputFileResult =
  | { ok: true; bytes: Uint8Array; record: InputFileRecord } // record: basename + location, never a path
  | { ok: false; failure: CaptureFailure }; // UNSAFE_PATH | PATH_NOT_FOUND | INPUT_TOO_LARGE

const MAX_NAME = 255;

/** The raw user path made safe to echo: control characters become "?". */
export function displayPath(path: string): string {
  return [...path].map((ch) => (ch < " " || ch === "\x7f" ? "?" : ch)).join("");
}

/** Basename for InputFileRecord: no control characters or backslash, <= 255 units (filesystems allow no more), never empty. */
function recordName(name: string): string {
  const clean = [...name]
    .map((ch) => (ch < " " || ch === "\x7f" || ch === "\\" ? "?" : ch))
    .join("")
    .slice(0, MAX_NAME);
  return clean === "" ? "file" : clean;
}

const unsafe = (path: string, detail: string): { ok: false; failure: CaptureFailure } =>
  captureFailure("UNSAFE_PATH", `${displayPath(path)} ${detail}`, [displayPath(path)]);

function unsafeMessage(reason: string): string {
  switch (reason) {
    case INPUT_PATH_REASONS.dotdot:
      return 'contains a ".." segment; it was not read.';
    case INPUT_PATH_REASONS.escapingSymlink:
      return "is a symlink that leaves the product repository; it was not read.";
    case INPUT_PATH_REASONS.externalSymlink:
      return "is outside the product repository and is a symlink; pass the file itself.";
    case INPUT_PATH_REASONS.externalNotAllowed:
      return "is outside the product repository; files of a ReferenceBatch must live inside it.";
    default:
      return "is not a valid path; it was not read.";
  }
}

function hasExtension(name: string, extensions: readonly string[]): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && extensions.includes(name.slice(dot).toLowerCase());
}

/** The dedicated read-only probe (D28): resolveInputFile -> lstat regular file (else UNSAFE_PATH) -> external text file
 * without an allowed extension -> UNSAFE_PATH -> size <= maxBytes (before reading) -> one readFileSync. Never writes,
 * never re-reads, never throws. `externalExtensions` null = any (images: magic bytes decide). */
export function readInputFile(request: {
  fs: ReadonlyFs;
  root: string;
  file: InputFileRef;
  maxBytes: number;
  externalExtensions: readonly string[] | null;
}): InputFileResult {
  const { fs, file, maxBytes, externalExtensions } = request;
  let resolved;
  try {
    resolved = resolveInputFile(fs, request.root, file.path, file.base, {
      allowExternal: file.allowExternal,
    });
  } catch (error) {
    if (error instanceof UnsafePathError) return unsafe(file.path, unsafeMessage(error.reason));
    return unsafe(file.path, "could not be resolved; it was not read.");
  }
  if (resolved === null) {
    return captureFailure("PATH_NOT_FOUND", `File not found: ${displayPath(file.path)}`, [
      displayPath(file.path),
    ]);
  }
  let size: number;
  try {
    const stat = fs.lstatSync(resolved.realPath);
    if (!stat.isFile()) return unsafe(file.path, "is not a regular file; it was not read.");
    size = stat.size;
  } catch {
    return unsafe(file.path, "could not be read.");
  }
  if (
    resolved.location === "external" &&
    externalExtensions !== null &&
    !hasExtension(resolved.name, externalExtensions)
  ) {
    return unsafe(
      file.path,
      `is outside the product repository and is not a ${externalExtensions.join(" or ")} file; it was not read.`,
    );
  }
  if (size > maxBytes) {
    return captureFailure(
      "INPUT_TOO_LARGE",
      `${displayPath(file.path)} exceeds ${maxBytes} bytes.`,
      [displayPath(file.path)],
    );
  }
  try {
    return {
      ok: true,
      bytes: fs.readFileSync(resolved.realPath),
      record: { name: recordName(resolved.name), location: resolved.location },
    };
  } catch {
    return unsafe(file.path, "could not be read.");
  }
}
