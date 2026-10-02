import * as fs from "node:fs";

export type FileStat = {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtimeMs: number;
  mode: number;
};

/** Synchronous filesystem port. The only place `node:fs` is imported (DP2). */
export interface FsPort {
  existsSync(path: string): boolean;
  lstatSync(path: string): FileStat;
  realpathSync(path: string): string;
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string): string[];
  mkdirSync(path: string, options: { recursive: true }): void;
  openSync(path: string, flags: "r" | "w" | "wx" | "a"): number;
  writeSync(fd: number, data: Uint8Array): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}

export type ReadonlyFs = Pick<
  FsPort,
  "existsSync" | "lstatSync" | "realpathSync" | "readFileSync" | "readdirSync"
>;

/** Real filesystem implementation of {@link FsPort}. */
export const nodeFs: FsPort = {
  existsSync: (path) => fs.existsSync(path),
  lstatSync: (path) => fs.lstatSync(path),
  realpathSync: (path) => fs.realpathSync(path),
  readFileSync: (path) => new Uint8Array(fs.readFileSync(path)),
  readdirSync: (path) => fs.readdirSync(path),
  mkdirSync: (path, options) => {
    fs.mkdirSync(path, options);
  },
  openSync: (path, flags) => fs.openSync(path, flags),
  writeSync: (fd, data) => fs.writeSync(fd, data),
  fsyncSync: (fd) => {
    fs.fsyncSync(fd);
  },
  closeSync: (fd) => {
    fs.closeSync(fd);
  },
  renameSync: (from, to) => {
    fs.renameSync(from, to);
  },
  unlinkSync: (path) => {
    fs.unlinkSync(path);
  },
  rmSync: (path, options) => {
    fs.rmSync(path, options);
  },
};

/** Node-style error code of a thrown value, or null. */
export function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
