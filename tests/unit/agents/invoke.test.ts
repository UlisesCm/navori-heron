import { describe, expect, test } from "bun:test";
import { createFakeProvider, fakeProvider } from "../../../src/agents/adapters/fake/index.ts";
import { buildContextPack } from "../../../src/agents/context-pack.ts";
import { runAgentTask } from "../../../src/agents/invoke.ts";
import type {
  AgentProvider,
  AgentRequest,
  ContextItem,
  ContextPack,
  ProviderServices,
} from "../../../src/agents/ports.ts";
import { AGENT_PROVIDERS, providerFor } from "../../../src/agents/registry.ts";
import { AGENT_TASKS } from "../../../src/agents/tasks.ts";
import type { FindingIssue } from "../../../src/core/contracts/index.ts";
import type { LogFields, Logger } from "../../../src/security/logger.ts";
import { refusingRunner } from "../../helpers/agents.ts";

const services: ProviderServices = {
  runner: refusingRunner,
  temp: {
    create() {
      throw new Error("the fake provider never needs a temp dir");
    },
  },
  env: {},
  probeTimeoutMs: 4_000,
  killGraceMs: 3_000,
};
const item = (kind: ContextItem["kind"], id: string, content: string): ContextItem => ({
  kind,
  id,
  trust: kind === "reference-origin" ? "untrusted" : "operator",
  priority: 0,
  content,
  findings: 0,
});
const packOf = (
  items: ContextItem[],
  task: Pick<(typeof AGENT_TASKS)["probe"], "id" | "allowedItems"> = AGENT_TASKS["research-brief"],
): ContextPack => {
  const result = buildContextPack({
    task: task.id,
    budget: 100_000,
    allowed: task.allowedItems,
    items,
  });
  if (!result.ok) throw new Error("pack over budget");
  return result.pack;
};
const brief = {
  queries: [1, 2, 3].map((n) => ({
    facet: "visual-style",
    job: `job ${n}`,
    query: `query ${n}`,
    question: `question ${n}`,
    rationale: `rationale ${n}`,
  })),
};
const events: { name: string; fields: LogFields }[] = [];
const logger: Logger = { event: (name, fields) => events.push({ name, fields }) };
const RUN = "run-20261001T000000Z-deadbeef";

/** Wraps a provider and records every request it receives. */
function recording(inner: AgentProvider): { provider: AgentProvider; requests: AgentRequest[] } {
  const requests: AgentRequest[] = [];
  return {
    requests,
    provider: {
      ...inner,
      invoke: (request, svc) => {
        requests.push(request);
        return inner.invoke(request, svc);
      },
    },
  };
}
const run = (provider: AgentProvider, pack: ContextPack, validate = (): FindingIssue[] => []) =>
  runAgentTask(
    {
      spec: AGENT_TASKS["research-brief"],
      provider,
      model: "m1",
      pack,
      timeoutMs: 1_000,
      validate,
      runId: RUN,
      logger,
    },
    services,
  );

const BIG_ORIGINAL = "ORIGINAL-PACK-MARKER ".repeat(50);
const bigPack = (): ContextPack =>
  packOf([
    item("task-input", "task-input", "facets: visual-style\nvalid ids: REF-1"),
    item("reference", "REF-1", BIG_ORIGINAL),
    item("operator-query", "operator-query", "an operator query"),
  ]);

describe("runAgentTask", () => {
  test("repairs with validation issues and stops after the third attempt", async () => {
    // Covers: R3, R20
    events.length = 0;
    const { provider, requests } = recording(
      createFakeProvider([
        { output: { queries: [] } },
        { text: "not json" },
        { output: { queries: [] } },
        { output: brief },
      ]),
    );
    const outcome = await run(provider, bigPack());
    expect(outcome.status).toBe("invalid-output");
    expect(requests.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(outcome.invocations.map((i) => [i.attempt, i.kind, i.status])).toEqual([
      [1, "initial", "invalid-output"],
      [2, "repair", "invalid-output"],
      [3, "repair", "invalid-output"],
    ]);
    expect(requests[1]?.templateId).toBe("shared/repair");
    expect(events.filter((e) => e.name === "agent.invocation")).toHaveLength(3);

    // A domain-validation issue is repaired; the second attempt succeeds.
    let calls = 0;
    const second = recording(createFakeProvider([{ output: brief }, { output: brief }]));
    const repaired = await run(second.provider, bigPack(), () =>
      (calls += 1) === 1 ? [{ pointer: "/queries/0", message: "unknown facet" }] : [],
    );
    expect(repaired.status).toBe("succeeded");
    expect(repaired.invocations).toHaveLength(2);
    expect(second.requests[1]?.pack.text).toContain("/queries/0: unknown facet");
  });

  test("does not retry timeouts, failures or an unready provider", async () => {
    // Covers: R3
    const timeout = recording(
      createFakeProvider([{ status: "timeout", detail: "slow" }, { output: brief }]),
    );
    const out = await run(timeout.provider, bigPack());
    expect(out.status).toBe("timeout");
    expect(timeout.requests).toHaveLength(1);

    const down: AgentProvider = {
      ...fakeProvider,
      probe: () =>
        Promise.resolve({ status: "missing", cliVersion: null, minimum: null, detail: "no cli" }),
    };
    const unavailable = await run(down, bigPack());
    expect(unavailable).toMatchObject({ status: "unavailable", detail: "no cli", invocations: [] });
  });

  test("sends only the previous output, the issues and the task facts in a repair", async () => {
    // Covers: R20
    const previous = { queries: [{ facet: "visual-style" }] };
    const { provider, requests } = recording(
      createFakeProvider([{ output: previous }, { output: brief }]),
    );
    const pack = bigPack();
    const outcome = await run(provider, pack);
    expect(outcome.status).toBe("succeeded");
    const [first, repair] = requests;
    expect(first?.pack.text).toContain("ORIGINAL-PACK-MARKER");
    expect(repair?.pack.items.map((i) => i.kind).toSorted()).toEqual([
      "previous-output",
      "task-input",
      "validation-issues",
    ]);
    expect(repair?.pack.text).not.toContain("ORIGINAL-PACK-MARKER");
    expect(repair?.pack.text).not.toContain("an operator query");
    expect(repair?.pack.text).toContain("valid ids: REF-1");
    expect(repair?.pack.text).toContain('"facet":"visual-style"');
    expect(repair?.pack.chars).toBeLessThan(pack.chars);
    expect(outcome.invocations[1]?.input.sha256).toBe(repair?.pack.sha256 as string);
  });

  test("produces deterministic SYNTHETIC outputs with the fake provider", async () => {
    // Covers: R11
    for (const task of Object.values(AGENT_TASKS)) {
      const pack = packOf(
        [
          item("task-input", "task-input", "facets: visual-style, flow"),
          ...(task.allowedItems.includes("reference")
            ? [item("reference", "REF-1", "r1"), item("reference", "REF-2", "r2")]
            : []),
        ],
        task,
      );
      const request = (): AgentRequest => ({
        task: task.id,
        attempt: 1,
        templateId: task.template.id,
        system: task.template.text,
        pack,
        outputSchema: task.output,
        model: null,
        timeoutMs: 1_000,
      });
      const a = await fakeProvider.invoke(request(), services);
      const b = await fakeProvider.invoke(request(), services);
      expect(a.status).toBe("succeeded");
      expect(a).toEqual(b);
      if (a.status === "succeeded" && task.id !== "probe") {
        expect(a.outputText).toContain("SYNTHETIC");
      }
    }
    expect(await fakeProvider.probe(services, "full")).toMatchObject({ status: "ready" });
  });

  test("resolves every provider id from the registry", () => {
    // Covers: R11
    for (const id of ["claude-code", "codex-cli", "fake"] as const) {
      expect(providerFor(id)).toBe(AGENT_PROVIDERS[id]);
      expect(providerFor(id).id).toBe(id);
    }
  });
});
