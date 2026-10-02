import type { AgentUsageSummary, AgentUsageTotals } from "../core/contracts/index.ts";

export type { AgentUsageSummary, AgentUsageTotals };

const DAY_MS = 86_400_000;
const startOfUtcDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/** A finite non-negative number, else 0 (null token fields count as 0). */
const tokens = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

function emptyTotals(): AgentUsageTotals {
  return {
    invocations: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsd: null,
  };
}

function add(totals: AgentUsageTotals, event: Record<string, unknown>): void {
  totals.invocations += 1;
  totals.inputTokens += tokens(event["inputTokens"]);
  totals.outputTokens += tokens(event["outputTokens"]);
  totals.cachedInputTokens += tokens(event["cachedInputTokens"]);
  const cost = event["costUsd"];
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
    totals.costUsd = (totals.costUsd ?? 0) + cost;
  }
}

/**
 * Sums the `agent.invocation` events of the local log (DR45): `today` (the UTC day of `now`) and `window` (the last
 * `windowDays` UTC days, today included). `overBudget` when `softBudget` is set and today's input + output tokens
 * exceed it. Reused runs log nothing, so they add 0. Other events and unparsable timestamps are ignored. Pure.
 */
export function summarizeAgentUsage(
  events: readonly Record<string, unknown>[],
  now: Date,
  options: { windowDays: number; softBudget: number | null },
): AgentUsageSummary {
  const todayStart = startOfUtcDay(now.getTime());
  const windowStart = todayStart - (options.windowDays - 1) * DAY_MS;
  const today = emptyTotals();
  const window = emptyTotals();
  for (const event of events) {
    if (event["event"] !== "agent.invocation") continue;
    const at = typeof event["at"] === "string" ? Date.parse(event["at"]) : Number.NaN;
    if (!Number.isFinite(at) || at < windowStart || at >= todayStart + DAY_MS) continue;
    add(window, event);
    if (at >= todayStart) add(today, event);
  }
  const overBudget =
    options.softBudget !== null && today.inputTokens + today.outputTokens > options.softBudget;
  return {
    today,
    window: { ...window, days: options.windowDays },
    softBudget: options.softBudget,
    overBudget,
  };
}
