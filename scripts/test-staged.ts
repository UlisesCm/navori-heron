/** Pre-commit test step: runs only the test files written in the commit (staged, added/copied/modified/renamed). */

/** Keeps `tests/**\/*.test.ts` entries from a NUL-separated `git diff -z --name-only` listing. */
export function selectStagedTests(nameOnlyZ: string): string[] {
  return nameOnlyZ
    .split("\0")
    .filter((file) => file.startsWith("tests/") && file.endsWith(".test.ts"));
}

/**
 * Runs the staged test files found in `cwd`'s index. Returns the exit code: 0 when nothing is staged,
 * the git exit code when git fails, otherwise `bun test`'s own (non-zero when a test fails).
 */
export function runStagedTests(cwd: string = process.cwd()): number {
  // -z: raw NUL-separated paths, so spaces and non-ASCII names are not quoted by git
  const diff = Bun.spawnSync(
    ["git", "diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
    { cwd },
  );
  if (diff.exitCode !== 0) {
    process.stderr.write(diff.stderr.toString());
    return diff.exitCode;
  }
  const files = selectStagedTests(diff.stdout.toString());
  if (files.length === 0) {
    process.stdout.write("test-staged: no staged tests, nothing to run\n");
    return 0;
  }
  process.stdout.write(`test-staged: ${files.join(" ")}\n`);
  const run = Bun.spawnSync(["bun", "test", ...files.map((f) => `./${f}`)], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  return run.exitCode;
}

if (import.meta.main) process.exit(runStagedTests());
