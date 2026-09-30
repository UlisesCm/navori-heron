import { dirname, join } from "node:path";
import type { FsPort } from "./fs-port.ts";

export type AtomicWriteOptions = { tmpDir: string; tmpName: string };

/** Opens a directory and fsyncs it so a rename inside it is durable. */
export function fsyncDir(fs: FsPort, dir: string): void {
  const fd = fs.openSync(dir, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** mkdir(tmpDir) -> open(tmp,"wx") -> write -> fsync -> close -> rename(tmp,target) -> open(dir,"r") + fsync(dir) + close. */
export function writeAtomic(
  fs: FsPort,
  targetAbsolute: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions,
): void {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  fs.mkdirSync(options.tmpDir, { recursive: true });
  const tmp = join(options.tmpDir, options.tmpName);
  const fd = fs.openSync(tmp, "wx");
  try {
    let offset = 0;
    while (offset < bytes.length) {
      offset += fs.writeSync(fd, bytes.subarray(offset));
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.mkdirSync(dirname(targetAbsolute), { recursive: true });
  fs.renameSync(tmp, targetAbsolute);
  fsyncDir(fs, dirname(targetAbsolute));
}
