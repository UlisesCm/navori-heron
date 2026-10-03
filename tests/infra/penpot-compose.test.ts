// Covers: R1, R2, R21
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activeServices,
  assertPenpotComposeInvariants,
  interpolateCompose,
  loadComposeModel,
  type ComposeModel,
} from "../helpers/compose.ts";

const root = new URL("../../", import.meta.url).pathname;
const infra = join(root, "infra/penpot");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/** Parses a dotenv file of `KEY=value` lines (the synthetic one has no quotes). */
const parseEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );

const synthetic = parseEnv(read("tests/assets/infra/penpot.synthetic.env"));
const base = read("infra/penpot/docker-compose.yaml");
const override = read("infra/penpot/compose.override.yaml");
const load = (env: Record<string, string>): ComposeModel => loadComposeModel([base, override], env);

const frontend = (m: ComposeModel) => m.services["penpot-frontend"] ?? {};

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "heron-penpot-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Environment for the scripts: the process one without any PENPOT_* variable, plus overrides. */
const scriptEnv = (extra: Record<string, string>): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("PENPOT_")) env[k] = v;
  }
  return { ...env, ...extra };
};

const run = (argv: string[], env: Record<string, string>): { code: number; out: string } => {
  const r = Bun.spawnSync(argv, { env, cwd: root, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}` };
};

describe("penpot compose model", () => {
  test("override pins the version, keeps MCP and removes insecure defaults", () => {
    const model = load(synthetic);
    expect(() => assertPenpotComposeInvariants(model)).not.toThrow();
    expect(Object.keys(model.services).toSorted()).toEqual([
      "penpot-backend",
      "penpot-exporter",
      "penpot-frontend",
      "penpot-mailcatch",
      "penpot-mcp",
      "penpot-postgres",
      "penpot-valkey",
    ]);
    expect(activeServices(model).map(([n]) => n)).not.toContain("penpot-mailcatch");
    expect(model.services["penpot-mailcatch"]?.image).toBe("sj26/mailcatcher:v0.11.0");
    expect(model.services["penpot-backend"]?.environment?.["PENPOT_FLAGS"]).toBe(
      "enable-mcp enable-prepl-server disable-registration ",
    );
    expect(model["x-flags"]).toEqual({
      PENPOT_FLAGS: "enable-mcp enable-prepl-server disable-registration ",
    });

    // the vendored compose alone breaks the invariants, so the checker is not vacuous
    expect(() => assertPenpotComposeInvariants(loadComposeModel([base], synthetic))).toThrow(
      /change-this-insecure-key/,
    );
    const mutate = (edit: (m: ComposeModel) => void): ComposeModel => {
      const copy = structuredClone(model);
      edit(copy);
      return copy;
    };
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          frontend(m).image = "penpotapp/frontend:2.16";
        }),
      ),
    ).toThrow(/not pinned/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          m.services["penpot-valkey"]!.image = "valkey/valkey:latest";
        }),
      ),
    ).toThrow(/unpinned/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          delete m.services["penpot-mailcatch"]?.profiles;
        }),
      ),
    ).toThrow(/mailcatch is active/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          m["x-flags"] = { PENPOT_FLAGS: "disable-email-verification" };
        }),
      ),
    ).toThrow(/disable-email-verification/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          m.services["penpot-backend"]!.environment!["PENPOT_TELEMETRY_ENABLED"] = "true";
        }),
      ),
    ).toThrow(/telemetry/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          m.services["penpot-postgres"]!.environment!["POSTGRES_PASSWORD"] = "penpot";
        }),
      ),
    ).toThrow(/database password/);
    expect(() =>
      assertPenpotComposeInvariants(
        mutate((m) => {
          frontend(m).environment!["PENPOT_FLAGS"] = "enable-smtp";
        }),
      ),
    ).toThrow(/enable-mcp/);
  });

  test("fails interpolation without the version or any secret and binds to loopback", () => {
    const without = (key: string): Record<string, string> =>
      Object.fromEntries(Object.entries(synthetic).filter(([k]) => k !== key));
    for (const key of [
      "PENPOT_VERSION",
      "PENPOT_SECRET_KEY",
      "PENPOT_DB_PASSWORD",
      "PENPOT_PUBLIC_URI",
    ]) {
      expect(() => load(without(key))).toThrow(new RegExp(key));
      expect(() => load({ ...synthetic, [key]: "" })).toThrow(new RegExp(key));
    }
    const model = load(synthetic);
    expect(model.services["penpot-frontend"]?.ports).toEqual(["127.0.0.1:9001:8080"]);
    expect(model.services["penpot-frontend"]?.image).toBe("penpotapp/frontend:2.17.2");
    expect(
      load({ ...synthetic, PENPOT_BIND_ADDRESS: "0.0.0.0" }).services["penpot-frontend"]?.ports,
    ).toEqual(["0.0.0.0:9001:8080"]);
    expect(() =>
      assertPenpotComposeInvariants(load({ ...synthetic, PENPOT_BIND_ADDRESS: "0.0.0.0" })),
    ).toThrow(/outside loopback/);
    // Bun.YAML drops the tag, so the text is the proof: without it Compose would also keep 0.0.0.0:9001
    expect(override).toMatch(/^ {4}ports: !override$/m);
    // no insecure default survives in the override text, including the 2.16 fallback
    expect(override).not.toContain(":-2.16");
    expect(override).not.toMatch(/PENPOT_VERSION:-/);
    expect(model.services["penpot-backend"]?.environment?.["PENPOT_TELEMETRY_ENABLED"]).toBe(
      "false",
    );
    // the interpolation forms of the compose spec
    const env = { A: "a", E: "" };
    expect(interpolateCompose("${A}|${E:-d}|${E-d}|${U:-d}|${U-d}|$$x", env)).toBe("a|d||d|d|$x");
  });

  test("vendored compose matches its recorded sha256 and the fetch script is https-only", () => {
    const digest = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(infra, "docker-compose.yaml")))
      .digest("hex");
    expect(read("infra/penpot/docker-compose.yaml.sha256")).toBe(
      `${digest}  infra/penpot/docker-compose.yaml\n`,
    );
    expect(read("infra/penpot/.env.example")).toContain("PENPOT_VERSION=2.17.2\n");
    const script = read("infra/penpot/fetch-compose");
    expect(script).toMatch(/^set -eu$/m);
    expect(script).toContain("--proto '=https'");
    expect(script).toContain("--tlsv1.2");
    expect(script).toContain('url="https://raw.githubusercontent.com/penpot/penpot/${version}/');
    expect(script).not.toMatch(/latest|http:\/\//);
    // usage and version validation exit 2 before any network access
    expect(run([join(infra, "fetch-compose"), "--bogus"], scriptEnv({})).code).toBe(2);
    expect(run([join(infra, "fetch-compose")], scriptEnv({ PENPOT_VERSION: "latest" })).code).toBe(
      2,
    );
    expect(statSync(join(infra, "fetch-compose")).mode & 0o111).not.toBe(0);
  });
});

describe("penpot secrets and operation", () => {
  const initEnv = join(infra, "init-env");

  test("generates the Penpot secrets once with mode 0600 and keeps them out of Git", () => {
    const dir = tempDir();
    const file = join(dir, ".env");
    const first = run([initEnv], scriptEnv({ PENPOT_ENV_FILE: file }));
    expect(first.code).toBe(0);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const values = parseEnv(readFileSync(file, "utf8"));
    expect(values["PENPOT_SECRET_KEY"]).toMatch(/^[0-9a-f]{128}$/);
    expect(values["PENPOT_DB_PASSWORD"]).toMatch(/^[0-9a-f]{64}$/);
    expect(values["PENPOT_VERSION"]).toBe("2.17.2");
    // nothing secret is printed
    expect(first.out).not.toContain(values["PENPOT_SECRET_KEY"] ?? "?");

    // a second run leaves the file untouched
    const before = readFileSync(file, "utf8");
    expect(run([initEnv], scriptEnv({ PENPOT_ENV_FILE: file })).code).toBe(1);
    expect(readFileSync(file, "utf8")).toBe(before);
    // a second generation elsewhere differs
    const other = join(dir, "other.env");
    expect(run([initEnv], scriptEnv({ PENPOT_ENV_FILE: other })).code).toBe(0);
    expect(parseEnv(readFileSync(other, "utf8"))["PENPOT_SECRET_KEY"]).not.toBe(
      values["PENPOT_SECRET_KEY"],
    );
    expect(run([initEnv, "extra"], scriptEnv({ PENPOT_ENV_FILE: join(dir, "x.env") })).code).toBe(
      2,
    );

    const ignored = (path: string): number =>
      run(["git", "check-ignore", "--no-index", "-q", path], scriptEnv({})).code;
    expect(ignored("infra/penpot/.env")).toBe(0);
    expect(ignored("infra/penpot/.env.local")).toBe(0);
    expect(ignored("infra/penpot/.env.example")).toBe(1);
  });

  /** A working directory with a generated .env and a fake `docker` that records each call in `calls`. */
  const sandbox = (): {
    env: string;
    calls: string;
    run: (args: string[], extra?: Record<string, string>) => { code: number; out: string };
  } => {
    const dir = tempDir();
    const env = join(dir, ".env");
    expect(run([initEnv], scriptEnv({ PENPOT_ENV_FILE: env })).code).toBe(0);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const calls = join(dir, "calls");
    writeFileSync(join(bin, "docker"), `#!/bin/sh\necho "$@" >> "${calls}"\n`);
    chmodSync(join(bin, "docker"), 0o755);
    return {
      env,
      calls,
      run: (args, extra = {}) =>
        run(
          [join(infra, "compose"), ...args],
          scriptEnv({
            PATH: `${bin}:${process.env["PATH"] ?? ""}`,
            PENPOT_ENV_FILE: env,
            ...extra,
          }),
        ),
    };
  };

  test("refuses an open env file or insecure extra flags before calling docker", () => {
    const ok = sandbox();
    expect(ok.run(["--check"]).code).toBe(0);
    expect(existsSync(ok.calls)).toBe(false);
    expect(ok.run(["config", "--services"]).code).toBe(0);
    const call = readFileSync(ok.calls, "utf8");
    expect(call).toContain("compose -p penpot --env-file");
    expect(call).toContain("docker-compose.yaml -f");
    expect(call).toContain("compose.override.yaml config --services");

    const open = sandbox();
    chmodSync(open.env, 0o644);
    expect(open.run(["--check"]).code).toBe(2);
    expect(open.run(["config"]).code).toBe(2);

    const missing = sandbox();
    rmSync(missing.env);
    expect(missing.run(["--check"]).code).toBe(2);

    const inEnv = sandbox();
    writeFileSync(
      inEnv.env,
      `${readFileSync(inEnv.env, "utf8")}PENPOT_EXTRA_FLAGS=enable-smtp disable-secure-session-cookies\n`,
    );
    expect(inEnv.run(["up", "-d"]).code).toBe(2);

    const inShell = sandbox();
    expect(
      inShell.run(["up", "-d"], { PENPOT_EXTRA_FLAGS: "disable-email-verification" }).code,
    ).toBe(2);
    expect(inShell.run(["--check"], { PENPOT_EXTRA_FLAGS: "enable-smtp" }).code).toBe(0);

    for (const s of [open, missing, inEnv, inShell]) {
      expect(existsSync(s.calls)).toBe(false);
    }
  });
});
