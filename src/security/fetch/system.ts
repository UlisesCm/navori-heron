import { lookup } from "node:dns/promises";
import type { ResolvedAddress, Resolver, Transport, TransportResponse } from "./types.ts";

/** The only file with `fetch(` and `node:dns` (boundary table). Exercised against 127.0.0.1 in tests only. */

/** A/AAAA lookup in resolver order (verbatim), raced against the signal. */
export const systemResolver: Resolver = {
  resolve: (hostname, signal) =>
    new Promise<ResolvedAddress[]>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason ?? new Error("aborted"));
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      lookup(hostname, { all: true, verbatim: true }).then(
        (records) => {
          signal.removeEventListener("abort", onAbort);
          resolve(
            records.flatMap((record) =>
              record.family === 4 || record.family === 6
                ? [{ address: record.address, family: record.family }]
                : [],
            ),
          );
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    }),
};

/** Reads the body counting decoded bytes; cancels the stream once more than `maxBytes` arrived. */
async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  if (body === null) return { bytes: new Uint8Array(0), overflow: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { bytes: new Uint8Array(0), overflow: true };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, overflow: false };
}

/** One GET to the pinned URL with the original Host header and, for hostnames, SNI/certificate name = serverName (DR10). */
export const bunTransport: Transport = {
  send: async (request, signal): Promise<TransportResponse> => {
    const response = await fetch(request.url, {
      method: "GET",
      redirect: "manual",
      headers: { host: request.hostHeader, ...request.headers },
      ...(request.serverName === null ? {} : { tls: { serverName: request.serverName } }),
      signal,
    });
    const { bytes, overflow } = await readCapped(response.body, request.maxBytes);
    return {
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      body: bytes,
      overflow,
    };
  },
};

export type McpFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
/** Block redirects on every SDK request, including its standalone SSE GET (DR7). */
export const mcpFetch: McpFetch = (url, init) => fetch(url, { ...init, redirect: "error" });
