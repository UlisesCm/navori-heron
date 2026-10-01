// Covers: R14
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

// Static literal regexes only: specifiers are never interpolated into a RegExp.
const TYPE_IMPORT_RE = /\b(?:import|export)\s+type\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

/** Every module specifier of a TS source: Bun scanner (static, dynamic, require) plus type-only forms it omits. */
export function extractImports(source: string): string[] {
  const found = new Set<string>();
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(source.replace(/^#!.*/, ""));
  for (const entry of scanned) found.add(entry.path);
  for (const match of source.matchAll(TYPE_IMPORT_RE)) found.add(match[1] ?? "");
  return [...found];
}

const listTs = (dir: string): string[] =>
  [...new Bun.Glob("**/*.ts").scanSync({ cwd: join(ROOT, dir), onlyFiles: true })]
    .map((file) => `${dir}/${file.split(sep).join("/")}`)
    .toSorted();

const readSource = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** Resolves a relative specifier to a repo-relative POSIX path; null for bare/builtin specifiers. */
function resolveRelative(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return relative(ROOT, resolve(dirname(join(ROOT, file)), specifier))
    .split(sep)
    .join("/");
}

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const NAVORI_RE = /^(?:navori|navori\/.*|@navori\/.*)$/;
const FS_RE = /^(?:node:)?fs(?:\/.*)?$/;
const FS_SCRIPTS = new Set(["scripts/gen-schemas.ts", "scripts/check-coverage.ts"]);

type Violation = string;

/** Returns one message per boundary rule broken by `file` (path relative to the repo root). */
function violationsFor(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  const imports = extractImports(source);
  for (const specifier of imports) {
    const target = resolveRelative(file, specifier);
    const bad = (rule: string): number => out.push(`${file} -> ${specifier}: ${rule}`);
    if (NAVORI_RE.test(specifier)) bad("navori import");
    if (FS_RE.test(specifier) && !under(file, "src/core/store") && !FS_SCRIPTS.has(file)) {
      bad("only src/core/store imports node:fs");
    }
    if (under(file, "src/core/contracts")) {
      if (target === null ? specifier !== "zod" : !under(target, "src/core/contracts")) {
        bad("contracts imports only zod and siblings");
      }
    }
    if (under(file, "src/core/state")) {
      if (
        target === null ||
        !(under(target, "src/core/contracts") || under(target, "src/core/state"))
      ) {
        bad("state imports only contracts (and siblings)");
      }
    }
    if (target !== null) {
      if (
        under(file, "src/core") &&
        (under(target, "src/intake") || under(target, "src/app") || under(target, "src/cli"))
      ) {
        bad("core must not import intake, app or cli");
      }
      if (under(file, "src/intake") && (under(target, "src/app") || under(target, "src/cli"))) {
        bad("intake must not import app or cli");
      }
      if (under(file, "src/app") && under(target, "src/cli")) bad("app must not import cli");
      const own = /^src\/intake\/adapters\/([^/]+)\//.exec(file)?.[1];
      const other = /^src\/intake\/adapters\/([^/]+)(?:\/|$)/.exec(target)?.[1];
      if (own !== undefined && other !== undefined && own !== other) {
        bad("adapters must not import each other");
      }
    }
  }
  if (under(file, "src/core/contracts") || under(file, "src/core/state")) {
    if (/\bBun\./.test(source) || /["']bun:/.test(source))
      out.push(`${file}: Bun runtime usage in pure core`);
  }
  return out;
}

const SYNTHETIC = [
  'import a from "mod-default";',
  'import { b } from "mod-named";',
  'import * as c from "mod-namespace";',
  'import "mod-side-effect";',
  'import type { T } from "mod-type";',
  'import type U from "mod-type-default";',
  'export type { V } from "mod-export-type";',
  'export * from "mod-export-star";',
  'export { w } from "mod-export-named";',
  'const d = await import("mod-dynamic");',
  'const e = require("mod-require");',
  "import type {",
  "  Multi,",
  '} from "mod-multiline-type";',
].join("\n");

const SOURCE_DIRS = ["src", "bin", "scripts"] as const;
const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => (dir === "bin" ? ["bin/heron.ts"] : listTs(dir)));

describe("module boundaries", () => {
  test("enforces module boundaries and no navori imports", () => {
    // self-check: the extractor sees every import form
    expect(extractImports(SYNTHETIC).toSorted()).toEqual(
      [
        "mod-default",
        "mod-named",
        "mod-namespace",
        "mod-side-effect",
        "mod-type",
        "mod-type-default",
        "mod-export-type",
        "mod-export-star",
        "mod-export-named",
        "mod-dynamic",
        "mod-require",
        "mod-multiline-type",
      ].toSorted(),
    );
    // self-check: the rules do flag violations
    expect(
      violationsFor("src/core/state/x.ts", 'import "../../app/result.ts";').length,
    ).toBeGreaterThan(0);
    expect(
      violationsFor("src/intake/adapters/a/x.ts", 'import "../b/y.ts";').length,
    ).toBeGreaterThan(0);
    expect(violationsFor("src/app/x.ts", 'import "node:fs";').length).toBeGreaterThan(0);
    expect(violationsFor("scripts/other.ts", 'import "node:fs";').length).toBeGreaterThan(0);
    expect(violationsFor("scripts/gen-schemas.ts", 'import "node:fs";')).toEqual([]);
    expect(violationsFor("src/cli/x.ts", 'import "@navori/core";').length).toBeGreaterThan(0);

    expect(SOURCE_FILES.length).toBeGreaterThan(20);
    const violations = SOURCE_FILES.flatMap((file) => violationsFor(file, readSource(file)));
    expect(violations).toEqual([]);

    const pkg = JSON.parse(readSource("package.json")) as Record<string, unknown>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const names = Object.keys((pkg[field] as Record<string, string> | undefined) ?? {});
      expect(names.filter((name) => NAVORI_RE.test(`${name}/x`) || NAVORI_RE.test(name))).toEqual(
        [],
      );
    }
  });
});

// Blanks comments and string/template literals (keeping newlines) so only code tokens remain.
const NON_CODE_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/g;
// any justified: this is the detector pattern, not a type. A member access such as `expect.any(...)` is not the type.
const ANY_RE = /(?<![.\w$])any\b/;
const DIRECTIVE_RULE = ["no-explicit", "any"].join("-");
const JUSTIFIED = "any justified:";

/** Lines (1-based) with an `any` token or a no-explicit-any directive lacking `// any justified:` here or on the previous line. */
export function unjustifiedAny(source: string): number[] {
  const code = source.replace(NON_CODE_RE, (m) => m.replace(/[^\n]/g, " "));
  const rawLines = source.split("\n");
  const codeLines = code.split("\n");
  const lines: number[] = [];
  codeLines.forEach((codeLine, index) => {
    const raw = rawLines[index] ?? "";
    const isDirective = raw.includes(DIRECTIVE_RULE);
    if (!ANY_RE.test(codeLine) && !isDirective) return;
    const justified = raw.includes(JUSTIFIED) || (rawLines[index - 1] ?? "").includes(JUSTIFIED);
    if (!justified) lines.push(index + 1);
  });
  return lines;
}

describe("any policy", () => {
  test("allows any only with a justification", () => {
    // self-check on synthetic sources
    expect(unjustifiedAny("const a: any = 1;")).toEqual([1]);
    expect(unjustifiedAny("// any justified: no types\nconst a: any = 1;")).toEqual([]);
    expect(unjustifiedAny("const a: any = 1; // any justified: lib")).toEqual([]);
    expect(unjustifiedAny('const s = "any"; // any word\n/* any */')).toEqual([]);
    expect(unjustifiedAny(`// oxlint-disable-next-line typescript/${DIRECTIVE_RULE}\nx`)).toEqual([
      1,
    ]);
    expect(
      unjustifiedAny(
        `// oxlint-disable-next-line typescript/${DIRECTIVE_RULE} -- any justified: r\nconst a: any = 1;`,
      ),
    ).toEqual([]);

    const files = [...SOURCE_FILES, ...listTs("tests")];
    const offenders = files.flatMap((file) =>
      unjustifiedAny(readSource(file)).map((line) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
