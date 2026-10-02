import { expect } from "bun:test";
import { runPenpotLink } from "../../src/app/penpot.ts";
import type { AppContext } from "../../src/app/context.ts";
import type { PenpotConnectRequest, PenpotFailure, PenpotGateway } from "../../src/penpot/ports.ts";
import { initializedRoot, withAgentSettings } from "./agents.ts";
import { fixedContext, runCliCaptured } from "./cli.ts";
import { createFakePenpot, runPenpotScript } from "./fake-penpot.ts";
import { referenceArgs } from "./research.ts";

export const CANARY_MCP_KEY = "SYNTHETIC-PENPOT-CANARY-DO-NOT-LEAK";
export const penpotEnv = (): Record<string, string> => ({
  PENPOT_URL: "http://localhost:9001",
  PENPOT_MCP_KEY: CANARY_MCP_KEY,
});

/** Production session/templates over the Plugin API double, never a socket or real Penpot. */
export function fakePenpotContext(): {
  ctx: AppContext;
  fake: ReturnType<typeof createFakePenpot>;
  calls: { code: string; timeoutMs: number }[];
  connections: PenpotConnectRequest[];
  closed: () => number;
  controls: { connectFailure: PenpotFailure | null; executeFailure: PenpotFailure | null };
} {
  const fake = createFakePenpot();
  const calls: { code: string; timeoutMs: number }[] = [];
  const connections: PenpotConnectRequest[] = [];
  const controls: { connectFailure: PenpotFailure | null; executeFailure: PenpotFailure | null } = {
    connectFailure: null,
    executeFailure: null,
  };
  let closes = 0;
  const gateway: PenpotGateway = {
    id: "mcp",
    connect: async (request) => {
      connections.push(request);
      if (controls.connectFailure !== null)
        return { ok: false, failure: controls.connectFailure, durationMs: 0 };
      return {
        ok: true,
        server: null,
        runner: {
          execute: async (code, timeoutMs) => {
            calls.push({ code, timeoutMs });
            if (controls.executeFailure !== null)
              return { ok: false, failure: controls.executeFailure, durationMs: 0 };
            return {
              ok: true,
              text: JSON.stringify({ result: await runPenpotScript(fake, code), log: "" }),
              durationMs: 0,
            };
          },
          close: async () => {
            closes += 1;
          },
        },
      };
    },
  };
  const ctx = fixedContext({ env: penpotEnv() });
  return {
    ctx: { ...ctx, penpot: { ...ctx.penpot, gateway } },
    fake,
    calls,
    connections,
    closed: () => closes,
    controls,
  };
}

/** Generate visual-directions.json through the public CLI and fake creator. Caller owns cleanup. */
export async function directionsWorkspace(): Promise<
  ReturnType<typeof fakePenpotContext> & { root: string }
> {
  const probe = fakePenpotContext();
  const root = await initializedRoot(probe.ctx);
  withAgentSettings(root, { roles: { creator: "fake" } });
  expect((await runCliCaptured(["init", root], probe.ctx)).code).toBe(0);
  for (let n = 1; n <= 5; n += 1)
    expect(
      (
        await runCliCaptured(
          [...referenceArgs(root, ["origin"]), "--origin", `Source ${n}`],
          probe.ctx,
        )
      ).code,
    ).toBe(0);
  expect(
    (await runCliCaptured(["gate", "research", "approve", "--yes", root], probe.ctx)).code,
  ).toBe(0);
  expect((await runCliCaptured(["direction", "propose", root], probe.ctx)).code).toBe(0);
  return { ...probe, root };
}

export async function linkedWorkspace(): Promise<Awaited<ReturnType<typeof directionsWorkspace>>> {
  const workspace = await directionsWorkspace();
  expect((await runPenpotLink(workspace.ctx, { path: workspace.root, fileId: null })).ok).toBe(
    true,
  );
  workspace.calls.length = 0;
  workspace.connections.length = 0;
  return workspace;
}
