import { dirname, join } from "node:path";
import {
  HERON_STATE_DOCUMENT,
  InvalidDocumentError,
  RunIdSchema,
  canonicalJson,
  parseVersionedDocument,
  type DocumentSpec,
  type HeronState,
  type RelativeArtifactPath,
  type RunId,
  type Sha256Hex,
} from "../contracts/index.ts";
import { fsyncDir, writeAtomic } from "./atomic.ts";
import { errorCode, type FsPort } from "./fs-port.ts";
import { sha256Hex } from "./hash.ts";
import { UnsafePathError, assertSafeRelativePath, resolveInside } from "./paths.ts";

export const HERON_DIR = ".heron";
export const STATE_FILE = "state.json";
export const PROJECT_FILE = "project.json";
export const MODE_FILE = "intake/mode.json";
export const GITIGNORE_FILE = ".gitignore";
export const STAGING_DIR = "staging";
export const LOCK_FILE = ".lock";
export const LOCK_RECLAIM_FILE = ".lock.reclaim";
export const HERON_GITIGNORE: string = [
  "# Managed by Heron. Local-only paths; everything else in .heron/ is versioned.",
  "/.lock",
  "/.lock.reclaim",
  "/staging/",
  "/cache/",
  "/logs/",
  "/penpot/snapshots/",
  "",
].join("\n");

const RESERVED_TOP_LEVEL: readonly string[] = [STAGING_DIR, LOCK_FILE, LOCK_RECLAIM_FILE];

export class DanglingArtifactError extends Error {
  readonly paths: RelativeArtifactPath[];
  constructor(paths: RelativeArtifactPath[]) {
    super(`state references artifacts that are missing or differ: ${paths.join(", ")}`);
    this.name = "DanglingArtifactError";
    this.paths = paths;
  }
}

export class StateRevisionConflictError extends Error {
  readonly expected: number;
  readonly found: number;
  constructor(expected: number, found: number) {
    super(`state.json is at revision ${found}, expected ${expected}; another command changed it`);
    this.name = "StateRevisionConflictError";
    this.expected = expected;
    this.found = found;
  }
}

export type CommitResult = {
  stateRevision: number;
  stateSha256: Sha256Hex;
  promoted: RelativeArtifactPath[];
};

export interface StoreTransaction {
  readonly runId: RunId;
  put(path: RelativeArtifactPath, content: string | Uint8Array): Sha256Hex;
  /** Validates against the spec, then writes canonical JSON. */
  putDocument<T>(path: RelativeArtifactPath, spec: DocumentSpec<T>, value: T): Sha256Hex;
  /** DP3 order. expectedRevision: 0 when no state.json exists yet. */
  commit(state: HeronState, expectedRevision: number): CommitResult;
  abort(): void;
}

export interface FileStore {
  readonly repoRoot: string;
  readonly heronDir: string;
  exists(path: RelativeArtifactPath): boolean;
  readBytes(path: RelativeArtifactPath): Uint8Array | null;
  sha256(path: RelativeArtifactPath): Sha256Hex | null;
  /** null when absent; throws UnsupportedSchemaVersionError | InvalidDocumentError. */
  readDocument<T>(path: RelativeArtifactPath, spec: DocumentSpec<T>): T | null;
  begin(runId: RunId): StoreTransaction;
  recoverOrphanStaging(currentRunId: RunId): RunId[];
}

function lstatOrNull(fs: FsPort, path: string): ReturnType<FsPort["lstatSync"]> | null {
  try {
    return fs.lstatSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

/** create=false: never writes. create=true: mkdir .heron if absent. Throws UnsafePathError if .heron exists
 * and is not a real directory (symlink or file). */
export function openFileStore(
  fs: FsPort,
  repoRoot: string,
  options: { create: boolean },
): FileStore {
  const realRoot = fs.realpathSync(repoRoot);
  const heronDir = join(realRoot, HERON_DIR);
  const stat = lstatOrNull(fs, heronDir);
  if (stat !== null && (stat.isSymbolicLink() || !stat.isDirectory())) {
    throw new UnsafePathError(HERON_DIR, ".heron must be a real directory, not a symlink or file");
  }
  if (stat === null && options.create) fs.mkdirSync(heronDir, { recursive: true });

  const present = (): boolean => lstatOrNull(fs, heronDir) !== null;
  const locate = (path: RelativeArtifactPath): string => resolveInside(fs, heronDir, path);

  const assertWritable = (path: RelativeArtifactPath): void => {
    assertSafeRelativePath(path);
    const top = path.split("/")[0] ?? "";
    if (RESERVED_TOP_LEVEL.includes(top) || path === STATE_FILE) {
      throw new UnsafePathError(path, "reserved path");
    }
    locate(path); // confinement check (symlink escape)
  };

  const readBytes = (path: RelativeArtifactPath): Uint8Array | null => {
    if (!present()) return null;
    const abs = locate(path);
    const s = lstatOrNull(fs, abs);
    if (s === null || !s.isFile()) return null;
    return fs.readFileSync(abs);
  };

  const readDocument = <T>(path: RelativeArtifactPath, spec: DocumentSpec<T>): T | null => {
    const bytes = readBytes(path);
    if (bytes === null) return null;
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new InvalidDocumentError(path, spec.kind, [{ pointer: "", message: "not valid JSON" }]);
    }
    return parseVersionedDocument(raw, spec, path);
  };

  const begin = (runId: RunId): StoreTransaction => {
    if (!RunIdSchema.safeParse(runId).success) {
      throw new UnsafePathError(runId, "invalid run id");
    }
    if (!present()) throw new Error(".heron does not exist; open the store with create: true");
    const stagingRoot = join(heronDir, STAGING_DIR, runId);
    const staged = new Map<RelativeArtifactPath, Sha256Hex>();
    let counter = 0;
    let closed = false;
    const assertOpen = (): void => {
      if (closed) throw new Error("transaction is already closed");
    };
    const stage = (path: RelativeArtifactPath, content: string | Uint8Array): Sha256Hex => {
      assertOpen();
      assertWritable(path);
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      counter += 1;
      writeAtomic(fs, join(stagingRoot, "files", ...path.split("/")), bytes, {
        tmpDir: join(stagingRoot, "tmp"),
        tmpName: `${counter}.tmp`,
      });
      const sha = sha256Hex(bytes);
      staged.set(path, sha);
      return sha;
    };

    return {
      runId,
      put: stage,
      putDocument<T>(path: RelativeArtifactPath, spec: DocumentSpec<T>, value: T): Sha256Hex {
        const valid = parseVersionedDocument(value, spec, path);
        return stage(path, canonicalJson(valid));
      },
      commit(state: HeronState, expectedRevision: number): CommitResult {
        assertOpen();
        const next = parseVersionedDocument(state, HERON_STATE_DOCUMENT, STATE_FILE);
        const onDisk = readDocument(STATE_FILE, HERON_STATE_DOCUMENT);
        const found = onDisk?.stateRevision ?? 0;
        if (found !== expectedRevision)
          throw new StateRevisionConflictError(expectedRevision, found);

        const dangling: RelativeArtifactPath[] = [];
        for (const artifact of next.artifacts) {
          const sha = staged.get(artifact.path) ?? store.sha256(artifact.path);
          if (sha !== artifact.sha256) dangling.push(artifact.path);
        }
        if (dangling.length > 0) throw new DanglingArtifactError(dangling.toSorted());

        const promoted = [...staged.keys()].toSorted();
        for (const path of promoted) {
          const target = locate(path);
          fs.mkdirSync(dirname(target), { recursive: true });
          fs.renameSync(join(stagingRoot, "files", ...path.split("/")), target);
          fsyncDir(fs, dirname(target));
        }
        const stateBytes = new TextEncoder().encode(canonicalJson(next));
        writeAtomic(fs, join(heronDir, STATE_FILE), stateBytes, {
          tmpDir: join(stagingRoot, "tmp"),
          tmpName: "state.json.tmp",
        });
        closed = true;
        fs.rmSync(stagingRoot, { recursive: true, force: true });
        return { stateRevision: next.stateRevision, stateSha256: sha256Hex(stateBytes), promoted };
      },
      abort(): void {
        closed = true;
        fs.rmSync(stagingRoot, { recursive: true, force: true });
      },
    };
  };

  const recoverOrphanStaging = (currentRunId: RunId): RunId[] => {
    const dir = join(heronDir, STAGING_DIR);
    if (!present() || lstatOrNull(fs, dir) === null) return [];
    const removed: RunId[] = [];
    for (const entry of fs.readdirSync(dir).toSorted()) {
      if (entry === currentRunId) continue;
      fs.rmSync(join(dir, entry), { recursive: true, force: true });
      removed.push(entry);
    }
    return removed;
  };

  const store: FileStore = {
    repoRoot: realRoot,
    heronDir,
    exists: (path) => readBytes(path) !== null,
    readBytes,
    sha256: (path) => {
      const bytes = readBytes(path);
      return bytes === null ? null : sha256Hex(bytes);
    },
    readDocument,
    begin,
    recoverOrphanStaging,
  };
  return store;
}
