// Covers: R6, R7
import { afterEach, expect, test } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { penpotChecks, runPenpotDoctor } from "../../../src/app/penpot-doctor.ts";
import { DOCTOR_CHECK_IDS } from "../../../src/core/contracts/index.ts";
import { openWorkspace } from "../../helpers/agents.ts";
import { fixedContext } from "../../helpers/cli.ts";
import { hashTree } from "../../helpers/fixtures.ts";
import { CANARY_MCP_KEY, linkedWorkspace } from "../../helpers/penpot.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("fails fast without plugin and never leaks the MCP key", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const before = hashTree(probe.root, { exclude: [] });
  probe.controls.executeFailure = {
    kind: "plugin-not-connected",
    detail: `https://user:pass@example.test/mcp/stream?userToken=${CANARY_MCP_KEY}`,
  };
  const result = await runPenpotDoctor(probe.ctx, { path: probe.root });
  expect(result).toMatchObject({ ok: false, code: 5 });
  expect(result.data?.checks.map((check) => check.id)).toEqual(
    DOCTOR_CHECK_IDS.filter((id) => id.startsWith("penpot.")),
  );
  expect(result.data?.checks.find((check) => check.id === "penpot.plugin")).toMatchObject({
    status: "FAIL",
    remedy: expect.stringContaining("Connect"),
  });
  expect(result.data?.checks.find((check) => check.id === "penpot.file")).toMatchObject({
    status: "WARNING",
    message: expect.stringContaining("Skipped"),
  });
  expect(probe.calls).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain(CANARY_MCP_KEY);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
});

test("reports a rejected key, another file and an untested version with remedies", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const before = hashTree(probe.root, { exclude: [] });
  probe.controls.connectFailure = { kind: "rejected", detail: `HTTP 401 ${CANARY_MCP_KEY}` };
  let result = await runPenpotDoctor(probe.ctx, { path: probe.root });
  expect(result).toMatchObject({ ok: false, code: 5 });
  expect(result.data?.checks.find((check) => check.id === "penpot.mcp")).toMatchObject({
    status: "FAIL",
    remedy: expect.stringContaining("new MCP key"),
  });
  expect(probe.calls).toHaveLength(0);
  expect(JSON.stringify(result)).not.toContain(CANARY_MCP_KEY);
  probe.controls.connectFailure = null;
  if (probe.fake.penpot.currentFile === null) throw new Error("test file absent");
  probe.fake.penpot.currentFile.id = "other-file";
  probe.fake.penpot.currentFile.name = CANARY_MCP_KEY;
  result = await runPenpotDoctor(probe.ctx, { path: probe.root });
  expect(result).toMatchObject({ ok: false, code: 4 });
  expect(result.data?.checks.find((check) => check.id === "penpot.file")).toMatchObject({
    status: "FAIL",
    remedy: expect.stringContaining("bound file"),
  });
  expect(JSON.stringify(result)).not.toContain(CANARY_MCP_KEY);
  probe.fake.penpot.currentFile.id = "file-1";
  probe.fake.penpot.version = "99.0.0";
  result = await runPenpotDoctor(probe.ctx, { path: probe.root });
  expect(result.ok).toBe(true);
  expect(result.data?.checks.find((check) => check.id === "penpot.version")).toMatchObject({
    status: "WARNING",
    remedy: expect.stringContaining("tested versions"),
  });
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
});

test("skips dependencies after local configuration failures and warns on an open key file", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  const project = openWorkspace(probe.ctx, probe.root).project;
  expect((await penpotChecks(fixedContext(), null))[0]?.status).toBe("FAIL");
  const missingUrl = await penpotChecks(fixedContext(), project);
  expect(missingUrl[1]?.status).toBe("FAIL");
  expect(missingUrl[2]?.message).toContain("Skipped");
  const missingKey = await penpotChecks(
    fixedContext({ env: { PENPOT_URL: "http://localhost:9001" } }),
    project,
  );
  expect(missingKey[2]?.status).toBe("FAIL");
  const keyFile = join(probe.root, "synthetic-key");
  writeFileSync(keyFile, CANARY_MCP_KEY, { mode: 0o600 });
  chmodSync(keyFile, 0o644);
  const ctx = {
    ...probe.ctx,
    env: { PENPOT_URL: "http://localhost:9001", PENPOT_MCP_KEY_FILE: keyFile },
  };
  const before = hashTree(probe.root, { exclude: [] });
  const checks = await penpotChecks(ctx, project);
  expect(checks[2]).toMatchObject({
    status: "WARNING",
    remedy: expect.stringContaining("chmod 600"),
  });
  expect(checks.slice(3).every((check) => check.status === "PASS")).toBe(true);
  expect(hashTree(probe.root, { exclude: [] })).toEqual(before);
  expect(await runPenpotDoctor(fixedContext(), { path: "/nonexistent-heron-path" })).toMatchObject({
    ok: false,
    code: 4,
  });
});

test("maps deadlines and incompatible MCP without reading or writing further", async () => {
  const probe = await linkedWorkspace();
  roots.push(probe.root);
  for (const kind of ["timeout", "incompatible", "unreachable"] as const) {
    probe.controls.connectFailure = { kind, detail: `${CANARY_MCP_KEY} raw transport detail` };
    const result = await runPenpotDoctor(probe.ctx, { path: probe.root });
    expect(result).toMatchObject({ ok: false, code: 5 });
    expect(JSON.stringify(result)).not.toContain(CANARY_MCP_KEY);
    expect(result.data?.checks[3]?.status).toBe("FAIL");
    expect(result.data?.checks[4]?.message).toContain("Skipped");
  }
  expect(probe.calls).toHaveLength(0);
  probe.controls.connectFailure = null;
  probe.fake.penpot.currentFile = null;
  expect((await runPenpotDoctor(probe.ctx, { path: probe.root })).data?.checks[4]?.status).toBe(
    "FAIL",
  );
});
