// Covers: R9
import { describe, expect, test } from "bun:test";
import { SENSITIVE_QUERY_KEYS, redactUrl } from "../../../src/security/redact.ts";

describe("redactUrl", () => {
  test("strips credentials and sensitive query values", () => {
    expect(redactUrl(new URL("https://user:pw@example.com/a?x=1#frag"))).toBe(
      "https://example.com/a?x=1",
    );
    expect(
      redactUrl(new URL("https://example.com/p?b=2&Token=abc&a=1&API_KEY=k&q=hello+world")),
    ).toBe("https://example.com/p?b=2&Token=REDACTED&a=1&API_KEY=REDACTED&q=hello+world");
    for (const key of SENSITIVE_QUERY_KEYS) {
      const out = redactUrl(new URL(`https://example.com/?${key}=CANARY-SECRET`));
      expect(out).toBe(`https://example.com/?${key}=REDACTED`);
    }
    // nothing to redact: untouched; the input URL is never mutated
    const plain = new URL("https://example.com/path");
    expect(redactUrl(plain)).toBe("https://example.com/path");
    const secret = new URL("https://u:p@example.com/?token=t#h");
    redactUrl(secret);
    expect(secret.href).toBe("https://u:p@example.com/?token=t#h");
    expect(SENSITIVE_QUERY_KEYS).toContain("x-amz-signature");
  });

  // Covers: R9
  test("redacts id_token, refresh_token, auth_token, access-token, jwt and bearer", () => {
    for (const key of [
      "id_token",
      "refresh_token",
      "auth_token",
      "access-token",
      "jwt",
      "bearer",
    ]) {
      expect(SENSITIVE_QUERY_KEYS).toContain(key);
      expect(redactUrl(new URL(`https://example.com/?${key.toUpperCase()}=CANARY&a=1`))).toBe(
        `https://example.com/?${key.toUpperCase()}=REDACTED&a=1`,
      );
    }
  });
});
