// Covers: R4, R8, R13, R17
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { openPenpotSession, parseExecuteText } from "../../../src/penpot/session.ts";
import type {
  PenpotConnectRequest,
  PenpotExecution,
  PenpotGateway,
  PenpotSession,
} from "../../../src/penpot/ports.ts";
import { buildReferencesPage } from "../../../src/penpot/compiler/references-page.ts";
import { resolvePenpotCopy } from "../../../src/penpot/compiler/copy.ts";
import { penpotTemplate } from "../../../src/penpot/compiler/templates.ts";
import { createFakePenpot, runPenpotScript } from "../../helpers/fake-penpot.ts";
import { sampleReference } from "../../helpers/research.ts";

const request: PenpotConnectRequest = {
  baseUrl: "http://localhost:9001",
  key: "SYNTHETIC-secret",
  timeoutMs: 1234,
  clientVersion: "0.1.0",
  redact: (text) => text.replaceAll("SYNTHETIC-secret", "[REDACTED]"),
};
const page = buildReferencesPage([sampleReference()], {
  mode: "reference-only",
  copy: resolvePenpotCopy("en"),
  template: penpotTemplate("review-page"),
});
async function setup(): Promise<{
  session: PenpotSession;
  fake: ReturnType<typeof createFakePenpot>;
  calls: { code: string; timeout: number }[];
  closed: () => number;
  setReply: (value: PenpotExecution | null) => void;
}> {
  const fake = createFakePenpot();
  const calls: { code: string; timeout: number }[] = [];
  let closes = 0;
  let reply: PenpotExecution | null = null;
  const gateway: PenpotGateway = {
    id: "mcp",
    connect: async (received) => {
      expect(received).toBe(request);
      return {
        ok: true,
        server: { name: "penpot", version: "1.0.0" },
        runner: {
          execute: async (code, timeoutMs) => {
            calls.push({ code, timeout: timeoutMs });
            return (
              reply ?? {
                ok: true,
                text: JSON.stringify({ result: await runPenpotScript(fake, code), log: "" }),
                durationMs: 0,
              }
            );
          },
          close: async () => {
            closes += 1;
          },
        },
      };
    },
  };
  const opened = await openPenpotSession(gateway, request);
  if (!opened.ok) throw new Error("fake gateway must connect");
  expect(opened.server).toEqual({ name: "penpot", version: "1.0.0" });
  return {
    session: opened.session,
    fake,
    calls,
    closed: () => closes,
    setReply: (value) => {
      reply = value;
    },
  };
}

describe("Penpot session", () => {
  test("executes the requested review version and rejects a mismatched result version", async () => {
    const { session, setReply } = await setup();
    const next = buildReferencesPage([sampleReference()], {
      mode: "reference-only",
      copy: resolvePenpotCopy("en"),
      template: penpotTemplate("review-page", 2),
    });
    const result = await session.apply(next, null, 100);
    expect(result).toMatchObject({
      ok: true,
      value: { heron: "review-page@v2", outcome: "written" },
    });
    if (!result.ok) throw new Error("v2 write failed");
    setReply({
      ok: true,
      text: JSON.stringify({ result: { ...result.value, heron: "review-page@v1" }, log: "" }),
      durationMs: 0,
    });
    expect(await session.apply(next, null, 100)).toMatchObject({
      ok: false,
      failure: { kind: "incompatible" },
    });
  });
  test("parses template results and maps execution failures", async () => {
    const schema = z.object({ ok: z.literal(1) });
    expect(
      parseExecuteText(JSON.stringify({ result: { ok: 1 }, log: "SYNTHETIC-secret" }), schema),
    ).toEqual({ ok: true, value: { ok: 1 } });
    for (const text of [
      "not JSON",
      "null",
      '{"result":{"ok":1}}',
      '{"result":{"ok":1},"log":[]}',
      '{"log":""}',
      '{"result":{"ok":2},"log":"SYNTHETIC-secret"}',
    ]) {
      const result = parseExecuteText(text, schema);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("SYNTHETIC-secret");
    }
    const { session, setReply } = await setup();
    for (const kind of [
      "timeout",
      "unreachable",
      "rejected",
      "incompatible",
      "plugin-not-connected",
      "script-failed",
    ] as const) {
      const failure = { kind, detail: "redacted failure" };
      setReply({ ok: false, failure, durationMs: 1 });
      expect(await session.inspect(100)).toEqual({ ok: false, failure });
    }
    const failure = { kind: "timeout" as const, detail: "redacted failure" };
    setReply({ ok: false, failure, durationMs: 1 });
    expect(await session.apply(page, null, 200)).toEqual({ ok: false, failure });
    const refusing: PenpotGateway = {
      id: "mcp",
      connect: async () => ({ ok: false, failure, durationMs: 0 }),
    };
    expect(await openPenpotSession(refusing, request)).toEqual({ ok: false, failure });
  });
  test("runs registered templates through FakePenpot and delegates close and timeouts", async () => {
    const { session, fake, calls, closed } = await setup();
    const before = fake.counters.mutations;
    expect((await session.inspect(111)).ok).toBe(true);
    expect(fake.counters.mutations).toBe(before);
    const written = await session.apply(page, null, 222);
    if (!written.ok) throw new Error("write must succeed");
    expect(written.value).toMatchObject({ outcome: "written", created: true });
    expect((await session.inspect(333)).ok).toBe(true);
    expect(await session.apply(page, written.value.pageId, 444)).toMatchObject({
      ok: true,
      value: { outcome: "written", created: false },
    });
    expect(calls.map((call) => call.timeout)).toEqual([111, 222, 333, 444]);
    await session.close();
    expect(closed()).toBe(1);
  });
  test("maps conflicts to the fixed retry detail but preserves human-shapes for the caller", async () => {
    const { session, setReply } = await setup();
    const result = {
      heron: "review-page@v1",
      pageId: "page",
      created: false,
      shapes: 0,
      fontFallbacks: [],
      humanShapes: [],
    };
    setReply({
      ok: true,
      text: JSON.stringify({ result: { ...result, outcome: "conflict" }, log: "" }),
      durationMs: 0,
    });
    expect(await session.apply(page, "page", 123)).toEqual({
      ok: false,
      failure: {
        kind: "script-failed",
        detail:
          "another write to this page ran at the same time; run heron penpot sync again once Penpot is idle",
      },
    });
    setReply({
      ok: true,
      text: JSON.stringify({
        result: { ...result, outcome: "human-shapes", humanShapes: ["SYNTHETIC human"] },
        log: "",
      }),
      durationMs: 0,
    });
    expect(await session.apply(page, "page", 123)).toMatchObject({
      ok: true,
      value: { outcome: "human-shapes", humanShapes: ["SYNTHETIC human"] },
    });
    setReply({ ok: true, text: "not JSON", durationMs: 0 });
    expect(await session.apply(page, "page", 123)).toMatchObject({
      ok: false,
      failure: { kind: "incompatible" },
    });
  });
  test("rejects oversized writing scripts before calling the runner", async () => {
    const { session, calls } = await setup();
    expect(await session.apply({ ...page, name: "😀".repeat(32768) }, null, 100)).toMatchObject({
      ok: false,
      failure: { kind: "script-failed" },
    });
    expect(calls).toEqual([]);
  });
});

// Covers: R12, R17
test("fails closed on absent v4 binding, requested legacy binding and malformed mismatch envelopes", async () => {
  const { session, calls, setReply } = await setup();
  const bound = buildReferencesPage([sampleReference()], {
    mode: "reference-only",
    copy: resolvePenpotCopy("en"),
    template: penpotTemplate("review-page", 4),
    expectedFileId: "file-1",
  });
  for (const binding of [undefined, ""])
    expect(await session.apply(bound, null, 100, binding)).toMatchObject({
      ok: false,
      failure: { kind: "file-mismatch" },
    });
  for (const version of [1, 2, 3])
    expect(
      await session.apply(
        { ...page, template: penpotTemplate("review-page", version).ref },
        null,
        100,
        "file-1",
      ),
    ).toMatchObject({ ok: false, failure: { kind: "file-mismatch" } });
  expect(calls).toHaveLength(0);
  setReply({
    ok: true,
    text: JSON.stringify({
      result: { heron: "review-page@v4", outcome: "file-mismatch" },
      log: "",
    }),
    durationMs: 0,
  });
  expect(await session.apply(bound, null, 100, "file-1")).toMatchObject({
    ok: false,
    failure: { kind: "file-mismatch" },
  });
  for (const result of [
    { heron: "review-page@v3", outcome: "file-mismatch" },
    { heron: "review-page@v4" },
    { heron: "review-page@v4", outcome: "file-mismatch", pageId: "invented" },
  ]) {
    setReply({ ok: true, text: JSON.stringify({ result, log: "" }), durationMs: 0 });
    expect(await session.apply(bound, null, 100, "file-1")).toMatchObject({
      ok: false,
      failure: { kind: "incompatible" },
    });
  }
});
