import type { AgentProviderId, AgentUsage } from "../../../core/contracts/index.ts";
import { schemaIssues, unfence } from "../../cli-adapter.ts";
import type { AgentAttempt, AgentProvider, AgentRequest } from "../../ports.ts";
import { RESPONDERS } from "./responders.ts";

/** One scripted answer of `createFakeProvider`: a ready output, raw text (parsed like a CLI would), or a failure. */
export type FakeStep =
  | { output: unknown }
  | { text: string }
  | { status: "timeout" | "failed" | "policy-violation"; detail: string };

const FAKE_VERSION = "fake-1";

/** Deterministic usage (about 4 chars per token) so token totals are testable; never a real cost. */
function usageOf(inputChars: number, outputText: string): AgentUsage {
  return {
    inputTokens: Math.ceil(inputChars / 4),
    outputTokens: Math.ceil(outputText.length / 4),
    cachedInputTokens: 0,
    costUsd: null,
    costIsEstimate: false,
  };
}

/** Maps a candidate output (already parsed, or raw text) to an attempt; never spawns, never throws. */
function answer(request: AgentRequest, outputText: string, candidate: () => unknown): AgentAttempt {
  const base = {
    cliVersion: FAKE_VERSION,
    reportedModels: request.model === null ? [] : [request.model],
    usage: usageOf(request.pack.chars, outputText),
    exitCode: 0,
    durationMs: 0,
  };
  let value: unknown;
  try {
    value = candidate();
  } catch {
    return { ...base, status: "invalid-output", detail: "fake text is not JSON", outputText };
  }
  const parsed = request.outputSchema.safeParse(value);
  if (!parsed.success) {
    return { ...base, status: "invalid-output", detail: schemaIssues(parsed.error), outputText };
  }
  return { ...base, status: "succeeded", output: parsed.data, outputText };
}

function respond(request: AgentRequest, step: FakeStep): AgentAttempt {
  if ("status" in step) {
    return {
      status: step.status,
      detail: step.detail,
      cliVersion: FAKE_VERSION,
      exitCode: null,
      signal: null,
      durationMs: 0,
    };
  }
  if ("text" in step) {
    return answer(request, step.text, () => JSON.parse(unfence(step.text)));
  }
  return answer(request, JSON.stringify(step.output), () => step.output);
}

function build(id: AgentProviderId, next: (request: AgentRequest) => FakeStep): AgentProvider {
  return {
    id,
    label: "Fake (synthetic, no process)",
    minimumVersion: null,
    probe: () => Promise.resolve({ status: "ready", cliVersion: FAKE_VERSION, minimum: null }),
    invoke: (request) => Promise.resolve(respond(request, next(request))),
  };
}

/** Answers every task with its deterministic SYNTHETIC responder. */
export const fakeProvider: AgentProvider = build("fake", (request) => ({
  output: RESPONDERS[request.task](request.pack.items),
}));

/**
 * Scripted provider for tests: the n-th invocation returns the n-th step; past the end it fails with a fixed detail.
 * Each call to `createFakeProvider` has its own cursor.
 */
export function createFakeProvider(
  script: readonly FakeStep[],
  id: AgentProviderId = "fake",
): AgentProvider {
  let cursor = 0;
  return build(id, () => {
    const step = script[cursor];
    cursor += 1;
    return step ?? { status: "failed", detail: "fake script exhausted" };
  });
}
