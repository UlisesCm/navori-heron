import type { AddressRange } from "../ssrf.ts";

export type ResolvedAddress = { address: string; family: 4 | 6 };
/** All A/AAAA records of a hostname; may throw (DNS failure) or reject when the signal aborts. */
export interface Resolver {
  resolve(hostname: string, signal: AbortSignal): Promise<ResolvedAddress[]>;
}
export type TransportRequest = {
  url: string; // pinned: "{scheme}://{ip or [ipv6]}{:port}{path}{?query}", never the hostname
  hostHeader: string; // original host[:port]
  serverName: string | null; // original hostname for SNI and certificate checks; null when the URL host is an IP literal
  headers: Readonly<Record<string, string>>; // accept, accept-encoding: identity, user-agent
  maxBytes: number; // stop reading once exceeded
};
export type TransportResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  body: Uint8Array;
  overflow: boolean;
};
/** One GET against a pinned address; may throw (network, TLS, abort). */
export interface Transport {
  send(request: TransportRequest, signal: AbortSignal): Promise<TransportResponse>;
}
export type SafeFetchRequest = {
  url: string;
  accept: readonly string[];
  maxBytes: number;
  allowLocal: boolean;
};
export type FetchHop = {
  url: string /* redacted */;
  address: string;
  range: AddressRange;
  status: number;
};
export type SafeFetchFailureCode =
  | "INVALID_URL"
  | "SSRF_BLOCKED"
  | "FETCH_FAILED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INPUT_TOO_LARGE";
export type SafeFetchResult =
  | {
      ok: true;
      requestedUrl: string;
      finalUrl: string;
      status: number;
      mediaType: string;
      body: Uint8Array;
      hops: FetchHop[];
      local: { address: string; range: AddressRange } | null;
    } // urls redacted
  | {
      ok: false;
      code: SafeFetchFailureCode;
      message: string;
      hops: FetchHop[];
    };
/** Property syntax on purpose: the boundary table forbids a bare `fetch(` token outside system.ts. Never throws. */
export interface Fetcher {
  readonly fetch: (request: SafeFetchRequest) => Promise<SafeFetchResult>;
}
