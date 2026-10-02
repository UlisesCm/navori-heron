# 0003 Agentes y direcciones visuales reference-only — Tasks

Lotes de 1–3 tareas, **en serie** (cada tarea declara de qué depende y con quién comparte archivos; no se paralelizan tareas que comparten archivos). Cada test lleva `// Covers: R<n>` y usa el nombre exacto del caso de `design.md` § Testing strategy. Convenciones vinculantes: skill `heron-architecture`.

**Dependencia externa (vinculante): T0 de 0004.** 0003 se implementa sobre `origin/develop` con 0004 integrada y, antes que nada, con la **T0 de 0004** (`specs/0004-product-context/tasks.md` › Lote 0). Esa tarea crea `freshen(state, paths)` en `src/core/state/lifecycle.ts`, con su caso `tests/unit/lifecycle.test.ts#freshens regenerated artifacts and marks their dependents stale`. También deriva de los registros las aserciones de `contracts.test.ts`, `cli-args.test.ts`, `status.test.ts` y `doctor.test.ts`, y reserva los ADR 0002/0005 para P3 y 0006 para P4 (`design.md` DR17, DR31). 0003 **no** reimplementa la T0 ni tiene helper propio de limpieza de `stale`: llama `freshen` (T15, T16) y solo agrega entradas a los registros. Las citas † de `design.md` se ubican por símbolo.

**Tests sin agentes reales.** Ningún test por default lanza un CLI real: `fixedContext` inyecta `refusingRunner` y solo el proveedor `fake` (DR30); los tests de adapters pasan `bunProcessRunner` y binarios de `writeFakeAgentBin`. La sonda viva es `tests/live/agents.live.ts` (fuera de `bun test`). Cada `Done` termina con `bun run typecheck && bun test` completo.

**Decisiones del usuario (2026-10-01):** DR35 (suscripción, `CLAUDE_CODE_OAUTH_TOKEN` sí, rutas de nube no, mínimo 2.1.259 + sonda de capacidades), DR36 (sin modelo por default), DR37 (análisis solo con texto), DR38 (sin tope duro). Economía de tokens: R19–R21, DR39–DR45.

## Lote 1 — Términos de uso

- [ ] **T1** (R17) — `docs/agent-providers.md` §Términos con fuentes, fechas y la conclusión de DR35 (P3.A11), y su test.
  - **Archivos:** `docs/agent-providers.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** DR35; AGENT_API_KEY_VARS; AGENT_ROUTE_VARS
  - **Patrón:** docs/research.md
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Decisiones del usuario; DR35, DR38; §Fuentes consultadas), https://www.anthropic.com/legal/consumer-terms, https://code.claude.com/docs/en/legal-and-compliance, https://code.claude.com/docs/en/authentication, https://platform.openai.com/docs/codex/non-interactive-mode
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "records the subscription terms with sources and dates"; prepara P3.A11 (el usuario lee §Términos y responde "Aprobado"). Re-intentar la página de términos de OpenAI; si sigue sin estar disponible, queda `[SIN VERIFICAR]` con la fecha.
  - **Depende de:** T0 de 0004.
  - **Comparte archivos con:** T18 (`docs/agent-providers.md`, `tests/repo/docs.test.ts`).
  - **Fuera de alcance:** el resto de `docs/agent-providers.md` y los ADR (T2, T18).

## Lote 2 — Zonas de escritura y primitivas de seguridad

- [ ] **T2** (R1, R15, R17, R21) — `TempDirPort`, sink append-only de logs con poda y lectura, `FsPort` con `"a"` y ADR 0002.
  - **Archivos:** `src/core/store/temp-dir.ts`, `src/core/store/append-log.ts`, `src/core/store/fs-port.ts`, `tests/helpers/faulty-fs.ts`, `tests/unit/store/temp-dir.test.ts`, `tests/unit/store/append-log.test.ts`, `tests/repo/boundaries.test.ts`, `docs/adr/0002-store-write-zones.md`
  - **Interfaces:** TempDirPort; TempWorkspace; nodeTempDirs; openAppendLog; pruneLogs; readLogEvents; LogSink
  - **Patrón:** src/core/store/fs-port.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 1; DR16, DR45; §Failure modes), `.claude/skills/heron-architecture/SKILL.md` (Zonas de escritura), `src/core/store/{fs-port,atomic,file-store}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/store tests/repo/boundaries.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "creates private empty directories and disposes them", "appends JSONL lines and prunes files older than the retention", "enforces module boundaries and no navori imports"; base de P3.A1 (cwd vacío) y P3.A5 (logs). `LAYERS` de `src/core/store` acepta `node:os` y `VENDORS` lo limita a `src/app/context.ts` y `src/core/store/temp-dir.ts`.
  - **Depende de:** T0 de 0004.
  - **Comparte archivos con:** T6, T8, T10 (`tests/repo/boundaries.test.ts`).
  - **Fuera de alcance:** logger y redacción (T3); `ExportWriter` (P5).

- [ ] **T3** (R2, R6, R15) — Entorno del hijo por lista blanca (DR35), redactor por valor cargado y logger JSONL.
  - **Archivos:** `src/security/env.ts`, `src/security/redact.ts`, `src/security/logger.ts`, `tests/unit/security/env.test.ts`, `tests/unit/security/logger.test.ts`, `tests/unit/security/redact.test.ts`
  - **Interfaces:** buildAgentEnv; AGENT_ENV_ALLOWLIST; AGENT_API_KEY_VARS; AGENT_ROUTE_VARS; createValueRedactor; Redactor; createLogger; Logger; nullLogger; LOG_EVENT_NAMES
  - **Patrón:** src/security/redact.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 2; DR14, DR16, DR23, DR35), `src/security/{redact,untrusted}.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/security && bun run typecheck && bun test`, esperado exit 0; casos de test "builds the child environment from the allowlist only", "redacts loaded secret values by key and by value before any sink"; base de P3.A5.
  - **Depende de:** T0 de 0004.
  - **Comparte archivos con:** ninguna tarea.
  - **Fuera de alcance:** sink a stderr y eventos de P9.

## Lote 3 — Contratos y estado

- [x] **T4** (R6, R7, R9, R10, R11, R12, R13, R14, R19, R21) — Contratos de agentes y direcciones (con claves de cache y uso de tokens), datos de CLI, `HeronProject.agents` perezoso, findings y envelope; schemas regenerados.
  - **Archivos:** `src/core/contracts/agents.ts`, `src/core/contracts/directions.ts`, `src/core/contracts/agents-data.ts`, `src/core/contracts/heron-project.ts`, `src/core/contracts/common.ts`, `src/core/contracts/cli-envelope.ts`, `src/core/contracts/version.ts`, `src/core/contracts/index.ts`, `schemas/`, `tests/unit/contracts.test.ts`
  - **Interfaces:** AgentSettingsInput; AgentSettingsInputSchema; AgentUsage; AgentRun; AGENT_RUN_DOCUMENT; AgentRunRef; ResearchBrief; RESEARCH_BRIEF_DOCUMENT; ResearchAnalysis; RESEARCH_ANALYSIS_DOCUMENT; VisualDirections; VISUAL_DIRECTIONS_DOCUMENT; ResearchBriefOutput; ResearchAnalysisOutput; DirectionProposalOutput; ProbeOutput; RESEARCH_FACETS; AGENT_PROVIDER_IDS; PACK_ITEM_KINDS; MODEL_NAME_PATTERN; AgentRunSummary; AgentUsageSummary
  - **Patrón:** src/core/contracts/research.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 4, 5, 12, 14; DR13, DR21, DR32, DR39, DR45; §Migration), `src/core/contracts/**`, `scripts/gen-schemas.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun run gen:schemas && bun test tests/unit/contracts.test.ts tests/repo/schemas.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "round-trips the agent documents and rejects an unknown schemaVersion"; base de P3.A5, P3.A7 y P3.A10. `directions.ts` importa de `agents.ts` y nunca al revés (DR32); un `project.json` de P1/P2/P4 sigue validando.
  - **Depende de:** T0 de 0004.
  - **Comparte archivos con:** ninguna tarea posterior.
  - **Fuera de alcance:** validadores de dominio (T6, T7); conversión a JSON Schema por proveedor (T8).

- [x] **T5** (R10, R11) — Hecho `researchApprovalValid` en `three-valid-directions`, artefactos y dependencias de `brief.json`/`analysis.json`, hechos de direcciones.
  - **Archivos:** `src/core/state/transitions.ts`, `src/core/state/stale.ts`, `src/app/facts.ts`, `tests/unit/state-machine.test.ts`, `tests/unit/stale.test.ts`, `tests/unit/app/facts.test.ts`
  - **Interfaces:** TransitionFacts; collectDirectionFacts; PHASE_ARTIFACTS; ARTIFACT_DEPENDENCIES
  - **Patrón:** src/core/state/transitions.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 11; DR17, DR18, DR19, DR28, DR34), `src/core/state/{transitions,stale,lifecycle,gates}.ts`, `src/app/facts.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/state-machine.test.ts tests/unit/stale.test.ts tests/unit/app/facts.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "requires a valid research approval to propose directions", "marks directions stale when the brief or the analysis changes"; base de P3.A7. `SATISFIED` gana `researchApprovalValid: true`. No toca `lifecycle.ts`: `freshen` es de la T0 de 0004.
  - **Depende de:** T4.
  - **Comparte archivos con:** ninguna tarea posterior.
  - **Fuera de alcance:** casos de uso que usan los hechos (T13, T16).

## Lote 4 — Dominio puro

- [x] **T6** (R11, R12, R13) — Contraste WCAG 2.2 en `src/tokens/` y validador/constructor de direcciones.
  - **Archivos:** `src/tokens/contrast.ts`, `src/research/directions.ts`, `src/research/layout.ts`, `tests/unit/tokens/contrast.test.ts`, `tests/unit/research/directions.test.ts`, `tests/repo/boundaries.test.ts`, `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts`
  - **Interfaces:** contrastRatio; checkContrast; parseHexColor; CONTRAST_THRESHOLDS; ContrastCheck; validateDirectionsOutput; buildVisualDirections; selectDirection; DIRECTION_LIMITS
  - **Patrón:** src/research/provenance.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 3, 10 (directions); DR3, DR11, DR12, DR33)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/tokens tests/unit/research/directions.test.ts tests/repo/boundaries.test.ts tests/repo/coverage-rules.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "computes WCAG 2.2 contrast ratios for sRGB hex pairs", "validates citations, completeness and contrast of each proposal", "records preferred unless both the document and the project are full"; base de P3.A10. Fila `src/tokens` en `LAYERS`; `research` no importa `tokens`; `src/tokens/` a 0,9.
  - **Depende de:** T4.
  - **Comparte archivos con:** T2, T8, T10 (`boundaries.test.ts`); T8 (`check-coverage.ts`, `coverage-rules.test.ts`).
  - **Fuera de alcance:** OKLCH, escalas y variantes de marca (P5).

- [x] **T7** (R9, R10) — Validadores y constructores de brief (ids estables, consultas acumulativas) y de análisis (frescura por digest).
  - **Archivos:** `src/research/brief.ts`, `src/research/analysis.ts`, `tests/unit/research/brief.test.ts`, `tests/unit/research/analysis.test.ts`
  - **Interfaces:** parseQueryFlag; validateResearchQuery; validateBriefOutput; buildBrief; queryId; GENERIC_QUERY_TERMS; referenceDigest; referencesToAnalyze; validateAnalysisOutput; mergeAnalysis; freshAnalyses
  - **Patrón:** src/research/provenance.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 10 (brief, analysis); DR2, DR27, DR28, DR39), `src/research/provenance.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/research/brief.test.ts tests/unit/research/analysis.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "rejects research queries without an interface-job facet", "tracks analysis freshness by reference digest"; cubre P3.A8.
  - **Depende de:** T4.
  - **Comparte archivos con:** ninguna tarea.
  - **Fuera de alcance:** casos de uso (T15).

## Lote 5 — Módulo `agents`: puertos, packs y plantillas

- [x] **T8** (R1, R5, R7, R20) — Puertos, configuración perezosa, dialectos de schema y context packs con proyección, compactación, prefijo estable y pack de reparación.
  - **Archivos:** `src/agents/ports.ts`, `src/agents/settings.ts`, `src/agents/json-schema.ts`, `src/agents/context-pack.ts`, `tests/unit/agents/context-pack.test.ts`, `tests/unit/agents/json-schema.test.ts`, `tests/repo/boundaries.test.ts`, `scripts/check-coverage.ts`, `tests/repo/coverage-rules.test.ts`
  - **Interfaces:** AgentProvider; ProcessRunner; ProcessSpec; ProcessOutcome; LineVerdict; ContextItem; ContextPack; AgentRequest; AgentAttempt; ProviderServices; ProbeLevel; DEFAULT_AGENT_SETTINGS; resolveAgentSettings; providerIdForRole; toProviderSchema; OPENAI_STRICT_KEYWORDS; assertStrictCompatible; buildContextPack; renderContextPack; repairPack; referenceItems; compactText; PACK_LIMITS
  - **Patrón:** src/research/ports.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 6; DR8, DR9, DR13, DR21, DR40, DR41, DR43; §Economía de tokens), `.claude/skills/heron-architecture/references/patterns.md` (§1, §6)
  - **Librerías:** zod@4.6.5
  - **Done:** comando `bun test tests/unit/agents/context-pack.test.ts tests/unit/agents/json-schema.test.ts tests/repo/boundaries.test.ts tests/repo/coverage-rules.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "builds task-scoped packs within budget and tags untrusted items", "compacts external text and caps items deterministically", "renders a stable prefix without timestamps or run ids", "emits provider schemas that both CLIs accept in strict mode"; cubre P3.A4. Fila `src/agents` en `LAYERS` (`core/contracts`, `STORE_READ`, `security`, `agents`, `prompts`; `import type` de `src/core/store/temp-dir.ts`; bare `zod`); `src/agents/` a 0,9.
  - **Depende de:** T2, T4.
  - **Comparte archivos con:** T2, T6, T10 (`boundaries.test.ts`); T6 (`check-coverage.ts`, `coverage-rules.test.ts`).
  - **Fuera de alcance:** plantillas (T9), runner y adapters (T10, T11).

- [x] **T9** (R3, R6, R9, R10, R11, R12, R14, R20) — Plantillas versionadas importadas como texto y especificación de las 4 tareas (ítems permitidos y `maxOutputTokens`).
  - **Archivos:** `src/agents/text-modules.d.ts`, `src/agents/prompts.ts`, `src/agents/tasks.ts`, `prompts/visual-researcher/research-brief@v1.md`, `prompts/visual-researcher/research-analyze@v1.md`, `prompts/design-director/direction-propose@v1.md`, `prompts/shared/repair@v1.md`, `prompts/shared/probe@v1.md`, `tests/unit/agents/prompts.test.ts`
  - **Interfaces:** PromptTemplate; PROMPT_TEMPLATES; templateFor; REPAIR_TEMPLATE; AgentTaskSpec; AGENT_TASKS
  - **Patrón:** src/research/registry.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 6 (prompts/tasks); DR9, DR10, DR41, DR42, DR44), `.claude/skills/heron-architecture/references/patterns.md` (§10), https://bun.com/docs/runtime/loaders (sección `text`)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/agents/prompts.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "registers every template with its version and sha256"; base de P3.A5 (plantilla@versión+sha256) y P3.A8. Las plantillas son estáticas (sin fechas ni ids), dicen que todo lo delimitado es dato y piden solo JSON del schema; `direction-propose` no admite `external-text` ni `reference-origin` (DR44).
  - **Depende de:** T8.
  - **Comparte archivos con:** ninguna tarea.
  - **Fuera de alcance:** ajustes de copy tras P3.A12 (nueva `@v2`, nunca editar `@v1` publicada).

## Lote 6 — Runner, adapters y primera sonda viva

- [x] **T10** (R1, R4, R20) — Runner de procesos único (grupo, timeouts, drenado acotado, señales) y adapter `claude-code` con sonda de capacidades y máximo de tokens de salida.
  - **Archivos:** `src/agents/process/bun-runner.ts`, `src/agents/adapters/claude-code/index.ts`, `tests/helpers/agents.ts`, `tests/unit/agents/argv.test.ts`, `tests/unit/agents/timeout.test.ts`, `tests/repo/boundaries.test.ts`
  - **Interfaces:** bunProcessRunner; claudeCodeProvider; CLAUDE_FIXED_ARGS; CLAUDE_REQUIRED_FLAGS; claudeArgv; writeFakeAgentBin; fakeBinEnv; refusingRunner
  - **Patrón:** src/security/fetch/system.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 7; DR5, DR6, DR13, DR35, DR42; §Failure modes), `node_modules/bun-types/bun.d.ts` (`detached`, `timeout`, `killSignal`, `maxBuffer`), https://code.claude.com/docs/en/headless, https://code.claude.com/docs/en/env-vars
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/agents/argv.test.ts tests/unit/agents/timeout.test.ts tests/repo/boundaries.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "maps CLI failures, error results and missing binaries to agent statuses", "kills a hung agent at the configured timeout"; cubre P3.A3. `TOKENS`: `Bun.spawn`, `Bun.which` y `process.on|off|once` solo en `bun-runner.ts`; `process.kill` en `bun-runner.ts` y `src/core/store/lock.ts`; `child_process` sigue prohibido. Tests de procesos reales con timeout explícito (≥ 15 000 ms) y la razón.
  - **Depende de:** T2, T8, T9.
  - **Comparte archivos con:** T11 (`argv.test.ts`), T13 (`tests/helpers/agents.ts`), T2, T6, T8 (`boundaries.test.ts`).
  - **Fuera de alcance:** imágenes (DR37).

- [x] **T11** (R1, R8, R18) — Adapter `codex-cli` con monitor por lista blanca y plantilla por stdin; sonda viva opt-in como criterio de salida del lote. _Código y pruebas listos; el criterio de salida manual (`HERON_LIVE_AGENTS=1 bun run test:live`) pasó el 2026-10-01 (claude 2.1.287, codex 0.159.3) con todas las comprobaciones en PASS, tras el arreglo de dialecto 1098c62._
  - **Archivos:** `src/agents/adapters/codex-cli/index.ts`, `tests/unit/agents/codex-events.test.ts`, `tests/unit/agents/argv.test.ts`, `tests/live/agents.live.ts`, `package.json`
  - **Interfaces:** codexCliProvider; CODEX_FIXED_ARGS; CODEX_DISABLED_FEATURES; CODEX_ALLOWED_EVENT_TYPES; CODEX_ALLOWED_ITEM_TYPES; codexArgv; codexPrompt; codexLineVerdict
  - **Patrón:** src/research/adapters/url/index.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 7; DR6, DR7, DR13, DR29, DR30, DR45), https://platform.openai.com/docs/codex/non-interactive-mode
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/agents/argv.test.ts tests/unit/agents/codex-events.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "invokes agent CLIs isolated, tool-less and schema-bound", "stops codex on the first tool-use event as a policy violation", "stops codex on an unknown item or event type without exposing the line"; cubre P3.A1. **Criterio de salida del lote (manual):** `HERON_LIVE_AGENTS=1 bun run test:live` con los CLIs reales del usuario confirma la sesión con las banderas de DR6, `structured_output` (o el plan B de DR13) con `--tools ""` + `--json-schema`, `web_search="disabled"` aceptado, los nombres de los campos de tokens (incluidos los cacheados, DR45) y ninguna `policy-violation` en una respuesta trivial de Codex; lo que falle se corrige en DR6/DR7/DR13/DR45 antes de T12.
  - **Depende de:** T10.
  - **Comparte archivos con:** T10 (`argv.test.ts`).
  - **Fuera de alcance:** `-c developer_instructions` (DR29, seguimiento).

## Lote 7 — Ejecución de tareas y paso de IA en `app`

- [x] **T12** (R3, R6, R11, R12, R15, R19, R20) — `runAgentTask` con reparación compacta y registro de intentos, clave de cache, proveedor `fake` y registro de proveedores.
  - **Archivos:** `src/agents/invoke.ts`, `src/agents/cache.ts`, `src/agents/registry.ts`, `src/agents/adapters/fake/index.ts`, `src/agents/adapters/fake/responders.ts`, `tests/unit/agents/invoke.test.ts`, `tests/unit/agents/cache.test.ts`
  - **Interfaces:** runAgentTask; RunTaskInput; TaskOutcome; agentCacheKey; analysisInputKey; AGENT_PROVIDERS; providerFor; fakeProvider; createFakeProvider; FakeStep
  - **Patrón:** src/research/registry.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 7 (fake), 8, `cache.ts`; DR10, DR15, DR16, DR39, DR43)
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/agents/invoke.test.ts tests/unit/agents/cache.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "repairs with validation issues and stops after the third attempt", "sends only the previous output, the issues and the task facts in a repair", "produces deterministic SYNTHETIC outputs with the fake provider", "derives the cache key from template, schema, provider, model and projected input"; base de P3.A2 y P3.A7.
  - **Depende de:** T6, T7, T9, T10, T11.
  - **Comparte archivos con:** T13 (`invoke.test.ts`).
  - **Fuera de alcance:** loop creator → reviewer (P7).

- [ ] **T13** (R1, R2, R3, R6, R7, R15, R19, R21) — `AppContext` con agentes, `executeAgentStep` (config perezosa, entorno, pack, cache, log, redacción, aviso blando), totales de uso y `fixedContext` que rechaza CLIs reales.
  - **Archivos:** `src/app/context.ts`, `src/app/agent-task.ts`, `src/app/agent-usage.ts`, `tests/helpers/cli.ts`, `tests/helpers/agents.ts`, `tests/unit/app-context.test.ts`, `tests/unit/agents/invoke.test.ts`, `tests/unit/agents/roles.test.ts`, `tests/unit/app/agent-usage.test.ts`, `tests/repo/live-agents.test.ts`
  - **Interfaces:** AppContext; AgentServices; executeAgentStep; finalizeAgentRun; AGENT_STATUS_EXIT; AgentStepInput; AgentRunDraft; summarizeAgentUsage; AgentUsageTotals; withAgentSettings; scriptedProvider
  - **Patrón:** src/app/write-run.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 9 (context, agent-task, agent-usage); DR1, DR14, DR15, DR21, DR23, DR30, DR39, DR45), `src/app/{context,write-run,workspace}.ts`, `tests/helpers/cli.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/agents tests/unit/app tests/unit/app-context.test.ts tests/repo/live-agents.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "retries invalid output at most twice and keeps Heron state", "resolves role providers from configuration", "totals tokens by day from the local log and warns over the soft budget", "keeps real agent CLIs out of the default test run"; cubre P3.A2 y P3.A6.
  - **Depende de:** T3, T12.
  - **Comparte archivos con:** T10 (`tests/helpers/agents.ts`), T12 (`invoke.test.ts`).
  - **Fuera de alcance:** casos de uso y CLI (T15–T17).

## Lote 8 — Vistas y research con agentes

- [ ] **T14** (R7, R16) — Vistas: `REFERENCES.md` con brief, notas inferidas y direcciones (escapadas); todos los escritores de research pasan los documentos de agente.
  - **Archivos:** `src/app/research-store.ts`, `src/app/references.ts`, `src/app/brand.ts`, `src/app/research.ts`, `src/research/render/references-md.ts`, `src/research/render/copy.ts`, `src/research/render/outputs.ts`, `tests/unit/research/render.test.ts`, `tests/e2e/research-render.test.ts`, `tests/e2e/p2-compat.test.ts`
  - **Interfaces:** renderResearchOutputs; stageResearchOutputs; readResearch; ResearchSnapshot; renderReferencesMarkdown
  - **Patrón:** src/research/render/references-md.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 9 (research-store), 15; DR24, DR28), `specs/0002-research/design.md` (§Contracts › 9.1), `src/research/render/**`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/unit/research/render.test.ts tests/e2e/research-render.test.ts tests/e2e/p2-compat.test.ts tests/e2e/references.test.ts tests/e2e/brand.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "escapes agent text in the research views", "reads P2 workspaces with agent defaults and unchanged research views"; prepara P3.A12. Sin documentos de agente, los bytes de P2 no cambian.
  - **Depende de:** T4, T7, T8, T13.
  - **Comparte archivos con:** T15 (`src/app/research.ts`).
  - **Fuera de alcance:** moodboard (DR24).

- [ ] **T15** (R6, R9, R10, R16, R19) — `heron research brief|analyze` de punta a punta con cache y `--force`, pie de `USAGE_TEXT` y prueba de secretos sobre un run del `fake`.
  - **Archivos:** `src/app/research.ts`, `src/cli/command.ts`, `src/cli/commands/research.ts`, `src/cli/main.ts`, `src/cli/args.ts`, `src/cli/render-agents.ts`, `tests/e2e/research-agents.test.ts`, `tests/unit/agents/run-record.test.ts`, `tests/unit/cli-args.test.ts`
  - **Interfaces:** runResearchBrief; runResearchAnalyze; ResearchBriefInput; ResearchAnalyzeInput; ResearchParsed; renderResearchBriefText; renderResearchAnalyzeText; USAGE_TEXT
  - **Patrón:** src/app/references.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 9 (research), 13, 14; DR17, DR19, DR27, DR39, DR40; §Migration (aserción de `USAGE_TEXT`)), `src/cli/commands/references.ts`, `src/cli/args.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/research-agents.test.ts tests/unit/agents/run-record.test.ts tests/unit/cli-args.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "formulates a faceted brief with the fake provider and rejects facet-less operator queries", "analyzes references as inferred notes without touching human fields", "renders agent sections only when agent documents exist", "reuses the stored run when inputs are unchanged unless --force", "records reproducibility fields and never leaks secrets"; cubre P3.A5 y prepara P3.A12. Llama `freshen` de la T0 de 0004 al reescribir `brief.json` y `analysis.json`.
  - **Depende de:** T13, T14, T0 de 0004.
  - **Comparte archivos con:** T14 (`src/app/research.ts`); T16, T17 (`src/cli/command.ts`, `tests/unit/cli-args.test.ts`); T16 (`src/cli/main.ts`, `src/cli/render-agents.ts`).
  - **Fuera de alcance:** imágenes (DR37).

## Lote 9 — Direcciones, status y doctor

- [ ] **T16** (R11, R12, R13, R19, R20) — `heron direction propose|select` de punta a punta, alimentado por el análisis guardado y con cache.
  - **Archivos:** `src/app/directions.ts`, `src/cli/commands/direction.ts`, `src/cli/commands/index.ts`, `src/cli/command.ts`, `src/cli/main.ts`, `src/cli/render-agents.ts`, `tests/e2e/directions.test.ts`, `tests/unit/cli-args.test.ts`
  - **Interfaces:** runDirectionPropose; runDirectionSelect; DirectionProposeInput; DirectionSelectInput; directionCommand; DirectionParsed; renderDirectionProposeText; renderDirectionSelectText
  - **Patrón:** src/app/references.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 9 (directions), 13, 14; DR3, DR4, DR18, DR39, DR44; §Failure modes), `src/app/gate.ts`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/directions.test.ts tests/unit/cli-args.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "proposes three reference-only directions and records a preferred one", "each direction carries a complete visual proposal with deterministic contrast", "refuses to propose directions while the research approval is invalid", "feeds directions from stored analyses instead of raw sources"; cubre P3.A7 y P3.A10. `heron gate direction approve --yes` en `reference-only` sigue con 3 (`MODE_BLOCKED`); llama `freshen` de la T0 de 0004.
  - **Depende de:** T5, T6, T15, T0 de 0004.
  - **Comparte archivos con:** T15, T17 (`src/cli/command.ts`, `tests/unit/cli-args.test.ts`).
  - **Fuera de alcance:** direcciones `full` y gate `direction` con Penpot (P5, P12).

- [ ] **T17** (R9, R11, R13, R14, R21) — `doctor` con checks de agentes en paralelo, `--deep` y uso de tokens; `status` con las órdenes de P3 y los totales del log local.
  - **Archivos:** `src/app/doctor.ts`, `src/cli/commands/doctor.ts`, `src/cli/command.ts`, `src/app/status.ts`, `src/cli/render.ts`, `tests/e2e/doctor.test.ts`, `tests/e2e/status.test.ts`, `tests/unit/cli-args.test.ts`
  - **Interfaces:** agentChecks; DoctorInput; DoctorParsed; AgentUsageSummary
  - **Patrón:** src/app/doctor.ts
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Contracts › 9 (doctor, agent-usage), 12, 13; DR20, DR45; §Migration (aserciones que cambian))
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/e2e/doctor.test.ts tests/e2e/status.test.ts tests/unit/cli-args.test.ts && bun run typecheck && bun test`, esperado exit 0; casos de test "reports agent availability from exit codes without reading credentials", "runs a schema-bound deep probe through each role provider", "reports agent token usage against the soft budget", "shows agent token totals and the soft budget"; cubre P3.A9. `doctor` sigue sin escribir (`hashTree` igual); "Allowed commands" suma las órdenes de P3 tras el prefijo fijo de P1/P2/P4.
  - **Depende de:** T13, T16.
  - **Comparte archivos con:** T15, T16 (`src/cli/command.ts`, `tests/unit/cli-args.test.ts`).
  - **Fuera de alcance:** checks de Penpot (P12) y Refero (P10).

## Lote 10 — Documentación y recorrido real

- [ ] **T18** (R17, R18, R20) — ADR 0005, resto de `docs/agent-providers.md` (incluida la economía de tokens), docs de arquitectura/seguridad/research, README y quality gate.
  - **Archivos:** `docs/adr/0005-ai-provider-boundary.md`, `docs/agent-providers.md`, `docs/architecture.md`, `docs/security.md`, `docs/research.md`, `README.md`, `tests/repo/docs.test.ts`
  - **Interfaces:** CLAUDE_FIXED_ARGS; CODEX_FIXED_ARGS; CODEX_ALLOWED_ITEM_TYPES; AGENT_ENV_ALLOWLIST; PACK_LIMITS
  - **Patrón:** docs/adr/0003-research-source-boundary.md
  - **Lectura:** `specs/0003-agents-directions/design.md` (§Decisiones del usuario; §Economía de tokens; §Fuentes consultadas; §Testing strategy › P3.A11 y P3.A12; DR6, DR7, DR14, DR20, DR30, DR35–DR45), `docs/architecture.md`, `docs/security.md`, `README.md`
  - **Librerías:** ninguna
  - **Done:** comando `bun test tests/repo/docs.test.ts && bun run check`, esperado exit 0; casos de test "documents the agent provider boundary, the exact flags and the subscription terms"; cierra P3.A11 y prepara P3.A12 (recorrido manual de §Testing strategy, con `HERON_LIVE_AGENTS=1 bun run test:live` como paso previo). `docs/agent-providers.md` documenta `--force`, `agents.warnTokensPerDay`, `PACK_LIMITS` y las banderas literales.
  - **Depende de:** T17.
  - **Comparte archivos con:** T1 (`docs/agent-providers.md`, `tests/repo/docs.test.ts`).
  - **Fuera de alcance:** guía de self-host (P9).
