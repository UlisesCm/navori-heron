import { dirname, join, relative, sep } from "node:path";
import { RelativeArtifactPathSchema, type RelativeArtifactPath } from "../contracts/index.ts";
import type { ReadonlyFs } from "./fs-port.ts";

export class UnsafePathError extends Error {
  readonly path: string;
  readonly reason: string;
  constructor(path: string, reason: string) {
    super(`unsafe path ${JSON.stringify(path)}: ${reason}`);
    this.name = "UnsafePathError";
    this.path = path;
    this.reason = reason;
  }
}

/** Validates a POSIX relative path (no absolute, no "..", no backslash, no NUL, <= 512 chars). */
export function assertSafeRelativePath(path: string): RelativeArtifactPath {
  const result = RelativeArtifactPathSchema.safeParse(path);
  if (!result.success) {
    throw new UnsafePathError(path, result.error.issues[0]?.message ?? "invalid relative path");
  }
  return result.data;
}

function lexists(fs: ReadonlyFs, path: string): boolean {
  try {
    fs.lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
}

/** Joins, then realpaths the deepest existing ancestor; throws UnsafePathError if the result leaves realpath(root). */
export function resolveInside(fs: ReadonlyFs, root: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);
  const realRoot = fs.realpathSync(root);
  const joined = join(realRoot, ...relativePath.split("/"));
  let ancestor = joined;
  const rest: string[] = [];
  while (!lexists(fs, ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new UnsafePathError(relativePath, "no existing ancestor");
    rest.unshift(ancestor.slice(parent.length + 1));
    ancestor = parent;
  }
  let realAncestor: string;
  try {
    realAncestor = fs.realpathSync(ancestor);
  } catch {
    throw new UnsafePathError(relativePath, "dangling symlink");
  }
  const resolved = rest.length > 0 ? join(realAncestor, ...rest) : realAncestor;
  if (!isInside(realRoot, resolved)) {
    throw new UnsafePathError(relativePath, "resolves outside the root");
  }
  return resolved;
}

/** POSIX relative path of `absolute` under `root`. */
export function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}
