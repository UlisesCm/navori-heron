// Covers: R9
import { describe, expect, test } from "bun:test";
import {
  SENSITIVE_QUERY_KEYS,
  createValueRedactor,
  redactUrl,
} from "../../../src/security/redact.ts";

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

describe("createValueRedactor", () => {
  // Covers: R6, R15
  test("redacts loaded secret values by key and by value before any sink", () => {
    const secret = 'tok"en/with space-9999';
    const redactor = createValueRedactor(
      {
        CLAUDE_CODE_OAUTH_TOKEN: secret,
        HERON_PROFILE: "profile-value-1",
        PENPOT_URL: "https://penpot.example",
        MY_PASSWORD: "short",
        PLAIN: "plain-value-long",
        EMPTY_KEY: undefined,
      },
      ["extra-secret-value", "tiny"],
    );
    const text = [
      secret,
      JSON.stringify({ v: secret }),
      `?t=${encodeURIComponent(secret)}`,
      "profile-value-1 https://penpot.example extra-secret-value",
      "short plain-value-long tiny",
    ].join("\n");
    const out = redactor.redact(text);
    for (const leaked of [
      secret,
      JSON.stringify(secret).slice(1, -1),
      encodeURIComponent(secret),
      "profile-value-1",
      "penpot.example",
      "extra-secret-value",
    ]) {
      expect(out.text).not.toContain(leaked);
    }
    // under 8 chars and unmarked names are left alone
    expect(out.text).toContain("short plain-value-long tiny");
    expect(out.count).toBe(6);
    expect(redactor.redact("nothing here")).toEqual({ text: "nothing here", count: 0 });
  });

  // Covers: R6
  test("replaces the longest secret first so a prefix never leaves a tail", () => {
    const redactor = createValueRedactor({ A_TOKEN: "abcdefgh", B_TOKEN: "abcdefghIJKLMN" });
    expect(redactor.redact("x abcdefghIJKLMN y").text).toBe("x [REDACTED] y");
  });

  // Covers: R6
  test("merges partially overlapping secrets so no tail of a secret survives", () => {
    const redactor = createValueRedactor({ A_TOKEN: "abcdefghij", B_TOKEN: "ghijklmnop" });
    expect(redactor.redact("x abcdefghijklmnop y")).toEqual({ text: "x [REDACTED] y", count: 1 });
    expect(redactor.redact("abcdefghij ghijklmnop")).toEqual({
      text: "[REDACTED] [REDACTED]",
      count: 2,
    });
  });
});
