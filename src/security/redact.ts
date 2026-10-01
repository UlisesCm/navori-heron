/** Lower-case query keys whose values never leave the process (compared lower-case). */
export const SENSITIVE_QUERY_KEYS: readonly string[] = [
  "access_token",
  "access-token",
  "auth_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "bearer",
  "client_secret",
  "code",
  "id_token",
  "jwt",
  "key",
  "pass",
  "password",
  "pwd",
  "refresh_token",
  "secret",
  "session",
  "sessionid",
  "sig",
  "signature",
  "token",
  "usertoken",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
];

/** href without userinfo and fragment; values of SENSITIVE_QUERY_KEYS -> "REDACTED"; parameter order kept. */
export function redactUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.username = "";
  copy.password = "";
  copy.hash = "";
  if (copy.search !== "") {
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      params.append(key, SENSITIVE_QUERY_KEYS.includes(key.toLowerCase()) ? "REDACTED" : value);
    }
    copy.search = params.toString();
  }
  return copy.href;
}

/** Upper-case substrings that mark an env/log key as secret-bearing. */
export const SECRET_NAME_MARKERS: readonly string[] = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "AUTH",
  "COOKIE",
  "SESSION",
];

/** Replacement for every secret occurrence. */
export const REDACTED = "[REDACTED]";

const MIN_SECRET_LENGTH = 8;
const FORBIDDEN_PREFIXES: readonly string[] = ["HERON_", "PENPOT_"];

export interface Redactor {
  redact(text: string): { text: string; count: number };
}

/** True when the key name (any case) contains a SECRET_NAME_MARKERS entry. */
export function isSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  return SECRET_NAME_MARKERS.some((marker) => upper.includes(marker));
}

/** Forms a secret can take once embedded in JSON text or a URL; the raw value is always first. */
function variantsOf(secret: string): string[] {
  const json = JSON.stringify(secret).slice(1, -1);
  return [secret, json, encodeURIComponent(secret)];
}

/**
 * Secret values = env values whose upper-cased name contains a marker or starts with HERON_/PENPOT_, plus `extra`;
 * length >= 8. Each value is also masked in its JSON-escaped and URL-encoded forms. Replaced longest first with
 * "[REDACTED]" by split/join (no RegExp is ever built from data).
 */
export function createValueRedactor(
  env: Readonly<Record<string, string | undefined>>,
  extra: readonly string[] = [],
): Redactor {
  const secrets = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value.length < MIN_SECRET_LENGTH) continue;
    const upper = name.toUpperCase();
    if (isSecretName(name) || FORBIDDEN_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      for (const variant of variantsOf(value)) secrets.add(variant);
    }
  }
  for (const value of extra) {
    if (value.length < MIN_SECRET_LENGTH) continue;
    for (const variant of variantsOf(value)) secrets.add(variant);
  }
  const ordered = [...secrets].filter((value) => value.length >= MIN_SECRET_LENGTH);
  return {
    redact(text: string): { text: string; count: number } {
      // All match ranges of every secret, merged when they overlap or touch, so a partial overlap never leaves a tail.
      const ranges: [number, number][] = [];
      for (const secret of ordered) {
        let from = text.indexOf(secret);
        while (from !== -1) {
          ranges.push([from, from + secret.length]);
          from = text.indexOf(secret, from + 1);
        }
      }
      if (ranges.length === 0) return { text, count: 0 };
      const sorted = ranges.toSorted((x, y) => x[0] - y[0] || y[1] - x[1]);
      let out = "";
      let cursor = 0;
      let count = 0;
      let [start, end] = sorted[0] as [number, number];
      const flush = (): void => {
        out += text.slice(cursor, start) + REDACTED;
        cursor = end;
        count += 1;
      };
      for (const [s0, e0] of sorted.slice(1)) {
        if (s0 <= end) end = Math.max(end, e0);
        else {
          flush();
          [start, end] = [s0, e0];
        }
      }
      flush();
      return { text: out + text.slice(cursor), count };
    },
  };
}
