// Covers: R18, R20
/** Opt-in, mutating probe. Use only a disposable file; fixtures are deliberately not cleaned up. */
import { readFileSync } from "node:fs";
import { z } from "zod";
import asset from "../assets/penpot/direction-proposal.json" with { type: "json" };
import { VisualDirectionsSchema } from "../../src/core/contracts/index.ts";
import { sha256Hex } from "../../src/core/store/hash.ts";
import { parsePenpotUrl } from "../../src/penpot/config.ts";
import { resolvePenpotCopy } from "../../src/penpot/compiler/copy.ts";
import { contentSha256 } from "../../src/penpot/compiler/ids.ts";
import { makeBoard, makeRect, type ReviewPage } from "../../src/penpot/compiler/nodes.ts";
import { planReviewSync } from "../../src/penpot/compiler/plan.ts";
import { buildProposalPage } from "../../src/penpot/compiler/proposal-page.ts";
import { MAX_SCRIPT_BYTES, renderScript } from "../../src/penpot/compiler/script.ts";
import { penpotTemplate, type PenpotTemplate } from "../../src/penpot/compiler/templates.ts";
import type { PenpotCodeRunner, SessionResult } from "../../src/penpot/ports.ts";
import { defaultPenpotGateway } from "../../src/penpot/registry.ts";
import { openPenpotSession, parseExecuteText } from "../../src/penpot/session.ts";
import { createValueRedactor } from "../../src/security/redact.ts";

if (process.env["HERON_LIVE_PENPOT"] !== "1") {
  console.log("penpot.live: skipped (set HERON_LIVE_PENPOT=1; use a disposable --file-id)");
  process.exit(0);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const fileId = args[0] === "--file-id" && args.length === 2 ? args[1] : undefined;
const url = parsePenpotUrl(process.env["PENPOT_URL"] ?? "");
const directKey = process.env["PENPOT_MCP_KEY"];
const keyFile = process.env["PENPOT_MCP_KEY_FILE"];
if (!z.uuid().safeParse(fileId).success || !url.ok || Boolean(directKey) === Boolean(keyFile)) {
  console.error(
    "penpot.live: requires --file-id UUID, valid PENPOT_URL and exactly one MCP key variable",
  );
  process.exit(1);
}
let key: string;
try {
  key = directKey ?? readFileSync(keyFile!, "utf8").trim();
  if (!key.trim()) throw new Error("empty key");
} catch {
  console.error("penpot.live: could not read a nonempty MCP key");
  process.exit(1);
}
const redact = createValueRedactor({}, [key]);
const request = {
  baseUrl: url.baseUrl,
  key,
  timeoutMs: 10_000,
  clientVersion: "0.1.0",
  redact: (text: string): string => redact.redact(text).text,
};
let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  // Only fixed labels, measured numbers and validated versions reach this sink, never errors/logs/URLs.
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
}
function requireValue<T>(result: SessionResult<T>): T {
  if (!result.ok) throw new Error(`probe dependency failed (${result.failure.kind})`);
  return result.value;
}
/** Custom probe code is trusted; external data still goes through Heron's sole renderer. */
function probeTemplate(text: string): PenpotTemplate {
  const sha256 = sha256Hex(new TextEncoder().encode(text));
  return { id: "inspect", version: 1, text, sha256, ref: { id: "inspect", version: 1, sha256 } };
}
async function execute<T>(
  runner: PenpotCodeRunner,
  text: string,
  data: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const script = renderScript(probeTemplate(text), data);
  if (!script.ok) throw new Error("probe exceeded script budget");
  const result = await runner.execute(script.code, 10_000);
  if (!result.ok) throw new Error(`probe execution failed (${result.failure.kind})`);
  return requireValue(parseExecuteText(result.text, schema));
}

const opened = await openPenpotSession(defaultPenpotGateway, request);
check("handshake and execute_code offered", opened.ok);
if (!opened.ok) process.exit(1);
const session = opened.session;
let runner: PenpotCodeRunner | null = null;
try {
  const inspected = requireValue(await session.inspect(10_000));
  check("bound disposable file (before any mutation)", inspected.file?.id === fileId);
  if (inspected.file?.id !== fileId) throw new Error("refusing to mutate another file");
  check(
    "penpot.version format",
    /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(inspected.penpotVersion),
    inspected.penpotVersion,
  );

  const raw = await defaultPenpotGateway.connect(request);
  if (!raw.ok) throw new Error("raw probe handshake failed");
  runner = raw.runner;
  const envelope = await execute(runner, "return { ok: 1 };", {}, z.object({ ok: z.literal(1) }));
  check("JSON result and string log envelope", envelope.ok === 1);
  const thrownScript = renderScript(probeTemplate('throw new Error("heron-live-error");'), {});
  if (!thrownScript.ok) throw new Error("small script budget");
  const thrown = await runner.execute(thrownScript.code, 10_000);
  check("Tool execution failed classified", !thrown.ok && thrown.failure.kind === "script-failed");

  const wrongKey = "SYNTHETIC_WRONG_PENPOT_KEY";
  const wrong = await defaultPenpotGateway.connect({ ...request, key: wrongKey });
  let wrongKind: string;
  if (!wrong.ok) wrongKind = wrong.failure.kind;
  else {
    try {
      const result = await wrong.runner.execute(thrownScript.code, 10_000);
      wrongKind = result.ok ? "unexpected-success" : result.failure.kind;
    } finally {
      await wrong.runner.close();
    }
  }
  check(
    "wrong key rejected or no plugin",
    ["rejected", "plugin-not-connected"].includes(wrongKind),
  );

  const fonts = await execute(
    runner,
    `
const partial = penpot.fonts.findByName("Inter");
const exact = penpot.fonts.all.find(font => font.name.toLowerCase() === "inter");
return { partial: partial ? partial.name : null, exact: exact ? exact.name : null,
  missing: !penpot.fonts.findByName("Heron Missing Font") };`,
    {},
    z.object({
      partial: z.string().nullable(),
      exact: z.string().nullable(),
      missing: z.boolean(),
    }),
  );
  check(
    "fonts.findByName and exact selection",
    fonts.partial !== null && fonts.exact === "Inter" && fonts.missing,
  );
  check("substring family observation", fonts.partial === "Inter Tight");

  // Backslashes double again in the RPC envelope. Include the renderer prefix in the exact 32 KiB size.
  const base = renderScript(probeTemplate("/* */\nreturn 1;"), {});
  if (!base.ok) throw new Error("small script budget");
  const padding = MAX_SCRIPT_BYTES - new TextEncoder().encode(base.code).byteLength;
  const padded = renderScript(probeTemplate(`/* ${"\\".repeat(padding)}*/\nreturn 1;`), {});
  if (!padded.ok) throw new Error("padded script budget");
  const bytes = new TextEncoder().encode(padded.code).byteLength;
  // SDK adds an integer id and jsonrpc; use a safe integer's maximum width as the conservative body measure.
  const rpcBytes = new TextEncoder().encode(
    JSON.stringify({
      jsonrpc: "2.0",
      id: Number.MAX_SAFE_INTEGER,
      method: "tools/call",
      params: { name: "execute_code", arguments: { code: padded.code } },
    }),
  ).byteLength;
  const large = await runner.execute(padded.code, 10_000);
  check(
    "32 KiB escaped script and RPC body",
    bytes === MAX_SCRIPT_BYTES &&
      large.ok &&
      requireValue(parseExecuteText(large.text, z.literal(1))) === 1,
    `script=${bytes} B; RPC<=${rpcBytes} B`,
  );

  const fixture = VisualDirectionsSchema.parse(asset);
  const template = penpotTemplate("review-page").ref;
  const proposal = buildProposalPage(fixture.directions[0]!, {
    mode: fixture.mode,
    copy: resolvePenpotCopy("en"),
    template,
  });
  const guardBase = {
    heronId: `heron:live-guard:${Date.now()}`,
    kind: "references-page" as const,
    name: "SYNTHETIC live human guard",
    mode: fixture.mode,
    sourceSha256: proposal.sourceSha256,
    template,
    nodes: [makeBoard("guard", [makeRect("child", 80, 30, { fill: "#123456" })])],
    issues: [],
  };
  const guard: ReviewPage = { ...guardBase, contentSha256: contentSha256(guardBase) };
  const desired = [proposal, guard];
  const before = requireValue(await session.inspect(10_000));
  if (before.file?.id !== fileId) throw new Error("file changed before mutation");
  const plan = planReviewSync(desired, before);
  for (const write of plan.writes) {
    const current = requireValue(await session.inspect(10_000));
    if (current.file?.id !== fileId) throw new Error("file changed before mutation");
    const result = requireValue(await session.apply(write.page, write.targetPageId, 60_000));
    check(
      `production review template ${write.page === guard ? "guard" : "proposal"}`,
      result.outcome === "written",
    );
    if (result.outcome !== "written") throw new Error("review write incomplete");
  }
  const after = requireValue(await session.inspect(10_000));
  check("second sync plans zero writes", planReviewSync(desired, after).writes.length === 0);
  const proposalPage = after.pages.find((page) => page.marks.id === proposal.heronId)!;
  const guardPage = after.pages.find((page) => page.marks.id === guard.heronId)!;
  const inactive = await execute(
    runner,
    `
await penpot.openPage(penpot.currentFile.pages.find(page => page.id === HERON.activePageId));
const page = penpot.currentFile.pages.find(page => page.id === HERON.pageId);
const board = page.root.children.find(shape => shape.getSharedPluginData("heron", "id"));
return { inactive: penpot.currentPage.id !== page.id, content: page.getSharedPluginData("heron", "content"),
  board: board.getSharedPluginData("heron", "id"), child: board.children[0].getSharedPluginData("heron", "id") };`,
    { pageId: proposalPage.pageId, activePageId: guardPage.pageId },
    z.object({ inactive: z.boolean(), content: z.string(), board: z.string(), child: z.string() }),
  );
  check(
    "inactive page and descendant marks",
    inactive.inactive &&
      inactive.content === proposal.contentSha256 &&
      inactive.board.startsWith(`${proposal.heronId}/`) &&
      inactive.child.startsWith(`${proposal.heronId}/`),
  );

  const snapshotCode = `
if (penpot.currentFile.id !== HERON.fileId) throw new Error("wrong disposable file");
const page = penpot.currentFile.pages.find(page => page.id === HERON.pageId);
const board = page.root.children.find(shape => shape.getSharedPluginData("heron", "id") === HERON.boardId);
if (HERON.addHuman) {
  await penpot.openPage(page);
  const human = penpot.createRectangle(); human.name = "SYNTHETIC human fixture";
  human.resize(20,20); board.appendChild(human);
}
return { content: page.getSharedPluginData("heron", "content"), name: page.name,
  children: board.children.map(shape => ({ id: shape.id, name: shape.name, mark: shape.getSharedPluginData("heron", "id") })) };`;
  const snapshotSchema = z.object({
    content: z.string(),
    name: z.string(),
    children: z.array(z.object({ id: z.string(), name: z.string(), mark: z.string().nullable() })),
  });
  const snapshotData = { fileId, pageId: guardPage.pageId, boardId: `${guard.heronId}/guard` };
  const humanBefore = await execute(
    runner,
    snapshotCode,
    { ...snapshotData, addHuman: true },
    snapshotSchema,
  );
  const changedBase = { ...guard, name: "SYNTHETIC attempted rewrite" };
  const changed = { ...changedBase, contentSha256: contentSha256(changedBase) };
  const blocked = requireValue(await session.apply(changed, guardPage.pageId, 60_000));
  const humanAfter = await execute(
    runner,
    snapshotCode,
    { ...snapshotData, addHuman: false },
    snapshotSchema,
  );
  check(
    "human inside owned board blocks rewrite and survives",
    blocked.outcome === "human-shapes" &&
      blocked.humanShapes.includes("SYNTHETIC human fixture") &&
      humanBefore.children.some(
        (shape) => shape.name === "SYNTHETIC human fixture" && shape.mark === null,
      ) &&
      JSON.stringify(humanBefore) === JSON.stringify(humanAfter),
  );
} catch (error: unknown) {
  // Do not print raw exceptions, transport details, logs or user-controlled file/shape names.
  check(
    "probe completed",
    false,
    error instanceof Error && error.message.startsWith("probe ")
      ? error.message
      : "stopped safely; inspect the preceding checks",
  );
} finally {
  if (runner) await runner.close();
  await session.close();
}
console.log(`penpot.live: ${failures === 0 ? "PASS" : "FAIL"}; ${failures} failed checks`);
process.exit(failures === 0 ? 0 : 1);
