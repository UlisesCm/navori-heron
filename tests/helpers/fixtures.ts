import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

const FIXTURES_ROOT = join(dirname(import.meta.path), "..", "..", "fixtures");

export type FixtureName =
  | "membership-product"
  | "no-ux"
  | "ux-only-md"
  | "ux-only-json"
  | "ux-invalid"
  | "closed-stage";

/** Copies fixtures/{name} into a fresh temp dir (mkdtemp under os.tmpdir()) and returns its realpath. */
export function copyFixture(name: FixtureName): string {
  const target = mkdtempSync(join(tmpdir(), `heron-${name}-`));
  cpSync(join(FIXTURES_ROOT, name), target, { recursive: true });
  return realpathSync(target);
}

const P1_WORKSPACES_ROOT = join(dirname(import.meta.path), "..", "assets", "p1-workspaces");

/** Copies fixtures/{name} plus the P1 golden `.heron/` of the same name (tests/assets/p1-workspaces) into a fresh temp dir. */
export function copyP1Workspace(name: "membership-product" | "no-ux"): string {
  const root = copyFixture(name);
  cpSync(join(P1_WORKSPACES_ROOT, name, ".heron"), join(root, ".heron"), { recursive: true });
  return root;
}

/** repo-relative POSIX path -> sha256 of every regular file under root, skipping the given top-level dirs. */
export function hashTree(
  root: string,
  options: { exclude: readonly string[] },
): Map<string, string> {
  const hashes = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (options.exclude.includes(path.split("/")[0] ?? "")) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        hashes.set(path, createHash("sha256").update(readFileSync(absolute)).digest("hex"));
      }
    }
  };
  walk(root);
  return hashes;
}

/** Merges `patch` into {root}/specs/_master/{stageDir}/state.json (null deletes a key); `removeFiles` deletes stage files. */
export function patchHarnessState(
  root: string,
  stageDir: string,
  patch: Record<string, unknown>,
  options: { removeFiles?: readonly string[] } = {},
): void {
  const stagePath = join(root, "specs", "_master", stageDir);
  const statePath = join(stagePath, "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete state[key];
    else state[key] = value;
  }
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  for (const file of options.removeFiles ?? []) {
    const target = join(stagePath, file);
    if (existsSync(target)) rmSync(target);
  }
}
