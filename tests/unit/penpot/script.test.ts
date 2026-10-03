// Covers: R9, R19
import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../../../src/core/contracts/index.ts";
import { sha256Hex } from "../../../src/core/store/hash.ts";
import { HERON_NAMESPACE, type ReviewPage } from "../../../src/penpot/compiler/nodes.ts";
import {
  MAX_SCRIPT_BYTES,
  renderScript,
  reviewScriptData,
  safeJsonLiteral,
} from "../../../src/penpot/compiler/script.ts";
import {
  PENPOT_TEMPLATES,
  penpotTemplate,
  type PenpotTemplate,
} from "../../../src/penpot/compiler/templates.ts";

const echo: PenpotTemplate = { ...penpotTemplate("inspect"), text: "return HERON;" };
const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

describe("Penpot scripts", () => {
  test("registers every Penpot template with its version and sha256", () => {
    expect(HERON_NAMESPACE).toBe("heron");
    expect(PENPOT_TEMPLATES.map((entry) => `${entry.id}@v${entry.version}`)).toEqual([
      "inspect@v1",
      "review-page@v1",
      "review-page@v2",
      "review-page@v3",
      "review-page@v4",
    ]);
    for (const entry of PENPOT_TEMPLATES) {
      expect(entry.sha256).toBe(sha256Hex(new TextEncoder().encode(entry.text)));
      expect(entry.ref).toEqual({ id: entry.id, version: entry.version, sha256: entry.sha256 });
      expect(penpotTemplate(entry.id, entry.version)).toBe(entry);
      // oxlint-disable-next-line no-control-regex -- tests the template transport invariant
      expect(entry.text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
      expect(entry.text).not.toMatch(/\b(?:fetch|console|storage)\b/);
      const rendered = renderScript(entry, {});
      expect(rendered.ok).toBe(true);
      if (rendered.ok)
        expect(
          () => new Function("penpot", `return (async () => {${rendered.code}})();`),
        ).not.toThrow();
    }
    // Deliberately exercise a programming error without weakening the public id type.
    expect(() => Reflect.apply(penpotTemplate, undefined, ["missing"])).toThrow(
      "unknown Penpot template",
    );
  });

  test("embeds untrusted strings as JSON data in deterministic scripts", () => {
    const data: unknown = JSON.parse('{"__proto__":{"polluted":true},"name":"hostile"}');
    const hostile = {
      data,
      text: '"); throw new Error("injected"); // ` ${penpot}\n\u0000\u2028\u2029😀\\',
    };
    const literal = safeJsonLiteral(hostile);
    expect(JSON.parse(literal)).toBe(JSON.stringify(JSON.parse(canonicalJson(hostile))));
    expect(literal).not.toContain("\u2028");
    expect(literal).not.toContain("\u2029");
    const rendered = renderScript(echo, hostile);
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw new Error("small script refused");
    const result = new Function(rendered.code)() as typeof hostile;
    expect(result).toEqual(hostile);
    expect(Object.hasOwn(result.data as object, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
    expect(renderScript(echo, { text: hostile.text, data })).toEqual(rendered);
    expect(() => safeJsonLiteral({ undefined })).toThrow(TypeError);
  });

  test("measures final UTF-8 bytes including the template and RPC escaping margin", () => {
    expect(MAX_SCRIPT_BYTES).toBe(32_768);
    const base = renderScript(echo, { text: "" });
    if (!base.ok) throw new Error("empty script refused");
    const available = MAX_SCRIPT_BYTES - bytes(base.code);
    const exact = renderScript(echo, { text: "a".repeat(available) });
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(bytes(exact.code)).toBe(MAX_SCRIPT_BYTES);
    expect(renderScript(echo, { text: "a".repeat(available + 1) })).toEqual({
      ok: false,
      bytes: MAX_SCRIPT_BYTES + 1,
    });
    const unicode = renderScript(echo, { text: "é".repeat(available) });
    expect(unicode.ok).toBe(false);
    expect(renderScript({ ...echo, text: " ".repeat(MAX_SCRIPT_BYTES) }, {}).ok).toBe(false);
    for (const unit of ["\\", "\u0000", "\n\r\t", "😀", "\ud800", "\u2028\u2029", '"']) {
      let count = 0;
      let high = MAX_SCRIPT_BYTES;
      while (count < high) {
        const candidate = Math.ceil((count + high) / 2);
        if (renderScript(echo, { text: unit.repeat(candidate) }).ok) count = candidate;
        else high = candidate - 1;
      }
      const rendered = renderScript(echo, { text: unit.repeat(count) });
      if (!rendered.ok) throw new Error("last fitting script refused");
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "execute_code", arguments: { code: rendered.code } },
      });
      expect(bytes(body)).toBeLessThan(100 * 1024);
      expect(bytes(body)).toBeLessThanOrEqual(2 * MAX_SCRIPT_BYTES + 200);
    }
  });

  test("shares exactly the writing payload without compiler issues", () => {
    const hash = sha256Hex(new Uint8Array());
    const page: ReviewPage = {
      heronId: "heron:references",
      kind: "references-page",
      name: "References",
      mode: "reference-only",
      sourceSha256: hash,
      contentSha256: hash,
      nodes: [],
      template: penpotTemplate("review-page").ref,
      issues: [{ code: "PENPOT_REFERENCES_TRUNCATED", message: "omitted", pointer: null }],
    };
    const payload = reviewScriptData(page, null);
    expect(payload).toEqual({
      page: {
        heronId: page.heronId,
        kind: page.kind,
        name: page.name,
        mode: page.mode,
        sourceSha256: hash,
        contentSha256: hash,
        template: "review-page@v1",
      },
      nodes: [],
      targetPageId: null,
    });
    expect(canonicalJson(payload)).not.toContain("issues");
    expect(reviewScriptData(page, "a".repeat(36)).targetPageId).toBe("a".repeat(36));
  });
});

// Covers: R9
test("keeps historical template hashes frozen", async () => {
  const hashes = [
    "ddf8f71c73de88dfbf65d4efd9c3f78bbddcd1d02ae8d7849ccc0832b17a8cb5",
    "712e7d4db8df16f2c7aa48183d891023e1770bcc3170816afdc2593541eacb8d",
    "b393585ab81a2776a7eeb37e89b7c00973e33fe2a933536412aaedcce57c40b9",
  ];
  for (const [index, baseline] of hashes.entries()) {
    const physical = await Bun.file(
      `templates/penpot/review-page@v${index + 1}.penpot.js`,
    ).arrayBuffer();
    expect(sha256Hex(new Uint8Array(physical))).toBe(baseline);
    expect(penpotTemplate("review-page", index + 1).sha256).toBe(baseline);
  }
});

// Covers: R9, R12
test("serializes the bound file as literal data and rejects missing or legacy bindings", () => {
  const hash = sha256Hex(new Uint8Array());
  const page: ReviewPage = {
    heronId: "heron:references",
    kind: "references-page",
    name: "References",
    mode: "reference-only",
    sourceSha256: hash,
    contentSha256: hash,
    nodes: [],
    template: penpotTemplate("review-page", 4).ref,
    issues: [],
  };
  const binding = 'SYNTHETIC "); throw new Error("injected"); // \n😀\u2028';
  const payload = reviewScriptData(page, null, binding);
  expect(payload.expectedFileId).toBe(binding);
  expect(
    new Function(
      renderScript(echo, payload).ok ? `return ${safeJsonLiteral(payload)};` : "return null;",
    )(),
  ).toBe(JSON.stringify(JSON.parse(canonicalJson(payload))));
  expect(renderScript(penpotTemplate("review-page", 4), payload)).toEqual(
    renderScript(penpotTemplate("review-page", 4), reviewScriptData(page, null, binding)),
  );
  for (const missing of [undefined, ""])
    expect(() => reviewScriptData(page, null, missing)).toThrow("bound Penpot file");
  for (const version of [1, 2, 3]) {
    const legacy = { ...page, template: penpotTemplate("review-page", version).ref };
    const { expectedFileId: _binding, ...unbound } = payload;
    expect(reviewScriptData(legacy, null)).toEqual({
      ...unbound,
      page: { ...payload.page, template: `review-page@v${version}` },
    });
    expect(Object.hasOwn(reviewScriptData(legacy, null), "expectedFileId")).toBe(false);
    expect(() => reviewScriptData(legacy, null, "file-1")).toThrow("Historical");
  }
});
