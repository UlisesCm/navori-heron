import type { FsPort } from "../../src/core/store/fs-port.ts";

export type FaultyFs = { fs: FsPort; mutations(): number; tripped(): boolean };

/** Wraps `inner`, counting mutating calls. The call number `failAt` (1-based) throws; every later
 * mutating call also throws, simulating a dead process. failAt = null never fails (used to count K). */
export function withFaultInjection(inner: FsPort, failAt: number | null): FaultyFs {
  let count = 0;
  let dead = false;
  const guard = <A extends unknown[], R>(fn: (...args: A) => R): ((...args: A) => R) => {
    return (...args: A): R => {
      count += 1;
      if (dead || (failAt !== null && count === failAt)) {
        dead = true;
        throw new Error(`injected failure at mutation ${count}`);
      }
      return fn(...args);
    };
  };
  const fs: FsPort = {
    existsSync: (p) => inner.existsSync(p),
    lstatSync: (p) => inner.lstatSync(p),
    realpathSync: (p) => inner.realpathSync(p),
    readFileSync: (p) => inner.readFileSync(p),
    readdirSync: (p) => inner.readdirSync(p),
    mkdirSync: guard((p, o) => inner.mkdirSync(p, o)),
    openSync: guard((p, f) => inner.openSync(p, f)),
    writeSync: guard((fd, d) => inner.writeSync(fd, d)),
    fsyncSync: guard((fd) => inner.fsyncSync(fd)),
    closeSync: guard((fd) => inner.closeSync(fd)),
    renameSync: guard((a, b) => inner.renameSync(a, b)),
    unlinkSync: guard((p) => inner.unlinkSync(p)),
    rmSync: guard((p, o) => inner.rmSync(p, o)),
  };
  return { fs, mutations: () => count, tripped: () => dead };
}
