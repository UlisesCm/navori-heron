// Covers: R17
import { describe, expect, test } from "bun:test";

const root = new URL("../../", import.meta.url);
const read = (path: string): Promise<string> => Bun.file(new URL(path, root)).text();

describe("research docs", () => {
  // Covers: R16
  test("documents the research source boundary, the research workflow and the SSRF policy", async () => {
    const adr = await read("docs/adr/0003-research-source-boundary.md");
    expect(adr).toContain("# ADR 0003");
    expect(adr).toContain("ResearchSource");
    expect(adr).toContain("createSafeFetcher");
    expect(adr).toContain("0004-sharp-image-sanitizing.md");

    const research = await read("docs/research.md");
    for (const cmd of [
      "heron references add",
      "heron references import",
      "heron brand add",
      "heron research render",
    ]) {
      expect(research).toContain(cmd);
    }
    // the manual walk-through P2.A9 (R16) over monorepo-fullstack
    expect(research).toContain("monorepo-fullstack");
    expect(research).toContain("moodboards/index.html");
    expect(research).toContain("--crop");

    const security = await read("docs/security.md");
    expect(security).toMatch(/^## SSRF$/m);
    for (const term of ["SSRF_BLOCKED", "--allow-local", "169.254.169.254", "UNSAFE_PATH"]) {
      expect(security).toContain(term);
    }

    // README and architecture link the new docs
    const readme = await read("README.md");
    expect(readme).toContain("docs/research.md");
    expect(readme).toContain("docs/security.md");
    expect(await read("docs/architecture.md")).toContain("0003-research-source-boundary.md");
  });
});

describe("agent providers docs", () => {
  // Covers: R17
  test("records the subscription terms with sources and dates", async () => {
    const doc = await read("docs/agent-providers.md");
    const section = doc.split(/^## Términos$/m)[1]?.split(/^## /m)[0] ?? "";
    expect(section).not.toBe("");

    // each source is a URL line followed by its access date; at least two (R17)
    const dated = section.match(/- URLs?: https?:\/\/\S+\n- Consultado: \d{4}-\d{2}-\d{2}/g) ?? [];
    expect(dated.length).toBeGreaterThanOrEqual(2);
    for (const url of [
      "https://www.anthropic.com/legal/consumer-terms",
      "https://code.claude.com/docs/en/legal-and-compliance",
      "https://code.claude.com/docs/en/authentication",
    ]) {
      expect(section).toContain(url);
    }
    // what could not be read is flagged, never inferred
    expect(section).toContain("[SIN VERIFICAR]");
    // the DR35 conclusion is stated for P3.A11
    expect(section).toMatch(/^### Conclusión \(DR35/m);
    expect(section).toContain("no permiten con claridad");
    // the user's decision and its revisit trigger are recorded
    expect(section).toMatch(/^### Decisión \(P3\.A11\)$/m);
    expect(section).toContain("2026-10-01 decidió mantener DR35");
    expect(section).toContain("Disparador de revisión");
  });
});
