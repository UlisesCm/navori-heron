import type { ResearchReference } from "../../src/core/contracts/index.ts";
import type {
  ResolvedAddress,
  Resolver,
  Transport,
  TransportRequest,
  TransportResponse,
} from "../../src/security/fetch/types.ts";

/** A complete manual reference (all provenance fields present); `overrides` replaces any field. */
export function sampleReference(overrides: Partial<ResearchReference> = {}): ResearchReference {
  return {
    id: "REF-1",
    source: "manual",
    origin: "Linear pricing page",
    capturedAt: "2026-09-30T12:00:00.000Z",
    mode: "reference-only",
    reason: "Shows a calm pricing table",
    studies: ["table density"],
    doNotCopy: ["brand colors"],
    influences: ["plan comparison layout"],
    capture: { kind: "manual" },
    crops: [],
    securityFindings: [],
    removed: null,
    ...overrides,
  };
}

/** Resolved addresses from plain IP texts (family inferred). */
export const addrs = (...texts: string[]): ResolvedAddress[] =>
  texts.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

/** Resolver double: `table[host]` lists the answer of each successive lookup (the last one repeats); a string answer
 * throws an error with that `code`. Unknown hosts throw ENOTFOUND. `calls` records every looked-up host. */
export function fakeResolver(
  table: Record<string, readonly ResolvedAddress[][] | string>,
): Resolver & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (hostname) => {
      calls.push(hostname);
      const answers = table[hostname];
      if (answers === undefined || typeof answers === "string") {
        throw Object.assign(new Error("dns"), { code: answers ?? "ENOTFOUND" });
      }
      const seen = calls.filter((call) => call === hostname).length;
      return answers[Math.min(seen, answers.length) - 1] ?? [];
    },
  };
}

/** A transport reply: a partial response (defaults: 200 text/html "ok"), an Error to throw, or "hang" until aborted. */
export type TransportReply = Partial<TransportResponse> | Error | "hang";

/** Transport double that records every request and never touches the network. */
export function recordingTransport(
  reply: TransportReply | ((request: TransportRequest, index: number) => TransportReply) = {},
): Transport & { readonly calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    send: async (request, signal) => {
      const index = calls.length;
      calls.push(request);
      const next = typeof reply === "function" ? reply(request, index) : reply;
      if (next === "hang") {
        return new Promise<TransportResponse>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      if (next instanceof Error) throw next;
      return {
        status: 200,
        location: null,
        contentType: "text/html",
        body: new TextEncoder().encode("ok"),
        overflow: false,
        ...next,
      };
    },
  };
}
