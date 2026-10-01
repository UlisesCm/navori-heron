# 0002 Research reference-only — Tasks

Lotes de 1–3 tareas. Cada test lleva `// Covers: R<n>` y usa el nombre exacto del caso de `design.md` § Testing strategy. Convenciones vinculantes: skill `heron-architecture`. Ningún test sale a Internet (`fixedContext` usa `offlineFetcher`); la red real solo contra `Bun.serve` en `127.0.0.1`. Nunca se escribe dentro de `fixtures/`.

## Lote 1 — Refactors previos (base de P2)

- [x] **T1** (R1) — Envoltorio de escritura único y lectura de workspace; `gate` recupera staging huérfano.
  - **Archivos:** `src/app/write-run.ts`, `src/app/workspace.ts`, `src/app/facts.ts`, `src/app/init.ts`, `src/app/gate.ts`, `src/app/status.ts`, `tests/unit/app/write-run.test.ts`, `tests/e2e/gate.test.ts`, `tests/unit/store.test.ts`
  - **Interfaces:** withWriteRun; loadWorkspace; collectTransitionFacts
  - **Patrón:** src/app/init.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 1. Refactors previos; §Decisions sobre `withWriteRun`; §Failure modes), `src/app/{init,gate,status,result}.ts`, `src/core/store/file-store.ts`, `.claude/skills/heron-architecture/references/patterns.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/app/write-run.test.ts tests/e2e/gate.test.ts tests/unit/store.test.ts`, esperado exit 0; casos de test "releases the lock and discards staging when the body fails or skips", "rejects a stale snapshot revision with exit 6", "recovers orphan staging before deciding a gate"; habilita P2.A1 (toda escritura de research pasa por `withWriteRun`).
  - **Fuera de alcance:** comandos de research; `collectResearchFacts` (T5).

- [x] **T2** (R2) — Registro de órdenes y emisión única de salida; las 4 órdenes de P1 migran sin cambiar su comportamiento.
  - **Archivos:** `src/cli/output.ts`, `src/cli/command.ts`, `src/cli/commands/index.ts`, `src/cli/args.ts`, `src/cli/main.ts`, `src/cli/commands/init.ts`, `src/cli/commands/status.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/gate.ts`, `tests/unit/cli/output.test.ts`, `tests/unit/cli-args.test.ts`
  - **Interfaces:** emitResult; splitNotices; CommandSpec; COMMANDS; parseCliArgs; commandFor
  - **Patrón:** src/cli/commands/init.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 1. Refactors previos, registro de órdenes; §Contracts › 8. CLI), `src/cli/**`, `tests/unit/cli-args.test.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/cli/output.test.ts tests/unit/cli-args.test.ts tests/e2e`, esperado exit 0 con las aserciones de P1 intactas; casos de test "emits one envelope in json mode and routes text to stdout or stderr"; habilita P2.A1 (las órdenes de research se registran en `COMMANDS`).
  - **Fuera de alcance:** los grupos `references`, `brand` y `research` (T11, T12).

## Lote 2 — Contratos y fronteras

- [x] **T3** (R4, R5) — Códigos de finding persistidos con patrón (OD1 = C′), ids de adapter completos, `ExitCode` sin literales y compatibilidad con `.heron/` de P1.
  - **Archivos:** `src/core/contracts/common.ts`, `src/core/contracts/mode-decision.ts`, `src/core/contracts/heron-project.ts`, `src/app/result.ts`, `src/cli/render.ts`, `src/core/state/mode.ts`, `schemas/`, `tests/assets/p1-workspaces/`, `tests/e2e/p1-compat.test.ts`, `tests/unit/contracts.test.ts`
  - **Interfaces:** StoredFinding; StoredFindingSchema; FINDING_CODE_PATTERN; StoredModeDecision; ADAPTER_IDS
  - **Patrón:** src/core/contracts/mode-decision.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 1. Refactors previos, OD1-C′; §Migration), `src/core/contracts/{common,mode-decision,heron-project,version}.ts`, `scripts/gen-schemas.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/e2e/p1-compat.test.ts tests/unit/contracts.test.ts`, esperado exit 0; casos de test "reads P1 workspaces without DOCUMENT_INVALID and keeps their artifacts on re-init", "stores finding codes as formatted strings and keeps the emitter union closed"; habilita P2.A2 (los nuevos códigos de research se persisten sin subir versión).
  - **Fuera de alcance:** contratos de research (T5).

- [x] **T4** (R3, R5) — Fronteras como tablas con autoverificación por fila, cubriendo `src/security/` y `src/research/`.
  - **Archivos:** `tests/repo/boundaries.test.ts`
  - **Interfaces:** LAYERS; VENDORS; TOKENS; violationsFor
  - **Patrón:** tests/repo/boundaries.test.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 1. Refactors previos, fronteras; §Testing strategy, fila de boundaries), `.claude/skills/heron-architecture/SKILL.md` (tabla de dependencias)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/boundaries.test.ts`, esperado exit 0; casos de test "enforces module boundaries and no navori imports", "allows any only with a justification"; garantiza P2.A3 (solo `src/security/fetch/system.ts` usa `fetch(`).
  - **Fuera de alcance:** soporte `.tsx` (P8).

## Lote 3 — Contratos de research y primitivas de seguridad

- [x] **T5** (R6, R7, R8, R11, R12, R13, R14, R15) — Contratos y documentos de research, datos de CLI, estado y hechos de research.
  - **Archivos:** `src/core/contracts/research.ts`, `src/core/contracts/research-data.ts`, `src/core/contracts/cli-envelope.ts`, `src/core/contracts/version.ts`, `src/core/contracts/index.ts`, `src/core/state/lifecycle.ts`, `src/core/state/transitions.ts`, `src/core/state/stale.ts`, `src/app/facts.ts`, `schemas/`, `tests/unit/lifecycle.test.ts`, `tests/unit/state-machine.test.ts`, `tests/unit/contracts.test.ts`
  - **Interfaces:** ResearchReference; Provenance; Crop; SecurityFinding; BrandInput; recordCommand; withArtifacts; collectResearchFacts
  - **Patrón:** src/core/contracts/heron-state.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 2. Contratos de research, 3. Datos de CLI, 6. Store y estado, 11. Findings nuevos), `src/core/contracts/**`, `src/core/state/**`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/unit/lifecycle.test.ts tests/unit/state-machine.test.ts tests/unit/contracts.test.ts`, esperado exit 0; casos de test "upserts artifacts and records commands without dropping research files", "names the reference count when the research minimum is unmet"; base de P2.A1 y P2.A9.
  - **Fuera de alcance:** lectura y escritura de archivos de research (T9, T11).

- [x] **T6** (R9) — Fetch seguro anti-SSRF con resolver y transporte inyectables, clasificador de direcciones y redacción de URLs.
  - **Archivos:** `src/security/ssrf.ts`, `src/security/fetch/types.ts`, `src/security/fetch/safe-fetch.ts`, `src/security/fetch/system.ts`, `src/security/redact.ts`, `tests/unit/security/ssrf.test.ts`, `tests/unit/security/redact.test.ts`, `tests/helpers/research.ts`
  - **Interfaces:** classifyAddress; createSafeFetcher; systemResolver; bunTransport; redactUrl
  - **Patrón:** src/core/store/paths.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 5. Primitivas de seguridad; §Decisions DR11 y las de fetch; §Failure modes), `.claude/skills/heron-architecture/SKILL.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/security/ssrf.test.ts tests/unit/security/redact.test.ts`, esperado exit 0; casos de test "classifies every special-purpose IPv4 and IPv6 block", "strips credentials and sensitive query values"; base de P2.A3.
  - **Fuera de alcance:** el e2e `tests/security/ssrf.test.ts` (T11).

- [x] **T7** (R11, R12, R13) — Saneo de imágenes con sharp, escáner de contenido no confiable y escape HTML/Markdown.
  - **Archivos:** `src/security/images/magic.ts`, `src/security/images/sanitize.ts`, `src/security/untrusted.ts`, `src/security/html.ts`, `src/security/markdown.ts`, `package.json`, `bun.lock`, `scripts/check-coverage.ts`, `tests/unit/security/magic.test.ts`, `tests/unit/security/untrusted.test.ts`, `tests/unit/security/html.test.ts`, `tests/repo/coverage-rules.test.ts`, `docs/adr/0004-sharp-image-sanitizing.md`
  - **Interfaces:** sniffImageType; sharpImageSanitizer; scanUntrustedText; escapeHtml; escapeMarkdownText
  - **Patrón:** src/core/store/hash.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 5. Primitivas de seguridad; §Contracts › 12. Dependencias; §Decisions sobre sharp y el escáner), `scripts/check-coverage.ts`
  - **Librerías:** sharp@0.35.5
  - **Done:** comando `bun install --frozen-lockfile && bun test tests/unit/security/magic.test.ts tests/unit/security/untrusted.test.ts tests/unit/security/html.test.ts tests/repo/coverage-rules.test.ts`, esperado exit 0; casos de test "detects image types, webp chunks and exif gps", "matches each instruction rule and stays linear on adversarial input", "escapes every html-significant character"; base de P2.A5 y P2.A6.
  - **Fuera de alcance:** importar imágenes desde la CLI (T9, T11).

## Lote 4 — Módulo research

- [x] **T8** (R6, R7, R8, R10, R11, R12) — Puerto `ResearchSource`, registro, validación de provenance, lectura de archivos de entrada (D28) y adapters `manual`, `url`, `image`, `design-md`.
  - **Archivos:** `src/research/ports.ts`, `src/research/registry.ts`, `src/research/layout.ts`, `src/research/provenance.ts`, `src/research/brand.ts`, `src/research/compare.ts`, `src/research/input-file.ts`, `src/research/image-file.ts`, `src/research/external-text.ts`, `src/research/adapters/manual/index.ts`, `src/research/adapters/url/index.ts`, `src/research/adapters/image/index.ts`, `src/research/adapters/design-md/index.ts`, `src/core/store/paths.ts`, `tests/unit/research/manual.test.ts`, `tests/unit/research/url.test.ts`, `tests/unit/research/image.test.ts`, `tests/unit/research/design-md.test.ts`, `tests/unit/research/provenance.test.ts`
  - **Interfaces:** ResearchSource; RESEARCH_SOURCES; sourceFor; validateReferenceInput; resolveInputFile; readInputFile; captureImageFile; fetchExternalText; manualSource; urlSource; imageSource; designMdSource
  - **Patrón:** src/intake/adapters/filesystem/index.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 4. Puerto ResearchSource, registro y adapters; §Decisions DR18 (D28); §Failure modes), `src/intake/{ports,detect,probe}.ts`, `src/core/store/paths.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/research`, esperado exit 0; casos de test "captures a manual reference without any I/O", "captures a page as untrusted content through the fetcher", "captures a sanitized image asset and maps sanitizer failures", "captures a DESIGN.md from a file or a URL as untrusted content", "names every missing provenance field in contract order"; base de P2.A1, P2.A2 y P2.A4.
  - **Nota:** cambiar el predicado local de `collectResearchFacts` (`src/app/facts.ts`) por `missingProvenance` de `src/research/provenance.ts` (revisión del lote 3).
  - **Fuera de alcance:** fuentes `penpot` (P6) y `refero` (P10).

- [x] **T9** (R13, R16) — Renderers de `REFERENCES.md`, `provenance.json` y moodboard HTML con CSP fijada por hash.
  - **Archivos:** `src/research/render/copy.ts`, `src/research/render/provenance.ts`, `src/research/render/references-md.ts`, `src/research/render/moodboard.ts`, `src/research/render/outputs.ts`, `tests/unit/research/render.test.ts`
  - **Interfaces:** renderReferencesMarkdown; buildProvenance; renderMoodboardHtml; MOODBOARD_CSP; renderResearchOutputs
  - **Patrón:** src/cli/render.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 9. Renderers; §Contracts › 10. Layout de `.heron/` tras P2 y marca de modo), `.claude/skills/heron-architecture/SKILL.md` (determinismo)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/research/render.test.ts`, esperado exit 0; casos de test "pins the moodboard stylesheet hash in the CSP", "escapes markdown and html in every user field"; base de P2.A7.
  - **Fuera de alcance:** escribir las salidas (T12).

## Lote 5 — Casos de uso y CLI

- [x] **T10** (R6, R7, R8, R9, R10, R11, R12, R15) — `heron references add|list|show|compare|remove|import` de punta a punta, con las pruebas de seguridad de ingesta.
  - **Archivos:** `src/app/context.ts`, `src/app/research-store.ts`, `src/app/references.ts`, `src/cli/commands/references.ts`, `src/cli/commands/index.ts`, `src/cli/render-research.ts`, `tests/helpers/cli.ts`, `tests/helpers/research.ts`, `tests/assets/research/design-injection.md`, `tests/assets/research/references-batch.json`, `tests/e2e/references.test.ts`, `tests/security/ssrf.test.ts`, `tests/security/paths.test.ts`, `tests/security/images.test.ts`, `tests/security/untrusted-content.test.ts`
  - **Interfaces:** runReferencesAdd; runReferencesList; runReferencesShow; runReferencesCompare; runReferencesRemove; runReferencesImport; referencesCommand
  - **Patrón:** src/app/gate.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 7. Casos de uso, 8. CLI, 10. Layout, 11. Findings nuevos y códigos de salida; §Failure modes; §Testing strategy), `src/app/{gate,write-run,workspace}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/references.test.ts tests/security`, esperado exit 0; casos de test "adds a manual reference with complete provenance", "rejects a reference missing any provenance field", "blocks every vector of the SSRF corpus and records explicit local allowances", "rejects image paths and symlinks escaping the allowed roots", "sanitizes, bounds and deduplicates imported images", "records suspicious instructions in external DESIGN.md without acting on them", "allows the research gate only with five references with provenance"; cubre P2.A1, P2.A2, P2.A3, P2.A4, P2.A5, P2.A6.
  - **Nota:** extender `tests/e2e/p1-compat.test.ts` para que, sobre los goldens de P1, `references add --source manual` funcione y un re-`init` conserve los artefactos de research (pendiente de la revisión del lote 2).
  - **Fuera de alcance:** `brand` y `research render` (T11).

- [x] **T11** (R13, R14, R16) — `heron brand add` y `heron research render`, más `status` con las órdenes de P2 y el aviso de assets grandes.
  - **Archivos:** `src/app/brand.ts`, `src/app/research.ts`, `src/app/status.ts`, `src/cli/commands/brand.ts`, `src/cli/commands/research.ts`, `src/cli/commands/index.ts`, `src/cli/render-research.ts`, `tests/e2e/brand.test.ts`, `tests/e2e/research-render.test.ts`, `tests/e2e/status.test.ts`
  - **Interfaces:** runBrandAdd; runResearchRender; brandCommand; researchCommand
  - **Patrón:** src/app/init.ts
  - **Lectura:** `specs/0002-research/design.md` (§Contracts › 7. Casos de uso, 8. CLI, 9. Renderers, 10. Layout), `src/app/references.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/brand.test.ts tests/e2e/research-render.test.ts tests/e2e/status.test.ts`, esperado exit 0; casos de test "requires an origin for every brand input", "renders reference-only outputs with escaped text and CSP", "renders byte-identical outputs and skips the write when nothing changed", "warns when research assets exceed the size threshold"; cubre P2.A7 y P2.A8.
  - **Nota:** cubrir la fila "vía `brand add --file`" en `tests/security/paths.test.ts` (pendiente de T10).
  - **Fuera de alcance:** `brand list|show|remove` (no lo exige R14).

- [x] **T13** (R13, R1) — `heron init --locale <bcp47>`: idioma de las salidas de research (DR17), con `project.json` conservando lo que no es `source`.
  - **Archivos:** `src/app/init.ts`, `src/cli/commands/init.ts`, `src/cli/command.ts`, `tests/e2e/init.test.ts`, `tests/e2e/research-render.test.ts`, `tests/unit/cli-args.test.ts`, `tests/unit/app/write-run.test.ts`, `tests/unit/store.test.ts`
  - **Interfaces:** InitInput.locale; InitParsed.locale; LOCALE_INVALID
  - **Patrón:** src/app/init.ts
  - **Lectura:** `specs/0002-research/design.md` (DR17; §Contracts › 7. Casos de uso, 8.1 USAGE, 11 `LOCALE_INVALID`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/init.test.ts tests/e2e/research-render.test.ts tests/unit/cli-args.test.ts`, esperado exit 0; casos de test "persists a canonical locale, keeps it on re-init and rejects an invalid tag before writing", "renders the es catalog without LOCALE_FALLBACK after init --locale es-MX"; valida con `Intl.getCanonicalLocales` (`LOCALE_INVALID`, exit 2, antes de escribir), persiste `project.json.product.locale` (opcional, sin bump), `init` sin `--locale` conserva el valor previo y todo `project.json` salvo `source`; `InitParsed.locale` solo existe si se pasó el flag; el catálogo se elige por subetiqueta primaria (`es-MX` → `es`).
  - **Fuera de alcance:** `status`/`doctor` mostrando el locale.


## Lote 6 — Documentación y recorrido real

- [x] **T12** (R17, R16) — ADR de la frontera de fuentes, `docs/research.md`, `docs/security.md`, arquitectura y README; quality gate completo.
  - **Archivos:** `docs/adr/0003-research-source-boundary.md`, `docs/research.md`, `docs/security.md`, `docs/architecture.md`, `README.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** ResearchSource; createSafeFetcher
  - **Patrón:** docs/adr/0001-state-persistence.md
  - **Lectura:** `specs/0002-research/design.md` (§Components › Dependencias, scripts y docs; §Testing strategy › P2.A9), `docs/architecture.md`, `README.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the research source boundary, the research workflow and the SSRF policy"; prepara P2.A9 (recorrido manual del usuario sobre `monorepo-fullstack` siguiendo `docs/research.md`).
  - **Fuera de alcance:** ADR 0002 (zonas de escritura, P3).
