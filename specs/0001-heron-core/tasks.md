# 0001 Heron core — Tasks

Lotes de 1–3 tareas. Cada test lleva `// Covers: R<n>`. El patrón de todas las tareas es `specs/0001-heron-core/design.md` (repo greenfield: todavía no hay código propio que imitar); la sección concreta se nombra en **Lectura**. Nada escribe dentro de `fixtures/` durante los tests.

## Lote 1 — Tooling y contratos

- [x] **T1** (R14, R16) — Scaffold del paquete único y CI.
  - **Archivos:** `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `.gitignore` (agrega `node_modules/`, `coverage/`, `.DS_Store`, `/.heron/` a `progress/`), `.github/workflows/ci.yml`, `tests/repo/ci.test.ts`
  - **Interfaces:** bunfig.toml; tsconfig.json; .oxlintrc.json; .oxfmtrc.json; .github/workflows/ci.yml
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Components › Raíz y tooling; §Contracts › Scripts de `package.json`, `bunfig.toml`, `tsconfig.json`, `.oxlintrc.json` y `.oxfmtrc.json`, `.github/workflows/ci.yml`), `specs/0001-heron-core/requirements.md`
  - **Librerías:** typescript@7.0.2, zod@4.6.5, oxlint@1.86.0, oxfmt@0.71.0, @types/bun@1.4.2
  - **Done:** comando `bun install --frozen-lockfile && bun test tests/repo/ci.test.ts`, esperado exit 0; casos de test "ci workflow runs the quality gate on pull requests and main"; cubre P1.A16.
  - **Fuera de alcance:** scripts `check` y `check-coverage` completos (T14); cualquier archivo de `src/`.

- [x] **T2** (R11, R15) — Contratos Zod versionados, JSON canónico y gate de versión.
  - **Archivos:** `src/core/contracts/common.ts`, `src/core/contracts/canonical-json.ts`, `src/core/contracts/version.ts`, `src/core/contracts/heron-project.ts`, `src/core/contracts/heron-state.ts`, `src/core/contracts/mode-decision.ts`, `src/core/contracts/cli-envelope.ts`, `src/core/contracts/index.ts`, `tests/unit/contracts.test.ts`
  - **Interfaces:** FINDING_CODES; ExitCode; canonicalJson; DocumentSpec; parseVersionedDocument; HeronProjectSchema; HeronStateSchema; TransitionSchema; GateDecisionSchema; DetectionReportSchema; ModeDecisionSchema; CliEnvelopeSchema; CONTRACT_DOCUMENTS
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/core/contracts/*`; §Decisions DP8, DP8b, DP11), `specs/0001-heron-core/requirements.md`
  - **Librerías:** zod@4.6.5
  - **Done:** comando `bun test tests/unit/contracts.test.ts`, esperado exit 0; casos de test "rejects an unknown schemaVersion naming the supported one"; cubre P1.A9.
  - **Fuera de alcance:** lógica que use los schemas (T4–T11); `UxContractSchema` (T8).

- [x] **T3** (R15) — Generación de JSON Schemas sin deriva.
  - **Archivos:** `scripts/gen-schemas.ts`, `schemas/heron-project.v1.schema.json`, `schemas/heron-state.v1.schema.json`, `schemas/mode-decision.v1.schema.json`, `schemas/cli-envelope.v1.schema.json`, `tests/repo/schemas.test.ts`
  - **Interfaces:** generateSchemas; CONTRACT_DOCUMENTS
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `scripts/gen-schemas.ts`), `src/core/contracts/index.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/repo/schemas.test.ts`, esperado exit 0 y `git diff --exit-code schemas/` sin diff una vez commiteado; casos de test "schemas directory matches the Zod contracts"; cubre P1.A14.
  - **Fuera de alcance:** validar documentos con ajv (P4).

## Lote 2 — Dominio puro de estado

- [x] **T4** (R8) — Tabla de transiciones con guard de modo y de aprobaciones.
  - **Archivos:** `src/core/state/transitions.ts`, `tests/unit/state-machine.test.ts`
  - **Interfaces:** TRANSITIONS; canTransition; applyTransition; TransitionRule; TransitionFacts
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/core/state/transitions.ts`; §Decisions DP8, DP8b, DP9, DP10), `src/core/contracts/heron-state.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/state-machine.test.ts`, esperado exit 0; casos de test "blocks production transitions in reference-only and rejects pairs outside the table"; cubre P1.A6.
  - **Fuera de alcance:** producir los hechos de Penpot o research (P2, P12, P5); los hechos se inyectan en el test.

- [x] **T5** (R8, R9, R10) — Gates atados a hashes, propagación de stale y ciclo de vida.
  - **Archivos:** `src/core/state/gates.ts`, `src/core/state/stale.ts`, `src/core/state/lifecycle.ts`, `tests/unit/gates.test.ts`, `tests/unit/stale.test.ts`
  - **Interfaces:** GATE_BINDINGS; approveGate; rejectGate; isApprovalValid; propagateStale; markStaleAfter; createInitialState; recordInit
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/core/state/gates.ts`, `src/core/state/stale.ts` y `src/core/state/lifecycle.ts`), `src/core/state/transitions.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/gates.test.ts tests/unit/stale.test.ts`, esperado exit 0; casos de test "invalidates an approval when a bound artifact hash changes"; cubre P1.A7.
  - **Fuera de alcance:** escribir en disco (T7).

- [x] **T6** (R2, R3, R4, R5, R7) — Decisión de modo.
  - **Archivos:** `src/core/state/mode.ts`, `tests/unit/mode.test.ts`
  - **Interfaces:** detectMode; describeModeBlock
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/core/state/mode.ts`; §Decisions DP11), `specs/_master/01-heron/DECISIONS.md` (D6, D27)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/mode.test.ts`, esperado exit 0; casos de test "decides the mode from UX files and the harness declaration"; cubre P1.A3 y P1.A11.
  - **Fuera de alcance:** leer archivos (T8, T9).

## Lote 3 — Persistencia

- [x] **T7** (R10, R12) — Store atómico con lock, staging y rutas seguras.
  - **Archivos:** `src/core/store/fs-port.ts`, `src/core/store/paths.ts`, `src/core/store/hash.ts`, `src/core/store/atomic.ts`, `src/core/store/lock.ts`, `src/core/store/file-store.ts`, `tests/helpers/faulty-fs.ts`, `tests/unit/store.test.ts`
  - **Interfaces:** FsPort; writeAtomic; acquireLock; openFileStore; FileStore; StoreTransaction; withFaultInjection
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/core/store/*`; §Contracts › Layout de `.heron/` (P1); §Failure modes; §Decisions DP2)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/store.test.ts`, esperado exit 0; casos de test "keeps a consistent state on injected failures and rejects a second writer"; cubre P1.A8.
  - **Fuera de alcance:** casos de uso que usan el store (T10, T11).

## Lote 4 — Intake

- [x] **T8** (R1, R5, R12) — Puerto de adapters, sondeo de archivos y lector UX provisional.
  - **Archivos:** `src/intake/ports.ts`, `src/intake/probe.ts`, `src/intake/ux-contract.ts`, `tests/unit/ux-contract.test.ts`
  - **Interfaces:** ProductContextAdapter; probeFile; UxContractSchema; readUxContract; readUxMarkdown; checkUxFiles
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/intake/*`; §Contracts › Fixtures), `specs/_master/01-heron/DECISIONS.md` (D5)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/ux-contract.test.ts`, esperado exit 0; casos de test "rejects broken relations and preserves unknown fields"; cubre P1.A4.
  - **Fuera de alcance:** conmutar al schema fijado del harness (P11).

- [x] **T9** (R1, R4, R6, R7, R12) — Lectores tolerantes del harness, selección de etapa y adapters.
  - **Archivos:** `src/intake/adapters/navori-master/harness.ts`, `src/intake/adapters/navori-master/stage.ts`, `src/intake/adapters/navori-master/index.ts`, `src/intake/adapters/filesystem/index.ts`, `src/intake/detect.ts`, `tests/unit/harness-readers.test.ts`, `tests/unit/stage-selection.test.ts`
  - **Interfaces:** readNavoriConfig; readMasterIndex; readStageState; selectStage; STAGE_DIR_PATTERN; navoriMasterAdapter; filesystemAdapter; detectProject
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/intake/*`; §Failure modes), `specs/_master/index.json`, `specs/_master/01-heron/state.json`, `../navori-harness/packages/cli/src/lib/master/schema.ts` (solo lectura)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/harness-readers.test.ts tests/unit/stage-selection.test.ts`, esperado exit 0; casos de test "picks the last closed stage and never uses converted or abandoned stages without --stage"; cubre P1.A5.
  - **Fuera de alcance:** `load` real de los adapters y ProductContext (P4).

## Lote 5 — Casos de uso y CLI

- [x] **T10** (R1, R2, R3, R4, R5, R6, R7, R10, R12) — `heron init` y `heron status` de punta a punta, con fixtures.
  - **Archivos:** `src/app/context.ts`, `src/app/version.ts`, `src/app/result.ts`, `src/app/init.ts`, `src/app/status.ts`, `src/cli/main.ts`, `src/cli/args.ts`, `src/cli/io.ts`, `src/cli/envelope.ts`, `src/cli/render.ts`, `src/cli/commands/init.ts`, `src/cli/commands/status.ts`, `bin/heron.ts`, `fixtures/README.md`, `fixtures/membership-product/`, `fixtures/no-ux/`, `fixtures/ux-only-md/`, `fixtures/ux-only-json/`, `fixtures/ux-invalid/`, `fixtures/closed-stage/`, `tests/helpers/fixtures.ts`, `tests/helpers/cli.ts`, `tests/unit/cli-args.test.ts`, `tests/e2e/init.test.ts`, `tests/e2e/status.test.ts`
  - **Interfaces:** runInit; runStatus; handleInit; handleStatus; runCli; parseCliArgs; copyFixture; hashTree; runCliCaptured; fixedContext; describeModeBlock
  - **Nota:** el test de segundo escritor de `tests/unit/store.test.ts` usa temporalmente `tests/helpers/lock-child.ts`; al existir `bin/heron.ts`, repuntarlo a `bun bin/heron.ts init` como fija design.md (revisión del lote 3).
  - **Nota:** al renderizar un rechazo `MODE_BLOCKED` de `canTransition`, la capa de app agrega el sufijo `({describeModeBlock(decision)})` (design.md › Mensajes de findings; revisión del lote 2, MEDIO-1).
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/app/*`, `src/cli/*` y `bin/heron.ts`, Superficie de la CLI, Salida exacta de `init`, Mensajes de findings, Salida de `status`, Fixtures), `specs/_master/01-heron/context/md/PLAN.md` (sección "Resultado esperado")
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/init.test.ts tests/e2e/status.test.ts tests/unit/cli-args.test.ts`, esperado exit 0; casos de test "reports FULL PRODUCT for the membership-product fixture", "reports REFERENCE ONLY for the no-ux fixture", "falls back to reference-only without inferring the missing UX file", "treats a schema-invalid ux.json as reference-only and lists the issues", "selects stages explicitly or falls back to the last closed stage with a notice", "reports the harness UX declaration and tolerates unknown phases and modes", "never writes outside .heron/ in the product repo"; cubre P1.A1, P1.A2, P1.A3, P1.A4, P1.A5, P1.A10, P1.A11.
  - **Fuera de alcance:** `doctor` y `gate` (T11); comandos de research o diseño.

- [x] **T11** (R8, R9, R10, R11) — `heron doctor` y `heron gate`.
  - **Archivos:** `src/app/doctor.ts`, `src/app/gate.ts`, `src/cli/commands/doctor.ts`, `src/cli/commands/gate.ts`, `tests/e2e/doctor.test.ts`, `tests/e2e/gate.test.ts`
  - **Interfaces:** runDoctor; runGate; handleDoctor; handleGate; collectTransitionFacts; describeModeBlock
  - **Nota:** quitar el `TODO(T11)` de `src/cli/main.ts` (hoy `doctor`/`gate` responden exit 2 "not available yet") y conectar los handlers reales (revisión de T10).
  - **Nota:** `collectTransitionFacts` siempre provee `invalidatedGates` (la guarda de aprobaciones falla cerrada si falta) y el rechazo `MODE_BLOCKED` se renderiza con `describeModeBlock` (revisión del lote 2).
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `src/app/*`, Salida de `status`, `doctor` y `gate`; §Decisions DP10), `src/core/state/gates.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/doctor.test.ts tests/e2e/gate.test.ts`, esperado exit 0; casos de test "gate approval requires confirmation, identity and full mode"; cubre P1.A7.
  - **Fuera de alcance:** checks de agentes, Penpot y Refero en `doctor` (P3, P12, P10).

## Lote 6 — Calidad

- [x] **T12** (R13) — Latencia de `init` y `status`.
  - **Archivos:** `tests/perf/init.perf.test.ts`
  - **Interfaces:** runCliCaptured; copyFixture
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Testing strategy)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/perf/init.perf.test.ts`, esperado exit 0; casos de test "init and status p95 under 2000 ms on membership-product"; cubre P1.A12.
  - **Fuera de alcance:** optimizaciones sin medición que las justifique.

- [x] **T13** (R14) — Fronteras entre módulos y `any` justificado.
  - **Archivos:** `tests/repo/boundaries.test.ts`
  - **Interfaces:** ProductContextAdapter; FsPort
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Testing strategy, fila de `tests/repo/boundaries.test.ts`; §Decisions DP2)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/boundaries.test.ts`, esperado exit 0; casos de test "enforces module boundaries and no navori imports", "allows any only with a justification"; cubre P1.A13.
  - **Fuera de alcance:** mover código entre módulos para cumplir (si falla, se corrige en la tarea dueña del archivo).

- [x] **T14** (R16) — Quality gate completo con umbrales de cobertura por ruta.
  - **Archivos:** `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts`, `package.json` (script `check`)
  - **Interfaces:** evaluateCoverage
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Contracts › `scripts/check-coverage.ts`, `bunfig.toml`, Scripts de `package.json`)
  - **Librerías:** ninguna
  - **Done:** comando `bun run check`, esperado exit 0; casos de test "fails a path under 90 percent and files never loaded"; cubre P1.A15.
  - **Fuera de alcance:** `jscpd` y `semgrep` dentro de `check` (siguen como gates del harness).

## Lote 7 — Documentación e instalación

- [x] **T15** (R17, R8, R10) — README, arquitectura y ADR de persistencia.
  - **Archivos:** `README.md`, `docs/architecture.md`, `docs/adr/0001-state-persistence.md`
  - **Interfaces:** runCli; TRANSITIONS
  - **Patrón:** specs/0001-heron-core/design.md
  - **Lectura:** `specs/0001-heron-core/design.md` (§Approach, §Components, §Decisions), `specs/_master/01-heron/MASTER.md` (§Arquitectura)
  - **Librerías:** ninguna
  - **Done:** comando `bun link && heron init --dry-run fixtures/no-ux`, esperado exit 0 con `REFERENCE ONLY` en la salida; casos de test "reports REFERENCE ONLY for the no-ux fixture" siguen en verde; cubre P1.A17 (revisión manual del usuario siguiendo `README.md`).
  - **Fuera de alcance:** documentos de §74 de otras partes (P9).
