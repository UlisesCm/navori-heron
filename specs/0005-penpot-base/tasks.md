# 0005 Penpot base y propuestas visuales — Tasks

Lotes de 1–3 tareas, **en serie** (cada tarea declara de qué depende y con quién comparte archivos; no se paralelizan tareas que comparten archivos). Cada test lleva `// Covers: R<n>` en la primera línea y usa el nombre exacto del caso de `design.md` § Testing strategy. Convenciones vinculantes: skill `heron-architecture`. Cada `Done` termina con `bun run check` completo (formato, lint, typecheck y tests con cobertura).

**Política de calidad del repo (2026-10-01).** El pre-commit corre solo formato, lint, typecheck y los tests de lo staged; `jscpd` y `semgrep` corren en CI en los PR hacia `develop`; `main` corre todo. Por eso el `Done` de cada tarea sigue exigiendo `bun run check` local completo y no se apoya en el pre-commit (`design.md` DR41).

**Decisiones.** No quedan decisiones abiertas: OD1–OD6 las cerró el usuario el 2026-10-01 (`design.md` DR33–DR38). El spike del Lote 1 puede activar un respaldo predeclarado (`design.md` § Spike); si cambia contratos o plantillas, el orquestador reescribe la tarea afectada antes de implementarla (DR44). Si S2 falla, la decisión de cuentas vuelve al usuario antes del Lote 2.

**Dependencias externas (vinculantes).** Lotes 1–6 corren sobre `origin/develop` ≥ `ca38bbf` (P3 T4, T6, T10, T11 y P4 T11–T13 ya integradas). Los Lotes 7–9 esperan a que estén en `develop`: **P3 T12** (proveedor `fake`), **P3 T13** (`AppContext.env`, logger y redactor compuestos, `fixedContext` con agentes), **P3 T15** (pie de `USAGE_TEXT`), **P3 T16** (`heron direction propose|select`) y **P3 T17** (`doctor` con agentes en paralelo). T21 exige además **P3.A12** (direcciones reales sobre `monorepo-fullstack`). Las citas † de `design.md` se ubican por símbolo. Los registros append-only reciben las entradas de P12 al final de lo que haya en `develop` al integrar: la rama que integre segunda hace rebase y `bun run gen:schemas` con deriva cero (C9).

**Fuentes de Penpot.** Un archivo citado como "`<ruta>` del tag 2.17.2" se lee con `gh api 'repos/penpot/penpot/contents/<ruta>?ref=2.17.2' -H 'Accept: application/vnd.github.raw'`.

**Tests sin Penpot real.** Ningún test por default sale de la máquina: `fixedContext` inyecta `refusingGateway` (desde T15); los tests de adapter y de casos de uso pasan `mcpGateway` contra `startFakeMcp` en `127.0.0.1:0`; las plantillas corren contra `FakePenpot`; los scripts de `infra/penpot/` corren contra archivos temporales y un `docker` falso. Las sondas vivas (`tests/live/penpot.live.ts`, `tests/live/penpot-compose.live.ts`) están fuera de `bun test`; todo PR que toque `infra/penpot/` adjunta la salida de `HERON_LIVE_COMPOSE=1 bun run test:live:compose` (DR41).

**Plantillas.** `templates/penpot/*@v1.penpot.js` se pueden corregir en su lugar hasta que se integra T12; desde ese merge quedan congeladas y todo cambio es `@v2` (DR13, DR44).

## Lote 1 — Infraestructura de Penpot, secretos y guía

- [x] **T1** (R1, R2) — Compose oficial vendorizado con su sha256, override sin defaults inseguros, `.env.example`, `fetch-compose`, prueba pura del modelo fusionado y comprobación opt-in con Compose real.
  - **Archivos:** `infra/penpot/fetch-compose`, `infra/penpot/docker-compose.yaml`, `infra/penpot/docker-compose.yaml.sha256`, `infra/penpot/compose.override.yaml`, `infra/penpot/.env.example`, `tests/assets/infra/penpot.synthetic.env`, `tests/helpers/compose.ts`, `tests/infra/penpot-compose.test.ts`, `tests/live/penpot-compose.live.ts`, `package.json`
  - **Interfaces:** loadComposeModel; interpolateCompose; assertPenpotComposeInvariants; ComposeModel; PENPOT_VERSION; PENPOT_SECRET_KEY; PENPOT_DB_PASSWORD; PENPOT_PUBLIC_URI; PENPOT_BIND_ADDRESS; PENPOT_EXTRA_FLAGS; PENPOT_TELEMETRY_ENABLED
  - **Patrón:** tests/repo/ci.test.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR1–DR4, DR35, DR36, DR40, DR41, DR47; § Qué existe › evidencia de Penpot; § Contracts › 1), https://raw.githubusercontent.com/penpot/penpot/2.17.2/docker/images/docker-compose.yaml, https://docs.docker.com/reference/compose-file/merge/, https://bun.com/docs/runtime/yaml, `tests/live/agents.live.ts` (forma de una sonda opt-in)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/infra/penpot-compose.test.ts && bun run check`, esperado exit 0; casos de test "override pins the version, keeps MCP and removes insecure defaults", "fails interpolation without the version or any secret and binds to loopback", "vendored compose matches its recorded sha256 and the fetch script is https-only"; cubre P12.A1. La prueba usa `Bun.YAML` (incluido en Bun 1.4.2), sin dependencia nueva; `penpot-mailcatch` queda con `sj26/mailcatcher:v0.11.0` y `profiles: ["disabled"]`. Comando de P12.A2 `PENPOT_VERSION=2.17.2 infra/penpot/fetch-compose && shasum -a 256 -c infra/penpot/docker-compose.yaml.sha256`, esperado exit 0 con `infra/penpot/docker-compose.yaml: OK` y `git diff --exit-code infra/penpot/` vacío. Evidencia obligatoria en el PR (DR4, Docker requerido por DR40): `HERON_LIVE_COMPOSE=1 bun run test:live:compose`, esperado exit 0, con la versión de Compose impresa y las aserciones de `assertPenpotComposeInvariants` en PASS sobre la salida real de `docker compose config`; script `test:live:compose` = `bun tests/live/penpot-compose.live.ts`.
  - **Depende de:** — (`origin/develop` ca38bbf).
  - **Comparte archivos con:** T2 (`tests/infra/penpot-compose.test.ts`); T11, T12, T14 (`package.json`).
  - **Fuera de alcance:** `init-env`, wrapper `compose` y `.gitignore` (T2); proxy TLS concreto; arranque real (criterio de salida del lote); override para 2.18 (T13).

- [x] **T2** (R21) — Secretos y operación: `init-env` (`.env` una vez, 0600), wrapper `compose` con guardas de permisos y de flags prohibidas, `.gitignore` y sus pruebas.
  - **Archivos:** `infra/penpot/init-env`, `infra/penpot/compose`, `.gitignore`, `tests/infra/penpot-compose.test.ts`
  - **Interfaces:** PENPOT_ENV_FILE; PENPOT_EXTRA_FLAGS
  - **Patrón:** tests/repo/ci.test.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR1, DR39, DR47; § Contracts › 1; § Testing strategy › filas de R21)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/infra/penpot-compose.test.ts && bun run check`, esperado exit 0; casos de test "generates the Penpot secrets once with mode 0600 and keeps them out of Git", "refuses an open env file or insecure extra flags before calling docker"; base de P12.A1. Los scripts son POSIX sh con `set -eu`; `init-env` usa `openssl rand -hex` y `umask 077`; el modo se lee con `ls -ln` (portable macOS/Linux); los tests usan `PENPOT_ENV_FILE` en un directorio temporal y un `docker` falso en `PATH` que deja una marca si se llama. Evidencia en el PR: `HERON_LIVE_COMPOSE=1 bun run test:live:compose` (DR41) e `infra/penpot/compose config --services` con un `.env` generado por `init-env` (lista sin `penpot-mailcatch`; `--services` no imprime secretos).
  - **Depende de:** T1.
  - **Comparte archivos con:** T1 (`tests/infra/penpot-compose.test.ts`).
  - **Fuera de alcance:** secretos de contenedor por `*_FILE`; proxy TLS.

- [x] **T3** (R3, R21) — `docs/penpot.md` (requisitos, instalación con `init-env` y `compose`, cuentas, HTTPS y websocket, `PENPOT_PUBLIC_URI`, MCP y key, configuración de Heron, secretos, fuentes, backups, upgrade, regla de evidencia de `infra/penpot/`, § Versiones) y su test; criterio de salida del lote con el spike.
  - **Archivos:** `docs/penpot.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** PENPOT_URL; PENPOT_MCP_KEY; PENPOT_MCP_KEY_FILE; PENPOT_VERSION
  - **Patrón:** docs/research.md
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR2, DR5, DR8, DR29, DR33, DR35, DR36, DR39–DR43, DR47; § Spike; § Supuestos; § Testing strategy › criterio de salida del Lote 1), https://help.penpot.app/mcp/, https://help.penpot.app/technical-guide/getting-started/docker/, https://help.penpot.app/technical-guide/configuration/
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the Penpot setup, MCP connection, secrets, backups, upgrades and versions"; prepara P12.A7 y P12.A8. § Versiones dice, con fecha, "2.17.2 fijada (D7); sonda de 2.18.x pendiente (T13)". La guía declara Docker 29.4.0 / Compose 5.1.2 (DR40), Chrome y Edge como navegadores soportados (DR42), `PENPOT_URL` y la key solo en el shell (Heron no lee `.env`, DR43), el egreso de Google Fonts y su opt-out (DR36) y que `docker compose` directo se salta las guardas del wrapper (DR47). **Criterio de salida del lote (manual, antes del Lote 2):** el de `design.md` § Testing strategy › criterio de salida del Lote 1, con el spike S1–S8 de § Spike; el PR registra las versiones (Docker, Compose, Chrome), la salida de `test:live:compose`, cada resultado de S1–S8 y el commit de la spec que los asienta en sus DR o activa su respaldo.
  - **Depende de:** T2.
  - **Comparte archivos con:** T13, T20, T21 (`docs/penpot.md`, `tests/repo/docs.test.ts`).
  - **Fuera de alcance:** sección de órdenes `heron penpot` (T20); requisitos de hardware y ensayo de upgrade (P9).

## Lote 2 — Contratos y tablas de estado

- [x] **T4** (R4, R5, R6, R8, R11, R13, R15) — Contrato `PenpotSyncState`, datos de CLI de `penpot`, 22 códigos de finding, 7 ids de checks y 4 órdenes; schemas regenerados.
  - **Archivos:** `src/core/contracts/penpot.ts`, `src/core/contracts/common.ts`, `src/core/contracts/cli-envelope.ts`, `src/core/contracts/version.ts`, `src/core/contracts/index.ts`, `schemas/`, `tests/unit/contracts.test.ts`
  - **Interfaces:** PenpotSyncState; PenpotSyncStateSchema; PENPOT_SYNC_STATE_DOCUMENT; PENPOT_SYNC_SCOPES; PenpotSyncEntry; PenpotFileRef; PenpotLinkData; PenpotInspectData; PenpotSyncData; PenpotPageStatus; PenpotSyncAction; FINDING_CODES; CLI_COMMANDS; DOCTOR_CHECK_IDS
  - **Patrón:** src/core/contracts/directions.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (§ Contracts › 2, 10; DR16, DR31; § Migration), `src/core/contracts/{directions,agents,cli-envelope,common,version,index}.ts`, `scripts/gen-schemas.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/unit/contracts.test.ts tests/repo/schemas.test.ts && bun run check`, esperado exit 0 y deriva cero en `schemas/`; casos de test "round-trips the Penpot sync state and rejects an unknown schemaVersion"; base de P12.A5. Las entradas nuevas van al final de cada registro vigente en `develop`; si P3 integra entradas antes, rebase y `bun run gen:schemas` con deriva cero (C9). `PenpotLinkData` no lleva `url`. Un `project.json` y un `state.json` de P1–P4 siguen validando.
  - **Depende de:** criterio de salida del Lote 1.
  - **Comparte archivos con:** ninguna tarea posterior.
  - **Fuera de alcance:** colector de hechos (T16); uso en CLI (T19).

- [x] **T5** (R15) — `penpot/review-sync.json` en `PHASE_ARTIFACTS` y `ARTIFACT_DEPENDENCIES`.
  - **Archivos:** `src/core/state/stale.ts`, `tests/unit/stale.test.ts`
  - **Interfaces:** PHASE_ARTIFACTS; ARTIFACT_DEPENDENCIES
  - **Patrón:** src/core/state/stale.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR17; § Contracts › 8), `src/core/state/{stale,lifecycle,gates}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/stale.test.ts tests/unit/state-machine.test.ts tests/unit/gates.test.ts && bun run check`, esperado exit 0; casos de test "marks the review sync stale when the directions or the references change"; base de P12.A5. `GATE_BINDINGS` y `transitions.ts` sin cambios.
  - **Depende de:** T4.
  - **Comparte archivos con:** ninguna tarea.
  - **Fuera de alcance:** atar el registro al gate `direction` (P5).

## Lote 3 — Scripts, plantillas y fronteras

- [x] **T6** (R9, R19) — Nodos, registro de plantillas con sha256, renderer único de scripts, las dos plantillas `@v1`, todas las filas de frontera de `src/penpot` y cobertura a 0,9.
  - **Archivos:** `src/penpot/compiler/nodes.ts`, `src/penpot/compiler/templates.ts`, `src/penpot/compiler/script.ts`, `src/penpot/text-modules.d.ts`, `templates/penpot/inspect@v1.penpot.js`, `templates/penpot/review-page@v1.penpot.js`, `tests/unit/penpot/script.test.ts`, `tests/repo/boundaries.test.ts`, `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts`
  - **Interfaces:** PenpotNode; BoardLayout; ReviewPage; ReviewPageKind; CompileIssue; HERON_NAMESPACE; PenpotTemplate; PENPOT_TEMPLATES; penpotTemplate; renderScript; safeJsonLiteral; reviewScriptData; ReviewScriptData; MAX_SCRIPT_BYTES; LAYERS; VENDORS; TOKENS; COVERAGE_RULES
  - **Patrón:** src/agents/prompts.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR11–DR14, DR44–DR46; § Spike con sus resultados asentados; § Contracts › 4 (nodes, templates, script), 5, 12), `.claude/skills/heron-architecture/references/patterns.md` (§ 9, § 10), `src/agents/{prompts,text-modules.d}.ts`, `tests/repo/boundaries.test.ts`, `plugins/libs/plugin-types/index.d.ts` del tag 2.17.2 (`Context`, `Page`, `PluginData`, `FontsContext`, `FlexLayout`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot/script.test.ts tests/repo/boundaries.test.ts tests/repo/coverage-rules.test.ts && bun run check`, esperado exit 0 (incluye que `tsc`, `oxlint` y `oxfmt` acepten los `.penpot.js`); casos de test "registers every Penpot template with its version and sha256", "enforces module boundaries and no navori imports"; base de P12.A4. `tests/repo/boundaries.test.ts` gana exactamente lo de `design.md` § Contracts 12: filas `src/penpot`, `src/penpot/compiler`, `src/penpot/compiler/templates.ts` y `src/penpot/adapters/mcp` en `LAYERS` con su par de ejemplos; `src/app` permite `src/penpot`; fila del SDK en `VENDORS`; fila de pureza del compilador (`Bun.`, `process.`, `Math.random(`) en `TOKENS`; y las dos autocomprobaciones del registro. T6 es la única tarea que edita ese archivo. `src/penpot/` a 0,9. `MAX_SCRIPT_BYTES = 32_768`; el test mide también el cuerpo JSON RPC con contenido escapado y exige < 100 KiB, sin cambiar límites del servidor. `reviewScriptData` es el único constructor del payload de escritura que comparten T9 y T10. Las plantillas no contienen C0 salvo TAB/CR/LF. Implementan las conversiones y guardas de § Adaptación de tipos en las plantillas (API del tag).
  - **Depende de:** criterio de salida del Lote 1 (spike asentado); se integra después del Lote 2.
  - **Comparte archivos con:** T7 (`templates/penpot/*`, `tests/unit/penpot/script.test.ts`).
  - **Fuera de alcance:** páginas concretas (T8, T9); ejecución contra Penpot (T7, T17).

- [x] **T7** (R8, R9, R13, R17) — `FakePenpot` que ejecuta las plantillas como `ExecuteCodeTaskHandler`, prueba de inyección de P12.A4 y pruebas de comportamiento de las plantillas (marcas, formas humanas, intercalado, lectura sin mutar).
  - **Archivos:** `tests/helpers/fake-penpot.ts`, `tests/unit/penpot/script.test.ts`, `tests/unit/penpot/templates.test.ts`, `templates/penpot/inspect@v1.penpot.js`, `templates/penpot/review-page@v1.penpot.js`
  - **Interfaces:** FakePenpot; FakePenpotCounters; runPenpotScript; createFakePenpot
  - **Patrón:** tests/helpers/faulty-fs.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR11, DR14, DR25, DR26, DR29, DR45, DR46; § Spike; § Contracts › 5), `mcp/packages/plugin/src/task-handlers/ExecuteCodeTaskHandler.ts` del tag 2.17.2, `plugins/libs/plugin-types/index.d.ts` del tag 2.17.2
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot && bun run check`, esperado exit 0; casos de test "embeds untrusted strings as JSON data in deterministic scripts", "renders a review page and marks the page and every shape", "rewrites only heron-marked shapes and keeps human shapes", "refuses to rewrite a page whose Heron boards contain human shapes", "leaves the page without a content mark when two writes interleave", "inspects heron pages without mutating the file"; cubre P12.A4. Agrega el caso "selects the exact font family instead of a substring match" (Inter Tight antes de Inter; fuente ausente usa fallback); el doble expone `fonts.all`, variantes y orden natural de hijos. Valida propiedades de texto como cadenas, `resize`, tracks de grid, valores de flex y marcas de cadena; prueba también `createText` devolviendo `null` y la ausencia de marca de contenido tras ese fallo. `FakePenpot` implementa solo la API que usan las plantillas, cuenta lecturas y mutaciones, expone `openPage` con una promesa controlable y cita en cada método el resultado del spike o el tipo de la Plugin API que imita (C10).
  - **Depende de:** T6.
  - **Comparte archivos con:** T6 (`templates/penpot/*`, `script.test.ts`); T10, T11, T17 (`tests/helpers/fake-penpot.ts`, que reutilizan).
  - **Fuera de alcance:** servidor MCP falso (T11).

## Lote 4 — Páginas de revisión y plan

- [x] **T8** (R10, R14) — Página de propuesta por dirección: ids y huellas, copy `en`/`es`, recetas de componentes, composición y layout fijo por sección.
  - **Archivos:** `src/penpot/compiler/ids.ts`, `src/penpot/compiler/copy.ts`, `src/penpot/compiler/components.ts`, `src/penpot/compiler/composition.ts`, `src/penpot/compiler/proposal-page.ts`, `tests/assets/penpot/direction-proposal.json`, `tests/unit/penpot/proposal-page.test.ts`
  - **Interfaces:** proposalPageId; REFERENCES_PAGE_ID; proposalSourceSha256; referencesSourceSha256; contentSha256; PENPOT_COPY; resolvePenpotCopy; componentNodes; compositionNodes; buildProposalPage; PROPOSAL_LAYOUT; CHROME
  - **Patrón:** src/research/render/moodboard.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR12, DR14, DR15, DR23–DR25, DR38; § Contracts › 4 (ids, copy, proposal-page, components, composition)), `src/core/contracts/directions.ts` (`VisualDirection`, `VisualProposal`, `CompositionNodeOutput`), `src/research/directions.ts` (`buildVisualDirections`), `src/research/render/copy.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot/proposal-page.test.ts && bun run check`, esperado exit 0; casos de test "lays out the proposal sections with the same geometry for every direction", "marks sample content SYNTHETIC and resolves unknown references with fallbacks", "writes page copy in the product locale"; base de P12.A5 y P12.A6. El asset se construye con `buildVisualDirections` sobre un `DirectionProposalOutput` SYNTHETIC válido (incluye un nombre con `"); malicious()`).
  - **Depende de:** T6.
  - **Comparte archivos con:** T9 (`ids.ts`, `copy.ts`).
  - **Fuera de alcance:** 2 pantallas representativas por dirección en `full` (P5).

- [x] **T9** (R11, R15, R16) — Página References (solo texto) y plan por huella con estados y registro confirmado; resultados de las plantillas.
  - **Archivos:** `src/penpot/compiler/references-page.ts`, `src/penpot/compiler/plan.ts`, `src/penpot/compiler/ids.ts`, `src/penpot/compiler/copy.ts`, `src/penpot/results.ts`, `tests/unit/penpot/plan.test.ts`, `tests/unit/penpot/references-page.test.ts`
  - **Interfaces:** buildReferencesPage; REFERENCES_LIMITS; reviewScriptData; renderScript; planReviewSync; pageStatuses; reviewRecord; PlannedWrite; ReviewPlan; InspectedFile; InspectedPage; WrittenPage; InspectedFileSchema; WrittenPageSchema
  - **Patrón:** src/research/analysis.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR15, DR16, DR30, DR37, DR45, DR46; § Contracts › 2, 3 (`results.ts`), 4 (references-page, plan)), `src/core/contracts/research.ts` (`ResearchReference`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot/plan.test.ts tests/unit/penpot/references-page.test.ts && bun run check`, esperado exit 0; casos de test "plans writes only for missing or outdated pages and reports duplicates", "builds one text card per active reference within the caps"; base de P12.A5. `plan.ts` importa de `results.ts` solo tipos (`import type`, lo exige la fila de T6); una página con `content` vacío es `outdated`. `buildReferencesPage` recibe `PenpotTemplate` completo y elige el prefijo mayor que pase `renderScript` usando `reviewScriptData` y reserva UUID de 36 caracteres. Agrega caso "fits the longest deterministic reference prefix into the script byte budget" con Unicode, barras invertidas, textos de máxima longitud, omisiones exactas y mismo resultado entre creación y reescritura; si ni la cabecera cabe, el render final falla sin escribir (DR11/DR30).
  - **Depende de:** T4 (`PenpotSyncState`), T8.
  - **Comparte archivos con:** T8 (`ids.ts`, `copy.ts`); T10 (`results.ts` por import).
  - **Fuera de alcance:** imágenes en las tarjetas (DR37).

## Lote 5 — Puerto, sesión, adapter MCP y sonda viva

- [x] **T10** (R4, R8, R13, R17) — Puerto `PenpotGateway`/`PenpotCodeRunner`/`PenpotSession`, validación pura de `PENPOT_URL` y endpoint, versiones probadas y sesión `inspect`/`apply` con el parseo de resultados.
  - **Archivos:** `src/penpot/ports.ts`, `src/penpot/config.ts`, `src/penpot/compatibility.ts`, `src/penpot/session.ts`, `tests/unit/penpot/config.test.ts`, `tests/unit/penpot/session.test.ts`
  - **Interfaces:** PenpotGateway; PenpotCodeRunner; PenpotConnectRequest; PenpotConnectOutcome; PenpotExecution; PenpotFailure; PenpotFailureKind; PenpotSession; SessionResult; parsePenpotUrl; mcpEndpoint; PENPOT_TESTED_VERSIONS; isTestedVersion; parseExecuteText; openPenpotSession
  - **Patrón:** src/agents/ports.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR5, DR7, DR9, DR10, DR22, DR45, DR46; § Contracts › 3), `src/penpot/results.ts`, `src/security/ssrf.ts` (`classifyAddress`, `LOCAL_ALLOWABLE_RANGES`), `mcp/packages/server/src/{Tool,ToolResponse,PluginBridge}.ts` y `tools/ExecuteCodeTool.ts` del tag 2.17.2
  - **Librerías:** zod@4.6.5
  - **Done:** comando `bun test tests/unit/penpot/config.test.ts tests/unit/penpot/session.test.ts && bun run check`, esperado exit 0; casos de test "accepts https or loopback http Penpot URLs without credentials, query or fragment", "parses template results and maps execution failures"; base de P12.A3 y P12.A5. `config.test.ts` incluye `http://[::1]:9001`, `http://127.0.0.2:9001`, `https://10.0.0.5` (aceptadas) y `https://169.254.169.254`, `https://0.0.0.0`, `…/mcp/stream` (rechazadas). La sesión se prueba con un `PenpotCodeRunner` falso que ejecuta los scripts en `FakePenpot`; `outcome: "conflict"` → `script-failed` con el detalle fijo de DR45.
  - **Depende de:** T7, T9.
  - **Comparte archivos con:** T9 (`results.ts` por import); T11 (`ports.ts`, `config.ts` por import); T13 (`compatibility.ts`).
  - **Fuera de alcance:** transporte MCP (T11); lectura del entorno (T15).

- [x] **T11** (R4, R6, R7, R17, R19) — Adapter `mcp` sobre el SDK con `mcpFetch`, clasificación de fallas y redacción (también de errores de transporte); registro `defaultPenpotGateway`; servidor MCP falso.
  - **Archivos:** `src/penpot/adapters/mcp/index.ts`, `src/penpot/registry.ts`, `src/security/fetch/system.ts`, `package.json`, `bun.lock`, `tests/helpers/fake-mcp.ts`, `tests/unit/penpot/mcp-adapter.test.ts`
  - **Interfaces:** mcpGateway; defaultPenpotGateway; mcpFetch; McpFetch; startFakeMcp; FakeMcpOptions; FakeMcpServer
  - **Patrón:** src/research/adapters/url/index.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR5–DR8, DR10, DR26, DR34; § Contracts › 3 (registry), 6, 12), `src/research/registry.ts`, `src/security/fetch/system.ts`, `src/security/redact.ts`, https://help.penpot.app/mcp/; primer paso de la tarea: `bun add --exact @modelcontextprotocol/sdk@1.31.0`, y después `node_modules/@modelcontextprotocol/sdk/dist/esm/client/{index,streamableHttp}.d.ts` y `node_modules/@modelcontextprotocol/sdk/dist/esm/server/{mcp,webStandardStreamableHttp}.d.ts`
  - **Librerías:** @modelcontextprotocol/sdk@1.31.0
  - **Done:** comando `bun install --frozen-lockfile && bun test tests/unit/penpot/mcp-adapter.test.ts tests/repo/boundaries.test.ts && bun run check`, esperado exit 0; casos de test "runs execute_code over streamable HTTP with the userToken only in the request URL", "classifies missing plugin, rejected key, timeouts, unknown formats and script errors", "redacts the key from transport errors of an unreachable endpoint"; base de P12.A3. Versión exacta en `package.json` y `trustedDependencies` sigue vacío. El adapter importa solo `@modelcontextprotocol/sdk/client/index.js` y `/client/streamableHttp.js`; `src/penpot/registry.ts` es su único importador; las filas de T6 lo verifican sin editar `boundaries.test.ts`. `TOKENS` de `fetch(` sigue limitado a `src/security/fetch/system.ts`. Tests con servidor HTTP real con timeout explícito (≥ 10 000 ms) y la razón.
  - **Depende de:** T10.
  - **Comparte archivos con:** T10 (`ports.ts` por import); T1, T12, T14 (`package.json`).
  - **Fuera de alcance:** caso de uso, entorno y redactor compuesto (T15).

- [x] **T12** (R18, R20) — Sonda viva opt-in contra un Penpot real con el código de Heron; su merge congela las plantillas `@v1`.
  - **Archivos:** `tests/live/penpot.live.ts`, `package.json`, `tests/repo/live-penpot.test.ts`
  - **Interfaces:** mcpGateway; openPenpotSession; planReviewSync
  - **Patrón:** scripts/check-coverage.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (§ Spike; § Supuestos y [SIN VERIFICAR]; DR10, DR14, DR22, DR25, DR26, DR44–DR46), `docs/penpot.md`, `tests/live/agents.live.ts` (sonda opt-in de P3, en `develop` `ca38bbf`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/live-penpot.test.ts && bun run check`, esperado exit 0 (las sondas no las recoge `bun test`); casos de test "keeps the live Penpot probe out of the default test run"; prepara P12.A7 y P12.A8; script `test:live:penpot` = `bun tests/live/penpot.live.ts`. **Criterio de salida del lote (manual):** con `PENPOT_URL=http://localhost:9001` y la key exportadas, `HERON_LIVE_PENPOT=1 bun run test:live:penpot -- --file-id <uuid de un archivo de prueba>` contra el Penpot 2.17.2 del Lote 1 confirma con el código de Heron: handshake y `execute_code`, formato `{ result, log }` y de errores, respuesta a una key equivocada, formato de `penpot.version`, marcas en páginas no activas, `fonts.findByName`, un script de 32 KiB con contenido escapado (el cuerpo JSON también se mide), que una forma humana dentro de un tablero de Heron bloquea la reescritura y sobrevive, y que una segunda escritura planeada da 0 escrituras. Una diferencia con el spike se corrige en su DR y en la plantilla antes del merge; al integrarse T12 las plantillas `@v1` quedan congeladas.
  - **Depende de:** T11, criterio de salida del Lote 1.
  - **Comparte archivos con:** T1, T11, T14 (`package.json`); T15 (`tests/repo/live-penpot.test.ts`); T13 (la sonda se reutiliza para 2.18.x).
  - **Fuera de alcance:** limpiar el archivo de prueba (se usa uno desechable).

## Lote 6 — Sonda de versión y lanzador

- [x] **T13** (R18) — Sonda de 2.18.x contra #12003 y aceptación manual de P12.A7.
  - **Archivos:** `docs/penpot.md`, `src/penpot/compatibility.ts`, `tests/repo/docs.test.ts`
  - **Interfaces:** PENPOT_TESTED_VERSIONS; isTestedVersion
  - **Patrón:** docs/research.md
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR22, DR32; § Hallazgos para el orquestador; § Testing strategy › P12.A7), https://github.com/penpot/penpot/releases, https://github.com/penpot/penpot/issues/12003
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the Penpot setup, MCP connection, secrets, backups, upgrades and versions"; cubre P12.A7 (manual). `docs/penpot.md` § Versiones registra fecha, versión 2.18.x probada, resultado de la sonda viva y versión fijada; `PENPOT_TESTED_VERSIONS` coincide (cambia solo si se sube, y entonces T1 se rehace para el override de 2.18 y se repite el spike antes del Lote 7); el usuario responde "Aprobado". La evidencia se registra con `navori master part P12 --accept A7 … --approved-by user`.
  - **Depende de:** T12.
  - **Comparte archivos con:** T3, T20, T21 (`docs/penpot.md`, `tests/repo/docs.test.ts`); T10 (`compatibility.ts`); T12 (sonda).
  - **Fuera de alcance:** subir la versión si #12003 sigue abierto (D7).

- [x] **T14** (R22) — Lanzador sin `.env` ni `bunfig.toml` del directorio de trabajo y su test. El arreglo del lanzador ya se integró por separado en `c4d1f40` (PR #16); este lote verifica el contrato completo y refuerza la prueba de versión y el script npm.
  - **Archivos:** `bin/heron.ts`, `package.json`, `tests/repo/launcher.test.ts`
  - **Interfaces:** runCli
  - **Patrón:** tests/repo/ci.test.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR33, DR43; § Contracts › 1 (lanzador); § Qué existe › fila de Bun), https://bun.com/docs/runtime/environment-variables
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/launcher.test.ts && bun run check`, esperado exit 0; casos de test "starts heron without the working directory's .env or bunfig.toml"; base de P12.A3. Primera línea de `bin/heron.ts` = `#!/usr/bin/env -S bun --no-env-file --config=/dev/null` (modo 100755 intacto); `scripts.heron` = `bun --no-env-file --config=/dev/null bin/heron.ts`. El test ejecuta `bin/heron.ts --version` con `Bun.spawn` desde un directorio temporal con `.env` y un `bunfig.toml` cuyo `preload` escribe una marca, y exige exit 0, la versión de Heron en stdout y la marca ausente.
  - **Depende de:** — (sin dependencias; el orquestador puede integrarla antes como arreglo propio, § Hallazgos).
  - **Comparte archivos con:** T1, T11, T12 (`package.json`).
  - **Fuera de alcance:** el resto de la configuración por entorno (T15).

## Lote 7 — Contexto y casos de uso

- [x] **T15** (R4, R7, R19) — `AppContext.penpot`, `PENPOT_URL` y key solo del entorno, aviso de permisos del archivo de la key, vínculo y redactor, `withPenpotSession`, evento `penpot.error` y `refusingGateway` en `fixedContext`.
  - **Archivos:** `src/app/context.ts`, `src/app/penpot-config.ts`, `src/app/penpot-session.ts`, `src/security/logger.ts`, `src/core/store/fs-port.ts`, `tests/helpers/cli.ts`, `tests/unit/app/penpot-config.test.ts`, `tests/unit/app-context.test.ts`, `tests/repo/live-penpot.test.ts`
  - **Interfaces:** PenpotServices; AppContext; createDefaultContext; resolvePenpotUrl; resolvePenpotKey; readPenpotLink; PenpotLink; penpotRedactor; withPenpotSession; LOG_EVENT_NAMES; FileStat; refusingGateway; fixedContext
  - **Patrón:** src/app/write-run.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR7, DR8, DR19, DR26, DR28, DR31, DR33, DR39; § Contracts › 2 (`FileStat`), 7 (context, penpot-config, penpot-session), 10), `src/app/{context,write-run,result}.ts`, `src/security/{redact,logger}.ts`, `src/core/store/fs-port.ts`, `tests/helpers/cli.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/app tests/unit/app-context.test.ts tests/repo/live-penpot.test.ts && bun run check`, esperado exit 0; casos de test "resolves the Penpot URL and the MCP key only from the environment and warns on an open key file", "keeps real Penpot connections out of the default test run" (caso nuevo en el archivo de T12); base de P12.A3. `createDefaultContext` importa `defaultPenpotGateway` de `src/penpot/registry.ts` (nunca de `adapters/`); `FileStat.mode` es aditivo; `LOG_EVENT_NAMES` + `"penpot.error"` al final de lo vigente en `develop` (rebase si hace falta, C9).
  - **Depende de:** T11, T12, T14, P3 T13.
  - **Comparte archivos con:** T16, T17 (`src/app/penpot-session.ts` y `penpot-config.ts` por uso).
  - **Fuera de alcance:** `doctor` (T18).

- [ ] **T16** (R4, R5, R8, R15) — `heron penpot link` (solo `fileId`) e `inspect` como casos de uso, hecho `penpotProposalsWritten` y su uso en `gateFacts`.
  - **Archivos:** `src/app/penpot.ts`, `src/app/facts.ts`, `src/app/gate.ts`, `tests/helpers/penpot.ts`, `tests/unit/app/penpot-facts.test.ts`, `tests/unit/penpot/inspect.test.ts`
  - **Interfaces:** runPenpotLink; PenpotLinkInput; runPenpotInspect; PenpotInspectInput; collectPenpotFacts; directionsWorkspace; linkedWorkspace; CANARY_MCP_KEY; penpotEnv
  - **Patrón:** src/app/references.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR18, DR19, DR22, DR33; § Contracts › 7 (penpot, facts)), `src/app/{facts,gate,references,workspace}.ts`, `src/app/directions.ts`† (P3 T16)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/app/penpot-facts.test.ts tests/unit/penpot/inspect.test.ts tests/e2e/gate.test.ts && bun run check`, esperado exit 0; casos de test "counts proposal pages written for the current directions in the bound file", "links the bound file and reports page statuses read-only"; base de P12.A3 y P12.A8. `runPenpotLink` escribe `penpot = { enabled: true, url: null, fileId, version: null }`. `tests/e2e/gate.test.ts` sigue verde (DR18). `directionsWorkspace` produce `visual-directions.json` con `heron direction propose` y el proveedor `fake`.
  - **Depende de:** T15, P3 T16.
  - **Comparte archivos con:** T17 (`tests/helpers/penpot.ts`); T19 (e2e de `link` e `inspect`).
  - **Fuera de alcance:** verificación en vivo de `doctor` al aprobar el gate `direction` (P5).

- [ ] **T17** (R10–R17) — `heron penpot sync` como caso de uso: fuentes, plan, escrituras por página, relectura, registro, corrida parcial, formas humanas y escritura tardía.
  - **Archivos:** `src/app/penpot-sync.ts`, `tests/helpers/penpot.ts`, `tests/unit/penpot/proposals.test.ts`
  - **Interfaces:** runPenpotSync; PenpotSyncInput
  - **Patrón:** src/app/references.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR15–DR20, DR29, DR30, DR45, DR46; § Recomendación; § Contracts › 7 (penpot-sync); § Failure modes), `src/app/{write-run,workspace}.ts`, `src/core/state/lifecycle.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot/proposals.test.ts && bun run check`, esperado exit 0; casos de test "writes one idempotent page per direction with its visual proposal", "marks proposal pages reference-only and writes no production artifacts", "refuses to write into a file other than the bound one", "stops at a failed page and converges on the next run", "converges after a write timeout whose script finishes late"; cubre P12.A5 y P12.A6. La segunda corrida: 0 scripts de escritura, 1 lectura y `hashTree(.heron)` igual.
  - **Depende de:** T16.
  - **Comparte archivos con:** T16 (`tests/helpers/penpot.ts`).
  - **Fuera de alcance:** sync del sistema y drift (P6).

## Lote 8 — Diagnóstico y CLI

- [ ] **T18** (R6, R7) — `heron penpot doctor` (7 checks) y checks de Penpot en `heron doctor` (en paralelo con los de agentes, solo con vínculo).
  - **Archivos:** `src/app/penpot-doctor.ts`, `src/app/doctor.ts`, `tests/unit/penpot/doctor.test.ts`, `tests/e2e/doctor.test.ts`
  - **Interfaces:** penpotChecks; runPenpotDoctor; DOCTOR_CHECK_IDS
  - **Patrón:** src/app/doctor.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR10, DR21, DR22, DR39; § Contracts › 7 (penpot-doctor), 9 (doctor)), `src/app/doctor.ts`† (P3 T17 `agentChecks`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/penpot/doctor.test.ts tests/e2e/doctor.test.ts && bun run check`, esperado exit 0; casos de test "fails fast without plugin and never leaks the MCP key", "reports a rejected key, another file and an untested version with remedies", "shows Penpot checks only for a linked workspace"; cubre P12.A3. `doctor` sigue sin escribir (`hashTree` igual); tras el rebase sobre P3 T17, `bun run gen:schemas` sin deriva (C9).
  - **Depende de:** T17, P3 T17.
  - **Comparte archivos con:** ninguna tarea posterior.
  - **Fuera de alcance:** check de Penpot dentro de `heron gate direction approve` (P5).

- [ ] **T19** (R4, R5, R6, R8, R11, R16) — Grupo `heron penpot` (`link`, `doctor`, `inspect`, `sync`) en la CLI, render de texto, pie de uso y órdenes permitidas en `status`.
  - **Archivos:** `src/cli/commands/penpot.ts`, `src/cli/commands/index.ts`, `src/cli/command.ts`, `src/cli/main.ts`, `src/cli/args.ts`, `src/cli/render-penpot.ts`, `src/app/status.ts`, `tests/e2e/penpot.test.ts`, `tests/unit/cli-args.test.ts`, `tests/e2e/status.test.ts`
  - **Interfaces:** penpotCommand; PenpotParsed; renderPenpotLinkText; renderPenpotInspectText; renderPenpotSyncText; USAGE_TEXT; allowedCommands
  - **Patrón:** src/cli/commands/research.ts
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR33; § Contracts › 9, 10; § Migration (aserciones que cambian)), `src/cli/{command,main,args}.ts`, `src/cli/commands/{research,index}.ts`, `src/cli/render-research.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/penpot.test.ts tests/unit/cli-args.test.ts tests/e2e/status.test.ts && bun run check`, esperado exit 0; casos de test "links the connected file and refuses a URL that carries a userToken", "never sends the key to a URL stored in the workspace", "inspects the managed pages read-only", "previews the plan with --dry-run without writing", "syncs the References page as text cards marked with the mode"; base de P12.A8. `--json` valida contra `CliEnvelopeSchema`; `link --url` sale con 2; tras el rebase sobre P3 T15–T17, registros al final y `bun run gen:schemas` sin deriva (C9).
  - **Depende de:** T18, P3 T15–T17.
  - **Comparte archivos con:** ninguna tarea posterior.
  - **Fuera de alcance:** vista web (P8).

## Lote 9 — Documentación y aceptación

- [ ] **T20** (R3, R19) — ADR 0007, `docs/penpot.md` completa con las órdenes `heron penpot`, secciones de arquitectura, seguridad y README, y skill actualizada.
  - **Archivos:** `docs/adr/0007-penpot-boundary.md`, `docs/penpot.md`, `docs/architecture.md`, `docs/security.md`, `README.md`, `.claude/skills/heron-architecture/references/layout.md`, `.claude/skills/heron-architecture/references/patterns.md`, `.claude/skills/heron-architecture/references/recipes.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** mcpGateway; defaultPenpotGateway; renderScript; PENPOT_TEMPLATES; PENPOT_TESTED_VERSIONS
  - **Patrón:** docs/adr/0003-research-source-boundary.md
  - **Lectura:** `specs/0005-penpot-base/design.md` (§ Approach; § Decisions; § Conocimiento durable; § Fuentes consultadas), `docs/{architecture,security,penpot}.md`, `README.md`, `.claude/skills/heron-architecture/references/{layout,patterns,recipes}.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "records the Penpot boundary ADR and the Penpot sections of the docs", "documents the Penpot setup, MCP connection, secrets, backups, upgrades and versions"; prepara P12.A8.
  - **Depende de:** T19.
  - **Comparte archivos con:** T3, T13, T21 (`docs/penpot.md`, `tests/repo/docs.test.ts`).
  - **Fuera de alcance:** guía de self-host de Heron (P9).

- [ ] **T21** (R20) — Aceptación manual de P12.A8 sobre `monorepo-fullstack` y su registro con fecha en `docs/penpot.md`.
  - **Archivos:** `docs/penpot.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** PENPOT_TESTED_VERSIONS
  - **Patrón:** docs/research.md
  - **Lectura:** `specs/0005-penpot-base/design.md` (DR38, DR42; § Testing strategy › P12.A8), `docs/penpot.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the Penpot setup, MCP connection, secrets, backups, upgrades and versions"; cubre P12.A8 (manual): recorrido de `design.md` § Testing strategy › P12.A8 sobre `monorepo-fullstack`, incluida la comparación lado a lado en tres ventanas (DR38); `docs/penpot.md` § Versiones suma, con fecha, "2.17.2 verificada con Heron sobre monorepo-fullstack (P12.A8)"; el usuario responde "Aprobado". La evidencia se registra con `navori master part P12 --accept A8 … --approved-by user`.
  - **Depende de:** T20, T13, P3.A12.
  - **Comparte archivos con:** T3, T13, T20 (`docs/penpot.md`, `tests/repo/docs.test.ts`).
  - **Fuera de alcance:** las 2 pantallas representativas en `full` (P5).

## Cobertura

**Criterios → requisitos → tareas**

| Criterio | Método | Requisitos | Tareas |
|---|---|---|---|
| P12.A1 | test | R1, R2, R21 | T1, T2 |
| P12.A2 | comando | R2 | T1 |
| P12.A3 | test | R4, R5, R6, R7, R22 | T10, T11, T14, T15, T16, T18, T19 |
| P12.A4 | test | R9, R16, R19 | T6, T7, T9, T11, T20 |
| P12.A5 | test | R8, R10, R11, R12, R13, R15, R17 | T4, T5, T7, T8, T9, T10, T16, T17, T19 |
| P12.A6 | test | R14, R16 | T8, T9, T17, T19 |
| P12.A7 | manual | R3, R18 | T3, T12, T13 |
| P12.A8 | manual | R3, R5, R19, R20 | T3, T12, T16, T20, T21 |

**Requisitos → tareas:** R1 T1, T2 · R2 T1 · R3 T3, T20 · R4 T4, T10, T11, T15, T19 · R5 T4, T16, T19 · R6 T4, T11, T18, T19 · R7 T11, T15, T18 · R8 T4, T7, T10, T16, T19 · R9 T6, T7 · R10 T8, T17 · R11 T4, T9, T17, T19 · R12 T17 · R13 T4, T7, T10, T17 · R14 T8, T17 · R15 T4, T5, T9, T16, T17 · R16 T9, T17, T19 · R17 T7, T10, T11, T17 · R18 T3, T12, T13 · R19 T6, T11, T15, T20 · R20 T12, T21 · R21 T2, T3 · R22 T14.

**Components de `design.md` → tareas** (toda fila de § Components está en el campo **Archivos** de al menos una tarea)

| Componente | Tarea |
|---|---|
| `infra/penpot/{fetch-compose,docker-compose.yaml,docker-compose.yaml.sha256,compose.override.yaml,.env.example}` | T1 |
| `infra/penpot/{init-env,compose}`, `.gitignore` | T2 |
| `bin/heron.ts` | T14 |
| `docs/penpot.md` | T3, T13, T20, T21 |
| `docs/adr/0007-penpot-boundary.md`, `docs/{architecture,security}.md`, `README.md` | T20 |
| `src/core/contracts/{penpot,common,cli-envelope,version,index}.ts`, `schemas/` | T4 |
| `src/core/state/stale.ts` | T5 |
| `src/core/store/fs-port.ts` | T15 |
| `src/penpot/text-modules.d.ts`, `src/penpot/compiler/{nodes,templates,script}.ts`, `templates/penpot/{inspect,review-page}@v1.penpot.js` | T6 (plantillas también en T7) |
| `src/penpot/compiler/{ids,copy,components,composition,proposal-page}.ts` | T8 (`ids.ts` y `copy.ts` también en T9) |
| `src/penpot/compiler/{references-page,plan}.ts`, `src/penpot/results.ts` | T9 |
| `src/penpot/{ports,config,compatibility,session}.ts` | T10 (y `compatibility.ts` en T13) |
| `src/penpot/adapters/mcp/index.ts`, `src/penpot/registry.ts`, `src/security/fetch/system.ts` | T11 |
| `src/security/logger.ts` | T15 |
| `src/app/{context,penpot-config,penpot-session}.ts` | T15 |
| `src/app/{penpot,facts,gate}.ts` | T16 |
| `src/app/penpot-sync.ts` | T17 |
| `src/app/{penpot-doctor,doctor}.ts` | T18 |
| `src/app/status.ts`, `src/cli/commands/{penpot,index}.ts`, `src/cli/{command,main,args,render-penpot}.ts` | T19 |
| `tests/repo/boundaries.test.ts` | T6 |
| `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts` | T6 |
| `package.json` | T1 (`test:live:compose`), T11 (SDK), T12 (`test:live:penpot`), T14 (`heron`) |
| `bun.lock` | T11 |
| `tests/helpers/compose.ts`, `tests/assets/infra/penpot.synthetic.env`, `tests/live/penpot-compose.live.ts` | T1 |
| `tests/infra/penpot-compose.test.ts` | T1, T2 |
| `tests/helpers/fake-penpot.ts` | T7 |
| `tests/helpers/fake-mcp.ts` | T11 |
| `tests/helpers/penpot.ts` | T16, T17 |
| `tests/helpers/cli.ts` | T15 |
| `tests/assets/penpot/direction-proposal.json` | T8 |
| `tests/repo/launcher.test.ts` | T14 |
| `tests/live/penpot.live.ts` | T12 |
| `.claude/skills/heron-architecture/references/{layout,patterns,recipes}.md` | T20 |
