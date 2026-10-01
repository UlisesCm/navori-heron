// Covers: R10, R12
import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGate } from "../../src/app/gate.ts";
import { runInit } from "../../src/app/init.ts";
import {
  ExitCode,
  HERON_STATE_DOCUMENT,
  HeronStateSchema,
  InvalidDocumentError,
  canonicalJson,
  type HeronMode,
  type HeronState,
  type RunId,
} from "../../src/core/contracts/index.ts";
import { createInitialState, recordInit } from "../../src/core/state/lifecycle.ts";
import type { TransitionMeta } from "../../src/core/state/transitions.ts";
import { writeAtomic } from "../../src/core/store/atomic.ts";
import {
  DanglingArtifactError,
  GITIGNORE_FILE,
  HERON_GITIGNORE,
  MODE_FILE,
  PROJECT_FILE,
  StateRevisionConflictError,
  openFileStore,
} from "../../src/core/store/file-store.ts";
import { nodeFs } from "../../src/core/store/fs-port.ts";
import { sha256File, sha256Hex } from "../../src/core/store/hash.ts";
import {
  DEFAULT_LOCK_OPTIONS,
  LockBusyError,
  acquireLock,
  defaultIsProcessAlive,
  isLockStale,
  readLockOwner,
  type LockOptions,
  type LockOwner,
} from "../../src/core/store/lock.ts";
import {
  UnsafePathError,
  assertSafeRelativePath,
  resolveInside,
  toPosixRelative,
} from "../../src/core/store/paths.ts";
import { fixedContext } from "../helpers/cli.ts";
import { withFaultInjection } from "../helpers/faulty-fs.ts";
import { copyFixture } from "../helpers/fixtures.ts";

const tmpDirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "heron-store-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const RUN_A: RunId = "run-20260930T120000Z-aaaaaaaa";
const RUN_B: RunId = "run-20260930T120100Z-bbbbbbbb";
const RUN_C: RunId = "run-20260930T120200Z-cccccccc";

function metaFor(runId: RunId): TransitionMeta {
  return { runId, at: "2026-09-30T12:00:00.000Z", command: "init", heronVersion: "0.0.0" };
}

/** Init-like transaction: artifacts first, state.json last. */
function fakeInit(
  fs: Parameters<typeof openFileStore>[0],
  root: string,
  mode: HeronMode,
  runId: RunId,
  previous: HeronState | null,
): void {
  const store = openFileStore(fs, root, { create: true });
  store.recoverOrphanStaging(runId);
  const tx = store.begin(runId);
  tx.put(GITIGNORE_FILE, HERON_GITIGNORE);
  const modeSha = tx.put(MODE_FILE, canonicalJson({ mode, runId }));
  const projectSha = tx.put(PROJECT_FILE, canonicalJson({ name: "demo", mode }));
  const input = {
    mode,
    artifacts: [
      { path: MODE_FILE, sha256: modeSha },
      { path: PROJECT_FILE, sha256: projectSha },
    ],
    meta: metaFor(runId),
  };
  const state = previous === null ? createInitialState(input) : recordInit(previous, input);
  tx.commit(state, previous?.stateRevision ?? 0);
}

function readState(root: string): HeronState | null {
  return openFileStore(nodeFs, root, { create: false }).readDocument(
    "state.json",
    HERON_STATE_DOCUMENT,
  );
}

function expectConsistent(root: string): void {
  const store = openFileStore(nodeFs, root, { create: false });
  const raw = store.readBytes("state.json");
  if (raw === null) return; // first init that never committed
  const state = HeronStateSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  for (const artifact of state.artifacts) expect(store.exists(artifact.path)).toBe(true);
}

function lockOptions(over: Partial<LockOptions> = {}): LockOptions {
  return {
    ...DEFAULT_LOCK_OPTIONS,
    hostname: "host-a",
    now: () => Date.now(),
    isProcessAlive: () => true,
    ...over,
  };
}
function ownerOf(over: Partial<LockOwner> = {}): LockOwner {
  return {
    runId: RUN_A,
    pid: 4242,
    hostname: "host-a",
    command: "init",
    acquiredAt: new Date().toISOString(),
    ...over,
  };
}
function heronDirIn(root: string): string {
  const dir = join(root, ".heron");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const prepared = async (): Promise<string> => {
  const root = copyFixture("membership-product");
  tmpDirs.push(root);
  await runInit(fixedContext(), { path: root, stage: null, dryRun: false, locale: null });
  return root;
};

describe("store", () => {
  test("keeps a consistent state on injected failures and rejects a second writer", async () => {
    // Count K mutating calls in a successful first init.
    const counting = tmp();
    const counter = withFaultInjection(nodeFs, null);
    fakeInit(counter.fs, counting, "full", RUN_A, null);
    const k1 = counter.mutations();
    expect(k1).toBeGreaterThan(5);

    for (let n = 1; n <= k1; n++) {
      const root = tmp();
      const faulty = withFaultInjection(nodeFs, n);
      expect(() => fakeInit(faulty.fs, root, "full", RUN_A, null)).toThrow();
      expectConsistent(root);
      const committed = readState(root); // the crash may have happened after the commit point
      fakeInit(nodeFs, root, "full", RUN_B, committed);
      expect(readState(root)?.stateRevision).toBe(committed === null ? 1 : 2);
      expect(existsSync(join(root, ".heron", "staging", RUN_A))).toBe(false);
    }

    // Re-init with a changed mode.
    const base = tmp();
    fakeInit(nodeFs, base, "full", RUN_A, null);
    const first = readState(base);
    if (first === null) throw new Error("expected state");
    const counting2 = tmp();
    fakeInit(nodeFs, counting2, "full", RUN_A, null);
    const c2 = withFaultInjection(nodeFs, null);
    fakeInit(c2.fs, counting2, "reference-only", RUN_B, first);
    const k2 = c2.mutations();
    for (let n = 1; n <= k2; n++) {
      const root = tmp();
      fakeInit(nodeFs, root, "full", RUN_A, null);
      const faulty = withFaultInjection(nodeFs, n);
      expect(() => fakeInit(faulty.fs, root, "reference-only", RUN_B, first)).toThrow();
      expectConsistent(root);
      const after = readState(root);
      expect([1, 2]).toContain(after?.stateRevision ?? 0);
      const latest = readState(root);
      if (latest === null) throw new Error("expected state");
      fakeInit(nodeFs, root, "reference-only", RUN_C, latest);
      expect(readState(root)?.stateRevision).toBe(latest.stateRevision + 1);
      expect(readState(root)?.mode).toBe("reference-only");
    }

    // Second writer: a real `bun bin/heron.ts init` exits 6 within 1 s while the lock is held.
    const root = tmp();
    const dir = heronDirIn(root);
    const { handle } = acquireLock(nodeFs, dir, ownerOf({ pid: process.pid }), lockOptions());
    const started = performance.now();
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "..", "..", "bin", "heron.ts"), "init", root],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    const code = await child.exited;
    expect(performance.now() - started).toBeLessThan(1000);
    expect(code).toBe(ExitCode.LockBusy);
    handle.release();
    expect(existsSync(join(dir, ".lock"))).toBe(false);
  }, 30_000); // bound by real fsync calls in the fault-injection loop (~2·K inits + spawned CLI): observed 5–7 s vs Bun's 5 s default

  test("keeps a consistent state when gate crashes at every write point", async () => {
    const GATE_INPUT = {
      gate: "intake",
      decision: "reject",
      note: null,
      reason: "needs more context",
      yes: true,
    } as const;
    const counting = withFaultInjection(nodeFs, null);
    const base = await prepared();
    expect(
      (await runGate(fixedContext({ fs: counting.fs }), { path: base, ...GATE_INPUT })).ok,
    ).toBe(true);
    const total = counting.mutations();
    expect(total).toBeGreaterThan(5);

    for (let n = 1; n <= total; n++) {
      const root = await prepared();
      const faulty = withFaultInjection(nodeFs, n);
      await expect(
        runGate(fixedContext({ fs: faulty.fs }), { path: root, ...GATE_INPUT }),
      ).rejects.toThrow();
      expectConsistent(root);
      const committed = readState(root)?.stateRevision ?? 0;
      // A dead pid left the lock behind; the next gate reclaims it and recovers the orphan staging.
      const retry = await runGate(
        fixedContext({
          ids: { runId: () => RUN_B },
          lock: { ...DEFAULT_LOCK_OPTIONS, corruptGraceMs: 0, isProcessAlive: () => false },
        }),
        { path: root, ...GATE_INPUT },
      );
      expect(retry.ok ? "ok" : `${n}: ${retry.message}`).toBe("ok");
      expect(readState(root)?.stateRevision).toBe(committed + 1);
      expect(existsSync(join(root, ".heron", ".lock"))).toBe(false);
      const staging = join(root, ".heron", "staging");
      expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
    }
  }, 60_000); // real fsync calls: one init and two gates per injected write point

  test("reclaims a lock whose pid is dead on the same host", () => {
    const dir = heronDirIn(tmp());
    acquireLock(nodeFs, dir, ownerOf({ pid: 999_999 }), lockOptions());
    const result = acquireLock(
      nodeFs,
      dir,
      ownerOf({ runId: RUN_B, pid: 1 }),
      lockOptions({ isProcessAlive: () => false }),
    );
    expect(result.reclaimed?.runId).toBe(RUN_A);
    expect(readLockOwner(nodeFs, dir)?.runId).toBe(RUN_B);
    expect(existsSync(join(dir, ".lock.reclaim"))).toBe(false);
    result.handle.release();
  });

  test("treats an unreadable lock as busy until the grace period passes", () => {
    const dir = heronDirIn(tmp());
    const lock = join(dir, ".lock");
    writeFileSync(lock, "{not json");
    const mtime = Date.now();
    const fresh = lockOptions({ now: () => mtime + 1_000 });
    expect(() => acquireLock(nodeFs, dir, ownerOf(), fresh)).toThrow(LockBusyError);
    const expired = lockOptions({ now: () => mtime + 31_000 });
    const result = acquireLock(nodeFs, dir, ownerOf(), expired);
    expect(result.reclaimed).toBeNull();
    expect(readLockOwner(nodeFs, dir)?.runId).toBe(RUN_A);
  });

  test("reclaims an orphan .lock.reclaim mutex after the grace period", () => {
    const dir = heronDirIn(tmp());
    acquireLock(nodeFs, dir, ownerOf({ pid: 999_999 }), lockOptions());
    const reclaim = join(dir, ".lock.reclaim");
    writeFileSync(reclaim, "");
    const now = Date.now();
    const old = new Date(now - 60_000);
    utimesSync(reclaim, old, old);
    const dead = lockOptions({ isProcessAlive: () => false });
    const result = acquireLock(nodeFs, dir, ownerOf({ runId: RUN_B }), dead);
    expect(result.reclaimed?.runId).toBe(RUN_A);

    // A fresh mutex means another reclaimer is working: busy.
    const dir2 = heronDirIn(tmp());
    acquireLock(nodeFs, dir2, ownerOf({ pid: 999_999 }), lockOptions());
    writeFileSync(join(dir2, ".lock.reclaim"), "");
    expect(() => acquireLock(nodeFs, dir2, ownerOf({ runId: RUN_B }), dead)).toThrow(LockBusyError);
  });

  test("keeps another host's lock busy for one hour", () => {
    const dir = heronDirIn(tmp());
    const acquiredAt = "2026-09-30T12:00:00.000Z";
    const t0 = Date.parse(acquiredAt);
    acquireLock(
      nodeFs,
      dir,
      ownerOf({ hostname: "host-b", acquiredAt }),
      lockOptions({ hostname: "host-b" }),
    );
    const at = (ms: number): LockOptions =>
      lockOptions({ now: () => t0 + ms, isProcessAlive: () => false });
    expect(() => acquireLock(nodeFs, dir, ownerOf({ runId: RUN_B }), at(3_599_000))).toThrow(
      LockBusyError,
    );
    const result = acquireLock(nodeFs, dir, ownerOf({ runId: RUN_B }), at(3_601_000));
    expect(result.reclaimed?.hostname).toBe("host-b");
  });

  test("release never deletes a lock owned by someone else", () => {
    const dir = heronDirIn(tmp());
    const { handle } = acquireLock(nodeFs, dir, ownerOf(), lockOptions());
    writeFileSync(join(dir, ".lock"), canonicalJson(ownerOf({ runId: RUN_B })));
    handle.release();
    expect(readLockOwner(nodeFs, dir)?.runId).toBe(RUN_B);
    rmSync(join(dir, ".lock"));
    handle.release(); // already gone: no throw
  });

  test("isLockStale and defaultIsProcessAlive cover the decision table", () => {
    const opts = lockOptions({ now: () => 100_000 });
    expect(isLockStale(null, 0, opts)).toBe(true);
    expect(isLockStale(null, 90_000, opts)).toBe(false);
    expect(defaultIsProcessAlive(process.pid)).toBe(true);
    expect(defaultIsProcessAlive(2_147_483_000)).toBe(false);
    expect(readLockOwner(nodeFs, join(tmp(), "missing"))).toBeNull();
  });

  test("rejects a changed revision and dangling artifacts", () => {
    const root = tmp();
    fakeInit(nodeFs, root, "full", RUN_A, null);
    const state = readState(root);
    if (state === null) throw new Error("expected state");
    const store = openFileStore(nodeFs, root, { create: false });

    const stale = store.begin(RUN_B);
    expect(() => stale.commit(state, 0)).toThrow(StateRevisionConflictError);
    stale.abort();

    const dangling = store.begin(RUN_B);
    const broken: HeronState = {
      ...state,
      stateRevision: 2,
      artifacts: [{ path: "intake/missing.json", sha256: "0".repeat(64) }],
    };
    expect(() => dangling.commit(broken, 1)).toThrow(DanglingArtifactError);
    dangling.abort();
    expect(() => dangling.put("x.json", "{}")).toThrow("closed");
    expect(store.recoverOrphanStaging(RUN_C)).toEqual([]);
  });

  test("recovers orphan staging of dead runs only", () => {
    const root = tmp();
    const store = openFileStore(nodeFs, root, { create: true });
    store.begin(RUN_A).put("intake/x.json", "{}");
    store.begin(RUN_B).put("intake/y.json", "{}");
    expect(store.recoverOrphanStaging(RUN_B)).toEqual([RUN_A]);
    expect(existsSync(join(root, ".heron", "staging", RUN_B))).toBe(true);
    expect(store.exists("intake/x.json")).toBe(false);
  });

  test("reads documents and reports invalid JSON or schema", () => {
    const root = tmp();
    fakeInit(nodeFs, root, "full", RUN_A, null);
    const store = openFileStore(nodeFs, root, { create: false });
    expect(store.readDocument("state.json", HERON_STATE_DOCUMENT)?.kind).toBe("HeronState");
    expect(store.readDocument("nope.json", HERON_STATE_DOCUMENT)).toBeNull();
    expect(store.sha256("state.json")).toBe(sha256File(nodeFs, join(root, ".heron/state.json")));
    expect(store.sha256("nope.json")).toBeNull();
    expect(sha256File(nodeFs, join(root, "missing.bin"))).toBeNull();
    writeFileSync(join(root, ".heron", "state.json"), "{oops");
    expect(() => store.readDocument("state.json", HERON_STATE_DOCUMENT)).toThrow(
      InvalidDocumentError,
    );
  });

  test("putDocument validates and writes canonical JSON", () => {
    const root = tmp();
    const store = openFileStore(nodeFs, root, { create: true });
    const tx = store.begin(RUN_A);
    const state = createInitialState({ mode: "full", artifacts: [], meta: metaFor(RUN_A) });
    const sha = tx.putDocument("copy/state.json", HERON_STATE_DOCUMENT, state);
    expect(sha).toBe(sha256Hex(new TextEncoder().encode(canonicalJson(state))));
    expect(() =>
      tx.putDocument("copy/bad.json", HERON_STATE_DOCUMENT, { ...state, kind: "Nope" } as never),
    ).toThrow(InvalidDocumentError);
    tx.abort();
  });

  test("never writes outside .heron and rejects unsafe paths and symlinks", () => {
    const root = tmp();
    const outside = tmp();
    const store = openFileStore(nodeFs, root, { create: true });
    const tx = store.begin(RUN_A);
    for (const bad of [
      "../x",
      "/abs",
      "a//b",
      "a\\b",
      "",
      "a/./b",
      "a\0b",
      `${"a/".repeat(300)}b`,
    ]) {
      expect(() => assertSafeRelativePath(bad)).toThrow(UnsafePathError);
    }
    for (const reserved of ["state.json", "staging/x", ".lock", ".lock.reclaim"]) {
      expect(() => tx.put(reserved, "x")).toThrow(UnsafePathError);
    }
    symlinkSync(outside, join(root, ".heron", "escape"));
    expect(() => tx.put("escape/evil.json", "{}")).toThrow(UnsafePathError);
    expect(() => resolveInside(nodeFs, join(root, ".heron"), "escape/evil.json")).toThrow(
      UnsafePathError,
    );
    symlinkSync(join(outside, "nowhere"), join(root, ".heron", "dangling"));
    expect(() => resolveInside(nodeFs, join(root, ".heron"), "dangling")).toThrow(UnsafePathError);
    expect(existsSync(join(outside, "evil.json"))).toBe(false);
    expect(resolveInside(nodeFs, join(root, ".heron"), "a/b.json")).toBe(
      join(store.heronDir, "a", "b.json"),
    );
    expect(toPosixRelative(store.heronDir, join(store.heronDir, "a", "b.json"))).toBe("a/b.json");
    tx.abort();
  });

  test("rejects a .heron symlink or file and never writes when create is false", () => {
    const root = tmp();
    const target = tmp();
    symlinkSync(target, join(root, ".heron"));
    expect(() => openFileStore(nodeFs, root, { create: true })).toThrow(UnsafePathError);
    const fileRoot = tmp();
    writeFileSync(join(fileRoot, ".heron"), "x");
    expect(() => openFileStore(nodeFs, fileRoot, { create: false })).toThrow(UnsafePathError);

    const clean = tmp();
    const ro = openFileStore(nodeFs, clean, { create: false });
    expect(existsSync(join(clean, ".heron"))).toBe(false);
    expect(ro.exists("state.json")).toBe(false);
    expect(ro.readBytes("state.json")).toBeNull();
    expect(ro.recoverOrphanStaging(RUN_A)).toEqual([]);
    expect(() => ro.begin(RUN_A)).toThrow();
    expect(() => openFileStore(nodeFs, clean, { create: true }).begin("bad")).toThrow(
      UnsafePathError,
    );
  });

  test("writeAtomic replaces the target and leaves the gitignore text exact", () => {
    const dir = tmp();
    const target = join(dir, "sub", "f.txt");
    writeAtomic(nodeFs, target, "one", { tmpDir: join(dir, "tmp"), tmpName: "1.tmp" });
    writeAtomic(nodeFs, target, new Uint8Array([50]), {
      tmpDir: join(dir, "tmp"),
      tmpName: "2.tmp",
    });
    expect(readFileSync(target, "utf8")).toBe("2");
    expect(HERON_GITIGNORE.endsWith("/penpot/snapshots/\n")).toBe(true);
    expect(HERON_GITIGNORE.split("\n")[0]).toContain("Managed by Heron");
  });
});
