// Covers: R3, R5
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");

// Static literal regexes only: specifiers are never interpolated into a RegExp.
const TYPE_IMPORT_RE = /\b(?:import|export)\s+type\b[^;]*?\bfrom\s*["']([^"']+)["']/g;

// Blanks comments and string/template literals (keeping newlines) so only code tokens remain.
const NON_CODE_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`/g;

/** Every module specifier of a TS source: Bun scanner (static, dynamic, require) plus type-only forms it omits. */
export function extractImports(source: string): string[] {
  const found = new Set<string>();
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(source.replace(/^#!.*/, ""));
  for (const entry of scanned) found.add(entry.path);
  for (const match of source.matchAll(TYPE_IMPORT_RE)) found.add(match[1] ?? "");
  return [...found];
}

/** Module specifiers that exist at runtime: the Bun scanner only (type-only imports are erased, DP20). */
export function runtimeImports(source: string): string[] {
  const scanned = new Bun.Transpiler({ loader: "ts" }).scanImports(source.replace(/^#!.*/, ""));
  return [...new Set(scanned.map((entry) => entry.path))];
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

/** `path` is `prefix` itself or lives below it (a prefix may be a directory or an exact file). */
const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);
const underAny = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => under(path, prefix));

type Example = { file: string; source: string };
type LayerRule = {
  from: string;
  allow: readonly string[];
  typeOnly: readonly string[];
  bare: readonly RegExp[];
  violates: Example;
  passes: Example;
};
type VendorRule = {
  specifier: RegExp;
  only: readonly string[];
  rule: string;
  violates: Example;
  passes: Example;
};
type TokenRule = {
  pattern: RegExp;
  scope: readonly string[];
  allow: readonly string[];
  rule: string;
  violates: Example;
  passes: Example;
};
/** "{file} -> {specifier}: {rule}" or "{file}: {rule}". */
export type Violation = string;

const NAVORI_RE = /^(?:navori|navori\/.*|@navori\/.*)$/;
/** Read-only store API that domain modules may import (heron-architecture SKILL: STORE_READ). */
export const STORE_READ: readonly string[] = [
  "src/core/store/fs-port.ts",
  "src/core/store/paths.ts",
  "src/core/store/hash.ts",
];

const ex = (file: string, ...lines: string[]): Example => ({ file, source: lines.join("\n") });

export const LAYERS: readonly LayerRule[] = [
  {
    from: "src/core/contracts",
    allow: ["src/core/contracts"],
    typeOnly: [],
    bare: [/^zod$/],
    violates: ex("src/core/contracts/x.ts", 'import "../state/mode.ts";'),
    passes: ex("src/core/contracts/x.ts", 'import { z } from "zod";', 'import "./common.ts";'),
  },
  {
    from: "src/core/state",
    allow: ["src/core/contracts", "src/core/state"],
    typeOnly: [],
    bare: [],
    violates: ex("src/core/state/x.ts", 'import "../store/paths.ts";'),
    passes: ex("src/core/state/x.ts", 'import "../contracts/index.ts";', 'import "./stale.ts";'),
  },
  {
    from: "src/core/store",
    allow: ["src/core/contracts", "src/core/store"],
    typeOnly: [],
    bare: [/^node:fs$/, /^node:path$/, /^node:crypto$/, /^node:os$/], // VENDORS narrows node:os to temp-dir.ts
    violates: ex("src/core/store/x.ts", 'import "../state/mode.ts";'),
    passes: ex(
      "src/core/store/x.ts",
      'import { join } from "node:path";',
      'import "../contracts/index.ts";',
      'import "./paths.ts";',
    ),
  },
  {
    from: "src/security",
    allow: ["src/core/contracts", "src/security"],
    typeOnly: [],
    bare: [/^node:dns(?:\/promises)?$/, /^node:(?:net|tls|http|https)$/, /^sharp$/], // VENDORS narrows each to its file
    violates: ex("src/security/x.ts", 'import "../intake/ports.ts";'),
    passes: ex("src/security/x.ts", 'import "../core/contracts/index.ts";'),
  },
  {
    from: "src/intake",
    allow: ["src/core/contracts", ...STORE_READ, "src/security", "src/intake"],
    typeOnly: ["src/research/ports.ts"],
    bare: [/^zod$/],
    violates: ex("src/intake/x.ts", 'import { r } from "../research/ports.ts";'),
    passes: ex(
      "src/intake/x.ts",
      'import type { R } from "../research/ports.ts";',
      'import "../core/store/paths.ts";',
      'import "../security/ssrf.ts";',
    ),
  },
  {
    from: "src/research",
    allow: ["src/core/contracts", ...STORE_READ, "src/security", "src/research"],
    typeOnly: ["src/intake/ports.ts"],
    bare: [/^zod$/],
    violates: ex("src/research/x.ts", 'import { DEFAULT_INPUT_LIMITS } from "../intake/ports.ts";'),
    passes: ex(
      "src/research/x.ts",
      'import type { InputLimits } from "../intake/ports.ts";',
      'import "../core/store/paths.ts";',
      'import "../security/ssrf.ts";',
    ),
  },
  {
    from: "src/app",
    allow: ["src/core", "src/intake", "src/research", "src/security", "src/app", "package.json"],
    typeOnly: [],
    bare: [/^node:os$/, /^node:path$/],
    violates: ex("src/app/x.ts", 'import "../cli/output.ts";'),
    passes: ex(
      "src/app/x.ts",
      'import "../core/state/mode.ts";',
      'import "../intake/detect.ts";',
      'import { resolve } from "node:path";',
      'import pkg from "../../package.json" with { type: "json" };',
    ),
  },
  {
    from: "src/cli",
    allow: ["src/app", "src/core/contracts", "src/cli"],
    typeOnly: [],
    bare: [/^node:util$/, /^node:readline$/],
    violates: ex("src/cli/x.ts", 'import "../core/state/mode.ts";'),
    passes: ex(
      "src/cli/x.ts",
      'import "../app/status.ts";',
      'import "../core/contracts/index.ts";',
      'import { parseArgs } from "node:util";',
    ),
  },
  {
    from: "bin",
    allow: ["src/cli"],
    typeOnly: [],
    bare: [],
    violates: ex("bin/heron.ts", 'import "../src/app/init.ts";'),
    passes: ex("bin/heron.ts", 'import "../src/cli/main.ts";'),
  },
  {
    from: "scripts",
    allow: ["src/core/contracts", "scripts"],
    typeOnly: [],
    bare: [/^zod$/, /^node:fs$/],
    violates: ex("scripts/x.ts", 'import "../src/app/init.ts";'),
    passes: ex(
      "scripts/gen-schemas.ts",
      'import { z } from "zod";',
      'import { mkdirSync } from "node:fs";',
      'import "../src/core/contracts/index.ts";',
    ),
  },
];

export const VENDORS: readonly VendorRule[] = [
  {
    specifier: /^(?:node:)?fs(?:\/.*)?$/,
    only: ["src/core/store", "scripts/gen-schemas.ts", "scripts/check-coverage.ts"],
    rule: "only src/core/store touches the filesystem (DP2)",
    violates: ex("src/app/x.ts", 'import "node:fs";'),
    passes: ex("scripts/gen-schemas.ts", 'import "node:fs";'),
  },
  {
    specifier: /^(?:node:)?dns(?:\/.*)?$/,
    only: ["src/security/fetch/system.ts"],
    rule: "only src/security/fetch/system.ts resolves DNS",
    violates: ex("src/security/x.ts", 'import "node:dns/promises";'),
    passes: ex("src/security/fetch/system.ts", 'import "node:dns/promises";'),
  },
  {
    specifier: /^(?:node:)?(?:net|tls|http|https)$/,
    only: ["src/security/fetch"],
    rule: "only src/security/fetch opens network sockets",
    violates: ex("src/security/x.ts", 'import "node:net";'),
    passes: ex("src/security/fetch/x.ts", 'import "node:net";'),
  },
  {
    specifier: /^sharp$/,
    only: ["src/security/images"],
    rule: "sharp lives only in src/security/images",
    violates: ex("src/security/x.ts", 'import sharp from "sharp";'),
    passes: ex("src/security/images/sanitize.ts", 'import sharp from "sharp";'),
  },
  {
    specifier: /^node:os$/,
    only: ["src/app/context.ts", "src/core/store/temp-dir.ts"],
    rule: "node:os only in src/app/context.ts and src/core/store/temp-dir.ts",
    violates: ex("src/core/store/x.ts", 'import "node:os";'),
    passes: ex("src/core/store/temp-dir.ts", 'import "node:os";'),
  },
  {
    specifier: /^(?:node:)?crypto$/,
    only: ["src/core/store/hash.ts"],
    rule: "node:crypto only in src/core/store/hash.ts",
    violates: ex("src/core/store/x.ts", 'import "node:crypto";'),
    passes: ex("src/core/store/hash.ts", 'import "node:crypto";'),
  },
  {
    specifier: /^(?:node:)?child_process$/,
    only: [],
    rule: "child_process is not allowed (P3 revisits it)",
    violates: ex("src/app/x.ts", 'import "node:child_process";'),
    passes: ex("src/app/x.ts", 'import "node:path";'),
  },
  {
    specifier: NAVORI_RE,
    only: [],
    rule: "navori import (RN-1)",
    violates: ex("src/cli/x.ts", 'import "@navori/core";'),
    passes: ex("src/cli/x.ts", 'import "../app/status.ts";'),
  },
];

export const TOKENS: readonly TokenRule[] = [
  {
    pattern: /\bnew\s+RegExp\(/,
    scope: ["src"],
    allow: [],
    rule: "no dynamic RegExp",
    violates: ex("src/app/x.ts", "const r = new RegExp(input);"),
    passes: ex("src/app/x.ts", 'const s = "new RegExp(";', "const r = /a/;"),
  },
  {
    pattern: /\bprocess\.env\b/,
    scope: ["src"],
    allow: ["src/app/context.ts", "src/cli/main.ts"],
    rule: "process.env only in src/app/context.ts and src/cli/main.ts",
    violates: ex("src/app/x.ts", "const v = process.env.HOME;"),
    passes: ex("src/cli/main.ts", "const v = process.env.HOME;"),
  },
  {
    pattern: /(?<![.\w$])fetch\(/,
    scope: ["src"],
    allow: ["src/security/fetch/system.ts"],
    rule: "fetch( only in src/security/fetch/system.ts",
    violates: ex("src/research/x.ts", 'const r = await fetch("https://example.test");'),
    passes: ex("src/security/fetch/system.ts", 'const r = await fetch("https://example.test");'),
  },
  {
    pattern: /\bBun\.(?:write|file)\b/,
    scope: ["src"],
    allow: ["src/core/store"],
    rule: "Bun.write/Bun.file only in src/core/store",
    violates: ex("src/app/x.ts", "await Bun.write(path, text);"),
    passes: ex("src/core/store/x.ts", "await Bun.write(path, text);"),
  },
  {
    pattern: /\bcrypto\.subtle\b|\bCryptoHasher\b/,
    scope: ["src"],
    allow: ["src/core/store/hash.ts"],
    rule: "crypto.subtle/CryptoHasher only in src/core/store/hash.ts",
    violates: ex("src/app/x.ts", 'const h = new Bun.CryptoHasher("sha256");'),
    passes: ex("src/core/store/hash.ts", 'const h = new Bun.CryptoHasher("sha256");'),
  },
  {
    pattern: /\brandomUUID\(/,
    scope: ["src"],
    allow: ["src/app/context.ts"],
    rule: "randomUUID( only in src/app/context.ts",
    violates: ex("src/app/x.ts", "const id = crypto.randomUUID();"),
    passes: ex("src/app/context.ts", "const id = crypto.randomUUID();"),
  },
  {
    pattern: /\bBun\.spawn/,
    scope: ["src"],
    allow: [],
    rule: "Bun.spawn is not allowed (P3 revisits it)",
    violates: ex("src/app/x.ts", 'Bun.spawn(["ls"]);'),
    passes: ex("src/app/x.ts", 'const s = "Bun.spawn";'),
  },
  {
    pattern: /\bconsole\./,
    scope: ["src"],
    allow: [],
    rule: "no console in src",
    violates: ex("src/app/x.ts", 'console.log("x");'),
    passes: ex("src/app/x.ts", '// console.log("x")'),
  },
  {
    pattern: /\bnew Date\(|\bDate\.now\(/,
    scope: ["src"],
    allow: ["src/app/context.ts", "src/app/write-run.ts", "src/app/doctor.ts"],
    rule: "dates only from ctx.clock (new Date( / Date.now( restricted)",
    violates: ex("src/core/state/x.ts", "const t = Date.now();"),
    passes: ex("src/app/context.ts", "const t = Date.now();"),
  },
  {
    pattern: /\bBun\./,
    scope: ["src/core/contracts", "src/core/state"],
    allow: [],
    rule: "Bun runtime usage in pure core (RNF-20)",
    violates: ex("src/core/state/x.ts", "const v = Bun.version;"),
    passes: ex("src/core/state/x.ts", 'const s = "Bun.version";'),
  },
  {
    pattern: /\bfailure\(\s*\d|\bcode:\s*\d/,
    scope: ["src/app", "src/cli"],
    allow: [],
    rule: "numeric exit code literal; use ExitCode.* (R5)",
    violates: ex("src/app/x.ts", "return failure(3, finding);"),
    passes: ex("src/app/x.ts", "return failure(ExitCode.Blocked, finding);"),
  },
];

/** `src/<module>/adapters/<adapter>/...` -> [module, adapter]. */
const adapterOf = (path: string): readonly [string, string] | null => {
  const match = /^src\/([^/]+)\/adapters\/([^/]+)(?:\/|$)/.exec(path);
  return match === null ? null : [match[1] ?? "", match[2] ?? ""];
};

/** Layer = row with the longest `from` prefix; a src/bin/scripts file without a row is a violation. Relative targets must
 * fall under `allow` or, only as type-only imports, under `typeOnly`; bare specifiers must match `bare` and every VENDORS
 * row whose specifier matches; adapters never import another adapter (any module); only src/<m>/registry.ts and
 * src/intake/detect.ts import src/<m>/adapters/**; TOKENS run on the source with NON_CODE_RE applied, for files under
 * `scope` and outside `allow`. */
export function violationsFor(file: string, source: string): Violation[] {
  const out: Violation[] = [];
  const layer = LAYERS.filter((row) => under(file, row.from)).toSorted(
    (a, b) => b.from.length - a.from.length,
  )[0];
  if (layer === undefined) out.push(`${file}: file belongs to no layer in LAYERS`);
  const runtime = new Set(runtimeImports(source));
  for (const specifier of extractImports(source)) {
    const target = resolveRelative(file, specifier);
    const bad = (rule: string): number => out.push(`${file} -> ${specifier}: ${rule}`);
    if (target === null) {
      if (layer !== undefined && !layer.bare.some((re) => re.test(specifier))) {
        bad(`${layer.from} may not import this package`);
      }
      for (const vendor of VENDORS) {
        if (vendor.specifier.test(specifier) && !underAny(file, vendor.only)) bad(vendor.rule);
      }
      continue;
    }
    if (layer !== undefined && !underAny(target, layer.allow)) {
      if (!underAny(target, layer.typeOnly)) bad(`${layer.from} may not import ${target}`);
      else if (runtime.has(specifier)) bad(`${target} must be imported with import type`);
    }
    const own = adapterOf(file);
    const other = adapterOf(target);
    if (other !== null) {
      if (own !== null) {
        if (own[0] !== other[0] || own[1] !== other[1]) bad("adapters must not import each other");
      } else if (file !== `src/${other[0]}/registry.ts` && file !== "src/intake/detect.ts") {
        bad("only registry.ts (and intake/detect.ts) imports adapters");
      }
    }
  }
  const code = source.replace(NON_CODE_RE, (m) => m.replace(/[^\n]/g, " "));
  for (const token of TOKENS) {
    if (underAny(file, token.scope) && !underAny(file, token.allow) && token.pattern.test(code)) {
      out.push(`${file}: ${token.rule}`);
    }
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

/** Asserts that the violating example is flagged and the passing example is clean. */
function expectRow(row: { violates: Example; passes: Example }): void {
  expect(violationsFor(row.violates.file, row.violates.source).length).toBeGreaterThan(0);
  expect(violationsFor(row.passes.file, row.passes.source)).toEqual([]);
}

describe("module boundaries", () => {
  test("enforces module boundaries and no navori imports", () => {
    // self-check: the extractors see every import form
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
    expect(runtimeImports(SYNTHETIC)).not.toContain("mod-type");
    expect(runtimeImports(SYNTHETIC)).toContain("mod-dynamic");

    // self-check: every table row flags its violating example and accepts its passing one
    for (const row of [...LAYERS, ...VENDORS, ...TOKENS]) expectRow(row);

    // self-check: rules that are not table rows
    expect(violationsFor("src/zzz/x.ts", "export {};").length).toBeGreaterThan(0);
    expect(
      violationsFor("src/intake/adapters/a/x.ts", 'import "../b/y.ts";').length,
    ).toBeGreaterThan(0);
    expect(
      violationsFor("src/research/adapters/a/x.ts", 'import "../../../intake/adapters/b/y.ts";')
        .length,
    ).toBeGreaterThan(0);
    expect(violationsFor("src/intake/adapters/a/x.ts", 'import "./y.ts";')).toEqual([]);
    expect(
      violationsFor("src/intake/x.ts", 'import "./adapters/filesystem/index.ts";').length,
    ).toBeGreaterThan(0);
    expect(
      violationsFor("src/research/registry.ts", 'import "./adapters/manual/index.ts";'),
    ).toEqual([]);
    expect(
      violationsFor("src/intake/detect.ts", 'import "./adapters/filesystem/index.ts";'),
    ).toEqual([]);
    expect(violationsFor("src/security/x.ts", "const r = ctx.fetch(url);")).toEqual([]);

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
