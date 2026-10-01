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
