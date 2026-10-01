import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A private scratch directory under the OS temp dir (ADR 0002, zone 3). */
export interface TempWorkspace {
  /** Realpath of a fresh 0700 directory. */
  readonly path: string;
  /** Writes `data` as a 0600 file; `name` is a flat file name. Returns the absolute path. */
  writeFile(name: string, data: string): string;
  /** File content, or null when absent or unreadable. */
  readFile(name: string): string | null;
  /** Recursive removal; errors ignored; idempotent. */
  dispose(): void;
}

export interface TempDirPort {
  create(prefix: string): TempWorkspace;
}

const PREFIX_RE = /^[a-z][a-z0-9-]{0,31}$/;
const NAME_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

function checkName(name: string): void {
  if (!NAME_RE.test(name) || name.includes("..")) {
    throw new Error(`invalid temp file name: ${JSON.stringify(name)}`);
  }
}

/** Real implementation: `mkdtemp` in `os.tmpdir()` (0700), files written 0600. */
export const nodeTempDirs: TempDirPort = {
  create(prefix) {
    if (!PREFIX_RE.test(prefix)) {
      throw new Error(`invalid temp dir prefix: ${JSON.stringify(prefix)}`);
    }
    const path = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
    return {
      path,
      writeFile(name, data) {
        checkName(name);
        const target = join(path, name);
        writeFileSync(target, data, { mode: 0o600 });
        return target;
      },
      readFile(name) {
        checkName(name);
        try {
          return readFileSync(join(path, name), "utf8");
        } catch {
          return null;
        }
      },
      dispose() {
        try {
          rmSync(path, { recursive: true, force: true });
        } catch {
          // best effort: a leftover temp dir holds no secrets (design §Failure modes)
        }
      },
    };
  },
};
