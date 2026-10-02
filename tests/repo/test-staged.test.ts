import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runStagedTests, selectStagedTests } from "../../scripts/test-staged";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "heron-staged-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PASSING = 'import { test } from "bun:test";\ntest("ok", () => {});\n';
const FAILING =
  'import { test, expect } from "bun:test";\ntest("ko", () => { expect(1).toBe(2); });\n';

function git(cwd: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
}

/** Fresh scratch repo (outside the worktree) with an initial commit. */
function newRepo(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir);
  git(dir, "init", "-q");
  writeFileSync(join(dir, "README.md"), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

function write(repo: string, rel: string, body: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), body);
}

/** Silences the script's own stdout/stderr (and the nested `bun test`'s, via inherit) while it runs. */
function quiet(run: () => number): number {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = (): boolean => true;
  process.stderr.write = (): boolean => true;
  try {
    return run();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
}

describe("selectStagedTests", () => {
  test("keeps only staged *.test.ts files under tests/", () => {
    const listing = [
      "src/core/a.ts",
      "tests/unit/a.test.ts",
      "tests/helpers/timing.ts",
      "scripts/x.test.ts",
      "tests/repo/ci.test.ts",
      "",
    ].join("\0");
    expect(selectStagedTests(listing)).toEqual(["tests/unit/a.test.ts", "tests/repo/ci.test.ts"]);
    expect(selectStagedTests("")).toEqual([]);
  });
});

// each case spawns a nested `bun test`: generous explicit timeout, well above Bun's 5 s default
const SPAWN_TIMEOUT = 30_000;

describe("runStagedTests", () => {
  test("exits 0 when nothing is staged", () => {
    const repo = newRepo("empty");
    write(repo, "tests/a.test.ts", FAILING); // untracked, not staged: must not run
    expect(quiet(() => runStagedTests(repo))).toBe(0);
  });

  test(
    "exits 1 when a staged test fails",
    () => {
      const repo = newRepo("failing");
      write(repo, "tests/ko.test.ts", FAILING);
      git(repo, "add", "tests/ko.test.ts");
      expect(quiet(() => runStagedTests(repo))).toBe(1);
    },
    SPAWN_TIMEOUT,
  );

  test(
    "runs a staged rename",
    () => {
      const repo = newRepo("rename");
      write(repo, "tests/old.test.ts", FAILING);
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "add");
      git(repo, "mv", "tests/old.test.ts", "tests/renamed.test.ts");
      // a renamed (R) failing file is selected: the run fails
      expect(quiet(() => runStagedTests(repo))).toBe(1);
    },
    SPAWN_TIMEOUT,
  );

  test(
    "runs a staged path with spaces",
    () => {
      const repo = newRepo("spaces");
      write(repo, "tests/with space.test.ts", FAILING);
      git(repo, "add", "tests/with space.test.ts");
      expect(quiet(() => runStagedTests(repo))).toBe(1);
    },
    SPAWN_TIMEOUT,
  );

  test(
    "runs a staged non-ASCII path",
    () => {
      const repo = newRepo("unicode");
      write(repo, "tests/ñandú-é.test.ts", FAILING);
      git(repo, "add", "tests/ñandú-é.test.ts");
      expect(quiet(() => runStagedTests(repo))).toBe(1);
    },
    SPAWN_TIMEOUT,
  );

  test(
    "passes when the staged tests pass",
    () => {
      const repo = newRepo("passing");
      write(repo, "tests/ok.test.ts", PASSING);
      git(repo, "add", "tests/ok.test.ts");
      expect(quiet(() => runStagedTests(repo))).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});
