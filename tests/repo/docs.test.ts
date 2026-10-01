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
