import { classifyAddress, isIpLiteral, LOCAL_ALLOWABLE_RANGES } from "../security/ssrf.ts";

export type PenpotUrlResult =
  | { ok: true; baseUrl: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "scheme"
        | "host"
        | "credentials"
        | "query"
        | "fragment"
        | "user-token"
        | "mcp-path";
    };
/** Trust comes from local environment, not workspace data; DNS names are not resolved here (DR7). */
export function parsePenpotUrl(raw: string): PenpotUrlResult {
  // oxlint-disable-next-line no-control-regex -- URL silently strips controls; reject rather than normalize them
  if (!raw || raw.length > 2048 || raw.trim() !== raw || /[\u0000-\u0020\u007f]/.test(raw))
    return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "scheme" };
  if (url.username || url.password || /^[a-z]+:\/\/[^/?#]*@/i.test(raw))
    return { ok: false, reason: "credentials" };
  if ([...url.searchParams.keys()].some((key) => key.toLowerCase() === "usertoken"))
    return { ok: false, reason: "user-token" };
  if (raw.includes("?")) return { ok: false, reason: "query" };
  if (raw.includes("#")) return { ok: false, reason: "fragment" };
  const literal = isIpLiteral(url.hostname);
  const range = literal ? classifyAddress(url.hostname).range : null;
  if (range !== null && range !== "public" && !LOCAL_ALLOWABLE_RANGES.includes(range))
    return { ok: false, reason: "host" };
  if (url.protocol === "http:" && url.hostname !== "localhost" && range !== "loopback")
    return { ok: false, reason: "host" };
  let path: string;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (/(?:^|\/)mcp\/stream\/*$/i.test(path)) return { ok: false, reason: "mcp-path" };
  return { ok: true, baseUrl: url.href.replace(/\/+$/, "") };
}
/** Only the adapter uses this URL; it must never reach a persisted value or an unredacted sink. */
export function mcpEndpoint(baseUrl: string, key: string): URL {
  const url = new URL("mcp/stream", `${baseUrl}/`);
  url.searchParams.set("userToken", key);
  return url;
}
