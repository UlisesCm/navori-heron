import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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

export type InputFileLocation = "repo" | "external";
export type ResolvedInputFile = { realPath: string; location: InputFileLocation; name: string };
/** Why `resolveInputFile` refused a path (UnsafePathError.reason). */
export const INPUT_PATH_REASONS = {
  invalid: "empty path or NUL",
  dotdot: "contains a '..' segment",
  escapingSymlink: "symlink that leaves the product repository",
  externalSymlink: "external path whose last component is a symlink",
  externalNotAllowed: "outside the product repository where only repository files are allowed",
} as const;

/** Resolves an explicit input file path (D28) without reading its content (lstat/realpath only). `inputPath` is raw:
 * absolute or relative to `base`. UnsafePathError when: empty or NUL; any "/" or "\\" segment equal to ".."; location
 * "repo" (realpath(parent) + basename inside realpath(root)) and the file's realpath leaves realpath(root); location
 * "external" and the path was written inside the repo (a directory symlink that leads out of it); location "external"
 * and `options.allowExternal` is false; location "external" and the last component is a symlink.
 * Returns null when the file does not exist. */
export function resolveInputFile(
  fs: ReadonlyFs,
  root: string,
  inputPath: string,
  base: string,
  options: { allowExternal: boolean },
): ResolvedInputFile | null {
  if (inputPath === "" || inputPath.includes("\0")) {
    throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.invalid);
  }
  if (inputPath.split(/[\\/]/).includes("..")) {
    throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.dotdot);
  }
  const absolute = isAbsolute(inputPath) ? inputPath : resolve(base, inputPath);
  const name = basename(absolute);
  let candidate: string;
  try {
    candidate = join(fs.realpathSync(dirname(absolute)), name);
    fs.lstatSync(candidate);
  } catch {
    return null;
  }
  const realRoot = fs.realpathSync(root);
  if (isInside(realRoot, candidate)) {
    let realPath: string;
    try {
      realPath = fs.realpathSync(candidate);
    } catch {
      throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.escapingSymlink);
    }
    if (!isInside(realRoot, realPath)) {
      throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.escapingSymlink);
    }
    return { realPath, location: "repo", name };
  }
  // A path written inside the repo whose directory symlink leads out of it is an escape, not an explicit external file.
  if (isInside(realRoot, absolute) || isInside(resolve(root), absolute)) {
    throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.escapingSymlink);
  }
  if (!options.allowExternal) {
    throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.externalNotAllowed);
  }
  if (fs.lstatSync(candidate).isSymbolicLink()) {
    throw new UnsafePathError(inputPath, INPUT_PATH_REASONS.externalSymlink);
  }
  return { realPath: candidate, location: "external", name };
}
