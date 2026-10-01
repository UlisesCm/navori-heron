# 0004 Contrato UX y ProductContext — Tasks

Lotes de 1–3 tareas. Cada test lleva `// Covers: R<n>` en la primera línea y usa el nombre exacto del caso de `design.md` § Testing strategy. Convenciones vinculantes: skill `heron-architecture`. Nunca se escribe dentro de `fixtures/` (los tests usan `copyFixture`); ningún test sale a la red. Las decisiones del usuario del 2026-10-01 ya están aplicadas (`design.md` DR28–DR33). Orden de integración: 0004 antes que 0003; T0 es común a ambas specs y aterriza con el primer PR de 0004.

## Lote 0 — Base compartida con 0003

- [x] **T0** (R8, R18) — `freshen` único y aserciones derivadas de los registros en los tests que 0003 y 0004 modifican.
  - **Archivos:** `src/core/state/lifecycle.ts`, `tests/unit/lifecycle.test.ts`, `tests/unit/contracts.test.ts`, `tests/unit/cli-args.test.ts`, `tests/e2e/status.test.ts`, `tests/e2e/doctor.test.ts`
  - **Interfaces:** freshen; CONTRACT_DOCUMENTS; CLI_COMMANDS; COMMANDS; FINDING_CODES; DOCTOR_CHECK_IDS
  - **Patrón:** src/core/state/lifecycle.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 9; § Decisions DR16, DR18; § Migration › Archivos compartidos con 0003), `specs/0003-agents-directions/design.md` (DR17, firma de `freshen`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/lifecycle.test.ts tests/unit/contracts.test.ts tests/unit/cli-args.test.ts tests/e2e/status.test.ts tests/e2e/doctor.test.ts`, esperado exit 0 sin ninguna cantidad literal de schemas, documentos, órdenes, códigos o checks en esas aserciones (P1/P2 como prefijo fijo; el resto derivado de `CONTRACT_DOCUMENTS`, `CLI_COMMANDS`, `COMMANDS`, `FINDING_CODES` y `DOCTOR_CHECK_IDS`); casos de test "freshens regenerated artifacts and marks their dependents stale", "validates every registered document kind and its schema file name", "keeps the append-only registries unique and well-formed", "derives the usage text, parsing and lookup from the command registry", "reports mode, phase, gates and counts without writing anything", "reports every base check as PASS on an initialized workspace without writing"; habilita P4.A6 y P4.A7.
  - **Nota:** es la "micro-tarea compartida" que 0003 asume (0003 DR17 y DR31): 0003 no la reimplementa, solo llama `freshen` y agrega entradas a los registros. Reserva de ADR: 0003 usa 0002 y 0005; 0004 usa 0006 (DR16, DR18).
  - **Fuera de alcance:** cualquier contrato o comando nuevo.

## Lote 1 — Fixtures, golden de P2 y contratos

- [x] **T1** (R11, R13, R18) — Fixture `membership-product` completo, fixture `conflict`, manifiestos SYNTHETIC y golden de P2 generado con el código de P2 antes de tocar contratos.
  - **Archivos:** `fixtures/membership-product/`, `fixtures/conflict/`, `fixtures/no-ux/SYNTHETIC`, `fixtures/ux-only-md/SYNTHETIC`, `fixtures/ux-only-json/SYNTHETIC`, `fixtures/ux-invalid/SYNTHETIC`, `fixtures/closed-stage/SYNTHETIC`, `fixtures/README.md`, `tests/helpers/fixtures.ts`, `tests/assets/p2-workspaces/membership-product/.heron/`, `tests/assets/p2-workspaces/README.md`, `tests/e2e/p2-compat.test.ts`
  - **Interfaces:** FixtureName; copyP2Workspace
  - **Patrón:** tests/e2e/p1-compat.test.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 14; § Decisions DR12, DR24; § Decisions DR30; § Migration), `fixtures/README.md`, `tests/assets/p1-workspaces/README.md`, plantillas del harness (`git -C ../navori-harness show origin/main:packages/core/core-assets/master-plan/en/{master,ux,digest,decisions}.md`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test` (suite completa: el fixture lo usan `init`, `gate`, `status`, `doctor`, `p1-compat`, `store` y `perf`), esperado exit 0 con las aserciones de P1 intactas (etapa `01-mvp`, `ux: "md-json"`, superficies `MOBILE`, `DASHBOARD`, `PARTNER`, 6 pantallas, 3 flows, 2 patterns); casos de test "reports FULL PRODUCT for the membership-product fixture", "reads P2 workspaces without DOCUMENT_INVALID and keeps their research artifacts"; `fixtures/README.md` registra el comando reproducible de la sonda y su resultado (los cuatro JSON del harness de ambos fixtures validan con los schemas de `aa149ad5`); habilita P4.A1, P4.A3 y P4.A6.
  - **Nota:** el golden se genera con `git worktree add {tmp}/heron-p2 b8ee0a9` sobre una copia del fixture ya reescrito y sin decisiones de gate (DR24).
  - **Fuera de alcance:** el test de SYNTHETIC (T14); el caso de intake sobre el golden (T13).

- [x] **T2** (R1, R5, R6, R8, R9, R10) — Contratos de P4, códigos de finding, `source.inputs` y corrección de `canonicalJson` para claves `__proto__`.
  - **Archivos:** `src/core/contracts/product-context.ts`, `src/core/contracts/intake-data.ts`, `src/core/contracts/cli-envelope.ts`, `src/core/contracts/version.ts`, `src/core/contracts/index.ts`, `src/core/contracts/common.ts`, `src/core/contracts/canonical-json.ts`, `src/core/contracts/heron-project.ts`, `schemas/`, `tests/unit/contracts.test.ts`
  - **Interfaces:** ProductContext; ProductContextSchema; PRODUCT_CONTEXT_DOCUMENT; IntakeConflicts; INTAKE_CONFLICTS_DOCUMENT; ManualContext; MANUAL_CONTEXT_DOCUMENT; SourceRef; Extension; CONFLICT_KINDS; CONFLICT_KIND_PATTERN; IntakeData; ConflictsListData; ConflictsAckData; canonicalJson
  - **Patrón:** src/core/contracts/research.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 1–5, 13; § Decisions DR25, DR26; § Migration), `src/core/contracts/**`, `scripts/gen-schemas.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/unit/contracts.test.ts tests/repo/schemas.test.ts`, esperado exit 0 y deriva cero en `schemas/`; casos de test "round-trips the intake documents and rejects a newer schemaVersion naming the supported one", "keeps __proto__ keys and sorts keys at every depth", "validates every registered document kind and its schema file name"; base de P4.A1, P4.A5 y P4.A6.
  - **Fuera de alcance:** lectura de fuentes y escritura de documentos (T3–T11).

## Lote 2 — Lectores y extracción

- [x] **T3** (R2, R16) — Normalización de texto, lectura de fuentes, extractor Markdown por rol (plantillas reales es ∪ en) y tipos nuevos del puerto.
  - **Archivos:** `src/intake/text.ts`, `src/intake/sources.ts`, `src/intake/markdown.ts`, `src/intake/ports.ts`, `tests/unit/intake/markdown.test.ts`, `tests/helpers/intake.ts`
  - **Interfaces:** normalizeText; stripInline; actorKeys; readSource; listContextMarkdown; MAX_CONTEXT_FILES; parseMarkdown; sectionAnchor; ROLE_HEADINGS; extractRoleSections; Candidate; ContextDraft; AdapterSelection
  - **Patrón:** src/intake/probe.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 6, 7; § Decisions DR2, DR8, DR20, DR21; § Failure modes), `src/intake/{probe,ports}.ts`, navori-harness `origin/main` `core-assets/master-plan/{digest,en/digest,master,en/master}.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/markdown.test.ts`, esperado exit 0; casos de test "extracts role sections in Spanish and English and ignores everything else", "reads the real DIGEST template and reports sources without elements"; base de P4.A1.
  - **Nota:** en `ports.ts` solo se agregan tipos; la firma de `load` cambia en T8.
  - **Fuera de alcance:** `DECISIONS.md`, `UX.md` y `parts.json` (T4).

- [x] **T4** (R2, R15, R16) — `DECISIONS.md` y `UX.md` por `ux-kind`, nombre e idioma de `navori.config.json` y `parts.json` tolerante con ids de criterio.
  - **Archivos:** `src/intake/adapters/navori-master/decisions.ts`, `src/intake/ux-markdown.ts`, `src/intake/adapters/navori-master/harness.ts`, `tests/unit/intake/navori-master.test.ts`, `tests/unit/harness-readers.test.ts`
  - **Interfaces:** parseDecisions; extractUxMarkdown; readParts; NavoriConfigView; PartView
  - **Patrón:** src/intake/adapters/navori-master/harness.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 6, 7; § Decisions DR8, DR9, DR11), navori-harness `origin/main` `packages/cli/src/lib/master/{markers,schema}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/navori-master.test.ts tests/unit/harness-readers.test.ts`, esperado exit 0; casos de test "parses decisions and UX.md ux-kind sections", "reads the harness language and a tolerant parts.json"; base de P4.A1.
  - **Fuera de alcance:** cambiar el locale de los artefactos (DR33).

- [x] **T5** (R10) — Lector UX conmutable y mapeo de `ux.json` a candidatos con extensiones en orden de fuente.
  - **Archivos:** `src/intake/ux-contract.ts`, `src/intake/ux-model.ts`, `tests/contracts/ux-contract.test.ts`
  - **Interfaces:** UxReader; PROVISIONAL_UX_READER; ACTIVE_UX_READER; uxCandidates; extensionsOf; KNOWN_UX_FIELDS
  - **Patrón:** src/intake/ux-contract.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 6, 7; § Decisions DR9, DR10, DR25, DR32), navori-harness `origin/main` `packages/cli/src/lib/master/schema.ts` (`UxContractSchema`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/contracts/ux-contract.test.ts && test ! -e tests/unit/ux-contract.test.ts`, esperado exit 0 con las aserciones de P1 intactas (archivo movido con `git mv`, `references/layout.md`); casos de test "rejects broken relations and preserves unknown fields", "preserves unknown ux.json fields and stable ids"; base de P4.A5 (la aserción "`ux.json` intacto tras `intake`" llega en T11).
  - **Fuera de alcance:** la copia fijada del schema del harness (P11).

## Lote 3 — Precedencia y conflictos

- [ ] **T6** (R3, R4) — Fusión por precedencia RN-7, omisión de ítems de menor rango en secciones por nombre y construcción de las 19 secciones.
  - **Archivos:** `src/intake/precedence.ts`, `src/intake/product-context.ts`, `tests/unit/intake/precedence.test.ts`, `tests/helpers/intake.ts`
  - **Interfaces:** SOURCE_PRECEDENCE; sourceRank; COMPARABLE_FIELDS; NAME_KEYED_SECTIONS; mergeCandidates; buildProductContext; countSections
  - **Patrón:** src/core/state/transitions.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 1, 6; § Decisions DR1, DR3, DR13, DR21), `src/core/state/stale.ts` (`compareStrings`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/precedence.test.ts`, esperado exit 0; casos de test "applies source precedence and records the winning source"; cubre P4.A2.
  - **Nota:** al fusionar los estados globales de `UX.md` (`global: true`) con los de `ux.json` (`global: false`, con `screens`) bajo la misma clave normalizada, unir los campos `global` y `screens` en lugar de que gane solo el de mayor rango.
  - **Fuera de alcance:** ids de conflicto (T7).

- [ ] **T7** (R5, R7) — Conflictos por par con fingerprint estable, reapertura de resueltos, reconocimiento, detalle de `intake-context-valid` y re-aprobación de `intake` en sitio desde producción.
  - **Archivos:** `src/intake/conflicts.ts`, `src/intake/product-context.ts`, `src/core/state/transitions.ts`, `tests/unit/intake/conflicts.test.ts`, `tests/unit/state-machine.test.ts`
  - **Interfaces:** detectConflicts; reconcileConflicts; acknowledgeConflict; unacknowledgedCount; conflictFingerprint; withConflictIds
  - **Patrón:** src/core/state/gates.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 2, 8, 9; § Decisions DR4, DR5, DR6, DR7, DR17, DR26), `src/core/state/transitions.ts` (`FACT_CHECKS`, `FORWARD_ROWS`), `specs/0001-heron-core/design.md` (DP9)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/conflicts.test.ts tests/unit/state-machine.test.ts`, esperado exit 0; casos de test "detects each conflict kind deterministically", "keeps conflict ids and acknowledgements stable across runs", "names the missing product context or the unacknowledged conflicts", "re-approves the intake gate in place from every production phase"; base de P4.A3 y P4.A8.
  - **Fuera de alcance:** el caso sobre el fixture `conflict` (T8) y la orden `conflicts` (T12).

## Lote 4 — Adapters

- [ ] **T8** (R1, R2, R3, R13, R15) — `load` real de `navori-master` sobre todas sus fuentes; P4.A1 y P4.A3 sobre los fixtures.
  - **Archivos:** `src/intake/ports.ts`, `src/intake/adapters/navori-master/index.ts`, `tests/contracts/product-context.test.ts`, `tests/unit/intake/precedence.test.ts`
  - **Interfaces:** loadNavoriMaster; LoadRequest; AdapterLoadResult
  - **Patrón:** src/intake/adapters/navori-master/index.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 6, 7, 8; § Decisions DR2, DR8, DR9, DR12; § Failure modes), `src/intake/ports.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/contracts/product-context.test.ts tests/unit/intake/precedence.test.ts`, esperado exit 0; casos de test "maps membership-product into ProductContext v1 with its nineteen sections", "every element points to the source text it came from", "reads the harness language and tolerates unknown sections and fields", "records a CONFLICT and blocks the intake gate until acknowledged"; cubre P4.A1 y P4.A3.
  - **Nota:** la unión de fallos de `AdapterLoadResult` conserva `LOAD_NOT_AVAILABLE` hasta T9 (el adapter `filesystem` aún es stub).
  - **Fuera de alcance:** `filesystem` (T9), `markdown`/`manual` (T10).

- [ ] **T9** (R3, R9) — `load` real de `filesystem`, `adapterFor` y retiro del stub de P1.
  - **Archivos:** `src/intake/adapters/filesystem/index.ts`, `src/intake/detect.ts`, `src/intake/ports.ts`, `tests/unit/intake/adapters.test.ts`
  - **Interfaces:** adapterFor; filesystemAdapter
  - **Patrón:** src/intake/adapters/filesystem/index.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 6, 7; § Decisions DR9)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/adapters.test.ts`, esperado exit 0 y ningún `loadNotAvailable` en `src/`; casos de test "keeps UX sections empty in reference-only"; base de P4.A4.
  - **Fuera de alcance:** selección explícita (T10).

- [ ] **T10** (R9) — Adapters `markdown` y `manual`, validación de insumos y selección explícita en `detectProject`.
  - **Archivos:** `src/intake/inputs.ts`, `src/intake/adapters/markdown/index.ts`, `src/intake/adapters/manual/index.ts`, `src/intake/detect.ts`, `src/core/state/mode.ts`, `tests/unit/intake/adapters.test.ts`, `tests/unit/mode.test.ts`, `tests/assets/intake/product-brief.md`, `tests/assets/intake/manual-context.json`
  - **Interfaces:** markdownAdapter; manualAdapter; validateSelection; parseManualContext; MAX_CONTEXT_INPUTS; OPT_IN_ADAPTERS; detectProject; describeModeBlock
  - **Patrón:** src/intake/adapters/filesystem/index.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 3, 6, 7; § Decisions DR20, DR22, DR28), `src/core/state/mode.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/intake/adapters.test.ts tests/unit/mode.test.ts`, esperado exit 0; casos de test "only the filesystem and navori-master adapters can reach full", "explains reference-only for the markdown and manual adapters"; cubre P4.A4.
  - **Fuera de alcance:** flags de `init` (T13).

## Lote 5 — Casos de uso y CLI

- [ ] **T11** (R8, R10) — `heron intake [path] [--dry-run] [--refresh] [--json]`: cálculo compartido, escritura atómica en cualquier fase, idempotencia y `freshen`; verificación de realismo sobre este repo.
  - **Archivos:** `src/app/intake.ts`, `src/app/workspace.ts`, `src/cli/commands/intake.ts`, `src/cli/commands/index.ts`, `src/cli/command.ts`, `src/cli/render-intake.ts`, `tests/e2e/intake.test.ts`, `tests/contracts/ux-contract.test.ts`
  - **Interfaces:** runIntake; computeIntake; PRODUCT_CONTEXT_FILE; CONFLICTS_FILE; selectionOf; intakeCommand; IntakeParsed; renderIntakeText
  - **Patrón:** src/app/research.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Recomendación; § Contracts › 10–13; § Decisions DR2, DR7, DR15, DR16, DR27, DR29, DR31), `src/app/{write-run,workspace,research}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/intake.test.ts tests/contracts/ux-contract.test.ts`, esperado exit 0; casos de test "writes the product context and its conflicts once and skips unchanged runs", "previews the product context with --dry-run without a workspace", "preserves unknown ux.json fields and stable ids" (ahora también `ux.json` con el mismo sha256 tras `intake`); y comando `d="$(mktemp -d)" && cp -R fixtures/membership-product/. "$d" && bun run heron init "$d" >/dev/null && bun run heron intake --json "$d" && test -z "$(git status --porcelain fixtures/)"`, esperado exit 0, `data.mode = "full"`, `data.conflicts = []` y `data.counts` con `surfaces` 3, `screens` 6, `flows` 3, `patterns` 2; y verificación de realismo `bun run heron intake --dry-run --json .`, esperado exit 0, `data.mode = "reference-only"` y los conteos de DR27 (registrados en el PR); cubre P4.A5 y P4.A7.
  - **Nota:** el comando de P4.A7 es el enmendado por D30 (DR29). `USAGE_TEXT` ya no se compara literal (T0).
  - **Fuera de alcance:** `conflicts list|ack`, hechos del gate y `status` (T12).

- [ ] **T12** (R6, R7, R12, R14) — `heron conflicts list|ack`, hechos de intake en el gate, re-aprobación en producción de punta a punta y conflictos y frescura en `status`.
  - **Archivos:** `src/app/conflicts.ts`, `src/app/facts.ts`, `src/app/gate.ts`, `src/app/status.ts`, `src/cli/commands/conflicts.ts`, `src/cli/commands/index.ts`, `src/cli/command.ts`, `src/cli/render-intake.ts`, `tests/e2e/conflicts.test.ts`, `tests/e2e/gate.test.ts`, `tests/e2e/status.test.ts`, `tests/e2e/intake.test.ts`, `tests/perf/init.perf.test.ts`
  - **Interfaces:** runConflictsList; runConflictsAck; collectIntakeFacts; conflictsCommand; ConflictsParsed; renderConflictsListText; renderConflictsAckText
  - **Patrón:** src/app/gate.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 10, 11, 13; § Decisions DR6, DR7, DR14, DR17, DR23; § Migration › aserciones que cambian), `src/app/{gate,facts,status}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/conflicts.test.ts tests/e2e/gate.test.ts tests/e2e/status.test.ts tests/e2e/intake.test.ts tests/perf/init.perf.test.ts`, esperado exit 0; casos de test "approves intake with valid context, recording approvedBy, artifact hashes, and committing only state.json", "lists and acknowledges conflicts with a note and an identity", "blocks the intake gate while a conflict is not acknowledged", "reports open conflicts and a stale product context", "does not report stale when an unused or non-contributing source changes", "absorbs a product context change in a production phase and re-approves intake in place", "status p95 under 2000 ms with a product context and 50 context files"; cubre P4.A3 y P4.A8.
  - **Nota:** cambia `tests/e2e/gate.test.ts:46` (detalle de `intake-context-valid`, DR17).
  - **Nota:** eliminar la allowlist `PENDING_SPECS` del test de registros (`tests/unit/contracts.test.ts`, agregada en T2 con `TODO(T11)`) una vez que `intake` y `conflicts` tengan su `CommandSpec`: exime por nombre de grupo y podría ocultar una spec faltante.
  - **Fuera de alcance:** `init --adapter` (T13).

- [ ] **T13** (R9, R18) — `heron init --adapter auto|markdown|manual --context <archivo>...` y compatibilidad con un workspace de P2.
  - **Archivos:** `src/app/init.ts`, `src/cli/commands/init.ts`, `src/cli/command.ts`, `src/cli/render.ts`, `tests/e2e/init.test.ts`, `tests/e2e/p2-compat.test.ts`, `tests/unit/cli-args.test.ts`
  - **Interfaces:** runInit; InitParsed; renderInitText
  - **Patrón:** src/app/init.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Contracts › 10, 11; § Decisions DR22, DR24, DR28), `src/app/{init,workspace}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/init.test.ts tests/e2e/p2-compat.test.ts tests/unit/cli-args.test.ts`, esperado exit 0 con las salidas de `init` de P1 intactas; casos de test "selects the markdown or manual adapter explicitly and keeps it on re-init", "runs intake and approves the intake gate over a P2 workspace without invalidating research", "parses intake, conflicts and the init adapter options"; cubre P4.A4 (por la CLI) y P4.A8 (sobre un workspace de P2).
  - **Fuera de alcance:** mostrar el adapter en `status`.

## Lote 6 — JSON Schemas, documentación y skill

- [ ] **T14** (R11) — Validación de lo emitido con ajv 2020 estricto sobre todos los fixtures, regla SYNTHETIC y umbral de cobertura de `src/intake/`.
  - **Archivos:** `tests/contracts/json-schema.test.ts`, `package.json`, `bun.lock`, `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts`
  - **Interfaces:** CONTRACT_DOCUMENTS; COVERAGE_RULES
  - **Patrón:** tests/repo/schemas.test.ts
  - **Lectura:** `specs/0004-product-context/design.md` (§ Decisions DR19, DR30; § Contracts › 14, 15), `scripts/{gen-schemas,check-coverage}.ts`
  - **Librerías:** ajv@8.20.0
  - **Done:** comando `bun install --frozen-lockfile && bun test tests/contracts/json-schema.test.ts tests/repo/coverage-rules.test.ts`, esperado exit 0 (incluye compilar en modo estricto los 3 schemas nuevos); casos de test "emitted JSON Schemas validate every fixture and fixtures are marked SYNTHETIC"; cubre P4.A6.
  - **Fuera de alcance:** validar `dist/` (P5).

- [ ] **T15** (R10, R17) — ADR 0006, `docs/contracts.md`, `docs/integrations/navori-harness.md`, arquitectura (enmienda de DP9), README y skill `heron-architecture`; quality gate completo.
  - **Archivos:** `docs/adr/0006-canonical-data-model.md`, `docs/contracts.md`, `docs/integrations/navori-harness.md`, `docs/architecture.md`, `README.md`, `tests/repo/docs.test.ts`, `.claude/skills/heron-architecture/references/layout.md`, `.claude/skills/heron-architecture/references/recipes.md`
  - **Interfaces:** ProductContext; ACTIVE_UX_READER
  - **Patrón:** docs/adr/0003-research-source-boundary.md
  - **Lectura:** `specs/0004-product-context/design.md` (§ Approach; § Contracts › 7, 8; § Decisions DR4, DR7, DR10, DR18, DR21; § Conocimiento durable; § Testing strategy › P4.A9), `docs/architecture.md`, `README.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the canonical data model and the navori-harness integration"; prepara P4.A9 (el usuario lee ambos documentos y responde "Aprobado").
  - **Fuera de alcance:** `docs/workflow.md` (P5).

## Cobertura

**Criterios → requisitos → tareas**

| Criterio | Requisitos | Tareas |
|---|---|---|
| P4.A1 | R1, R2, R3, R13, R15, R16 | T2, T3, T4, T8 |
| P4.A2 | R4 | T6 |
| P4.A3 | R5, R6, R7, R13, R14 | T7, T8, T12 |
| P4.A4 | R3, R9 | T9, T10, T13 |
| P4.A5 | R10 | T2, T5, T11 |
| P4.A6 | R1, R11, R18 | T0, T1, T2, T14 |
| P4.A7 | R2, R8, R13 | T0, T11 |
| P4.A8 | R7, R12, R18 | T7, T12, T13 |
| P4.A9 | R10, R17 | T15 |

**Requisitos → tareas:** R1 T2, T8 · R2 T3, T4, T8 · R3 T6, T8, T9 · R4 T6 · R5 T7 · R6 T12 · R7 T7, T12 · R8 T0, T11 · R9 T10, T13 · R10 T2, T5, T11, T15 · R11 T1, T14 · R12 T12 · R13 T1, T8 · R14 T12 · R15 T4, T8 · R16 T3, T4 · R17 T15 · R18 T0, T1, T13.

**Components de `design.md` → tareas** (toda fila de § Components está en el campo **Archivos** de al menos una tarea)

| Componente | Tarea |
|---|---|
| `src/core/state/lifecycle.ts`, `tests/unit/lifecycle.test.ts` | T0 |
| `tests/unit/contracts.test.ts` | T0, T2 |
| `tests/unit/cli-args.test.ts` | T0, T13 |
| `tests/e2e/status.test.ts` | T0, T12 |
| `tests/e2e/doctor.test.ts` | T0 |
| `src/core/contracts/{product-context,intake-data,cli-envelope,version,index,common,canonical-json,heron-project}.ts`, `schemas/` | T2 |
| `src/core/state/transitions.ts` | T7 |
| `src/core/state/mode.ts` | T10 |
| `src/intake/ports.ts` | T3, T8, T9 |
| `src/intake/detect.ts` | T9, T10 |
| `src/intake/{text,sources,markdown}.ts` | T3 |
| `src/intake/ux-markdown.ts`, `src/intake/adapters/navori-master/{decisions,harness}.ts` | T4 |
| `src/intake/{ux-contract,ux-model}.ts` | T5 |
| `src/intake/precedence.ts` | T6 |
| `src/intake/product-context.ts` | T6, T7 |
| `src/intake/conflicts.ts` | T7 |
| `src/intake/inputs.ts`, `src/intake/adapters/{markdown,manual}/index.ts` | T10 |
| `src/intake/adapters/navori-master/index.ts` | T8 |
| `src/intake/adapters/filesystem/index.ts` | T9 |
| `src/app/{intake,workspace}.ts` | T11 |
| `src/app/{conflicts,facts,gate,status}.ts` | T12 |
| `src/app/init.ts` | T13 |
| `src/cli/command.ts`, `src/cli/commands/index.ts` | T11, T12 (y `command.ts` en T13) |
| `src/cli/render-intake.ts` | T11, T12 |
| `src/cli/commands/intake.ts` | T11 |
| `src/cli/commands/conflicts.ts` | T12 |
| `src/cli/commands/init.ts`, `src/cli/render.ts` | T13 |
| `fixtures/membership-product/**`, `fixtures/conflict/**`, `fixtures/*/SYNTHETIC`, `fixtures/README.md` | T1 |
| `tests/assets/p2-workspaces/**` | T1 |
| `tests/assets/intake/{product-brief.md,manual-context.json}` | T10 |
| `package.json`, `bun.lock`, `scripts/check-coverage.ts` | T14 |
| `docs/adr/0006-canonical-data-model.md`, `docs/contracts.md`, `docs/integrations/navori-harness.md`, `docs/architecture.md`, `README.md`, `.claude/skills/heron-architecture/references/{layout,recipes}.md` | T15 |
| `tests/contracts/product-context.test.ts` | T8 |
| `tests/contracts/ux-contract.test.ts` | T5, T11 |
| `tests/contracts/json-schema.test.ts` | T14 |
| `tests/unit/intake/precedence.test.ts` | T6, T8 |
| `tests/unit/intake/conflicts.test.ts` | T7 |
| `tests/unit/intake/markdown.test.ts` | T3 |
| `tests/unit/intake/navori-master.test.ts` | T4 |
| `tests/unit/intake/adapters.test.ts` | T9, T10 |
| `tests/e2e/intake.test.ts` | T11, T12 |
| `tests/e2e/conflicts.test.ts`, `tests/e2e/gate.test.ts` | T12 |
| `tests/e2e/p2-compat.test.ts` | T1, T13 |
| `tests/e2e/init.test.ts` | T13 |
| `tests/perf/init.perf.test.ts` | T12 |
| `tests/unit/harness-readers.test.ts` | T4 |
| `tests/unit/state-machine.test.ts` | T7 |
| `tests/unit/mode.test.ts` | T10 |
| `tests/repo/coverage-rules.test.ts` | T14 |
| `tests/repo/docs.test.ts` | T15 |
| `tests/helpers/fixtures.ts` | T1 |
| `tests/helpers/intake.ts` | T3, T6 |
