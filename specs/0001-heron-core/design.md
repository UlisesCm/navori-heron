# 0001 Heron core — Design

Parte P1 del master-plan `01-heron`. Cubre R1–R17 de `requirements.md`. Señales de diseño: primera abstracción compartida del repo (contratos, puertos, store), contrato compartido con un tercero (lectores del harness), concurrencia (lock de un escritor, escritura atómica) y decisiones difíciles de revertir (formato de `.heron/`, tabla de estados, versionado). Lo decidido en `MASTER.md` (Reglas de negocio, RNF, Dominio y datos, Arquitectura, Stack, Contratos, Seguridad) y en `DECISIONS.md` D1–D22 no se re-litiga aquí: este documento lo concreta para P1.

## Approach

### Qué existe (evidencia)

- **Repo de Heron:** sin código de producto. `git log` en `navori-heron` responde "does not have any commits yet"; en la raíz solo hay `.claude/`, `.codex/`, `.navori/`, `specs/`, `progress/`, `CLAUDE.md`, `navori.config.json`, `.mcp.json` y `.gitignore` (`progress/`). No hay nada que extender dentro del repo; todo el código de P1 es nuevo.
- **Contratos del harness que Heron lee (no importa)** — `navori-harness`, `git fetch origin main` hecho; `origin/main` = `44afd638`:
  - `packages/cli/src/lib/master/stages.ts:13` (`MASTER_DIR_NAME = "_master"`) y `:24` (`{specsDir}/_master/index.json`); `checks.ts:104` (`stagePath = join(masterDirPath(cwd, specsDir), stage.dir)`).
  - `schema.ts:84` `MasterIndexSchema` (`version` 1, `stages[]` con `number`, `slug`, `dir`, `state`, `openedAt`, `closedAt`, `spec`); `schema.ts:33` `MASTER_STAGE_STATES = ["activa","cerrada","convertida","abandonada"]`.
  - `schema.ts:117` `MASTER_PHASES` **sin** `ux`; `schema.ts:129` `MASTER_MODES = ["template","en-curso"]` **sin** `desde-cero`; `schema.ts:147` `MasterStateSchema` usa `z.enum` estrictos para ambos.
  - `schema.ts:18-29` `versionField`: una versión distinta de 1 falla con un mensaje que nombra la versión que se lee. Heron adopta el mismo patrón de mensaje para sus propios documentos.
  - `checks.ts:313` y `:346`: `DIGEST.md` y `CODEBASE.md` viven en `{stage}/context/`.
  - `packages/cli/src/lib/config/schema.ts:150-152` `SddSchema.specsDir` default `"specs"`; `:487` `sdd` es opcional.
- **Solo local (rama `feat/master-plan-ux-contract`, sin push: `git ls-remote` no la encuentra y `origin/main` sigue en `44afd638` tras un segundo fetch):**
  - Commit `678d7cb7`: `schema.ts:132` `MASTER_UX_CHOICES = ["none","md","md-json"]`, `schema.ts:164` `ux` opcional en `state.json`, `schema.ts:135` `MASTER_MODES` con `desde-cero`; `ux.ts:30` `checkUxContent` vacío (el estado que describe D2); `ux.ts:39-42` `checkUxArtifacts`: `UX.md` y `ux.json` viven en la raíz de la etapa (`ctx.stagePath`).
  - Commit `acf9f7f0` (HEAD de la rama, apareció durante este diseño): `schema.ts:457` `UxContractSchema` (`z.strictObject`, `schemaVersion` 1, `masterStage`, `surfaces`, `actors`, `journeys`, `flows`, `screens`, `functionalComponents`, `patterns`, `uxRequirements`, `traceability`) y `ux.ts:366` `checkUxContent` con validación de coherencia; `ux.ts:380` `checkUxArtifacts`. Sigue siendo local y puede cambiar antes de llegar a `main`, así que D5 (lector provisional) sigue vigente.
- **Muestras reales:** `navori-heron/specs/_master/index.json` (una etapa `01-heron` `activa`) y `specs/_master/01-heron/state.json` (`phase: "executing"`, `mode: "template"`, sin `ux`).
- **Patrones del ecosistema reutilizables** — `monorepo-fullstack` `origin/main` = `88e31bd` (fetch hecho; `MASTER.md` citaba `e24995a`, ya desactualizado):
  - `.github/workflows/ci.yml:21-24`: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0` con `bun-version-file: package.json`; `:34` `bun install --frozen-lockfile`.
  - `.oxlintrc.json:23` `typescript/no-explicit-any: error`; `.oxfmtrc.json:3` `printWidth: 100` e `ignorePatterns` para archivos del harness.
  - `monorepo-fullstack` tiene `navori.config.json` pero no `specs/_master/`: `heron init` debe mostrar `Navori Master: no` (P1.A17).

### El problema real

Heron necesita un núcleo que decida el modo (`full` / `reference-only`) de forma **conservadora y explicable** a partir de archivos que controla un tercero (el harness) y que todavía cambian, y que persista esa decisión en el repo del producto sin corromperlo: sin escribir fuera de `.heron/`, sin dejar estados a medias ante una caída y sin dos escritores a la vez. Todo lo que construyan P2–P11 (research, agentes, diseño, export, web) consume este núcleo: contratos versionados, store atómico, máquina de estados con gates atados a hashes y el puerto `ProductContextAdapter`. Un error aquí se multiplica en cada parte.

### Decision drivers (derivados de las reglas del proyecto)

1. **Invariante dual conservador** (RN-2, RN-3, RN-4, RN-47; R2–R5, R7): ante duda, `reference-only`; nunca inferir el archivo faltante.
2. **Cero acoplamiento de runtime con navori** (RN-1, R14): lectores propios, tolerantes (RN-46), probados por un test de fronteras.
3. **Consistencia ante caída y un solo escritor** (RNF-3, RNF-4, R10): `state.json` como punto de commit, código 6 en ≤ 1 s.
4. **Versionado explícito que falla fuerte** (RNF-13, R11).
5. **Sin dependencias de runtime nuevas** (RNF-15): P1 solo usa `zod`.
6. **Núcleo portable** (RNF-20): 0 referencias a `Bun`/`bun:` en contratos y estado.
7. **Latencia** (RNF-1, R13): p95 ≤ 2 000 ms en `init`/`status`.
8. **CLAUDE.md del proyecto:** tipado fuerte sin `any` (salvo `// any justified:`), "simplicidad > cleverness", postura greenfield (velocidad, pero el quality gate pasa), tests para lógica no trivial. La regla `architectureRule` y `criticalAreas` de `navori.config.json` son placeholders de plantilla (`"ej: axios → service → …"`, `"ej: src/auth"`): no aplican a una CLI sin UI; la estructura vinculante es D4.
9. **Idioma** (D14): salida de CLI en inglés; docs del repo en español.

### Opciones consideradas

**Cómo leer los contratos del harness** (`index.json`, `state.json`, `navori.config.json`, `ux.json`):

- *Patrón existente — importar los schemas de `@navori/cli`:* descartado; RN-1 lo prohíbe y R14 lo verifica.
- *Extensión — copiar los schemas Zod del harness tal cual:* descartado; `MASTER_PHASES` y `MASTER_MODES` son `z.enum` estrictos (`schema.ts:117`, `:129`, `:147` en `origin/main`), así que un `state.json` con `ux` o `desde-cero` (ya presentes en `678d7cb7`) haría fallar al lector y violaría RN-46/R7. El `UxContractSchema` local es `strictObject` y rechaza campos desconocidos, lo contrario de D5 ("preserva campos desconocidos").
- *Nueva abstracción — vistas tolerantes redeclaradas (elegida):* cada lector declara en Zod propio solo los campos que Heron usa (`z.looseObject`), acepta cadenas desconocidas en fases, modos y declaraciones, y verifica `version` explícitamente. Alinea nombres de campo con el borrador local de `ux.json` para que el cambio a la copia fijada (P11, D5) sea local al lector.

**Máquina de estados:**

- *Reducer con `switch` por fase:* descartado; P1.A6 exige enumerar la tabla completa y probar que todo par fuera de ella se rechaza, lo que un `switch` no expone como dato.
- *Librería (xstate u otra):* descartada; no está en "Stack y librerías" (RNF-15 exige ADR para agregarla) y no aporta nada que una tabla de datos no dé.
- *Tabla de datos con precondición por fila (elegida):* `TRANSITIONS` es un arreglo inmutable de reglas `{from, event, to, precondition, production, check}`; `canTransition` busca por `(from, eventKey)`. Es enumerable, probable de forma exhaustiva y documentable.

**Lock de un escritor:**

- *`flock` vía `bun:ffi`:* descartado; depende de Bun en el store, agrega FFI y no mejora el caso de uso (CLI local de un usuario).
- *Directorio como lock (`mkdir`):* equivalente al archivo `O_EXCL`, sin ventaja; descartado por no aportar.
- *Archivo `.heron/.lock` creado con `O_EXCL` (`openSync(path, "wx")`) + reclamo de lock vencido con un mutex de reclamo (elegido):* verificado en Bun 1.4.2 (segundo `wx` → `EEXIST`; `process.kill(pid, 0)` de un pid muerto → `ESRCH`).

**I/O del store:**

- *Asíncrono (`fs.promises`):* descartado para P1; un `await` olvidado rompe el orden tmp → fsync → rename y complica la inyección de fallos.
- *Síncrono con puerto `FsPort` inyectable (elegido):* orden de escritura determinista, fallos inyectables por punto de escritura (P1.A8) y latencia irrelevante para unos pocos archivos pequeños.

**Umbral de cobertura por ruta (R16):**

- *`bunfig.toml` con umbral por ruta:* no existe. Bun 1.4.2 solo acepta `coverageThreshold` global (número u objeto `{ lines, functions }`; `statements` se acepta pero no se aplica). Fuente: https://bun.com/docs/test/code-coverage (consultado 2026-09-30), confirmado con sonda local: con `functions` por debajo del umbral, `bun test --coverage` sale con 1.
- *Varias corridas de `bun test` por directorio:* descartada; la cobertura de `core/` que aportan los e2e se perdería y el tiempo se duplica.
- *Umbral global en `bunfig.toml` + script sobre `coverage/lcov.info` para las rutas de ≥ 90 % (elegida).*

### Recomendación

Un solo paquete (D4) con módulos por frontera: `core/contracts` (Zod + tipos, sin imports internos), `core/state` (tabla de transiciones, gates, stale, decisión de modo; funciones puras), `core/store` (único módulo con acceso de escritura al filesystem), `intake` (puerto `ProductContextAdapter`, lectores tolerantes, lector provisional `UxContract`, adapters `navori-master` y `filesystem`), `app` (casos de uso compartidos por la CLI y, desde P8, por la web) y `cli` (parseo con `node:util` `parseArgs`, render en inglés, `--json`). `init` detecta, decide con `detectMode` (pura) y escribe `.heron/` en una transacción: staging por run → promoción de artefactos → `state.json` al final como punto de commit. `status` y `doctor` son de solo lectura y recalculan la detección en vivo (RN-29). `gate approve|reject` aplica la tabla con guard de modo antes que la precondición y ata la decisión a los sha256 de los artefactos.

## Components

Cada ruta es exacta. "Cubre" lista los R de `requirements.md`.

### Raíz y tooling

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `package.json` | Paquete único `navori-heron` (`private`, `type: module`, `packageManager: "bun@1.4.2"`, `bin.heron = ./bin/heron.ts`); dependencias y scripts de la sección Contracts | R14, R16, R17 |
| `bun.lock` | Lockfile de texto versionado; CI usa `--frozen-lockfile` | R16 |
| `bunfig.toml` | `[install] exact = true`; `[test]` con `root`, reporters `text` + `lcov`, umbral global 0.8, exclusiones | R16 |
| `tsconfig.json` | TS 7.0.2 estricto, `noEmit`, `module: Preserve`, `moduleResolution: bundler`, `types: ["bun"]` | R16 |
| `.oxlintrc.json` | oxlint 1.86.0: categorías `correctness` y `suspicious` como error, `typescript/no-explicit-any: error` | R16 |
| `.oxfmtrc.json` | oxfmt 0.71.0: `printWidth: 100`, ignora archivos del harness, `fixtures/**`, `schemas/**`, `coverage/**` | R16 |
| `.gitignore` | Agrega `node_modules/`, `coverage/`, `.DS_Store`, `/.heron/` a lo existente (`progress/`) | R16 |
| `.github/workflows/ci.yml` | CI en PR (cualquier base) y push a `main`: checkout y setup-bun fijados por SHA, `bun install --frozen-lockfile`, `bun run check` | R16 |
| `bin/heron.ts` | Shim ejecutable (`#!/usr/bin/env bun`, modo 100755) que llama `runCli(process.argv.slice(2), processIo())` y sale con su código | R1, R17 |
| `README.md` | Instalación desde un clon con `bun link` (D20), primer `heron init`, comandos de P1, en español | R17 |
| `docs/architecture.md` | Módulos, reglas de frontera, tabla de transiciones, layout de `.heron/`, códigos de salida | R8, R14 |
| `docs/adr/0001-state-persistence.md` | ADR de persistencia: filesystem + Git, escritura atómica, staging, `state.json` como commit, lock | R10 |

### `src/core/contracts/` — contratos (solo importa `zod` y archivos hermanos)

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/core/contracts/common.ts` | Tipos base (`Sha256Hex`, `RelativeArtifactPath`, `IsoDateTime`, `RunId`, `HeronMode`), `Finding`, `FINDING_CODES`, `ExitCode`, `toJsonPointer` | R4, R5, R7, R8, R11 |
| `src/core/contracts/canonical-json.ts` | `canonicalJson`: claves ordenadas, 2 espacios, LF final | R10, R15 |
| `src/core/contracts/version.ts` | `DocumentSpec`, `parseVersionedDocument` (gate de versión), errores `UnsupportedSchemaVersionError` e `InvalidDocumentError` | R11 |
| `src/core/contracts/heron-project.ts` | `HeronProjectSchema` / `HeronProject` | R10, R15 |
| `src/core/contracts/heron-state.ts` | Fases, gates, eventos, `TransitionSchema`, `GateDecisionSchema`, `HeronStateSchema` | R8, R9, R10, R15 |
| `src/core/contracts/mode-decision.ts` | `DetectionReportSchema`, `ModeDecisionSchema` | R1–R7, R15 |
| `src/core/contracts/cli-envelope.ts` | `CliEnvelopeSchema` y los `data` de cada comando | R1, R15 |
| `src/core/contracts/index.ts` | Barrel y `CONTRACT_DOCUMENTS` (registro que consume `gen:schemas`) | R15 |

### `src/core/state/` — dominio puro (importa solo `core/contracts`; sin `Bun`/`bun:`)

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/core/state/transitions.ts` | `TRANSITIONS`, `canTransition`, `applyTransition`, guard de modo, guard de aprobaciones | R8 |
| `src/core/state/gates.ts` | `GATE_BINDINGS`, `approveGate`, `rejectGate`, `isApprovalValid`, estados de gate | R9 |
| `src/core/state/stale.ts` | `PHASE_ARTIFACTS`, `ARTIFACT_DEPENDENCIES`, `propagateStale`, `markStaleAfter`, `matchesGlob` | R8, R9 |
| `src/core/state/lifecycle.ts` | `createInitialState`, `recordInit` | R10 |
| `src/core/state/mode.ts` | `detectMode` (reglas RN-2..RN-4, D6, R5, R7) y `describeModeBlock` | R2, R3, R4, R5, R7 |

### `src/core/store/` — único módulo que importa `node:fs`

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/core/store/fs-port.ts` | `FsPort`, `ReadonlyFs`, `nodeFs` | R10, R12 |
| `src/core/store/paths.ts` | Rutas seguras: `assertSafeRelativePath`, `resolveInside` (realpath confinado, symlinks), `UnsafePathError` | R12 |
| `src/core/store/hash.ts` | `sha256Hex`, `sha256File` (`node:crypto`) | R9 |
| `src/core/store/atomic.ts` | `writeAtomic`: tmp + fsync + rename + fsync del directorio | R10 |
| `src/core/store/lock.ts` | `acquireLock`, reclamo de lock vencido, `LockBusyError` | R10 |
| `src/core/store/file-store.ts` | `openFileStore`, `FileStore`, `StoreTransaction` (staging por run, promoción, commit de `state.json`, recuperación de staging huérfano), constantes de layout y `HERON_GITIGNORE` | R10, R11, R12 |

### `src/intake/` — detección de contexto

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/intake/ports.ts` | Puerto `ProductContextAdapter` (`detect`, `load`), `DetectRequest`, `AdapterDetection`, límites de entrada | R1, R14 |
| `src/intake/probe.ts` | `probeFile`: presencia, tamaño máximo, confinamiento y sha256 de un archivo de entrada | R1, R12 |
| `src/intake/ux-contract.ts` | Lector provisional `UxContract` (D5), `readUxContract`, `readUxMarkdown`, `checkUxFiles` | R5 |
| `src/intake/detect.ts` | `detectProject`: recorre `DEFAULT_ADAPTERS` en orden y devuelve el primer detectado o un error de etapa | R1, R6 |
| `src/intake/adapters/navori-master/harness.ts` | Lectores tolerantes `readNavoriConfig`, `readMasterIndex`, `readStageState` | R1, R6, R7 |
| `src/intake/adapters/navori-master/stage.ts` | `selectStage` (activa, `--stage`, última cerrada con aviso, D22) y `STAGE_DIR_PATTERN` | R6 |
| `src/intake/adapters/navori-master/index.ts` | `navoriMasterAdapter`: presencia de los 7 artefactos, declaración `ux`, `DetectionReport` | R1, R4, R7 |
| `src/intake/adapters/filesystem/index.ts` | `filesystemAdapter`: repo sin master-plan; `UX.md` y `ux.json` en la raíz del repo | R1, R3 |

### `src/app/` — casos de uso (CLI hoy, web en P8)

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/app/context.ts` | `AppContext` y servicios `Clock` (respeta `SOURCE_DATE_EPOCH`), `IdGenerator`, `IdentityProvider`; `createDefaultContext` | R9, R10 |
| `src/app/version.ts` | `HERON_VERSION` leído de `package.json` | R11 |
| `src/app/result.ts` | `UseCaseResult` | R1 |
| `src/app/init.ts` | `runInit`: detectar → decidir → (sin `--dry-run`) lock → recuperar staging → transacción → liberar | R1–R7, R10, R12 |
| `src/app/status.ts` | `runStatus`: lee `.heron/`, recalcula detección en vivo, compara huellas, gates y stale; sin escrituras | R8, R9, R11, R12 |
| `src/app/doctor.ts` | `runDoctor`: checks base con timeout por check | R11 |
| `src/app/gate.ts` | `runGate`: confirmación (TTY o `--yes`), identidad, lock, `approveGate`/`rejectGate`, commit; `collectTransitionFacts` | R8, R9, R10 |

### `src/cli/` — interfaz de línea de comandos (inglés, D14)

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `src/cli/main.ts` | `runCli`: parsea, despacha al handler, captura errores inesperados (exit 1) | R1 |
| `src/cli/args.ts` | `parseCliArgs` con `node:util` `parseArgs` (`strict`), `USAGE_TEXT`, `UsageError` | R6 |
| `src/cli/io.ts` | `CliIo`, `processIo` | R1 |
| `src/cli/envelope.ts` | `buildEnvelope` para `--json` | R1 |
| `src/cli/render.ts` | Render de texto exacto de `init`, `status`, `doctor`, `gate` y findings | R1–R7 |
| `src/cli/commands/init.ts` | `handleInit` | R1–R7 |
| `src/cli/commands/status.ts` | `handleStatus` | R8, R9 |
| `src/cli/commands/doctor.ts` | `handleDoctor` | R11 |
| `src/cli/commands/gate.ts` | `handleGate` | R8, R9 |

### Scripts, schemas, fixtures y tests

| Ruta | Responsabilidad | Cubre |
|---|---|---|
| `scripts/gen-schemas.ts` | Genera `schemas/*.schema.json` desde `CONTRACT_DOCUMENTS`; exporta `generateSchemas` | R15 |
| `scripts/check-coverage.ts` | Umbral ≥ 90 % por ruta sobre `coverage/lcov.info`; falla si un archivo con código de runtime nunca se cargó | R16 |
| `schemas/heron-project.v1.schema.json`, `schemas/heron-state.v1.schema.json`, `schemas/mode-decision.v1.schema.json`, `schemas/cli-envelope.v1.schema.json` | JSON Schema draft 2020-12 generados y versionados | R15 |
| `fixtures/README.md` | Explica los fixtures y la marca SYNTHETIC (no es un fixture) | R1–R7 |
| `fixtures/membership-product/`, `fixtures/no-ux/`, `fixtures/ux-only-md/`, `fixtures/ux-only-json/`, `fixtures/ux-invalid/`, `fixtures/closed-stage/` | Repos de producto sintéticos (layout en Contracts) | R1–R7, R13 |
| `tests/helpers/fixtures.ts` | `copyFixture`, `hashTree`, `patchHarnessState` | R7, R12 |
| `tests/helpers/cli.ts` | `runCliCaptured`, `fixedContext` | R1 |
| `tests/helpers/faulty-fs.ts` | `withFaultInjection`, `InjectedFaultError` | R10 |
| `tests/unit/contracts.test.ts` | Gate de versión, ida y vuelta, JSON canónico | R11, R15 |
| `tests/unit/state-machine.test.ts` | Tabla exhaustiva (A6) | R8 |
| `tests/unit/gates.test.ts` | Invalidación por hash (A7), estados de gate | R9 |
| `tests/unit/stale.test.ts` | Propagación de stale | R8, R9 |
| `tests/unit/store.test.ts` | Fallos inyectados, segundo escritor (A8), rutas seguras, lock vencido | R10, R12 |
| `tests/unit/mode.test.ts` | Matriz de `detectMode` | R2, R3, R4, R5, R7 |
| `tests/unit/ux-contract.test.ts` | Lector provisional y chequeo de `UX.md` | R5 |
| `tests/unit/harness-readers.test.ts` | Tolerancia, versiones, `specsDir` hostil | R1, R7, R12 |
| `tests/unit/stage-selection.test.ts` | Selección de etapa | R6 |
| `tests/unit/cli-args.test.ts` | Parseo y exit 2 | R6 |
| `tests/e2e/init.test.ts` | A1, A2, A3, A4, A5, A10, A11 | R1–R7, R12 |
| `tests/e2e/status.test.ts` | Salida de `status`, no inicializado, huella cambiada | R8, R9, R11, R12 |
| `tests/e2e/doctor.test.ts` | Checks base | R11 |
| `tests/e2e/gate.test.ts` | `MODE_BLOCKED`, `PRECONDITION_UNMET`, confirmación, identidad | R8, R9 |
| `tests/perf/init.perf.test.ts` | A12 | R13 |
| `tests/repo/boundaries.test.ts` | A13 y `any` justificado | R14 |
| `tests/repo/schemas.test.ts` | Deriva de schemas en proceso | R15 |
| `tests/repo/ci.test.ts` | A16 | R16 |
| `tests/repo/coverage-rules.test.ts` | `evaluateCoverage` sobre lcov sintético | R16 |

## Decisions

- **DP1 — Módulo `src/app/` para casos de uso.** `MASTER.md` Arquitectura dibuja "casos de uso" compartidos por CLI y web pero no les da módulo. Se crea `src/app/`: `cli` y (P8) `web` solo llaman funciones `run*`; ninguna lógica vive en la CLI. Cubre R14.
- **DP2 — Store síncrono tras `FsPort`, único importador de `node:fs`.** Solo `src/core/store/**` importa `node:fs`/`fs`; `intake` recibe un `ReadonlyFs` inyectado. Así R12 queda garantizado por construcción: nada fuera del store puede escribir, y el store solo escribe bajo `.heron/`. El test de fronteras lo verifica. Cubre R10, R12. Excepción acotada (revisión del lote 6): las herramientas de build `scripts/gen-schemas.ts` y `scripts/check-coverage.ts` importan `node:fs`; no se distribuyen ni escriben en `.heron/`, y el test de fronteras las exime por nombre.
- **DP3 — Protocolo de commit.** Orden fijo: (1) cada artefacto se escribe en `.heron/staging/{runId}/{ruta}` con `open(wx)` + `write` + `fsync` + `close`; (2) se valida el `HeronState` nuevo y que cada `artifacts[].path` exista (staged o en disco con el mismo sha256); (3) se promueve cada artefacto con `rename` en orden lexicográfico y `fsync` de su directorio padre; (4) `state.json` se escribe en staging y se promueve al final con `rename` + `fsync` de `.heron/`; (5) se borra `staging/{runId}/`. Nunca se borra un artefacto antes del commit. Una caída entre (3) y (4) deja artefactos promovidos más nuevos que `state.json`: `state.json` sigue válido y ningún artefacto referenciado falta (R10); la diferencia de hash se detecta en el siguiente comando (RN-29). Se descarta el almacenamiento direccionado por contenido: complica el diff en Git sin mejorar la garantía que pide RNF-3.
- **DP4 — Recuperación de staging huérfano.** Con el lock tomado, todo `staging/{id}/` con `id` distinto del run actual pertenece a un run muerto y se borra (finding `STAGING_RECOVERED`, info). Cubre R10.
- **DP5 — Lock.** Contenido de `.heron/.lock`: `LockOwner` en JSON canónico. Adquisición sin espera: si existe y no está vencido, `LockBusyError` → exit 6 de inmediato (R10 pide ≤ 1 s). Vencido si: mismo `hostname` y el pid no vive; otro `hostname` y `acquiredAt` tiene más de `staleAfterMs` (default 3 600 000, porque en P3 un agente puede tardar 600 s y no se debe robar un lock vivo); archivo ilegible con `mtime` de más de 30 s (caída entre `open` y `write`). Reclamo seguro ante carreras: se toma `.heron/.lock.reclaim` con `wx` (si existe con `mtime` de más de 30 s se elimina y se reintenta una vez), se relee `.lock`, se confirma el mismo `runId` vencido, se elimina `.lock`, se libera el mutex y se crea `.lock` con `wx`; si otro proceso ganó, `LOCK_BUSY`. Un pid reutilizado cuenta como vivo (lado seguro). Cubre R10.
- **DP6 — Guard de revisión.** `commit` recibe `expectedRevision`; si el `stateRevision` en disco difiere, falla con exit 6 (`LOCK_BUSY` con detalle de revisión). Con el lock no ocurre en la CLI, pero prepara la web (P8) sin cambiar el contrato. Cubre R10.
- **DP7 — Documentos propios con `z.looseObject`.** Los documentos persistidos de Heron preservan campos desconocidos al leer y reescribir; `schemaVersion` es un entero que sube solo en cambios incompatibles (renombrar, quitar o cambiar el significado de un campo). Agregar un campo opcional no sube la versión (p. ej. `providers` en `project.json` en P3). Agregar un valor a un enum persistido (`HeronPhase`, `GateName`, `PreconditionId`, `FindingCode`) sí es incompatible, porque un Heron anterior no podría leer el documento: sube `schemaVersion`. Por eso los enums persistidos se definen completos para toda la etapa desde P1 y `HistoryEntry.command` es texto libre no vacío. Mayor que la soportada → falla nombrando la soportada (R11); no se escribe nunca un documento que no se pudo leer. `CliEnvelope` es salida transitoria y usa `z.object`. Cubre R11, R15.
- **DP8 — Tabla de estados: 13 fases.** Las 12 fases de la tabla de Dominio de `MASTER.md` más `researching`, que el alcance de P2 en `MASTER.md` nombra explícitamente ("Estados `researching`/`research-ready`"). Es una fase estable (el usuario agrega referencias a lo largo de días), no un "estado en curso" de un run. Agregarla después obligaría a subir `schemaVersion` de `HeronState`; se define ahora. Cubre R8.
- **DP8b — El gate `direction` exige Penpot (D26).** La tabla completa se define en P1 para no migrar `HeronState`, así que la precondición `direction-selectable` ya incluye `penpotEnabled` y `penpotProposalsWritten === 3`. En P1 nada produce ese hecho: la fila existe y se prueba con hechos inyectados; P12 y P5 lo alimentan. Cubre R8.
- **DP9 — El gate `intake` es ortogonal al research.** P2 (research) se entrega antes que P4 (intake), así que el research no puede exigir `intake-ready`. El gate `intake` se aprueba desde `initialized` (avanza a `intake-ready`) o, como bucle sobre la misma fase, desde `researching`, `research-ready` y `directions-ready`; es precondición de `direction-selected`. Cubre R8.
- **DP10 — Orden de chequeo de una transición.** (1) existe la fila `(from, eventKey)`, si no `TRANSITION_NOT_ALLOWED`; (2) guard de modo: fila con `production = true` en `reference-only` → `MODE_BLOCKED`, sin evaluar la precondición; (3) guard de aprobaciones: una fila de producción que no sea de rechazo ni `revise` exige que todas las aprobaciones registradas sigan válidas (salvo la del propio gate del evento) → si no, `PRECONDITION_UNMET` con `approvals-valid`; (4) precondición de la fila → `PRECONDITION_UNMET`. `production` = `to ∈ PRODUCTION_PHASES` ("toda transición desde la #5 exige `mode = full`"). Cubre R8.
- **DP11 — Declaración `ux` del harness.** `md` → `reference-only` siempre, con finding `UX_DECLARED_MD_ONLY` que atribuye la decisión al harness; con `md` y solo `UX.md` presente no se emite `UX_INCONSISTENT` (es el estado declarado). Cualquier desajuste declaración/archivos → `UX_DECLARATION_MISMATCH` **y** `reference-only`. Forzar `reference-only` ante desajuste lo confirmó el usuario (D27), por el driver 1 (si el harness no respalda los archivos, no se produce sobre ellos). Revertirlo es una línea en `detectMode`. Valor desconocido → se muestra, se ignora para decidir y se emite `HARNESS_UNKNOWN_VALUE`. Legacy sin `ux` → deciden los archivos. Cubre R7.
- **DP12 — Lector provisional `UxContract` fuera de los adapters y fuera de `schemas/`.** Vive en `src/intake/ux-contract.ts` porque lo usan `navori-master` y `filesystem`, que no pueden importarse entre sí (R14). No se emite JSON Schema de `ux.json`: es un contrato ajeno y emitirlo sugeriría que Heron lo define (RN-6, D2). Cubre R5, R14.
- **DP13 — Surfaces y conteos solo en `full`.** En `reference-only` nada los consume y mostrarlos sugeriría un uso parcial (RN-4, D6). Cubre R1, R2.
- **DP14 — Formato de las líneas de presencia.** `(name + ":").padEnd(7) + " " + mark` reproduce exactamente los literales del brief (`UX.md:  ✓`, `ux.json: ✓`, `UX.md:  missing`, `ux.json: missing`); `mark` es `✓` (U+2713) o `missing`. Las demás líneas quedan `MASTER.md: ✓`. Cubre R1.
- **DP15 — `init` idempotente.** Si `project.json`, `intake/mode.json` y `.gitignore` recalculados son idénticos byte a byte a los de disco y el modo no cambió, `init` no escribe (`written: false`) y no crea revisión. Las fechas solo viven en `history[]` y en `GateDecision`, nunca en `mode.json`, para que Git no vea ruido. Cubre R10, R12.
- **DP16 — `status` y `doctor` de solo lectura.** No toman lock ni escriben. `status` recalcula la detección con la etapa guardada en `project.json` (RN-29) y reporta `INPUTS_CHANGED` si difieren los sha256; el modo efectivo es `full` solo si el persistido y el recalculado son `full`. Cubre R8, R12.
- **DP17 — Sin sink de logs JSONL en P1.** Ningún R de P1 lo pide; RNF-14 se cubre con `runId` y `durationMs` en el `CliEnvelope` y con `history[]` en `state.json` (la transición y el gate quedan registrados de forma durable). El sink `.heron/logs/` llega con los primeros eventos externos (P2). `.heron/.gitignore` ya excluye `logs/`.
- **DP18 — Cobertura.** Global ≥ 0.8 de líneas y funciones en `bunfig.toml`; `scripts/check-coverage.ts` exige ≥ 0.9 de líneas y funciones en `src/core/contracts/`, `src/core/state/` y `src/core/store/` sumando `LF/LH` y `FNF/FNH` del lcov. Bun omite del reporte los archivos que ningún test cargó (verificado con sonda); el script falla si un `src/**/*.ts` con código de runtime no aparece en el lcov. Se consideran solo de tipos (y se eximen) los archivos cuyo `new Bun.Transpiler({ loader: "ts" }).transformSync(source)` es la cadena vacía (verificado). El reporter `text` se mantiene porque, fuera de `--parallel`, Bun solo aplica el umbral con ese reporter (doc de cobertura). Cubre R16.
- **DP19 — Herramientas sin Node.** Los scripts llaman `bun --bun oxfmt`, `bun --bun oxlint` y `bun --bun tsc`: los tres bins tienen shebang `node`; se verificó que corren con Bun 1.4.2 y un `PATH` sin Node. CI no necesita `setup-node`. Cubre R16.
- **DP20 — Fronteras por test, no por lint.** P1.A13 exige un test; duplicar la regla en `no-restricted-imports` de oxlint abre deriva entre dos fuentes. El extractor de imports une `Bun.Transpiler#scanImports` (estáticos, dinámicos, `require`) con una regex para `import type`/`export type … from`, porque `scanImports` omite los imports de solo tipos (verificado). Cubre R14.
- **DP21 — Deriva de schemas en proceso además del comando de A14.** `git diff --exit-code schemas/` no detecta archivos nuevos sin trackear y el repo aún no tiene commits; `tests/repo/schemas.test.ts` compara `generateSchemas()` con los archivos en disco (faltantes, sobrantes y distintos). A14 se mantiene tal cual como criterio. Cubre R15.
- **DP22 — Adapter `filesystem`.** Se activa cuando no hay `navori.config.json` o no existe `{specsDir}/_master/index.json`; busca `UX.md` y `ux.json` solo en la raíz del repo. P4 puede ampliar la búsqueda sin cambiar el puerto. Cubre R1, R3.
- **DP23 — e2e en proceso, rendimiento con proceso real.** Los e2e llaman `runCli` en el mismo proceso (la cobertura de Bun no instrumenta subprocesos); el test de rendimiento y el del segundo escritor lanzan `bin/heron.ts` como proceso real. Cubre R10, R13, R16.
- **DP24 — Dependencias.** Runtime: solo `zod` 4.6.5. Dev: `typescript` 7.0.2, `@types/bun` 1.4.2, `oxlint` 1.86.0, `oxfmt` 0.71.0. Se descartan en P1: `ajv` (ningún criterio de P1 valida documentos con JSON Schema; entra en P4 con P4.A6); `oxlint-tsgolint` (no está en el Stack; su regla más valiosa, `no-floating-promises`, pierde peso con un store síncrono); `minimumReleaseAge` de `bunfig.toml` (patrón de `monorepo-fullstack`: `oxlint` y `oxfmt` fijados se publicaron el 2026-09-28 y una ventana de 3 días bloquearía la instalación hasta el 2026-10-01). Cubre R16.
- **DP25 — CI.** `on: pull_request` sin filtro de rama (cubre PRs a `main` o a `develop` según la política del usuario) y `push` a `main`; acciones fijadas por SHA reutilizando los pines de `monorepo-fullstack` (`ci.yml:21-24`); `bun-version-file: package.json` lee `packageManager` (verificado en `oven-sh/setup-bun` v2.2.0, `src/utils.ts`, `pkg.packageManager?.split("bun@")`). Cubre R16.
- **DP26 — `/.heron/` en el `.gitignore` raíz de Heron.** *[assumed]* P1.A17 corre `heron init` sobre el propio repo; su `.heron/` es salida de prueba manual, no un workspace de diseño. Si el usuario quiere que Heron diseñe su propia UI, se quita la línea.
- **DP27 — Fixtures compatibles con el borrador del harness.** El `ux.json` de `membership-product` sigue la forma del `UxContractSchema` local (`schema.ts:457` en `acf9f7f0`, sin publicar) como mejor esfuerzo, para que la conmutación de P11 no obligue a rehacer fixtures; el lector provisional solo exige su subconjunto.

### Stack fijado (versiones verificadas en npm, consultado 2026-09-30)

| Paquete | Versión | Tipo | Publicada | Fuente |
|---|---|---|---|---|
| Bun | 1.4.2 | runtime (`packageManager`) | 2026-09-05 | https://www.npmjs.com/package/bun |
| `zod` | 4.6.5 | dependencia | 2026-09-13 | https://www.npmjs.com/package/zod |
| `typescript` | 7.0.2 (`latest`) | dev | 2026-07-08 | https://www.npmjs.com/package/typescript |
| `@types/bun` | 1.4.2 | dev | 2026-09-08 | https://www.npmjs.com/package/@types/bun |
| `oxlint` | 1.86.0 | dev | 2026-09-28 | https://www.npmjs.com/package/oxlint |
| `oxfmt` | 0.71.0 | dev | 2026-09-28 | https://www.npmjs.com/package/oxfmt |
| `ajv` | 8.20.0 | no se instala en P1 (DP24) | 2026-04-24 | https://www.npmjs.com/package/ajv |
| `actions/checkout` | v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1` | CI | 2026-07-20 | https://github.com/actions/checkout/releases/tag/v7.0.1 |
| `oven-sh/setup-bun` | v2.2.0 = `0c5077e51419868618aeaa5fe8019c62421857d6` | CI | 2026-03-14 | https://github.com/oven-sh/setup-bun/releases/tag/v2.2.0 |

Verificaciones empíricas hechas en un directorio temporal (fuera del repo) con Bun 1.4.2 en darwin: `tsconfig.json` de Contracts compila con `tsc` 7.0.2; `z.toJSONSchema(..., { target: "draft-2020-12", io: "output" })` produce `additionalProperties: {}` para `z.looseObject` y conserva `default`; `.oxfmtrc.json` es el archivo que lee oxfmt 0.71.0 (`--init`, `--check`); `// oxlint-disable-next-line typescript/no-explicit-any -- any justified: …` silencia solo esa línea; `bun link` dentro del paquete crea el symlink del bin en `$BUN_INSTALL/bin` (sonda con `BUN_INSTALL` aislado; la página https://bun.com/docs/pm/cli/link, consultada 2026-09-30, no lo documenta); `Bun.YAML.parse` y `node:util` `parseArgs` funcionan; `fsync` de un directorio, `open(wx)` → `EEXIST` y `process.kill(pid, 0)` → `ESRCH` funcionan. El `fsync` de directorio en Linux se verifica cuando `tests/unit/store.test.ts` corra en CI (ubuntu-24.04).

### Conocimiento durable (destino propuesto; no lo escribe este documento)

- **Dominio** (skill `dominio`): glosario de modos, las 13 fases, los 6 gates, "precondición verificable", "producción" (`to ∈ PRODUCTION_PHASES`) y la regla de declaración `ux` (DP11).
- **CLAUDE.md, sección de usuario:** `bun run check` como quality gate; herramientas con `bun --bun`; "solo `src/core/store/**` importa `node:fs`"; `core/contracts` solo importa `zod`; los tests llevan `// Covers: R<n>`.

## Contracts

Todas las firmas son solo tipos; los cuerpos los decide el implementer. En textos y rutas, `{nombre}` marca un valor interpolado; los `<…>` que aparecen dentro de la salida de la CLI (`<NN-slug>`, `<gate>`, `<text>`, `<command>`) son texto literal que se imprime. `z` es `import { z } from "zod"`. Toda fecha es RFC 3339 UTC con milisegundos (`Date#toISOString`). Toda ruta persistida es POSIX y relativa (a la raíz del repo o a `.heron/`, según el campo).

### Scripts de `package.json`

```json
{
  "name": "navori-heron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.2",
  "bin": { "heron": "./bin/heron.ts" },
  "scripts": {
    "heron": "bun bin/heron.ts",
    "gen:schemas": "bun scripts/gen-schemas.ts",
    "format": "bun --bun oxfmt",
    "format:check": "bun --bun oxfmt --check",
    "lint": "bun --bun oxlint --deny-warnings --report-unused-disable-directives",
    "typecheck": "bun --bun tsc --noEmit -p tsconfig.json",
    "test": "bun test",
    "test:coverage": "bun test --coverage && bun scripts/check-coverage.ts",
    "check": "bun run format:check && bun run lint && bun run typecheck && bun run test:coverage"
  },
  "dependencies": { "zod": "4.6.5" },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "oxfmt": "0.71.0",
    "oxlint": "1.86.0",
    "typescript": "7.0.2"
  }
}
```

`bun run check` cubre R16: formato, lint, typecheck y tests con cobertura; la deriva de schemas (`tests/repo/schemas.test.ts`) y las fronteras (`tests/repo/boundaries.test.ts`) corren dentro de `bun test`. `bun run heron init {ruta}` es la forma sin `bun link` (P4.A7 y P11.A2 la usan).

### `bunfig.toml`

```toml
[install]
exact = true

[test]
root = "tests"
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { lines = 0.8, functions = 0.8 }
coverageSkipTestFiles = true
coveragePathIgnorePatterns = ["tests/**", "scripts/**", "bin/**"]
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["bun"]
  },
  "include": ["src", "bin", "scripts", "tests"]
}
```

### `.oxlintrc.json` y `.oxfmtrc.json`

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc"],
  "categories": { "correctness": "error", "suspicious": "error" },
  "rules": { "typescript/no-explicit-any": "error" },
  "ignorePatterns": ["coverage/**", "fixtures/**", "schemas/**", ".claude/**", ".codex/**", ".navori/**"]
}
```

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 100,
  "ignorePatterns": [
    "bun.lock", "coverage/**", "fixtures/**", "schemas/**", "specs/**", "progress/**",
    ".claude/**", ".codex/**", ".navori/**", "CLAUDE.md", "AGENTS.md", "navori.config.json", ".mcp.json"
  ]
}
```

La única forma aceptada de `any` es `// oxlint-disable-next-line typescript/no-explicit-any -- any justified: {razón}`; `tests/repo/boundaries.test.ts` rechaza cualquier directiva sobre `no-explicit-any` sin el texto `any justified:` (RNF-19).

### `.github/workflows/ci.yml`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version-file: package.json
      - run: bun install --frozen-lockfile
      - run: bun run check
```

### `src/core/contracts/common.ts`

```ts
export type Sha256Hex = string; // /^[0-9a-f]{64}$/
export declare const Sha256HexSchema: z.ZodType<Sha256Hex>;

/** POSIX, relative, no leading "/", no "\\", no NUL, no "", "." or ".." segments, ≤ 512 chars. */
export type RelativeArtifactPath = string;
export declare const RelativeArtifactPathSchema: z.ZodType<RelativeArtifactPath>;

export type IsoDateTime = string; // RFC 3339 UTC, e.g. "2026-09-30T12:00:00.000Z"
export declare const IsoDateTimeSchema: z.ZodType<IsoDateTime>;

/** "run-" + UTC basic timestamp + "-" + 8 lowercase hex, e.g. "run-20260930T120000Z-3f9a1c2b". */
export type RunId = string; // /^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/
export declare const RunIdSchema: z.ZodType<RunId>;

export declare const HERON_MODES: readonly ["full", "reference-only"];
export type HeronMode = (typeof HERON_MODES)[number];
export declare const HeronModeSchema: z.ZodType<HeronMode>;

export declare const FINDING_CODES: readonly [
  "UX_INCONSISTENT", "UX_CONTRACT_INVALID", "UX_DECLARATION_MISMATCH", "UX_DECLARED_MD_ONLY",
  "MODE_BLOCKED", "TRANSITION_NOT_ALLOWED", "PRECONDITION_UNMET", "GATE_APPROVAL_INVALIDATED",
  "INPUTS_CHANGED", "SCHEMA_VERSION_UNSUPPORTED", "DOCUMENT_INVALID", "NOT_INITIALIZED",
  "HARNESS_UNREADABLE", "HARNESS_VERSION_UNSUPPORTED", "HARNESS_UNKNOWN_VALUE",
  "NO_STAGE", "STAGE_FALLBACK_LAST_CLOSED", "STAGE_NOT_FOUND", "NO_SELECTABLE_STAGE", "INVALID_STAGE",
  "UNSAFE_PATH", "INPUT_TOO_LARGE", "PATH_NOT_FOUND",
  "LOCK_BUSY", "LOCK_RECLAIMED", "STAGING_RECOVERED",
  "CONFIRMATION_REQUIRED", "IDENTITY_REQUIRED", "REASON_REQUIRED", "USAGE", "UNEXPECTED_ERROR",
  "PENPOT_REQUIRED_FOR_DIRECTION" // D26: emitted by the direction-selectable precondition
];
export type FindingCode = (typeof FINDING_CODES)[number];
export type FindingSeverity = "info" | "warning" | "error";
/** `pointer` is an RFC 6901 JSON Pointer into the file named by the finding ("" = document root). */
export type FindingIssue = { pointer: string; message: string };
export type Finding = {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  paths: string[];        // repo-relative POSIX paths
  issues: FindingIssue[]; // sorted by pointer, then message
};
export declare const FindingSchema: z.ZodType<Finding>;

/** Exit codes (MASTER.md Contratos). Same identifier for the value map and the union type. */
export declare const ExitCode: {
  readonly Ok: 0;
  readonly Unexpected: 1;
  readonly Usage: 2;
  readonly Blocked: 3;               // mode or precondition
  readonly ValidationFailed: 4;
  readonly DependencyUnavailable: 5;
  readonly LockBusy: 6;              // lock held or stateRevision conflict
};
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** ["screens", 1, "surface"] -> "/screens/1/surface"; escapes "~" as "~0" and "/" as "~1". */
export declare function toJsonPointer(path: readonly PropertyKey[]): string;
```

### `src/core/contracts/canonical-json.ts`

```ts
/** Keys sorted by UTF-16 code unit at every depth, array order kept, 2-space indent, "\n" at EOF.
 * Throws TypeError on undefined, functions, symbols, bigint, NaN or Infinity. */
export declare function canonicalJson(value: unknown): string;
```

### `src/core/contracts/version.ts`

```ts
export type DocumentKind = "HeronProject" | "HeronState" | "ModeDecision" | "CliEnvelope";

export interface DocumentSpec<T> {
  readonly kind: DocumentKind;
  readonly schemaVersion: number;   // supported (and written) version
  readonly schema: z.ZodType<T>;
  readonly schemaFile: string;      // e.g. "heron-state.v1.schema.json"
}

export declare class UnsupportedSchemaVersionError extends Error {
  readonly file: string;
  readonly kind: DocumentKind;
  readonly found: number;
  readonly supported: number;
}
export declare class InvalidDocumentError extends Error {
  readonly file: string;
  readonly kind: DocumentKind;
  readonly issues: FindingIssue[];
}

/** Order: object with `kind` equal to spec.kind -> integer `schemaVersion` -> version gate -> Zod parse.
 * found > supported throws UnsupportedSchemaVersionError; any other problem throws InvalidDocumentError. */
export declare function parseVersionedDocument<T>(raw: unknown, spec: DocumentSpec<T>, file: string): T;

/** Exact text: `${file}: ${kind} schemaVersion ${found} is not supported; this Heron supports schemaVersion ${supported}. Upgrade Heron to read this file.` */
export declare function formatUnsupportedVersionMessage(
  file: string, kind: DocumentKind, found: number, supported: number,
): string;
```

### `src/core/contracts/heron-project.ts` — `.heron/project.json`

```ts
export declare const ADAPTER_IDS: readonly ["navori-master", "filesystem"]; // P4 appends "markdown", "manual"
export type AdapterId = (typeof ADAPTER_IDS)[number];
export declare const STAGE_SELECTIONS: readonly ["explicit", "active", "last-closed"];
export type StageSelection = (typeof STAGE_SELECTIONS)[number];

export type HeronProject = {
  kind: "HeronProject";
  schemaVersion: 1;
  source: {
    adapter: AdapterId;
    specsDir: string | null;                                      // repo-relative; null for filesystem
    stage: { dir: string; selection: StageSelection } | null;     // null for filesystem or no stage
  };
  penpot: { enabled: boolean; url: string | null; fileId: string | null; version: string | null }; // P1 writes { false, null, null, null } (D8)
};
export declare const HeronProjectSchema: z.ZodType<HeronProject>; // z.looseObject at every level
export declare const HERON_PROJECT_DOCUMENT: DocumentSpec<HeronProject>; // schemaFile "heron-project.v1.schema.json"
```

### `src/core/contracts/heron-state.ts` — `.heron/state.json`

```ts
export declare const HERON_PHASES: readonly [
  "initialized", "intake-ready", "researching", "research-ready", "directions-ready",
  "direction-selected", "foundations-ready", "representative-screens-ready", "system-ready",
  "screens-ready", "penpot-synced", "validated", "exported",
]; // array order is the phase order used by phaseIndex
export type HeronPhase = (typeof HERON_PHASES)[number];
/** "direction-selected" .. "exported" (MASTER.md #5–#12). */
export declare const PRODUCTION_PHASES: readonly HeronPhase[];

export declare const GATE_NAMES: readonly [
  "intake", "research", "direction", "foundations", "representative-screens", "visual-review",
];
export type GateName = (typeof GATE_NAMES)[number];

export declare const HERON_EVENT_TYPES: readonly [
  "reference-added", "directions-proposed", "system-completed", "screens-completed",
  "validation-passed", "export-written", "approve-gate", "reject-gate", "revise",
];
export type HeronEventType = (typeof HERON_EVENT_TYPES)[number];
export type HeronEvent =
  | { type: "reference-added" | "directions-proposed" | "system-completed" | "screens-completed" | "validation-passed" | "export-written" }
  | { type: "approve-gate"; gate: GateName }
  | { type: "reject-gate"; gate: GateName }
  | { type: "revise"; target: HeronPhase };
export type TransitionEventKey =
  | "reference-added" | "directions-proposed" | "system-completed" | "screens-completed"
  | "validation-passed" | "export-written"
  | `approve-gate:${GateName}` | `reject-gate:${GateName}` | `revise:${HeronPhase}`;

export declare const PRECONDITION_IDS: readonly [
  "intake-context-valid", "reference-has-provenance", "research-minimum-references",
  "three-valid-directions", "direction-selectable", "foundations-complete",
  "representative-screens-cover-categories", "system-consistent", "all-screens-designed",
  "penpot-sync-clean", "validation-clean-penpot-disabled", "validation-clean", "export-verified",
  "gate-rejectable", "revise-scope-declared", "approvals-valid",
];
export type PreconditionId = (typeof PRECONDITION_IDS)[number];

/** Serializable descriptor of a table row; recorded in history. */
export type Transition = {
  from: HeronPhase;
  event: TransitionEventKey;
  to: HeronPhase;
  precondition: PreconditionId;
  production: boolean; // to ∈ PRODUCTION_PHASES
};
export declare const TransitionSchema: z.ZodType<Transition>;

export type BoundArtifact = { path: RelativeArtifactPath; sha256: Sha256Hex }; // path relative to .heron/
export declare const BoundArtifactSchema: z.ZodType<BoundArtifact>;

type GateDecisionBase = {
  gate: GateName;
  decidedBy: string;          // non-empty; CLI: OS user name
  decidedAt: IsoDateTime;
  artifacts: BoundArtifact[]; // sorted by path
  stateRevision: number;      // revision this decision produced
  runId: RunId;
};
export type GateDecision =
  | (GateDecisionBase & { decision: "approved"; note: string | null })
  | (GateDecisionBase & { decision: "rejected"; reason: string }); // reason non-empty
export declare const GateDecisionSchema: z.ZodType<GateDecision>; // discriminated union on "decision"

export type StaleEntry = { path: RelativeArtifactPath; reason: string; since: number /* stateRevision */ };
export type HistoryEntry = {
  stateRevision: number;
  runId: RunId;
  command: string;            // non-empty; P1 writes "init", "gate approve", "gate reject"
  heronVersion: string;
  at: IsoDateTime;
  mode: HeronMode;
  transition: Transition | null; // null for init
};

export type HeronState = {
  kind: "HeronState";
  schemaVersion: 1;
  stateRevision: number;      // ≥ 1, +1 per committed command
  mode: HeronMode;
  phase: HeronPhase;
  designRevision: number;     // ≥ 0; P1 always 0
  artifacts: BoundArtifact[]; // committed artifacts referenced by this state, sorted by path
  gates: GateDecision[];      // append-only
  stale: StaleEntry[];        // unique by path, sorted by path
  history: HistoryEntry[];    // append-only
};
export declare const HeronStateSchema: z.ZodType<HeronState>;
export declare const HERON_STATE_DOCUMENT: DocumentSpec<HeronState>; // schemaFile "heron-state.v1.schema.json"
```

### `src/core/contracts/mode-decision.ts` — `.heron/intake/mode.json`

```ts
export declare const HARNESS_ARTIFACT_NAMES: readonly [
  "MASTER.md", "DECISIONS.md", "parts.json", "UX.md", "ux.json", "DIGEST.md", "CODEBASE.md",
]; // display order of R1
export type HarnessArtifactName = (typeof HARNESS_ARTIFACT_NAMES)[number];

export type DetectedArtifact = {
  name: HarnessArtifactName;
  path: string;            // repo-relative POSIX
  present: boolean;        // false also when unsafe or too large (a finding explains it)
  sha256: Sha256Hex | null;
};
export type UxFileCheck = {
  path: string;
  present: boolean;
  valid: boolean | null;   // null when absent
  sha256: Sha256Hex | null;
  issues: FindingIssue[];
};
export type UxSummary = { surfaces: string[]; screens: number; flows: number; patterns: number };
export type UxJsonCheck = UxFileCheck & { reader: "provisional-1"; summary: UxSummary | null };
export type StageRef = { number: number; slug: string; dir: string; state: string; selection: StageSelection };
export type HarnessDeclaration = { phase: string | null; mode: string | null; ux: string | null }; // raw, tolerant

export type DetectionReport = {
  adapter: AdapterId;
  navoriMaster: boolean;
  specsDir: string | null;
  stage: StageRef | null;
  stageStatus: "selected" | "none" | "unknown" | "not-applicable"; // "none": 0 stages; "unknown": index unreadable; filesystem: "not-applicable"
  stageNotice: string | null;                   // "No active stage; using last closed: 02-beta"
  harness: HarnessDeclaration | null;           // null: filesystem, or stage state.json absent/unreadable
  artifacts: DetectedArtifact[];                // navori-master with stage: 7 in HARNESS_ARTIFACT_NAMES order; filesystem: UX.md, ux.json; otherwise []
  uxMarkdown: UxFileCheck;                      // stage "none"/"unknown": path "", present false, valid null
  uxJson: UxJsonCheck;
  findings: Finding[];                          // detection-level findings
};
export declare const DetectionReportSchema: z.ZodType<DetectionReport>;

export declare const MODE_REASON_CODES: readonly [
  "UX_COMPLETE", "UX_FILES_MISSING", "UX_INCONSISTENT", "UX_CONTRACT_INVALID",
  "UX_DECLARED_MD_ONLY", "UX_DECLARATION_MISMATCH", "STAGE_UNAVAILABLE",
];
export type ModeReasonCode = (typeof MODE_REASON_CODES)[number];
export type ModeReason = { code: ModeReasonCode; message: string };

export type ModeDecision = {
  kind: "ModeDecision";
  schemaVersion: 1;
  mode: HeronMode;
  reasons: ModeReason[];   // "UX_COMPLETE" alone iff mode = "full"
  findings: Finding[];     // mode-level findings (UX_*), in FINDING_CODES order then by path
  detection: DetectionReport;
};
export declare const ModeDecisionSchema: z.ZodType<ModeDecision>;
export declare const MODE_DECISION_DOCUMENT: DocumentSpec<ModeDecision>; // schemaFile "mode-decision.v1.schema.json"
```

### `src/core/contracts/cli-envelope.ts`

```ts
export declare const CLI_COMMANDS: readonly ["init", "status", "doctor", "gate"];
export type CliCommand = (typeof CLI_COMMANDS)[number];

export type InitData = { decision: ModeDecision; dryRun: boolean; written: boolean; stateRevision: number | null };

export type GateStatus = "not-reached" | "pending" | "approved" | "invalidated" | "rejected";
export type StatusData = {
  adapter: AdapterId;
  navoriMaster: boolean;
  stage: StageRef | null;
  mode: HeronMode;            // effective: "full" only if persisted and live are "full"
  persistedMode: HeronMode;
  liveMode: HeronMode;
  phase: HeronPhase;
  stateRevision: number;
  counts: UxSummary | null;   // only when effective mode = "full"
  gates: { gate: GateName; status: GateStatus }[]; // GATE_NAMES order
  stale: StaleEntry[];
  inputsChanged: string[];    // repo-relative paths whose presence or sha256 differ from mode.json
  openConflicts: number | null; // null until P4
  allowedCommands: string[];
};

export declare const DOCTOR_CHECK_IDS: readonly [
  "runtime.bun", "target.path", "heron.documents", "heron.lock", "heron.gitignore", "harness.detection",
];
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorCheckStatus = "PASS" | "WARNING" | "FAIL";
export type DoctorCheck = {
  id: DoctorCheckId;
  kind: "dependency" | "workspace";
  status: DoctorCheckStatus;
  message: string;
  remedy: string | null;
  durationMs: number;
};
export type DoctorData = { checks: DoctorCheck[] };

export type GateData = {
  gate: GateName;
  decision: "approved" | "rejected";
  from: HeronPhase;
  to: HeronPhase;
  stateRevision: number;
  artifacts: BoundArtifact[];
};

export type CliEnvelope = {
  kind: "CliEnvelope";
  schemaVersion: 1;
  command: CliCommand | "unknown";
  ok: boolean;             // true iff code = 0
  code: ExitCode;
  data: InitData | StatusData | DoctorData | GateData | null;
  findings: Finding[];
  runId: RunId;
  durationMs: number;
  next: string[];
};
export declare const CliEnvelopeSchema: z.ZodType<CliEnvelope>;
export declare const CLI_ENVELOPE_DOCUMENT: DocumentSpec<CliEnvelope>; // schemaFile "cli-envelope.v1.schema.json"
```

### `src/core/contracts/index.ts`

```ts
/** Registry consumed by scripts/gen-schemas.ts, in this order. */
export declare const CONTRACT_DOCUMENTS: readonly [
  DocumentSpec<HeronProject>, DocumentSpec<HeronState>, DocumentSpec<ModeDecision>, DocumentSpec<CliEnvelope>,
];
```

Reglas de estos schemas: sin `.transform()`, `z.date()`, `z.custom()` ni otros tipos no representables (Zod los rechaza en `toJSONSchema` con `unrepresentable: "throw"`). Los invariantes entre campos (revisión monotónica, `artifacts` existentes) viven en código, no en el JSON Schema.

### `scripts/gen-schemas.ts`

```ts
/** File name -> canonicalJson(z.toJSONSchema(spec.schema, { target: "draft-2020-12", io: "output", unrepresentable: "throw" })
 * plus "$id": spec.schemaFile and "title": spec.kind). Deterministic. */
export declare function generateSchemas(): Map<string, string>;
export declare function schemaFileName(spec: DocumentSpec<unknown>): string;
// CLI: `bun scripts/gen-schemas.ts` writes schemas/ (removing *.schema.json not in the map).
```

`bun run gen:schemas && git diff --exit-code schemas/` es P1.A14 tal cual.

### `scripts/check-coverage.ts`

```ts
export type CoverageRule = { prefix: string; lines: number; functions: number };
/** src/core/contracts/, src/core/state/, src/core/store/ at 0.9 lines and functions. The global 0.8 lives in bunfig.toml. */
export declare const COVERAGE_RULES: readonly CoverageRule[];
export type LcovFile = { path: string; linesFound: number; linesHit: number; functionsFound: number; functionsHit: number };
export declare function parseLcov(lcov: string): LcovFile[];
export type CoverageReport = {
  ok: boolean;
  rules: { rule: CoverageRule; lines: number; functions: number; ok: boolean }[];
  neverLoaded: string[]; // src/**/*.ts with runtime code absent from lcov
};
/** runtimeSources: src/**/*.ts whose Bun.Transpiler output is non-empty. Ratios sum LF/LH and FNF/FNH per prefix;
 * a prefix with 0 found counts as 1.0. */
export declare function evaluateCoverage(files: readonly LcovFile[], runtimeSources: readonly string[], rules: readonly CoverageRule[]): CoverageReport;
// CLI: `bun scripts/check-coverage.ts` reads coverage/lcov.info, prints one line per rule, exits 1 when !ok.
```

### `tests/helpers/*`

```ts
// fixtures.ts
/** Copies fixtures/{name} into a fresh temp dir (mkdtemp under os.tmpdir()) and returns its realpath. */
export declare function copyFixture(name: "membership-product" | "no-ux" | "ux-only-md" | "ux-only-json" | "ux-invalid" | "closed-stage"): string;
/** repo-relative POSIX path -> sha256 of every regular file under root, skipping the given top-level dirs. */
export declare function hashTree(root: string, options: { exclude: readonly string[] }): Map<string, string>;
/** Merges `patch` into {root}/specs/_master/{stageDir}/state.json (null deletes a key); `removeFiles` deletes stage files. */
export declare function patchHarnessState(
  root: string, stageDir: string, patch: Record<string, unknown>, options?: { removeFiles?: readonly string[] },
): void;

// cli.ts
export type CapturedRun = { code: ExitCode; stdout: string; stderr: string };
/** Fixed clock (2026-09-30T12:00:00.000Z unless given), sequential run ids, identity "tester", isTTY false,
 * confirm resolving to `confirmAnswer`, lock.isProcessAlive overridable. */
export declare function fixedContext(overrides?: Partial<AppContext> & { confirmAnswer?: boolean }): AppContext;
export declare function runCliCaptured(argv: readonly string[], ctx?: AppContext): Promise<CapturedRun>;

// faulty-fs.ts
export declare class InjectedFaultError extends Error { readonly point: string; readonly index: number }
/** Counts every mutating FsPort call (mkdir, open with "w"/"wx", write, fsync, close of a written fd, rename, unlink, rm)
 * and throws InjectedFaultError on call number `failAt` (1-based); failAt = 0 never fails. */
export declare function withFaultInjection(base: FsPort, plan: { failAt: number }): FsPort & { readonly writePoints: number };
```

### `src/core/state/transitions.ts`

```ts
export type TransitionFacts = Partial<{
  productContextValid: boolean;
  unacknowledgedConflicts: number;
  referenceComplete: boolean;
  referencesWithProvenance: number;
  minReferences: number;               // default 5 (D16)
  validDirections: number;
  directionSelected: boolean;
  intakeApprovalValid: boolean;
  foundationsAreas: number;
  tokenOrA11yFails: number;
  representativeCategoriesCovered: boolean;
  orphanComponents: number;
  patternsWithoutScreen: number;
  screensDesigned: number;
  screensTotal: number;
  penpotEnabled: boolean;
  penpotProposalsWritten: number;      // direction proposal pages written to Penpot (D23–D26; produced from P12)
  penpotSyncErrors: number;
  penpotFileIdMatches: boolean;
  penpotDrift: number;
  validationFails: number;
  exportVerified: boolean;
  reviseScopeDeclared: boolean;
  boundArtifactCount: number;          // files matching GATE_BINDINGS of the event's gate
  invalidatedGates: GateName[];
}>; // an absent fact makes its precondition fail with detail "{fact} is not available"

export type PreconditionResult = { ok: true } | { ok: false; detail: string };
export interface TransitionRule extends Transition {
  readonly description: string;
  readonly check: (facts: TransitionFacts, state: HeronState) => PreconditionResult;
}
export declare const TRANSITIONS: readonly TransitionRule[]; // 108 rows, unique by (from, event)

export declare function phaseIndex(phase: HeronPhase): number;
export declare function isProductionPhase(phase: HeronPhase): boolean;
export declare function eventKey(event: HeronEvent): TransitionEventKey;

export type TransitionRejection =
  | { ok: false; code: "TRANSITION_NOT_ALLOWED"; reason: string }
  | { ok: false; code: "MODE_BLOCKED"; reason: string; rule: TransitionRule }
  | { ok: false; code: "PRECONDITION_UNMET"; reason: string; rule: TransitionRule; precondition: PreconditionId };
export type TransitionCheck = { ok: true; rule: TransitionRule } | TransitionRejection;
export declare function canTransition(state: HeronState, event: HeronEvent, facts: TransitionFacts): TransitionCheck;

export type TransitionMeta = { runId: RunId; at: IsoDateTime; command: string; heronVersion: string };
export type TransitionOutcome = { ok: true; state: HeronState; transition: Transition } | TransitionRejection;
/** On success: phase = rule.to, stateRevision + 1, history entry appended; if phaseIndex(to) < phaseIndex(from),
 * markStaleAfter(state, to, reason) is applied. Never mutates its input. */
export declare function applyTransition(
  state: HeronState, event: HeronEvent, facts: TransitionFacts, meta: TransitionMeta,
): TransitionOutcome;
/** Events whose row exists from state.phase and passes the mode guard (preconditions not evaluated). */
export declare function allowedEvents(state: HeronState): HeronEvent[];
```

Filas de `TRANSITIONS` (la precondición de cada fila es su predicado sobre `TransitionFacts`/`HeronState`):

| # | from | event | to | precondition | prod |
|---|---|---|---|---|---|
| F1 | initialized | approve-gate:intake | intake-ready | intake-context-valid | no |
| F2 | researching | approve-gate:intake | researching | intake-context-valid | no |
| F3 | research-ready | approve-gate:intake | research-ready | intake-context-valid | no |
| F4 | directions-ready | approve-gate:intake | directions-ready | intake-context-valid | no |
| F5 | initialized | reference-added | researching | reference-has-provenance | no |
| F6 | intake-ready | reference-added | researching | reference-has-provenance | no |
| F7 | researching | reference-added | researching | reference-has-provenance | no |
| F8 | research-ready | reference-added | researching | reference-has-provenance | no |
| F9 | directions-ready | reference-added | researching | reference-has-provenance | no |
| F10 | researching | approve-gate:research | research-ready | research-minimum-references | no |
| F11 | research-ready | directions-proposed | directions-ready | three-valid-directions | no |
| F12 | directions-ready | directions-proposed | directions-ready | three-valid-directions | no |
| F13 | directions-ready | approve-gate:direction | direction-selected | direction-selectable | sí |
| F14 | direction-selected | approve-gate:foundations | foundations-ready | foundations-complete | sí |
| F15 | foundations-ready | approve-gate:representative-screens | representative-screens-ready | representative-screens-cover-categories | sí |
| F16 | representative-screens-ready | system-completed | system-ready | system-consistent | sí |
| F17 | system-ready | screens-completed | screens-ready | all-screens-designed | sí |
| F18 | screens-ready | approve-gate:visual-review | penpot-synced | penpot-sync-clean | sí |
| F19 | screens-ready | validation-passed | validated | validation-clean-penpot-disabled | sí |
| F20 | penpot-synced | validation-passed | validated | validation-clean | sí |
| F21 | validated | export-written | exported | export-verified | sí |
| F22 | exported | export-written | exported | export-verified | sí |
| A1 | intake-ready | approve-gate:intake | intake-ready | intake-context-valid | no |
| A2 | research-ready | approve-gate:research | research-ready | research-minimum-references | no |
| A3 | direction-selected | approve-gate:direction | direction-selected | direction-selectable | sí |
| A4 | foundations-ready | approve-gate:foundations | foundations-ready | foundations-complete | sí |
| A5 | representative-screens-ready | approve-gate:representative-screens | representative-screens-ready | representative-screens-cover-categories | sí |
| A6 | penpot-synced | approve-gate:visual-review | penpot-synced | penpot-sync-clean | sí |

Predicados: `intake-context-valid` = `productContextValid === true && unacknowledgedConflicts === 0`; `reference-has-provenance` = `referenceComplete === true`; `research-minimum-references` = `referencesWithProvenance >= (minReferences ?? 5)`; `three-valid-directions` = `validDirections === 3`; `direction-selectable` = `intakeApprovalValid === true && directionSelected === true && penpotEnabled === true && penpotProposalsWritten === 3` (D26: el gate `direction` en full exige las 3 propuestas escritas en Penpot; si falla por Penpot, el detalle usa el código `PENPOT_REQUIRED_FOR_DIRECTION`); `foundations-complete` = `foundationsAreas === 14 && tokenOrA11yFails === 0`; `representative-screens-cover-categories` = `representativeCategoriesCovered === true`; `system-consistent` = `orphanComponents === 0 && patternsWithoutScreen === 0`; `all-screens-designed` = `screensTotal > 0 && screensDesigned === screensTotal`; `penpot-sync-clean` = `penpotEnabled === true && penpotSyncErrors === 0 && penpotFileIdMatches === true && penpotDrift === 0`; `validation-clean-penpot-disabled` = `penpotEnabled === false && validationFails === 0`; `validation-clean` = `validationFails === 0`; `export-verified` = `exportVerified === true`; `gate-rejectable` = `latestDecision(state, g)?.decision === "approved"` o (hay fila `approve-gate:{g}` desde `from` y `boundArtifactCount > 0`: no se rechaza un gate sin nada que revisar); `revise-scope-declared` = `reviseScopeDeclared === true`; `approvals-valid` (guard, DP10) = `invalidatedGates` sin el gate del evento está vacío.

Filas generadas (explícitas en datos; el test fija sus conteos):

- **Rechazo `reject-gate:{g}` (52 filas, precondición `gate-rejectable`)** — una fila por cada fase `P` donde el gate está pendiente o puede estar aprobado. Destino: si `P` está en el rango de revocación del gate, el destino de revocación; si no, `P` (rechazo de un gate pendiente, bucle).
  - `intake` (13): `initialized`→`initialized`; `intake-ready`→`initialized`; `researching`, `research-ready`, `directions-ready` → sí mismas; `direction-selected`..`exported` → `directions-ready`.
  - `research` (11): `researching`→`researching`; `research-ready`..`exported` → `researching`.
  - `direction` (9): `directions-ready`→`directions-ready`; `direction-selected`..`exported` → `directions-ready`.
  - `foundations` (8): `direction-selected`→`direction-selected`; `foundations-ready`..`exported` → `direction-selected`.
  - `representative-screens` (7): `foundations-ready`→`foundations-ready`; `representative-screens-ready`..`exported` → `foundations-ready`.
  - `visual-review` (4): `screens-ready`→`screens-ready`; `penpot-synced`, `validated`, `exported` → `screens-ready`.
- **`revise:{T}` (28 filas, precondición `revise-scope-declared`)** — para cada `P` desde `foundations-ready` hasta `exported` y cada `T` con `phaseIndex("direction-selected") ≤ phaseIndex(T) < phaseIndex(P)`: fila `(P, revise:T, T)`.
- Total: 22 + 6 + 52 + 28 = **108**. Todo par `(fase, eventKey)` de las 13 × 31 combinaciones que no esté en la tabla da `TRANSITION_NOT_ALLOWED` con razón `No transition for "{eventKey}" from phase "{phase}".`

### `src/core/state/gates.ts`

```ts
/** Glob patterns relative to .heron/ whose files are bound to each gate decision. */
export declare const GATE_BINDINGS: Readonly<Record<GateName, readonly string[]>>;
// intake: ["intake/mode.json", "intake/product-context.json", "intake/conflicts.json"]
// research: ["research/references.json", "research/provenance.json"]
// direction: ["research/visual-directions.json"]
// foundations: ["design/foundations/**", "design/tokens/**", "design/DESIGN.md"]
// representative-screens: ["design/screens/**"]
// visual-review: ["penpot/sync-state.json"]

export type GateApprovalInput = {
  gate: GateName; decidedBy: string; note: string | null; artifacts: BoundArtifact[]; meta: TransitionMeta;
};
export type GateRejectionInput = {
  gate: GateName; decidedBy: string; reason: string; artifacts: BoundArtifact[]; meta: TransitionMeta;
};
export type GateOutcome =
  | { ok: true; state: HeronState; decision: GateDecision; transition: Transition }
  | TransitionRejection
  | { ok: false; code: "IDENTITY_REQUIRED" | "REASON_REQUIRED" | "NO_BOUND_ARTIFACTS"; reason: string };
/** Order: decidedBy non-empty -> canTransition(approve-gate:{gate}) -> artifacts.length ≥ 1 (else NO_BOUND_ARTIFACTS,
 * rendered as finding PRECONDITION_UNMET, exit 3) -> applyTransition. */
export declare function approveGate(state: HeronState, input: GateApprovalInput, facts: TransitionFacts): GateOutcome;
/** reject-gate:{gate}; requires non-empty reason; a regression marks later artifacts stale. */
export declare function rejectGate(state: HeronState, input: GateRejectionInput, facts: TransitionFacts): GateOutcome;

export type ApprovalValidity =
  | { valid: true }
  | { valid: false; changed: RelativeArtifactPath[]; missing: RelativeArtifactPath[] };
/** `current` maps each bound path to its sha256 now; an absent key means the file is missing. */
export declare function isApprovalValid(
  decision: GateDecision, current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): ApprovalValidity;
export declare function latestDecision(state: HeronState, gate: GateName): GateDecision | null;
export declare function invalidatedGates(
  state: HeronState, current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): GateName[];
export declare function gateStatuses(
  state: HeronState, current: ReadonlyMap<RelativeArtifactPath, Sha256Hex>,
): Record<GateName, GateStatus>;
```

### `src/core/state/stale.ts` y `src/core/state/lifecycle.ts`

```ts
/** Artifacts (globs relative to .heron/) produced when entering each phase. */
export declare const PHASE_ARTIFACTS: Readonly<Record<HeronPhase, readonly string[]>>;
// initialized: ["project.json", "intake/mode.json"]; intake-ready: ["intake/product-context.json", "intake/conflicts.json"];
// researching: ["research/references.json", "research/provenance.json", "research/assets/**", "brand/**"];
// research-ready: []; directions-ready: ["research/visual-directions.json"]; direction-selected: [];
// foundations-ready: ["design/foundations/**", "design/tokens/**", "design/DESIGN.md"];
// representative-screens-ready: ["design/screens/**"];
// system-ready: ["design/design-system.json", "design/components/**", "design/patterns/**"];
// screens-ready: ["design/screens/**"]; penpot-synced: ["penpot/sync-state.json"]; validated: ["validation/**"]; exported: []

/** Dependent glob -> globs it depends on (closure computed transitively). */
export declare const ARTIFACT_DEPENDENCIES: Readonly<Record<string, readonly string[]>>;
// "intake/product-context.json": ["intake/mode.json"]; "intake/conflicts.json": ["intake/product-context.json"];
// "research/visual-directions.json": ["research/references.json", "intake/product-context.json"];
// "design/foundations/**": ["research/visual-directions.json", "intake/product-context.json"];
// "design/tokens/**": ["design/foundations/**"]; "design/DESIGN.md": ["design/tokens/**"];
// "design/screens/**": ["design/tokens/**", "intake/product-context.json"];
// "design/design-system.json", "design/components/**", "design/patterns/**": ["design/screens/**", "design/tokens/**"];
// "penpot/sync-state.json": ["design/**"]; "validation/**": ["design/**", "penpot/sync-state.json"]

/** Segments split on "/"; "**" matches zero or more segments, "*" any chars within one segment; nothing else is special. */
export declare function matchesGlob(path: string, pattern: string): boolean;
/** Adds a StaleEntry for every state.artifacts path that transitively depends on a changed path. */
export declare function propagateStale(state: HeronState, changed: readonly RelativeArtifactPath[], reason: string): HeronState;
/** Adds a StaleEntry for every state.artifacts path produced by a phase after `phase`. */
export declare function markStaleAfter(state: HeronState, phase: HeronPhase, reason: string): HeronState;

// lifecycle.ts
export declare function createInitialState(input: { mode: HeronMode; artifacts: BoundArtifact[]; meta: TransitionMeta }): HeronState;
/** stateRevision + 1, mode updated, artifacts replaced, history entry (transition null),
 * propagateStale over artifacts whose sha256 changed. Phase never changes here (RN-29: the mode guard blocks). */
export declare function recordInit(state: HeronState, input: { mode: HeronMode; artifacts: BoundArtifact[]; meta: TransitionMeta }): HeronState;
```

### `src/core/state/mode.ts`

```ts
/** Pure. Rules, all applied, findings accumulated:
 * 1. stageStatus "none" or "unknown" -> reference-only, STAGE_UNAVAILABLE ("selected" and "not-applicable" go on).
 * 2. For each present UX file with valid = false -> UX_CONTRACT_INVALID (one finding per file, with issues).
 * 3. Exactly one UX file present -> UX_INCONSISTENT naming the missing file, unless harness.ux = "md" and only UX.md is present.
 * 4. harness.ux = "md" -> UX_DECLARED_MD_ONLY and reference-only (D6).
 * 5. Declaration vs presence (none: neither; md: UX.md only; md-json: both) differs -> UX_DECLARATION_MISMATCH and reference-only (DP11).
 * 6. Both absent -> UX_FILES_MISSING. 7. Otherwise, both present and valid -> full with reason UX_COMPLETE. */
export declare function detectMode(report: DetectionReport): ModeDecision;
/** Short English cause for MODE_BLOCKED, e.g. "ux.json is missing", "ux.json is invalid",
 * "the harness declared UX.md only", "no stage is selected". */
export declare function describeModeBlock(decision: ModeDecision): string;
```

### `src/core/store/*`

```ts
// fs-port.ts
export type FileStat = { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; size: number; mtimeMs: number };
export interface FsPort {
  existsSync(path: string): boolean;
  lstatSync(path: string): FileStat;
  realpathSync(path: string): string;
  readFileSync(path: string): Uint8Array;
  readdirSync(path: string): string[];
  mkdirSync(path: string, options: { recursive: true }): void;
  openSync(path: string, flags: "r" | "w" | "wx"): number;
  writeSync(fd: number, data: Uint8Array): number;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  rmSync(path: string, options: { recursive: true; force: true }): void;
}
export type ReadonlyFs = Pick<FsPort, "existsSync" | "lstatSync" | "realpathSync" | "readFileSync" | "readdirSync">;
export declare const nodeFs: FsPort;

// paths.ts
export declare class UnsafePathError extends Error { readonly path: string; readonly reason: string }
export declare function assertSafeRelativePath(path: string): RelativeArtifactPath;
/** Joins, then realpaths the deepest existing ancestor; throws UnsafePathError if the result leaves realpath(root). */
export declare function resolveInside(fs: ReadonlyFs, root: string, relative: string): string;
export declare function toPosixRelative(root: string, absolute: string): string;

// hash.ts
export declare function sha256Hex(bytes: Uint8Array): Sha256Hex;
export declare function sha256File(fs: ReadonlyFs, absolutePath: string): Sha256Hex | null;

// atomic.ts
export type AtomicWriteOptions = { tmpDir: string; tmpName: string };
/** mkdir(tmpDir) -> open(tmp,"wx") -> write -> fsync -> close -> rename(tmp,target) -> open(dir,"r") + fsync(dir) + close. */
export declare function writeAtomic(fs: FsPort, targetAbsolute: string, content: string | Uint8Array, options: AtomicWriteOptions): void;

// lock.ts
export type LockOwner = { runId: RunId; pid: number; hostname: string; command: string; acquiredAt: IsoDateTime };
export type LockOptions = {
  staleAfterMs: number;          // other host only; default 3_600_000
  corruptGraceMs: number;        // unreadable lock or orphan .lock.reclaim; default 30_000
  hostname: string;
  now: () => number;
  isProcessAlive: (pid: number) => boolean; // default: process.kill(pid, 0) without ESRCH
};
export declare const DEFAULT_LOCK_OPTIONS: Omit<LockOptions, "hostname" | "now" | "isProcessAlive">;
export interface LockHandle { readonly path: string; readonly owner: LockOwner; release(): void }
export type AcquiredLock = { handle: LockHandle; reclaimed: LockOwner | null };
export declare class LockBusyError extends Error { readonly holder: LockOwner | null }
/** Never waits. Throws LockBusyError when held and not stale (DP5). */
export declare function acquireLock(fs: FsPort, heronDir: string, owner: LockOwner, options: LockOptions): AcquiredLock;
export declare function readLockOwner(fs: ReadonlyFs, heronDir: string): LockOwner | null;
export declare function isLockStale(owner: LockOwner | null, lockMtimeMs: number, options: LockOptions): boolean;

// file-store.ts
export declare const HERON_DIR: ".heron";
export declare const STATE_FILE: "state.json";
export declare const PROJECT_FILE: "project.json";
export declare const MODE_FILE: "intake/mode.json";
export declare const GITIGNORE_FILE: ".gitignore";
export declare const STAGING_DIR: "staging";
export declare const LOCK_FILE: ".lock";
export declare const LOCK_RECLAIM_FILE: ".lock.reclaim";
export declare const HERON_GITIGNORE: string; // exact content in "Layout de .heron/"

export declare class DanglingArtifactError extends Error { readonly paths: RelativeArtifactPath[] }
export declare class StateRevisionConflictError extends Error { readonly expected: number; readonly found: number }
export type CommitResult = { stateRevision: number; stateSha256: Sha256Hex; promoted: RelativeArtifactPath[] };
export interface StoreTransaction {
  readonly runId: RunId;
  put(path: RelativeArtifactPath, content: string | Uint8Array): Sha256Hex;
  putDocument<T>(path: RelativeArtifactPath, spec: DocumentSpec<T>, value: T): Sha256Hex; // validates, canonicalJson
  /** DP3 order. expectedRevision: 0 when no state.json exists yet. */
  commit(state: HeronState, expectedRevision: number): CommitResult;
  abort(): void;
}
export interface FileStore {
  readonly repoRoot: string;   // realpath
  readonly heronDir: string;   // realpath(repoRoot)/.heron
  exists(path: RelativeArtifactPath): boolean;
  readBytes(path: RelativeArtifactPath): Uint8Array | null;
  sha256(path: RelativeArtifactPath): Sha256Hex | null;
  /** null when absent; throws UnsupportedSchemaVersionError | InvalidDocumentError. */
  readDocument<T>(path: RelativeArtifactPath, spec: DocumentSpec<T>): T | null;
  begin(runId: RunId): StoreTransaction;
  recoverOrphanStaging(currentRunId: RunId): RunId[];
}
/** create=false: never writes. create=true: mkdir .heron if absent. Throws UnsafePathError if .heron exists
 * and is not a real directory (symlink or file). */
export declare function openFileStore(fs: FsPort, repoRoot: string, options: { create: boolean }): FileStore;
```

### `src/intake/*`

```ts
// ports.ts
export type InputLimits = { maxInputBytes: number };
export declare const DEFAULT_INPUT_LIMITS: InputLimits; // { maxInputBytes: 16_777_216 }
export type DetectRequest = { root: string; stage: string | null; fs: ReadonlyFs; limits: InputLimits };
export type StageSummary = { dir: string; state: string };
export type StageError = {
  kind: "stage-error";
  code: "STAGE_NOT_FOUND" | "NO_SELECTABLE_STAGE" | "INVALID_STAGE";
  requested: string | null;
  available: StageSummary[];  // index order
  message: string;
};
export type AdapterDetection = { kind: "not-detected" } | { kind: "detected"; report: DetectionReport } | StageError;
export type LoadRequest = DetectRequest & { report: DetectionReport };
/** P4 widens this union with { ok: true; context: ProductContext }. */
export type AdapterLoadResult = { ok: false; code: "LOAD_NOT_AVAILABLE"; message: string };
export interface ProductContextAdapter {
  readonly id: AdapterId;
  /** Read-only and non-throwing on hostile input: problems become findings in the report. */
  detect(request: DetectRequest): AdapterDetection;
  load(request: LoadRequest): AdapterLoadResult;
}

// probe.ts
export type FileProbe = { path: string; present: boolean; sha256: Sha256Hex | null; bytes: Uint8Array | null; finding: Finding | null };
/** Symlink escaping root -> UNSAFE_PATH; size > maxInputBytes -> INPUT_TOO_LARGE; both report present = false. */
export declare function probeFile(fs: ReadonlyFs, root: string, relativePath: string, limits: InputLimits): FileProbe;

// ux-contract.ts — provisional reader (D5), loose at every level
export declare const UX_CONTRACT_READER: "provisional-1";
export declare const SUPPORTED_UX_SCHEMA_VERSION: 1;
export type UxSurfaceRef = { id: string; name?: string; [key: string]: unknown };
export type UxScreenRef = { id: string; surface: string; [key: string]: unknown };
export type UxFlowRef = { id: string; screens: string[]; [key: string]: unknown };
export type UxPatternRef = { id: string; screens: string[]; [key: string]: unknown };
export type UxContract = {
  schemaVersion: 1;
  masterStage?: string;
  surfaces: UxSurfaceRef[];   // ≥ 1
  screens: UxScreenRef[];     // ≥ 1
  flows: UxFlowRef[];         // ≥ 1
  patterns: UxPatternRef[];   // ≥ 0
  [key: string]: unknown;
};
export declare const UxContractSchema: z.ZodType<UxContract>;
export type UxContractReadResult = { ok: true; contract: UxContract; summary: UxSummary } | { ok: false; issues: FindingIssue[] };
/** Fatal UTF-8 decode -> JSON.parse -> schemaVersion gate ("schemaVersion 2 is not supported; Heron reads ux.json schemaVersion 1")
 * -> shape -> relations: unique ids per kind, screen.surface declared, flow/pattern screens declared,
 * masterStage equal to expectedStage when both exist. Issues sorted by pointer. */
export declare function readUxContract(bytes: Uint8Array, options: { expectedStage: string | null }): UxContractReadResult;
export type UxMarkdownReadResult = { ok: true } | { ok: false; issues: FindingIssue[] };
/** Valid iff fatal UTF-8 decode succeeds and the text has ≥ 1 non-whitespace character (R5). */
export declare function readUxMarkdown(bytes: Uint8Array): UxMarkdownReadResult;
export declare function checkUxFiles(
  fs: ReadonlyFs, root: string, paths: { markdown: string; json: string }, expectedStage: string | null, limits: InputLimits,
): { uxMarkdown: UxFileCheck; uxJson: UxJsonCheck; findings: Finding[] };

// detect.ts
export declare const DEFAULT_ADAPTERS: readonly ProductContextAdapter[]; // [navoriMasterAdapter, filesystemAdapter]
export type ProjectDetection = { kind: "detected"; report: DetectionReport } | StageError;
/** First adapter returning "detected" or "stage-error" wins; filesystemAdapter always detects. */
export declare function detectProject(request: DetectRequest, adapters?: readonly ProductContextAdapter[]): ProjectDetection;

// adapters/navori-master/harness.ts — tolerant views of harness files (z.looseObject, unknown strings accepted)
export declare const SUPPORTED_HARNESS_VERSION: 1;
export declare const HARNESS_UX_DECLARATIONS: readonly ["none", "md", "md-json"];
export type HarnessReadResult<T> =
  | { status: "absent" }
  | { status: "ok"; value: T; sha256: Sha256Hex }
  | { status: "unreadable"; finding: Finding }                          // HARNESS_UNREADABLE | UNSAFE_PATH | INPUT_TOO_LARGE
  | { status: "unsupported-version"; found: number; finding: Finding }; // HARNESS_VERSION_UNSUPPORTED
export type NavoriConfigView = { specsDir: string };                   // sdd.specsDir ?? "specs"; relative, confined to root
export declare function readNavoriConfig(fs: ReadonlyFs, root: string, limits: InputLimits): HarnessReadResult<NavoriConfigView>;
export type MasterStageView = { number: number; slug: string; dir: string; state: string; closedAt: string | null };
export type MasterIndexView = { version: 1; stages: MasterStageView[]; skipped: Finding[] }; // entries with unsafe dir are skipped with UNSAFE_PATH
export declare function readMasterIndex(fs: ReadonlyFs, root: string, specsDir: string, limits: InputLimits): HarnessReadResult<MasterIndexView>;
export type StageStateView = { version: 1; phase: string | null; mode: string | null; ux: string | null };
export declare function readStageState(fs: ReadonlyFs, root: string, stageRelativeDir: string, limits: InputLimits): HarnessReadResult<StageStateView>;

// adapters/navori-master/stage.ts
export declare const STAGE_DIR_PATTERN: RegExp; // /^\d{2,}-[a-z0-9]+(?:-[a-z0-9]+)*$/
export type StageSelectionResult =
  | { ok: true; stage: MasterStageView; selection: StageSelection; notice: string | null }
  | { ok: true; stage: null; selection: null; notice: null } // index has 0 stages -> NO_STAGE
  | { ok: false; error: StageError };
/** requested != null: must match STAGE_DIR_PATTERN (else INVALID_STAGE) and a stage dir in any state (else STAGE_NOT_FOUND).
 * requested == null: the "activa" stage; else the "cerrada" stage with the highest number, notice
 * "No active stage; using last closed: {dir}"; else NO_SELECTABLE_STAGE. */
export declare function selectStage(index: MasterIndexView, requested: string | null, indexPath: string): StageSelectionResult;

// adapters/navori-master/index.ts and adapters/filesystem/index.ts
export declare const navoriMasterAdapter: ProductContextAdapter; // detected iff navori.config.json and {specsDir}/_master/index.json exist
export declare const filesystemAdapter: ProductContextAdapter;   // always detected; UX.md and ux.json at repo root
```

Rutas que resuelve `navoriMasterAdapter` (relativas a la raíz del repo, con `S = {specsDir}/_master/{stage.dir}`): `S/MASTER.md`, `S/DECISIONS.md`, `S/parts.json`, `S/UX.md`, `S/ux.json`, `S/context/DIGEST.md`, `S/context/CODEBASE.md`; la declaración sale de `S/state.json`. `parts.json` solo se reporta por presencia en P1.

### `src/app/*`

```ts
// context.ts
export interface Clock { now(): Date }
export interface IdGenerator { runId(now: Date): RunId }
export interface IdentityProvider { current(): string | null }
export type ProcessInfo = { pid: number; hostname: string; bunVersion: string | null };
export type AppContext = {
  fs: FsPort;
  clock: Clock;
  ids: IdGenerator;
  identity: IdentityProvider;
  process: ProcessInfo;
  heronVersion: string;
  isTTY: boolean;
  confirm: (question: string) => Promise<boolean>;
  lock: Omit<LockOptions, "hostname" | "now">;
  limits: InputLimits;
};
/** SOURCE_DATE_EPOCH (integer seconds) fixes now(); an invalid value is ignored. */
export declare function systemClock(env: Readonly<Record<string, string | undefined>>): Clock;
export declare function randomRunIds(): IdGenerator;
export declare function createDefaultContext(io: { isTTY: boolean; readLine: () => Promise<string | null> }): AppContext;

// version.ts
export declare const HERON_VERSION: string; // package.json "version"

// result.ts
export type UseCaseResult<T> =
  | { ok: true; data: T; findings: Finding[]; next: string[] }
  | { ok: false; code: Exclude<ExitCode, 0>; message: string; findings: Finding[]; data: T | null };

// init.ts / status.ts / doctor.ts / gate.ts
export type InitInput = { path: string; stage: string | null; dryRun: boolean };
export declare function runInit(ctx: AppContext, input: InitInput): Promise<UseCaseResult<InitData>>;
export type StatusInput = { path: string };
export declare function runStatus(ctx: AppContext, input: StatusInput): Promise<UseCaseResult<StatusData>>;
export declare const DOCTOR_CHECK_TIMEOUT_MS: 10_000;
export type DoctorInput = { path: string };
export declare function runDoctor(ctx: AppContext, input: DoctorInput): Promise<UseCaseResult<DoctorData>>;
export type GateInput = {
  path: string; gate: GateName; decision: "approve" | "reject"; note: string | null; reason: string | null; yes: boolean;
};
export declare function runGate(ctx: AppContext, input: GateInput): Promise<UseCaseResult<GateData>>;
/** P1 fills invalidatedGates and intakeApprovalValid (isApprovalValid over the store) and, when gate != null,
 * boundArtifactCount (files matching GATE_BINDINGS[gate]); every other fact stays absent. */
export declare function collectTransitionFacts(store: FileStore, state: HeronState, gate: GateName | null): TransitionFacts;
```

### `src/cli/*` y `bin/heron.ts`

```ts
// io.ts
export type CliIo = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
  readLine: () => Promise<string | null>;
};
export declare function processIo(): CliIo;

// args.ts
export type ParsedCommand =
  | { command: "init"; path: string; stage: string | null; dryRun: boolean; json: boolean }
  | { command: "status"; path: string; json: boolean }
  | { command: "doctor"; path: string; json: boolean }
  | { command: "gate"; path: string; gate: GateName; decision: "approve" | "reject"; note: string | null; reason: string | null; yes: boolean; json: boolean }
  | { command: "help" }
  | { command: "version" };
export declare class UsageError extends Error { readonly json: boolean }
/** node:util parseArgs with strict: true and allowPositionals: true; path defaults to "."; unknown option,
 * unknown command, unknown gate or extra positional -> UsageError (exit 2). */
export declare function parseCliArgs(argv: readonly string[]): ParsedCommand | UsageError;
export declare const USAGE_TEXT: string;

// envelope.ts
export type EnvelopeInput<T> = { command: CliCommand | "unknown"; result: UseCaseResult<T>; runId: RunId; durationMs: number };
export declare function buildEnvelope<T extends CliEnvelope["data"]>(input: EnvelopeInput<T>): CliEnvelope;

// render.ts
export declare const MODE_LABELS: Readonly<Record<HeronMode, "FULL PRODUCT" | "REFERENCE ONLY">>;
export declare function formatPresenceLine(name: HarnessArtifactName, present: boolean): string; // DP14
export declare function renderFindings(findings: readonly Finding[]): string;
export declare function renderInitText(data: InitData): string;
export declare function renderStatusText(data: StatusData, findings: readonly Finding[]): string;
export declare function renderDoctorText(data: DoctorData): string;
export declare function renderGateText(data: GateData): string;

// commands/*.ts — CLI command handlers
export declare function handleInit(parsed: Extract<ParsedCommand, { command: "init" }>, ctx: AppContext, io: CliIo): Promise<ExitCode>;
export declare function handleStatus(parsed: Extract<ParsedCommand, { command: "status" }>, ctx: AppContext, io: CliIo): Promise<ExitCode>;
export declare function handleDoctor(parsed: Extract<ParsedCommand, { command: "doctor" }>, ctx: AppContext, io: CliIo): Promise<ExitCode>;
export declare function handleGate(parsed: Extract<ParsedCommand, { command: "gate" }>, ctx: AppContext, io: CliIo): Promise<ExitCode>;

// main.ts
/** Text mode: result to stdout, failures to stderr. --json: exactly one CliEnvelope + "\n" to stdout, nothing else.
 * Unexpected exception -> exit 1, UNEXPECTED_ERROR (stack only when HERON_DEBUG=1). */
export declare function runCli(argv: readonly string[], io: CliIo, ctx?: AppContext): Promise<ExitCode>;
```

`bin/heron.ts` (única pieza fuera de `src/` que ejecuta código): shebang `#!/usr/bin/env bun`, llama `runCli(process.argv.slice(2), processIo())` y termina con `process.exit(code)`.

### Superficie de la CLI

```text
Usage: heron <command> [options]

Commands:
  init [path] [--stage <NN-slug>] [--dry-run] [--json]
      Detect the product context, decide the mode and write .heron/
  status [path] [--json]
      Show mode, stage, phase, gates and stale artifacts
  doctor [path] [--json]
      Check the local environment and the .heron/ workspace
  gate <gate> approve|reject [path] [--note <text>] [--reason <text>] [--yes] [--json]
      Record a human gate decision bound to artifact hashes

Gates: intake, research, direction, foundations, representative-screens, visual-review

Options:
  -h, --help     Show this help
  -v, --version  Show the Heron version
```

Códigos por comando: `init` 0 (también en `reference-only`), 2 (ruta inexistente, `--stage` inválido o inexistente, sin etapa seleccionable, opción desconocida), 3 (`.heron/` inseguro, documento de `.heron/` inválido o con versión no soportada), 6 (lock), 1 (inesperado). `status`: 0, 2, 3 (`NOT_INITIALIZED`, documento inválido o no soportado). `doctor`: 0 sin FAIL; 5 si falla un check `kind: "dependency"`; 4 si falla otro. `gate`: 0, 2 (gate desconocido, sin `--reason` al rechazar, sin TTY ni `--yes`, confirmación negada, sin identidad), 3 (`NOT_INITIALIZED`, `MODE_BLOCKED`, `TRANSITION_NOT_ALLOWED`, `PRECONDITION_UNMET`), 6 (lock o revisión).

### Salida exacta de `init` (inglés, D14)

Estructura, en este orden (`[…]` = línea condicional; una línea vacía separa bloques):

1. `Project detected`
2. `Navori Master: yes` o `Navori Master: no`
3. `[No active stage; using last closed: {dir}]` solo con fallback (D22)
4. `[Stage: {dir}]` / `[Stage: none]` / `[Stage: unknown]` solo con `navori-master`
5. Líneas de presencia con `formatPresenceLine` (7 con `navori-master` y etapa seleccionada; `UX.md` y `ux.json` con `filesystem`; ninguna si la etapa es `none` o `unknown`)
6. `[Harness UX declaration: {value}]` solo si `state.json` declara `ux`
7. `Mode:` y en la línea siguiente `FULL PRODUCT` o `REFERENCE ONLY`
8. Bloque de findings: todo finding de detección y de modo salvo `STAGE_FALLBACK_LAST_CLOSED` (ya mostrado en 3), una línea `{CODE}: {message}` y debajo cada issue como `  {pointer}: {message}` (pointer vacío se muestra `(root)`)
9. Solo en `full`: `Surfaces:`, una línea `- {id}` por surface en el orden de `ux.json`, línea vacía, `Screens: {n}`, `Flows: {n}`, `Patterns: {n}`
10. `full`: `Ready for research.`; `reference-only`: `Full product generation disabled.` y `Visual research is available.`
11. `[Dry run: nothing was written to .heron/]` con `--dry-run`

`membership-product` (P1.A1, R1, R2):

```text
Project detected
Navori Master: yes
Stage: 01-mvp

MASTER.md: ✓
DECISIONS.md: ✓
parts.json: ✓
UX.md:  ✓
ux.json: ✓
DIGEST.md: ✓
CODEBASE.md: ✓

Harness UX declaration: md-json

Mode:
FULL PRODUCT

Surfaces:
- MOBILE
- DASHBOARD
- PARTNER

Screens: 6
Flows: 3
Patterns: 2

Ready for research.
```

`no-ux` (P1.A2, R3):

```text
Project detected
Navori Master: yes
Stage: 01-mvp

MASTER.md: ✓
DECISIONS.md: ✓
parts.json: ✓
UX.md:  missing
ux.json: missing
DIGEST.md: ✓
CODEBASE.md: ✓

Mode:
REFERENCE ONLY

Full product generation disabled.
Visual research is available.
```

`ux-only-md` (P1.A3, R4; `ux-only-json` es simétrico con `UX.md is missing`):

```text
Mode:
REFERENCE ONLY

UX_INCONSISTENT: UX.md is present but ux.json is missing (specs/_master/01-mvp/ux.json); Heron will not create or infer it.

Full product generation disabled.
Visual research is available.
```

`ux-invalid` (P1.A4, R5):

```text
Mode:
REFERENCE ONLY

UX_CONTRACT_INVALID: specs/_master/01-mvp/ux.json does not satisfy the provisional UX contract reader (3 issues).
  /flows/0/screens/1: undeclared screen "SCR-MOBILE-09"
  /patterns: expected array
  /screens/1/surface: undeclared surface "KIOSK"

Full product generation disabled.
Visual research is available.
```

`closed-stage` sin `--stage` (P1.A5, R6):

```text
Project detected
Navori Master: yes
No active stage; using last closed: 02-beta
Stage: 02-beta
```

`--stage 99-x` (exit 2, a stderr):

```text
Stage "99-x" not found in specs/_master/index.json.
Available stages: 01-alpha (cerrada), 02-beta (cerrada), 03-gamma (abandonada)
```

Sin etapa `activa` ni `cerrada` y sin `--stage` (exit 2): `No active or closed stage in specs/_master/index.json; pass --stage <NN-slug>.` seguido de la misma línea `Available stages: …`.

Declaración `md` (P1.A11, R7):

```text
Harness UX declaration: md

Mode:
REFERENCE ONLY

UX_DECLARED_MD_ONLY: The harness declared ux = "md" (UX.md only) in specs/_master/01-mvp/state.json; Heron requires UX.md and ux.json for full product, so it stays in reference-only.
```

Repo sin master-plan, adapter `filesystem` (P1.A17 sobre `monorepo-fullstack`):

```text
Project detected
Navori Master: no

UX.md:  missing
ux.json: missing

Mode:
REFERENCE ONLY

Full product generation disabled.
Visual research is available.
```

### Mensajes de findings (texto exacto; `{…}` se interpola)

| Código | Severidad | Mensaje |
|---|---|---|
| `UX_INCONSISTENT` | warning | `{present} is present but {missing} is missing ({missingPath}); Heron will not create or infer it.` |
| `UX_CONTRACT_INVALID` | error | `{path} does not satisfy the provisional UX contract reader ({n} issue(s)).` (`issue` si n = 1, `issues` si no) |
| `UX_DECLARATION_MISMATCH` | warning | `The harness declares ux = "{value}" in {statePath}, but {detail}.` (`{detail}`: `ux.json is missing`, `UX.md is missing`, `ux.json exists`, `UX.md exists`, unidos con ` and `) |
| `UX_DECLARED_MD_ONLY` | info | ver ejemplo de declaración `md` |
| `HARNESS_UNREADABLE` | warning | `{path} could not be read: {reason}.` |
| `HARNESS_VERSION_UNSUPPORTED` | warning | `{path} has version {found}; Heron reads version 1.` |
| `HARNESS_UNKNOWN_VALUE` | info | `{path} declares ux = "{value}", which Heron does not recognize; the declaration is ignored.` |
| `NO_STAGE` | warning | `{indexPath} has no stages.` |
| `STAGE_FALLBACK_LAST_CLOSED` | info | `No active stage; using last closed: {dir}` |
| `STAGE_NOT_FOUND` | error | `Stage "{requested}" not found in {indexPath}.` |
| `NO_SELECTABLE_STAGE` | error | `No active or closed stage in {indexPath}; pass --stage <NN-slug>.` |
| `INVALID_STAGE` | error | `Invalid stage "{requested}": expected NN-slug, for example 01-mvp.` |
| `UNSAFE_PATH` | warning (entrada) / error (`.heron/`) | `{path} resolves outside the repository or is not a regular path; it is ignored.` / `.heron/ must be a regular directory inside the repository.` |
| `INPUT_TOO_LARGE` | warning | `{path} exceeds {limit} bytes; it is ignored.` |
| `PATH_NOT_FOUND` | error | `Path not found or not a directory: {path}` |
| `NOT_INITIALIZED` | error | `.heron/state.json not found. Run: heron init {path}` |
| `SCHEMA_VERSION_UNSUPPORTED` | error | `formatUnsupportedVersionMessage(...)` |
| `DOCUMENT_INVALID` | error | `{file} is not a valid {kind} document ({n} issue(s)); restore it from Git.` |
| `MODE_BLOCKED` | error | `{eventKey} requires FULL PRODUCT mode; current mode is REFERENCE ONLY ({describeModeBlock}).` |
| `TRANSITION_NOT_ALLOWED` | error | `No transition for "{eventKey}" from phase "{phase}".` |
| `PRECONDITION_UNMET` | error | `Precondition "{id}" is not met for "{eventKey}" from phase "{phase}": {detail}.` / `Gate "{gate}" has no bound artifacts to review.` (`NO_BOUND_ARTIFACTS`) |
| `GATE_APPROVAL_INVALIDATED` | warning | `Gate "{gate}" approval is no longer valid: changed [{changed}], missing [{missing}].` |
| `INPUTS_CHANGED` | warning | `Inputs changed since the last heron init: {paths}. Run: heron init {path}` |
| `LOCK_BUSY` | error | `.heron/ is locked by "{command}" (pid {pid} on {hostname}, run {runId}, since {acquiredAt}).` / `.heron/state.json changed during the command (expected revision {expected}, found {found}).` |
| `LOCK_RECLAIMED` | warning | `Reclaimed a stale lock from pid {pid} on {hostname} (run {runId}).` |
| `STAGING_RECOVERED` | info | `Removed orphan staging from interrupted run(s): {runIds}.` |
| `CONFIRMATION_REQUIRED` | error | `Gate decisions need an interactive terminal or --yes.` / `Gate decision cancelled; nothing was written.` |
| `IDENTITY_REQUIRED` | error | `Cannot determine who is deciding the gate (OS user is empty).` |
| `REASON_REQUIRED` | error | `heron gate {gate} reject requires --reason <text>.` |
| `USAGE` | error | mensaje de `parseArgs` o `Unknown command "{x}".`, seguido de `USAGE_TEXT` |
| `UNEXPECTED_ERROR` | error | `Unexpected error: {message}` |

### Salida de `status`, `doctor` y `gate`

`status` (texto):

```text
Stage: 01-mvp
Navori Master: yes
Mode: FULL PRODUCT
Phase: initialized
State revision: 1

Screens: 6
Flows: 3
Patterns: 2

Gates:
- intake: pending
- research: not-reached
- direction: not-reached
- foundations: not-reached
- representative-screens: not-reached
- visual-review: not-reached

Stale artifacts: none
Open conflicts: not tracked yet
Allowed commands: heron init, heron status, heron doctor, heron gate intake approve|reject
```

En `reference-only` los conteos se omiten y tras `Mode:` va `Production blocked: {describeModeBlock}`. Si el modo persistido y el recalculado difieren: `Mode: REFERENCE ONLY (persisted: FULL PRODUCT)`. Los findings (`INPUTS_CHANGED`, `GATE_APPROVAL_INVALIDATED`) van al final con `renderFindings`. `Allowed commands` = siempre `heron init`, `heron status`, `heron doctor`, más `heron gate {g} approve|reject` por cada gate con fila desde la fase actual que pasa el guard de modo (`allowedEvents`).

`doctor`: una línea por check `{STATUS padded to 7} {id padded to 18} {message}` y, si hay remedio, `        Remedy: {remedy}`; al final `Summary: {p} PASS, {w} WARNING, {f} FAIL`. Checks P1: `runtime.bun` (dependency; `process.versions.bun` ≥ 1.4.2 o FAIL), `target.path` (existe y es directorio), `heron.documents` (si hay `.heron/`: `project.json`, `state.json`, `intake/mode.json` legibles con versión soportada; sin `.heron/` WARNING `Not initialized`), `heron.lock` (sin lock PASS; lock vivo o vencido WARNING con remedio), `heron.gitignore` (contenido igual a `HERON_GITIGNORE` o WARNING), `harness.detection` (PASS con adapter y etapa; WARNING con cada finding de detección). Cada check corre con `DOCTOR_CHECK_TIMEOUT_MS`; al vencer queda FAIL `timed out after 10000 ms`.

`gate` (texto): `Gate "{gate}" {approved|rejected} by {decidedBy}.`, `Bound artifacts: {n}`, `Phase: {from} -> {to}`, `State revision: {r}`. Sin `--yes` y con TTY se pregunta `{Approve|Reject} gate "{gate}" bound to {n} artifact(s)? [y/N] ` y solo `y`/`yes` (sin distinguir mayúsculas) confirma. Orden: parseo → estado legible → lock → modo efectivo recalculado → `canTransition` (falla antes de preguntar) → confirmación → decisión → commit (solo `state.json`) → liberar lock.

### Layout de `.heron/` (P1)

```text
.heron/
  .gitignore          versionado; escrito por init en la misma transacción
  project.json        HeronProject v1
  state.json          HeronState v1 — punto de commit, siempre el último en escribirse
  intake/
    mode.json         ModeDecision v1 (incluye DetectionReport; sin fechas)
  staging/{runId}/    transitorio (ignorado)
  .lock               transitorio (ignorado)
  .lock.reclaim       transitorio (ignorado)
```

`state.artifacts` tras el primer `init`: `intake/mode.json` y `project.json` con sus sha256. `.gitignore` no se referencia (es configuración). Contenido exacto de `HERON_GITIGNORE` (LF, con LF final):

```text
# Managed by Heron. Local-only paths; everything else in .heron/ is versioned.
/.lock
/.lock.reclaim
/staging/
/cache/
/logs/
/penpot/snapshots/
```

`runs/` no se incluye: `MASTER.md` Retención excluye los "`runs/` crudos" y la decisión de qué parte de `runs/` se versiona pertenece a P3 (dueña de `AgentRun`); P3 actualiza esta constante e `init` reescribe el archivo.

### Fixtures (todos SYNTHETIC)

Convención de marca en P1: cada fixture tiene un archivo `SYNTHETIC` en su raíz (texto `SYNTHETIC fixture — not a real product.`) y todo `.md` empieza con la línea `> SYNTHETIC — fixture data, not a real product.`. Los JSON del harness no llevan una clave extra de marca porque el borrador del harness usa `strictObject` para `ux.json`; la regla definitiva para JSON la cierra P4 (P4.A6). Todos usan `specsDir` default (`navori.config.json` = `{ "name": "membership-product", "sdd": { "specsDir": "specs" } }` con `name` igual al nombre del directorio del fixture) salvo que se indique.

| Fixture | Etapas en `specs/_master/index.json` | Contenido de la etapa | `state.json` de la etapa | Resultado esperado |
|---|---|---|---|---|
| `membership-product` | `01-mvp` `activa` | `MASTER.md`, `DECISIONS.md`, `parts.json`, `UX.md`, `ux.json`, `context/DIGEST.md`, `context/CODEBASE.md` | `phase: "executing"`, `mode: "template"`, `ux: "md-json"` | `FULL PRODUCT`, 3 surfaces, 6 screens, 3 flows, 2 patterns |
| `no-ux` | `01-mvp` `activa` | los 7 salvo `UX.md` y `ux.json` | sin `ux` (legacy) | `REFERENCE ONLY`, sin findings |
| `ux-only-md` | `01-mvp` `activa` | como `no-ux` + `UX.md` | sin `ux` | `UX_INCONSISTENT` (falta `ux.json`) |
| `ux-only-json` | `01-mvp` `activa` | como `no-ux` + `ux.json` válido | sin `ux` | `UX_INCONSISTENT` (falta `UX.md`) |
| `ux-invalid` | `01-mvp` `activa` | los 7; `ux.json` con 3 issues | `ux: "md-json"` | `UX_CONTRACT_INVALID` con 3 pointers |
| `closed-stage` | `01-alpha` `cerrada`, `02-beta` `cerrada`, `03-gamma` `abandonada` (con `closedAt`) | cada etapa con los 5 artefactos sin UX | `phase: "closed"`, `outcome: "entregada"` (gamma: `abandonada` + `abandonment`) | fallback a `02-beta`; `--stage 01-alpha` y `--stage 03-gamma` exit 0; `--stage 99-x` exit 2 |

`membership-product/…/01-mvp/ux.json` usa ids del borrador del harness: surfaces `MOBILE`, `DASHBOARD`, `PARTNER`; screens `SCR-MOBILE-01`, `SCR-MOBILE-02`, `SCR-DASHBOARD-01`, `SCR-DASHBOARD-02`, `SCR-PARTNER-01`, `SCR-PARTNER-02`; flows `F01`–`F03`; patterns `PT01`, `PT02`; además `actors`, `journeys`, `functionalComponents`, `uxRequirements` y `traceability` con referencias `RF-1`, `RN-1` que existen en su `MASTER.md` sintético, y `masterStage: "01-mvp"`. El e2e lee los conteos del propio `ux.json` (P1.A1).

`ux.json` provisional mínimo válido (lo que exige `UxContractSchema`; todo lo demás se tolera y preserva):

```json
{
  "schemaVersion": 1,
  "masterStage": "01-mvp",
  "surfaces": [{ "id": "MOBILE", "name": "Mobile" }],
  "screens": [{ "id": "SCR-MOBILE-01", "surface": "MOBILE" }],
  "flows": [{ "id": "F01", "screens": ["SCR-MOBILE-01"] }],
  "patterns": []
}
```

`ux-invalid/…/01-mvp/ux.json` (exactamente 3 issues):

```json
{
  "schemaVersion": 1,
  "masterStage": "01-mvp",
  "surfaces": [{ "id": "MOBILE", "name": "Mobile" }],
  "screens": [
    { "id": "SCR-MOBILE-01", "surface": "MOBILE" },
    { "id": "SCR-KIOSK-01", "surface": "KIOSK" }
  ],
  "flows": [{ "id": "F01", "screens": ["SCR-MOBILE-01", "SCR-MOBILE-09"] }],
  "patterns": "none"
}
```

Las variantes de P1.A11 se derivan en el test copiando `membership-product` con `patchHarnessState`: (a) `ux: "md"` y sin `ux.json`; (b) `ux: "md-json"` y sin `ux.json`; (c) `phase: "ux-review"`, `mode: "desde-cero-v9"` y una clave desconocida `futureField`; (d) `ux: "md-json-v2"`.

## Failure modes

| Falla | Detección | Comportamiento | Exit | Test |
|---|---|---|---|---|
| Caída en cualquier punto de escritura de `init` o `gate` | `FsPort` con fallo inyectado en la llamada N | `state.json` queda ausente (primer `init`) o en su versión previa válida; todo `state.artifacts[].path` existe; el siguiente comando borra el staging huérfano y termina bien | 1 en el run caído; 0 después | `tests/unit/store.test.ts` (A8) |
| Segundo escritor | `open(".lock", "wx")` → `EEXIST` con dueño vivo | `LockBusyError` sin espera, mensaje con pid, host, run y fecha | 6 en ≤ 1 s | `tests/unit/store.test.ts` (A8, proceso real) |
| Lock huérfano (mismo host, pid muerto) | `isProcessAlive(pid) === false` | Reclamo con mutex, `LOCK_RECLAIMED`, continúa | 0 | `tests/unit/store.test.ts` |
| Lock ilegible (caída entre `open` y `write`) o `.lock.reclaim` huérfano | JSON inválido / `mtime` > 30 s | Vencido tras 30 s; antes, busy | 6 o 0 | `tests/unit/store.test.ts` |
| Lock de otro host (FS compartido) | `hostname` distinto | Busy hasta 1 h desde `acquiredAt` | 6 | `tests/unit/store.test.ts` |
| Revisión cambiada en disco durante el comando | `expectedRevision` ≠ revisión en disco | `StateRevisionConflictError`, abort | 6 | `tests/unit/store.test.ts` |
| `schemaVersion` mayor en `.heron/` | `parseVersionedDocument` | Mensaje que nombra la soportada; no escribe | 3 | `tests/unit/contracts.test.ts` (A9) |
| Documento de `.heron/` corrupto | `InvalidDocumentError` con pointers | `DOCUMENT_INVALID`, remedio "restore it from Git"; sin autorreparación | 3 | `tests/unit/contracts.test.ts`, `tests/e2e/status.test.ts` |
| `.heron` es symlink o archivo | `lstat` en `openFileStore` | `UNSAFE_PATH`, no escribe | 3 | `tests/unit/store.test.ts` |
| Ruta de entrada que escapa del repo (symlink, `sdd.specsDir` absoluto o con `..`, `dir` de etapa hostil) | `resolveInside`, `STAGE_DIR_PATTERN` | Se ignora con `UNSAFE_PATH`; decide `reference-only` si afecta a UX | 0 | `tests/unit/harness-readers.test.ts` |
| Archivo de entrada enorme | `size > maxInputBytes` (16 MiB) | `INPUT_TOO_LARGE`, se trata como ausente/inválido | 0 | `tests/unit/harness-readers.test.ts` |
| `navori.config.json` ilegible | `JSON.parse`/decode | `HARNESS_UNREADABLE`, `specsDir = "specs"` | 0 | `tests/unit/harness-readers.test.ts` |
| `index.json` ilegible o versión ≠ 1 | lector | `Navori Master: yes`, `Stage: unknown`, `reference-only` con el finding (RN-46) | 0 | `tests/unit/harness-readers.test.ts`, `tests/unit/mode.test.ts` |
| `state.json` de la etapa ilegible, versión ≠ 1, fase/modo/`ux` desconocidos | lector tolerante | Declaración ignorada o mostrada; nunca falla el adapter | 0 | `tests/e2e/init.test.ts` (A11) |
| `ux.json` inválido (UTF-8, JSON, versión, forma, relaciones) | `readUxContract` | `UX_CONTRACT_INVALID` con pointers, `reference-only` | 0 | `tests/unit/ux-contract.test.ts`, `tests/e2e/init.test.ts` (A4) |
| `UX.md` no UTF-8 o en blanco | `readUxMarkdown` | `UX_CONTRACT_INVALID` pointer `""`, `reference-only` | 0 | `tests/unit/ux-contract.test.ts` |
| UX desaparece tras llegar a producción | `status` recalcula; `init` persiste el nuevo modo | Fase intacta, toda transición de producción `MODE_BLOCKED` (RN-29) | 0 / 3 | `tests/unit/state-machine.test.ts`, `tests/e2e/status.test.ts` |
| Lector concurrente durante un commit | — | Lee el `state.json` viejo o el nuevo (rename atómico); puede ver un `mode.json` promovido antes que `state.json` y reportar `INPUTS_CHANGED` transitorio. Aceptado: `status` es informativo | 0 | — |
| Disco lleno / `EACCES` | excepción del `FsPort` | `abort()` de la transacción; `state.json` intacto | 1 | cubierto por la inyección de fallos |
| `SOURCE_DATE_EPOCH` inválido | parseo | Se ignora y se usa el reloj del sistema | — | `tests/unit/contracts.test.ts` |

## Testing strategy

Cada test lleva `// Covers: R<n>` y responde a un riesgo nombrado arriba. Los e2e llaman `runCli` en el mismo proceso con `fixedContext` (reloj fijo, ids deterministas, `isTTY` controlado) sobre una copia temporal del fixture (`copyFixture`); nunca escriben dentro de `fixtures/`.

| Test (archivo # caso) | Riesgo que responde | Cubre |
|---|---|---|
| `tests/e2e/init.test.ts#reports FULL PRODUCT for the membership-product fixture` | La salida no respeta el orden y los literales del brief o los conteos no salen de `ux.json` | R1, R2 |
| `tests/e2e/init.test.ts#reports REFERENCE ONLY for the no-ux fixture` | Sin UX se decide `full` o sale con código ≠ 0 | R1, R3 |
| `tests/e2e/init.test.ts#falls back to reference-only without inferring the missing UX file` | Heron crea o infiere el archivo faltante; no nombra cuál falta (corre `ux-only-md` y `ux-only-json`; verifica `state.json.mode` y que no aparece ningún archivo UX nuevo) | R4 |
| `tests/e2e/init.test.ts#treats a schema-invalid ux.json as reference-only and lists the issues` | Un `ux.json` roto habilita `full` o los issues no son localizables | R5 |
| `tests/e2e/init.test.ts#selects stages explicitly or falls back to the last closed stage with a notice` | Etapa equivocada en silencio; `--stage` inexistente no da 2 ni lista las disponibles | R6 |
| `tests/e2e/init.test.ts#reports the harness UX declaration and tolerates unknown phases and modes` | Un cambio del harness (fase `ux`, modo `desde-cero`, campos nuevos) rompe a Heron; D6 no se respeta | R7 |
| `tests/e2e/init.test.ts#never writes outside .heron/ in the product repo` | Escritura fuera de `.heron/` (`hashTree` antes y después de `init` y `status`, excluyendo `.heron/`) | R12 |
| `tests/unit/state-machine.test.ts#blocks production transitions in reference-only and rejects pairs outside the table` | Una transición de producción se cuela en `reference-only`; un par no previsto se acepta; una fila sin precondición real. Verifica: 108 filas únicas por `(from, event)`; las 13 × 31 combinaciones; cada fila de producción con hechos satisfechos da `MODE_BLOCKED` en `reference-only` y `ok` en `full`; cada fila falla con hechos vacíos (su precondición chequea algo) | R8 |
| `tests/unit/gates.test.ts#invalidates an approval when a bound artifact hash changes` | Una aprobación sobrevive al cambio o desaparición de un artefacto atado | R9 |
| `tests/unit/stale.test.ts` | Stale no se propaga por dependencias o por regresión de fase | R8, R9 |
| `tests/unit/store.test.ts#keeps a consistent state on injected failures and rejects a second writer` | Estado corrupto o artefacto referenciado faltante tras una caída; segundo escritor que espera o escribe. Cuenta K puntos de escritura en un `init` exitoso; para N = 1..K corre con fallo en N (primer `init` y re-`init` con modo cambiado), valida `state.json` con `HeronStateSchema` y la existencia de cada `artifacts[].path`, luego corre sin fallo. Segundo escritor: el test toma el lock con su pid y lanza `bun bin/heron.ts init` como proceso real; exige exit 6 y ≤ 1 000 ms. El run "caído" usa un pid falso marcado muerto en `lock.isProcessAlive` | R10 |
| `tests/unit/contracts.test.ts#rejects an unknown schemaVersion naming the supported one` | Un documento de un Heron futuro se lee o se sobrescribe en silencio | R11 |
| `tests/unit/mode.test.ts` | Matriz completa de `detectMode` (ninguno, uno, ambos válidos, inválidos, declaraciones `none`/`md`/`md-json`/desconocida, etapa `none`/`unknown`) | R2–R5, R7 |
| `tests/unit/ux-contract.test.ts` | El lector provisional rechaza campos desconocidos (violaría D5) o acepta relaciones rotas | R5 |
| `tests/unit/harness-readers.test.ts` | `specsDir` hostil, JSON roto, versiones distintas de 1, symlinks | R1, R7, R12 |
| `tests/unit/stage-selection.test.ts` | "Última cerrada" mal calculada (mayor `number`); `convertida`/`abandonada` usadas sin `--stage` | R6 |
| `tests/unit/cli-args.test.ts` | Opciones desconocidas aceptadas; exit ≠ 2 en uso inválido | R6 |
| `tests/e2e/status.test.ts` | `status` escribe, no detecta `INPUTS_CHANGED` o no bloquea al bajar el modo | R8, R9, R11, R12 |
| `tests/e2e/doctor.test.ts` | Checks sin remedio o exit mal mapeado | R11 |
| `tests/e2e/gate.test.ts` | Gate aprobado sin identidad, sin TTY ni `--yes`, en `reference-only` sobre un gate de producción o sin precondición | R8, R9 |
| `tests/perf/init.perf.test.ts#init and status p95 under 2000 ms on membership-product` | Arranque lento. 20 corridas de `init` (copia nueva cada vez) y 20 de `status` como proceso real `bun bin/heron.ts`; p95 = `sorted[Math.ceil(0.95 × 20) − 1]` ≤ 2 000 ms para cada uno; timeout del caso 120 000 ms | R13 |
| `tests/repo/boundaries.test.ts#enforces module boundaries and no navori imports` | Acoplamiento con navori o entre adapters. Reglas: ningún archivo de `src/`, `bin/`, `scripts/` importa `navori`, `navori/*` o `@navori/*`, y `package.json` no los declara; `src/core/contracts/**` solo importa `zod` y hermanos; `src/core/state/**` solo `src/core/contracts/**`; `src/core/**` no importa `intake`, `app` ni `cli`; `src/intake/**` no importa `app` ni `cli`; `src/app/**` no importa `cli`; `src/intake/adapters/{a}/**` no importa `src/intake/adapters/{b}/**` (a ≠ b); solo `src/core/store/**` importa `node:fs`/`fs`; 0 apariciones de `Bun.` o `bun:` en `src/core/contracts/**` y `src/core/state/**` (RNF-20). El extractor se autoverifica con una cadena sintética que contiene cada forma de import | R14 |
| `tests/repo/boundaries.test.ts#allows any only with a justification` | `any` sin `// any justified:` (RNF-19) | R14 |
| `tests/repo/schemas.test.ts` | `schemas/` desincronizado, con faltantes o sobrantes | R15 |
| `tests/repo/ci.test.ts#ci workflow runs the quality gate on pull requests and main` | CI inexistente o sin el gate: parsea `.github/workflows/ci.yml` con `Bun.YAML.parse` y exige `on.pull_request`, `on.push.branches` con `main` y pasos `bun install --frozen-lockfile` y `bun run check` | R16 |
| `tests/repo/coverage-rules.test.ts` | El script de cobertura calcula mal o no detecta archivos no cargados | R16 |
| P1.A14 `bun run gen:schemas && git diff --exit-code schemas/` | Deriva frente a lo commiteado | R15 |
| P1.A15 `bun run check` | Quality gate completo | R16 |
| P1.A17 manual | Instalación real ≤ 10 min con `bun link` y detección sobre repos reales. Para no dejar `.heron/` en repos ajenos, el recorrido puede usar `--dry-run`: la salida es idéntica salvo la línea final `Dry run: …` | R17 |

## NOT in scope

- `ProductContext`, precedencia RN-7, `CONFLICT`, `heron intake`, `load` real de los adapters y los adapters `markdown`/`manual` → P4. En P1 `load` devuelve `LOAD_NOT_AVAILABLE` y el gate `intake` no puede aprobarse (falta `productContextValid`).
- Validar `parts.json`, `MASTER.md` o `DECISIONS.md` más allá de su presencia → P4.
- Conmutar el lector provisional a la copia fijada del schema del harness → P11 (D5, D19).
- Research, referencias y `brand` (eventos `reference-added`) → P2; agentes, `doctor --deep` y direcciones → P3. La tabla ya contiene sus filas; los comandos no existen en P1.
- Sink de logs JSONL en `.heron/logs/` y eventos de log → P2 (DP17).
- `ajv` y validación de documentos contra los JSON Schemas emitidos → P4 (P4.A6).
- `jscpd` y `semgrep` dentro de `bun run check`: R16 fija el contenido del gate; esos dos siguen como gates del harness (`.claude/scripts/check-jscpd.sh`, `.claude/scripts/check-semgrep.sh`) porque requieren instalaciones externas.
- Web UI, Docker, Penpot → P8, P9, P6.
- Binario `bun build --compile` y paquete npm (D20).
- Migraciones de `schemaVersion` (N−1): no hay versión anterior a la 1.
