# Recetas "cómo agregar X"

Patrones citados: [patterns.md](patterns.md). Ubicaciones: [layout.md](layout.md). Lo marcado [Pn]/[pre-P2] aún no existe; confirma con `ls`.

## Orden de CLI

1. `<Cmd>Data` (`z.object`) en `core/contracts/<familia>.ts`; súmalo a `CLI_COMMANDS` y a la unión `data`; corre `gen:schemas` (aditivo, sin bump).
2. `run<Cmd>` en `app/<familia>.ts`; con `withWriteRun` si escribe; los pasos largos van fuera del lock (patrón 3).
3. `CommandSpec` del grupo en `cli/commands/<grupo>.ts` [P2]; el handler termina en `emitResult` [pre-P2]. Hasta P2 el modelo es `handleInit`.
4. `render<Cmd>Text` en inglés; un código nuevo se suma a `FINDING_CODES` (sin bump, OD1-C′).
5. Tests: parseo y exit 2, e2e con `e2eSetup`, y `--json` validado contra `CliEnvelopeSchema`.
6. README y `docs/workflow.md`.

## Documento versionado

1. Tipo + `<Name>Schema` (`z.looseObject`, findings como `StoredFinding`) + `<NAME>_DOCUMENT`; exportarlo en `core/contracts/index.ts`.
2. Kind en `DocumentKind` y en `CONTRACT_DOCUMENTS`.
3. `bun run gen:schemas` y commit de `schemas/<kind>.v1.schema.json`.
4. `PHASE_ARTIFACTS`/`ARTIFACT_DEPENDENCIES`/`GATE_BINDINGS` si aplica.
5. Escribir con `tx.putDocument`; sus enums (adapter, fuente, proveedor, validador, categoría) nacen completos.
6. Test de ida y vuelta + versión mayor rechazada.

## Adapter para un puerto existente

1. `src/<module>/adapters/<id>/index.ts` exporta `const <camelId><Port>`.
2. El id ya existe en el enum completo; se registra en `registry.ts` (`Partial<Record>` o lista ordenada).
3. Efectos solo vía servicios del request; un vendor solo si la tabla `VENDORS` [pre-P2] lo permite.
4. Nunca lanza ante entrada hostil: devuelve resultado con findings.
5. `tests/unit/<module>/<id>.test.ts` con dobles + un e2e con el adapter `fake`.

## Puerto o módulo nuevo

1. `ports.ts`, `registry.ts`, `adapters/`.
2. Fila en `LAYERS` [pre-P2] (y en `VENDORS`/`TOKENS` si aplica) con ejemplos `violates`/`passes`.
3. Contratos en `core/contracts`; servicios en `AppContext`, `createDefaultContext` y `fixedContext`.
4. Dominio o seguridad: prefijo en `COVERAGE_RULES` (≥ 0.9, RNF-8).
5. ADR si MASTER lo pide o entra una dependencia; fila en `docs/architecture.md` en el mismo PR.

## Fuente nueva de ProductContext

Una fuente es un adapter del puerto `ProductContextAdapter` (`src/intake/ports.ts`); el modelo y la regla están en [ADR 0006](../../../../docs/adr/0006-canonical-data-model.md).

1. `src/intake/adapters/<id>/index.ts` exporta `<camelId>Adapter` con `detect` y `load`; el id debe estar en `ADAPTER_IDS` (`core/contracts/heron-project.ts`). Un adapter por detección va en `DEFAULT_ADAPTERS`; uno que solo corre si `init --adapter` lo elige, en `OPT_IN_ADAPTERS` (`src/intake/detect.ts`).
2. `load` devuelve un `ContextDraft` de candidatos con `sourceRef` (ancla `§<encabezado>` o JSON Pointer, nunca número de línea); usa `candidateSink` (`candidates.ts`) y los lectores de `markdown.ts`/`sources.ts`/`inputs.ts`. El merge, la precedencia y los conflictos son comunes: el adapter no los decide.
3. Una fuente nueva con nombre propio entra en `SOURCE_KINDS` (su posición es su rango en `SOURCE_PRECEDENCE`, `precedence.ts`), en las reglas de extracción de `docs/integrations/navori-harness.md` y en el esquema persistido (valor nuevo en un enum persistido = bump, ver "Documento versionado").
4. Efectos solo vía el `ReadonlyFs` y los límites del request; nunca lanza ante entrada hostil: devuelve findings o `{ ok: false }`.
5. Tests: `tests/unit/intake/<id>.test.ts`; `tests/contracts/product-context.test.ts` si cambia el mapa archivo → campo; regenerar y re-aprobar es la política de upgrade (la frescura es regenerar y comparar bytes).
6. Si cambia el lector de `ux.json`, no se toca a los consumidores: se crea un `UxReader` y se apunta `ACTIVE_UX_READER` a él (pasos en `docs/integrations/navori-harness.md`).

## Orden de CLI de intake

`heron intake` y `heron conflicts list|ack` siguen la receta "Orden de CLI": `run*` en `app/intake.ts` y `app/conflicts.ts`, `CommandSpec` en `cli/commands/{intake,conflicts}.ts`, texto en `cli/render-intake.ts`. Escriben con `withWriteRun` + `freshen` y regeneran con `computeIntake` (solo lectura, compartido con `status` y el gate).

## Fixture

1. `fixtures/<name>/` con `SYNTHETIC`, `.md` marcados y `navori.config.json` cuyo `name` es el directorio.
2. Agregarlo a `FixtureName` y a `fixtures/README.md`.
3. Usarlo solo vía `copyFixture`/`e2eSetup`.
4. Insumos sueltos en `tests/assets/<module>/`.

## Gate o fase

1. Revisa primero: las 13 fases, 6 gates y 16 precondiciones ya están completas (DP7/DP8); casi todo son **hechos**.
2. Un hecho es un campo en `TransitionFacts`, calculado en `app` (`collectTransitionFacts`), nunca en la tabla.
3. Una fase, gate o precondición nueva es un cambio de enum de `HeronState`: bump + migración + ADR.
4. Filas en `FORWARD_ROWS`/`REJECTION_SPEC`, `GATE_BINDINGS`, `PHASE_ARTIFACTS`.
5. Matriz exhaustiva en `state-machine.test.ts` e invalidación en `gates.test.ts`.

## Configuración y secretos [P3]

`src/app/config.ts`: defaults en código < `.heron/project.json` (`HeronProject`, campos opcionales sin bump) < variables `HERON_*`. Los secretos solo llegan por env o `<NAME>_FILE`; si ambos están definidos → exit 2 (nunca elegir en silencio). Configuración inválida → exit 2; dependencia ausente → 3 o 5. Solo `context.ts`/`config.ts` leen `process.env`. No hay `heron.config.json` en V1 (supuesto).

## Servicio externo y páginas de revisión (P12)

1. Destinos y secretos de servicios externos llegan por `AppContext.env`, **nunca del workspace**. Para Penpot usa `resolvePenpotUrl`/`resolvePenpotKey` en `app/penpot-config.ts`; no reintroduzcas `project.penpot.url`, `.env`, `--url` ni redirects. Launcher: `heron` o `bun run heron`, no Bun sin los flags de aislamiento.
2. Inyecta gateway por `AppContext.penpot`; composición vía `defaultPenpotGateway` del registro, nunca importando el adapter MCP en app. Usa `withPenpotSession` con cierre y redactor; log solo en escrituras normales y con `heronDir` explícito. Tests default con `refusingGateway` o `fakePenpotContext`.
3. Layout nuevo en `compiler/` puro, datos tipados como nodos. `renderScript` mide la plantilla completa más literal seguro. No edites las plantillas congeladas: agrega `@v2`, registro/sha256 y tests de compatibilidad y guarda humana.
4. Inspecciona fuera del lock sobre revisión R; antes de escribir comprueba archivo vinculado. Tras intentos remotos reinspecciona; commit local con `expectedRevision = R`, `recordCommand`, `withArtifacts` y `freshen`. Nunca supongas rollback remoto ni que el timeout canceló el script.
5. Prueba key canario sin eco en éxito/fallo/logs, archivo incorrecto, humano dentro/fuera, parcial y repetición sin cambios. Sondas vivas solo opt-in sobre archivo desechable autorizado. A8 exige direcciones reales y aprobación en tres ventanas, no una expectativa automatizada.
