import type { Finding, Sha256Hex } from "../core/contracts/index.ts";
import type { ReadonlyFs } from "../core/store/fs-port.ts";
import { sha256Hex } from "../core/store/hash.ts";
import { resolveInside, UnsafePathError } from "../core/store/paths.ts";
import type { InputLimits } from "./ports.ts";

export type FileProbe = {
  path: string;
  present: boolean;
  sha256: Sha256Hex | null;
  bytes: Uint8Array | null;
  finding: Finding | null;
};

function warn(code: Finding["code"], path: string, message: string): Finding {
  return { code, severity: "warning", message, paths: [path], issues: [] };
}

function absent(path: string, finding: Finding | null = null): FileProbe {
  return { path, present: false, sha256: null, bytes: null, finding };
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fatal UTF-8 decode; null when the bytes are not valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Symlink escaping root or non-regular file -> UNSAFE_PATH; size > maxInputBytes -> INPUT_TOO_LARGE;
 * both report present = false. A missing file is simply absent. Never throws. */
export function probeFile(
  fs: ReadonlyFs,
  root: string,
  relativePath: string,
  limits: InputLimits,
): FileProbe {
  const unsafe = (): FileProbe =>
    absent(
      relativePath,
      warn(
        "UNSAFE_PATH",
        relativePath,
        `${relativePath} resolves outside the repository or is not a regular path; it is ignored.`,
      ),
    );
  let resolved: string;
  try {
    resolved = resolveInside(fs, root, relativePath);
  } catch (error) {
    return error instanceof UnsafePathError ? unsafe() : absent(relativePath);
  }
  let size: number;
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile()) return unsafe();
    size = stat.size;
  } catch {
    return absent(relativePath);
  }
  if (size > limits.maxInputBytes) {
    return absent(
      relativePath,
      warn(
        "INPUT_TOO_LARGE",
        relativePath,
        `${relativePath} exceeds ${limits.maxInputBytes} bytes; it is ignored.`,
      ),
    );
  }
  try {
    const bytes = fs.readFileSync(resolved);
    return { path: relativePath, present: true, sha256: sha256Hex(bytes), bytes, finding: null };
  } catch (error) {
    return absent(
      relativePath,
      warn(
        "HARNESS_UNREADABLE",
        relativePath,
        `${relativePath} could not be read: ${reason(error)}.`,
      ),
    );
  }
}
