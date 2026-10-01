import { redactUrl } from "../redact.ts";
import {
  LOCAL_ALLOWABLE_RANGES,
  classifyAddress,
  isIpLiteral,
  type AddressClass,
} from "../ssrf.ts";
import type {
  FetchHop,
  Fetcher,
  ResolvedAddress,
  Resolver,
  SafeFetchFailureCode,
  SafeFetchRequest,
  SafeFetchResult,
  Transport,
  TransportRequest,
} from "./types.ts";

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000; // whole chain: DNS + every hop + body
export const MAX_REDIRECTS = 3;
export type SafeFetcherOptions = {
  resolver: Resolver;
  transport: Transport;
  userAgent: string;
  timeoutMs?: number;
  maxRedirects?: number;
};

type Failure = { code: SafeFetchFailureCode; message: string };
type FailureResult = Extract<SafeFetchResult, { ok: false }>;

const failure = (code: SafeFetchFailureCode, message: string): Failure => ({
  code,
  message,
});
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Authority text between "//" and the first "/", "?" or "#", without userinfo or port; null when absent. */
function rawHostOf(text: string): string | null {
  const start = text.indexOf("//");
  if (start === -1) return null;
  let end = text.length;
  for (const stop of ["/", "?", "#", "\\"]) {
    const at = text.indexOf(stop, start + 2);
    if (at !== -1 && at < end) end = at;
  }
  let authority = text.slice(start + 2, end);
  authority = authority.slice(authority.lastIndexOf("@") + 1);
  if (authority.startsWith("[")) return authority.slice(0, authority.indexOf("]") + 1);
  const colon = authority.indexOf(":");
  return colon === -1 ? authority : authority.slice(0, colon);
}

/** Text safe to echo for an unparseable URL: no query, no fragment, nothing when it may carry userinfo. */
function echoable(text: string): string {
  const cut = [text.indexOf("?"), text.indexOf("#")].filter((i) => i !== -1);
  const base = cut.length === 0 ? text : text.slice(0, Math.min(...cut));
  return base.includes("@") || base.length > 200 ? "The URL" : base;
}

function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function errorDetail(error: unknown, signal: AbortSignal, timeoutMs: number): string {
  if (signal.aborted) return `timed out after ${timeoutMs} ms`;
  return error instanceof Error ? error.name : "unknown error";
}

function dnsCode(error: unknown): string {
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : "ERROR";
}

/** Per hop: parse (INVALID_URL: syntax or userinfo) -> scheme (https; http only if allowLocal and the target is local) ->
 * raw host vs URL.hostname (non-canonical IPv4 -> SSRF_BLOCKED) -> host: "localhost"/"*.localhost" = loopback without DNS,
 * IP literal = classifyAddress, else resolver.resolve once -> every address classified; a mix of public and non-public addresses, or any non-public address not
 * authorized -> SSRF_BLOCKED -> any port for https (D29) -> pin first IPv4 else first IPv6 -> transport.send ->
 * 3xx with Location: next hop (<= maxRedirects, else FETCH_FAILED); local authorization only if hop 0 was local ->
 * 2xx: media type in accept (UNSUPPORTED_MEDIA_TYPE), overflow (INPUT_TOO_LARGE) -> ok; other status: FETCH_FAILED.
 * Abort/timeout, DNS or transport error -> FETCH_FAILED. URLs in results and messages are redactUrl'd. Never throws. */
export function createSafeFetcher(options: SafeFetcherOptions): Fetcher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;

  type Target = {
    url: URL;
    shown: string;
    classes: AddressClass[];
    pinned: ResolvedAddress;
  };
  type Chain = { hops: FetchHop[]; firstHopLocal: boolean; requested: string };

  /** Validates one URL and resolves the address to pin; a Failure when the policy blocks it. */
  async function admit(
    raw: string,
    base: URL | null,
    request: SafeFetchRequest,
    chain: Chain,
    signal: AbortSignal,
    hopIndex: number,
  ): Promise<Target | Failure> {
    let url: URL;
    try {
      url = base === null ? new URL(raw) : new URL(raw, base);
    } catch {
      return failure("INVALID_URL", `${echoable(raw)} is not a valid absolute URL.`);
    }
    if (url.username !== "" || url.password !== "") {
      return failure("INVALID_URL", "URLs with credentials are not accepted.");
    }
    const shown = redactUrl(url);
    if (hopIndex === 0) chain.requested = shown;
    const via = hopIndex === 0 ? "" : `redirect ${hopIndex} to ${shown}: `;
    const blocked = (detail: string): Failure =>
      failure("SSRF_BLOCKED", `Blocked ${chain.requested}: ${via}${detail}.`);
    const schemeDetail = `scheme "${url.protocol.slice(0, -1)}" is not allowed (https only; http only to a local target with --allow-local)`;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && request.allowLocal)) {
      return blocked(schemeDetail);
    }
    const rawHost = rawHostOf(raw);
    const hostname = url.hostname;
    const bareHost = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
    if (
      rawHost !== null &&
      isIpLiteral(bareHost) &&
      !bareHost.includes(":") &&
      rawHost.toLowerCase() !== bareHost
    ) {
      return blocked(`host "${rawHost}" is a non-canonical IPv4 form of ${bareHost}`);
    }
    let resolved: ResolvedAddress[];
    if (bareHost === "localhost" || bareHost.endsWith(".localhost")) {
      resolved = [{ address: "127.0.0.1", family: 4 }];
    } else if (isIpLiteral(bareHost)) {
      const literal = classifyAddress(bareHost);
      resolved = [{ address: literal.address, family: literal.family }];
    } else {
      try {
        resolved = await options.resolver.resolve(bareHost, signal);
      } catch (error) {
        const detail = signal.aborted
          ? `timed out after ${timeoutMs} ms`
          : `DNS lookup failed (${dnsCode(error)})`;
        return failure("FETCH_FAILED", `Could not fetch ${shown}: ${detail}.`);
      }
      if (resolved.length === 0) {
        return failure("FETCH_FAILED", `Could not fetch ${shown}: DNS lookup failed (ENODATA).`);
      }
    }
    const classes = resolved.map((entry) => classifyAddress(entry.address));
    if (
      classes.some((entry) => entry.range === "public") &&
      classes.some((entry) => entry.range !== "public")
    ) {
      return blocked(`${bareHost} resolves to a mix of public and non-public addresses`);
    }
    const mayBeLocal = request.allowLocal && (hopIndex === 0 || chain.firstHopLocal);
    for (const entry of classes) {
      if (entry.range === "public") continue;
      if (entry.range === "metadata") {
        return blocked(
          `${bareHost} resolves to ${entry.address}, a cloud metadata address; it is never fetched`,
        );
      }
      if (!(mayBeLocal && LOCAL_ALLOWABLE_RANGES.includes(entry.range))) {
        const hint =
          LOCAL_ALLOWABLE_RANGES.includes(entry.range) && !request.allowLocal
            ? "; pass --allow-local to fetch a local target you trust"
            : "";
        return blocked(
          `${bareHost} resolves to ${entry.address}, a ${entry.range} address (${entry.cidr ?? "unparseable"})${hint}`,
        );
      }
    }
    const anyLocal = classes.some((entry) => entry.range !== "public");
    if (url.protocol === "http:" && !classes.every((entry) => entry.range !== "public")) {
      return blocked(schemeDetail);
    }
    if (hopIndex === 0) chain.firstHopLocal = anyLocal;
    const pinned = resolved.find((entry) => entry.family === 4) ?? resolved[0];
    if (pinned === undefined)
      return failure("FETCH_FAILED", `Could not fetch ${shown}: DNS lookup failed (ENODATA).`);
    return { url, shown, classes, pinned };
  }

  function pinnedRequest(
    target: Target,
    userAgent: string,
    request: SafeFetchRequest,
  ): TransportRequest {
    const { url, pinned } = target;
    const ip = pinned.family === 6 ? `[${pinned.address}]` : pinned.address;
    const bare = url.hostname.endsWith(".") ? url.hostname.slice(0, -1) : url.hostname;
    return {
      url: `${url.protocol}//${ip}${url.port === "" ? "" : `:${url.port}`}${url.pathname}${url.search}`,
      hostHeader: url.host,
      serverName: isIpLiteral(bare) ? null : url.hostname,
      headers: {
        accept: request.accept.join(", "),
        "accept-encoding": "identity",
        "user-agent": userAgent,
      },
      maxBytes: request.maxBytes,
    };
  }

  async function run(request: SafeFetchRequest, signal: AbortSignal): Promise<SafeFetchResult> {
    const chain: Chain = { hops: [], firstHopLocal: false, requested: "" };
    const fail = (error: Failure): FailureResult => ({
      ok: false,
      ...error,
      hops: chain.hops,
    });
    let raw = request.url;
    let base: URL | null = null;
    for (let hopIndex = 0; ; hopIndex += 1) {
      const admitted = await admit(raw, base, request, chain, signal, hopIndex);
      if ("code" in admitted) return fail(admitted);
      const { url, shown, classes } = admitted;
      const pinnedClass =
        classes.find((entry) => entry.address === admitted.pinned.address) ?? classes[0];
      if (pinnedClass === undefined)
        return fail(failure("FETCH_FAILED", `Could not fetch ${shown}: no address.`));
      let response;
      try {
        response = await options.transport.send(
          pinnedRequest(admitted, options.userAgent, request),
          signal,
        );
      } catch (error) {
        return fail(
          failure(
            "FETCH_FAILED",
            `Could not fetch ${shown}: ${errorDetail(error, signal, timeoutMs)}.`,
          ),
        );
      }
      chain.hops.push({
        url: shown,
        address: pinnedClass.address,
        range: pinnedClass.range,
        status: response.status,
      });
      if (response.status >= 300 && response.status < 400) {
        if (response.location === null || !REDIRECT_STATUSES.has(response.status)) {
          return fail(
            failure("FETCH_FAILED", `Could not fetch ${shown}: redirect without Location.`),
          );
        }
        if (hopIndex >= maxRedirects) {
          return fail(
            failure(
              "FETCH_FAILED",
              `Could not fetch ${shown}: more than ${maxRedirects} redirects.`,
            ),
          );
        }
        raw = response.location;
        base = url;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        return fail(failure("FETCH_FAILED", `Could not fetch ${shown}: HTTP ${response.status}.`));
      }
      const mediaType = mediaTypeOf(response.contentType);
      if (!request.accept.includes(mediaType)) {
        return fail(
          failure(
            "UNSUPPORTED_MEDIA_TYPE",
            `${shown} returned ${mediaType === "" ? "no content type" : mediaType}; expected ${request.accept.join(", ")}.`,
          ),
        );
      }
      if (response.overflow) {
        return fail(failure("INPUT_TOO_LARGE", `${shown} exceeds ${request.maxBytes} bytes.`));
      }
      return {
        ok: true,
        requestedUrl: chain.requested,
        finalUrl: shown,
        status: response.status,
        mediaType,
        body: response.body,
        hops: chain.hops,
        local:
          pinnedClass.range === "public"
            ? null
            : { address: pinnedClass.address, range: pinnedClass.range },
      };
    }
  }

  return {
    fetch: async (request) => {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        return await run(request, signal);
      } catch (error) {
        return {
          ok: false,
          code: "FETCH_FAILED",
          message: `Could not fetch the URL: ${errorDetail(error, signal, timeoutMs)}.`,
          hops: [],
        };
      }
    },
  };
}
