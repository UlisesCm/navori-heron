/**
 * Opt-in live check of the Penpot compose files (specs/0005 DR4, DR41): `HERON_LIVE_COMPOSE=1 bun run test:live:compose`.
 * It runs the real `docker compose config` with the SYNTHETIC env file (never a real secret: `config` prints the
 * interpolated values) and applies the same R1 invariants as `tests/infra/penpot-compose.test.ts` to the model
 * Compose itself produces. It needs Docker, never the network, and does nothing without the variable.
 */
import { join } from "node:path";
import { assertPenpotComposeInvariants, type ComposeModel } from "../helpers/compose.ts";

if (process.env["HERON_LIVE_COMPOSE"] !== "1") {
  console.log(
    "penpot-compose.live: skipped (set HERON_LIVE_COMPOSE=1 to run it against the real docker compose)",
  );
  process.exit(0);
}

const root = new URL("../../", import.meta.url).pathname;
const compose = [
  "docker",
  "compose",
  "-p",
  "penpot-check",
  "--env-file",
  join(root, "tests/assets/infra/penpot.synthetic.env"),
  "-f",
  join(root, "infra/penpot/docker-compose.yaml"),
  "-f",
  join(root, "infra/penpot/compose.override.yaml"),
];

const exec = (argv: string[]): string => {
  const r = Bun.spawnSync(argv, { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0)
    throw new Error(
      `${argv.slice(0, 3).join(" ")} failed (exit ${r.exitCode}): ${r.stderr.toString().trim()}`,
    );
  return r.stdout.toString();
};

let failed = false;
const check = (name: string, fn: () => void): void => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed = true;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

console.log(exec(["docker", "compose", "version"]).trim());
const model = JSON.parse(exec([...compose, "config", "--format", "json"])) as ComposeModel;
check("assertPenpotComposeInvariants on the real docker compose config", () =>
  assertPenpotComposeInvariants(model),
);
check("config --services lists no penpot-mailcatch", () => {
  const services = exec([...compose, "config", "--services"])
    .split("\n")
    .filter(Boolean);
  if (services.includes("penpot-mailcatch")) throw new Error("penpot-mailcatch is listed");
  if (!services.includes("penpot-mcp")) throw new Error("penpot-mcp is missing");
});
process.exit(failed ? 1 : 0);
