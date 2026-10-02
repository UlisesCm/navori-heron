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

describe("canonical data model docs", () => {
  // Covers: R17
  // Covers: R10
  test("documents the canonical data model and the navori-harness integration", async () => {
    const adr = await read("docs/adr/0006-canonical-data-model.md");
    expect(adr).toContain("# ADR 0006");
    for (const term of [
      "ProductContext",
      "ProductContextAdapter",
      "ACTIVE_UX_READER",
      "SOURCE_PRECEDENCE",
      "Frescura por regeneración",
      "ajv",
    ]) {
      expect(adr).toContain(term);
    }

    const contracts = await read("docs/contracts.md");
    for (const term of [
      "ProductContext",
      "IntakeConflicts",
      "ManualContext",
      "ACTIVE_UX_READER",
      "provisional-1",
      "regenerar y comparar",
    ]) {
      expect(contracts).toContain(term);
    }

    // the mapping, the provisional subset, the switch and the heuristic limits P4.A9 asks the user to check
    const harness = await read("docs/integrations/navori-harness.md");
    expect(harness).toMatch(/^## Qué aporta cada fuente$/m);
    expect(harness).toMatch(/^## Subconjunto provisional de `ux.json`$/m);
    expect(harness).toMatch(/^## Conmutación del lector de `ux.json`$/m);
    expect(harness).toMatch(/^### Límites de las heurísticas$/m);
    for (const term of [
      "DECISIONS.md",
      "MASTER.md",
      "ux.json",
      "extensions",
      "ACTIVE_UX_READER",
      "PRODUCT_CONTEXT_STALE",
      "heron conflicts ack",
      "no redefine su contrato",
    ]) {
      expect(harness).toContain(term);
    }

    // architecture amends DP9 and links the new docs; README documents the new commands
    const architecture = await read("docs/architecture.md");
    expect(architecture).toContain("Enmienda de DP9");
    expect(architecture).toContain("0006-canonical-data-model.md");
    expect(architecture).toContain("integrations/navori-harness.md");

    const readme = await read("README.md");
    for (const term of [
      "heron intake [path]",
      "heron conflicts list",
      "heron conflicts ack",
      "--adapter auto|markdown|manual",
      "docs/contracts.md",
      "docs/integrations/navori-harness.md",
    ]) {
      expect(readme).toContain(term);
    }

    const recipes = await read(".claude/skills/heron-architecture/references/recipes.md");
    expect(recipes).toContain("## Fuente nueva de ProductContext");
  });
});

describe("agent provider boundary docs", () => {
  // Covers: R17, R18, R20
  test("documents the agent provider boundary, the exact flags and the subscription terms", async () => {
    const adr = await read("docs/adr/0005-ai-provider-boundary.md");
    expect(adr).toContain("# ADR 0005");
    for (const term of [
      "AgentProvider",
      "bunProcessRunner",
      "AGENT_ENV_ALLOWLIST",
      "CODEX_ALLOWED_ITEM_TYPES",
    ]) {
      expect(adr).toContain(term);
    }

    const doc = await read("docs/agent-providers.md");
    // the literal flags come from the adapters, so the doc cannot drift from what is launched
    const { CLAUDE_FIXED_ARGS } = await import("../../src/agents/adapters/claude-code/index.ts");
    const { CODEX_FIXED_ARGS } = await import("../../src/agents/adapters/codex-cli/index.ts");
    for (const flag of [...CLAUDE_FIXED_ARGS, ...CODEX_FIXED_ARGS].filter((arg) =>
      arg.startsWith("--"),
    )) {
      expect(doc).toContain(flag);
    }
    const { PACK_LIMITS } = await import("../../src/agents/context-pack.ts");
    expect(doc).toContain("PACK_LIMITS");
    expect(doc).toContain(String(PACK_LIMITS.maxReferences));
    for (const term of [
      "--force",
      "agents.warnTokensPerDay",
      "doctor --deep",
      "cachedInputTokens",
      "draft-7",
      "2.1.287",
      "0.159.3",
      "heron init",
      "## Términos",
    ]) {
      expect(doc).toContain(term);
    }

    const security = await read("docs/security.md");
    expect(security).toMatch(/^## Agentes \(P3\)$/m);
    for (const term of [
      "AGENT_ENV_ALLOWLIST",
      "CODEX_ALLOWED_ITEM_TYPES",
      "AGENT_POLICY_VIOLATION",
      "bunfig",
    ]) {
      expect(security).toContain(term);
    }

    expect(await read("docs/architecture.md")).toContain("0005-ai-provider-boundary.md");
    const readme = await read("README.md");
    expect(readme).toContain("docs/agent-providers.md");
    expect(await read("docs/research.md")).toContain("research analyze");
  });
});

describe("penpot docs", () => {
  // Covers: R18, R20
  test("records live v2 evidence without claiming manual acceptance", async () => {
    const docs = await read("docs/penpot.md");
    for (const term of [
      "Prueba viva de v2",
      "7/7 PASS",
      "0 escrituras",
      "review-page@v2",
      "T21 y la aceptación final permanecen pendientes",
    ])
      expect(docs).toContain(term);
  });
  // Covers: R3, R19
  test("records the Penpot boundary ADR and the Penpot sections of the docs", async () => {
    const adr = await read("docs/adr/0007-penpot-boundary.md");
    for (const term of [
      "# ADR 0007",
      "PenpotGateway",
      "PenpotCodeRunner",
      "mcpGateway",
      "defaultPenpotGateway",
      "renderScript",
      "PENPOT_TEMPLATES",
      "PENPOT_TESTED_VERSIONS",
      "expectedRevision",
      "refusingGateway",
      "32 KiB",
    ])
      expect(adr).toContain(term);
    for (const path of ["docs/architecture.md", "docs/security.md", "README.md"])
      expect(await read(path)).toMatch(/^##(?:#)? Penpot \(P12\)$/m);
    const doc = await read("docs/penpot.md");
    for (const term of [
      "heron penpot link",
      "heron penpot doctor",
      "heron penpot inspect",
      "heron penpot sync",
      "--dry-run",
      "PENPOT_SYNC_PARTIAL",
      "review-sync.json",
      "32 KiB",
      "48 tarjetas",
      "0 escrituras",
    ])
      expect(doc).toContain(term);
    const layout = await read(".claude/skills/heron-architecture/references/layout.md");
    expect(layout).toContain("ports registry config session results compatibility");
    expect(layout).toContain("0007-penpot-boundary.md");
    expect(await read(".claude/skills/heron-architecture/references/patterns.md")).toContain(
      "refusingGateway",
    );
    expect(await read(".claude/skills/heron-architecture/references/recipes.md")).toContain(
      "nunca del workspace",
    );
  });

  // Covers: R3, R21
  test("documents the Penpot setup, MCP connection, secrets, backups, upgrades and versions", async () => {
    const doc = await read("docs/penpot.md");
    for (const heading of [
      "Requisitos",
      "Instalación",
      "Cuentas",
      "HTTPS y websocket",
      "MCP",
      "Configuración de Heron",
      "Secretos",
      "Fuentes y egreso a terceros",
      "Backups",
      "Upgrade",
      "Versiones",
    ]) {
      expect(doc).toMatch(new RegExp(`^## ${heading}$`, "m"));
    }
    for (const term of [
      "Docker 29.4.0",
      "Compose 5.1.2",
      "Chrome",
      "Edge",
      "infra/penpot/init-env",
      "infra/penpot/compose",
      "create-profile",
      "PENPOT_PUBLIC_URI",
      "/mcp/ws",
      "PENPOT_URL",
      "PENPOT_MCP_KEY",
      "PENPOT_MCP_KEY_FILE",
      "PENPOT_VERSION",
      "userToken",
      "Google Fonts",
      "disable-google-fonts-provider",
      "docker compose` directo se salta",
      "HERON_LIVE_COMPOSE=1 bun run test:live:compose",
      "no lee `.env`",
    ]) {
      expect(doc).toContain(term);
    }
    // the evidence rule for infra/penpot/ and the dated versions section (R18)
    expect(doc).toContain("todo PR que toque `infra/penpot/` adjunta");
    expect(doc).toMatch(/^- \d{4}-\d{2}-\d{2}: \*\*2\.17\.2 fijada \(D7\)\*\*/m);
    expect(doc).toMatch(
      /^- \d{4}-\d{2}-\d{2}: \*\*2\.18\.1 probada en instancia aislada \(T13\): PASS, 0 comprobaciones fallidas; se conserva 2\.17\.2 fijada\.\*\*/m,
    );
    expect(doc).toContain("no se reprodujo en este entorno local");
    expect(doc).toContain('PENPOT_TESTED_VERSIONS` conserva `["2.17.2"]`');
    // the manual spike of the Lote 1 exit criterion
    for (const id of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) {
      expect(doc).toMatch(new RegExp(`^\\| ${id} +\\|`, "m"));
    }
  });
});
