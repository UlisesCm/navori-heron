// Covers: R13
import { describe, expect, test } from "bun:test";
import { escapeHtml } from "../../../src/security/html.ts";
import { escapeMarkdownText } from "../../../src/security/markdown.ts";

describe("escaping", () => {
  test("escapes every html-significant character", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("&amp;")).toBe("&amp;amp;"); // never trusts existing entities
    expect(escapeHtml(`" onmouseover='x'`)).not.toMatch(/["']/);
    expect(escapeHtml("plain text 123 áé 日本")).toBe("plain text 123 áé 日本");
    expect(escapeHtml("")).toBe("");
  });

  test("escapes markdown syntax and flattens whitespace controls", () => {
    expect(escapeMarkdownText("a\\b `c` *d* _e_ [f](g) <h> #i |j| !k")).toBe(
      "a\\\\b \\`c\\` \\*d\\* \\_e\\_ \\[f\\](g) \\<h\\> \\#i \\|j\\| \\!k",
    );
    expect(escapeMarkdownText("line1\r\nline2\tcol")).toBe("line1  line2 col");
    expect(escapeMarkdownText("R&D <b>")).toBe("R&amp;D \\<b\\>");
    expect(escapeMarkdownText("# heading\n- item")).toBe("\\# heading - item");
    expect(escapeMarkdownText("")).toBe("");
  });

  // Covers: R9
  test("neutralizes strikethrough, autolink literals and leading list markers", () => {
    expect(escapeMarkdownText("~~gone~~")).toBe("\\~\\~gone\\~\\~");
    expect(escapeMarkdownText("see http://a.io and HTTPS://b.io")).toBe(
      "see http\\://a.io and HTTPS\\://b.io",
    );
    expect(escapeMarkdownText("go www.example.com")).toBe("go www\\.example.com");
    for (const [input, expected] of [
      ["- item", "\\- item"],
      ["+ item", "\\+ item"],
      ["* item", "\\* item"],
      ["1. item", "1\\. item"],
      ["12) item", "12\\) item"],
      ["# title", "\\# title"],
      ["x\n- y", "x - y"],
    ] as const) {
      expect(escapeMarkdownText(input)).toBe(expected);
    }
    expect(escapeMarkdownText("a-b 2.5 and 3)")).toBe("a-b 2.5 and 3)");
  });
});
