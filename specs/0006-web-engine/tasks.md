# Heron Web Engine — Tareas

Plan de ejecución nuevo. Ninguna tarea está completada. Tres entregas funcionales, tres PRs para V1; un commit verificado por milestone, nunca un PR por tarea o capa. Las estimaciones son orientativas y excluyen código reutilizado o movimientos mecánicos. No se crea TaskList paralela.

| PR | Resultado usable | Alcance agrupado |
|---|---|---|
| E1 | Conectar GitHub y aprobar el contexto de un repo desde la web | Limpieza mínima necesaria, fronteras, sesión, selección e intake |
| E2 | Generar, revisar y descargar un design system | Persistencia de revisiones, worker, IA, previews, validación y export |
| E3 | Operar la aplicación autohospedada y recuperar sus datos | Revocación, eliminación, backup/restore, distribución, accesibilidad y medición |

La limpieza se consume dentro de E1; el worker se consume dentro de E2. No hay PRs separados de scaffolding, schemas, puertos, tests o documentación. Cada PR incluye sus migraciones, pruebas y documentación. Seguridad básica y aislamiento se verifican desde E1/E2, no se posponen a E3. E1/E2 no son autorizaciones para exponer el servicio en producción.

Un fallo de milestone se corrige dentro de su entrega. Se divide un PR adicional sólo si aparece un bloqueo real de revisión o integración documentado, no por número de carpetas. No se hacen commits de miles de líneas sin puntos de revisión: los milestones conservan unidades verificables dentro del mismo PR.

## Convenciones de ejecución

- Cada test nuevo declara `// Covers: R<n>` con los requisitos que verifica.
- Lectura común acotada: esta spec, `package.json`, `docs/architecture.md` y `tests/repo/boundaries.test.ts`. Cada tarea agrega sus archivos patrón y alcance.
- Gate automático de cada commit y CI: `bun run check` = format, lint, typecheck, jscpd y ast-grep, con dependencias locales. Sin plugins jscpd/Semgrep ni gate pre-commit del harness.
- Verificación funcional por milestone: ejecutar explícitamente los tests nombrados. Antes de integrar una entrega: gate y tests de aceptación. Los tests no se agregan al gate automático de commits/CI.
- Dependencias nuevas: consultar documentación oficial vigente, fijar versiones exactas, actualizar lockfile y registrar decisión antes de usarlas.
- Las rutas de módulos siguientes son objetivo; no se presupone que existan. Las carpetas de pruebas sí pueden crearse antes de los módulos migrados.
- No desplegar, borrar datos, crear PRs en repos externos ni cambiar permisos GitHub como efecto de ejecutar tests.

## E1 — Conectar GitHub y aprobar el contexto del repositorio
Estimated LOC: 3500

### M1 — Preservar trabajo existente y fijar baseline
- **A1** [observable] — Inventario enlaza commits concretos y cada módulo a conservar/adaptar/retirar; el estado histórico no cambia ficticiamente · `bun test tests/repo/migration-plan.test.ts` → PASS.
- [ ] **T1** (R1) — Crear `docs/migration/web-engine.md` y `tests/repo/migration-plan.test.ts`: inventariar main y la referencia develop disponible, incluyendo specs 0002–0005, research, intake, agentes, seguridad y Penpot. Fijar los SHAs revisados; seleccionar reuso por módulo sin merge automático. Instalar dependencias congeladas y registrar baseline del quality gate; no atribuir resultados antiguos a HEAD. Patrón: `tests/repo/schemas.test.ts`. · effect: docs · test: tests/repo/migration-plan.test.ts::preserves implemented modules and historical evidence

### M2 — Extraer aplicación del transporte sin alterar dominio
- **A2** [observable] — Dominio no importa infraestructura; casos de uso no leen TTY ni escriben stdout; pruebas puras previas conservan resultados · `bun test tests/repo/boundaries.test.ts tests/unit/application/approval.test.ts` → PASS.
- [ ] **T2** (R1, R7) — Reformar `src/app/context.ts`, `src/app/gate.ts`, `src/app/init.ts`, `src/core/state`, composición y fronteras según D1: dependencias acotadas, decisión explícita, revisión esperada y confirmación fuera del lock. Mover sólo módulos con inventario aprobado a `src/application`, `src/domain` y `src/bootstrap`. Actualizar `navori.config.json` y regenerar reglas mediante harness; actualizar `docs/architecture.md`. Lectura adicional: `src/core/state/gates.ts`, `src/core/store/lock.ts`, tests de gates y referencia develop de write-run. · effect: behavior · test: tests/unit/application/approval.test.ts::rejects changed revision without waiting under lock

### M3 — Sesión web y autorización
- **A3** [observable] — Usuario autorizado entra; sesión ausente, callback inválido, CSRF y operador ajeno son rechazados · `bun test tests/web/auth.test.ts` → PASS.
- [ ] **T3** (R2, R3, R14) — Crear `src/interfaces/web/auth`, servidor en `src/bootstrap/server.ts`, `src/application/projects`, sesiones/migraciones en `src/infrastructure/persistence` y `docs/github-app.md`. Implementar D2 con allowlist, logout y credenciales cifradas. Consultar documentación GitHub App; no habilitar escrituras. Patrón de contratos: `src/core/contracts/version.ts`; reutilizar redacción inventariada en E1. · effect: behavior · test: tests/web/auth.test.ts::rejects unauthorized sessions csrf and invalid oauth state

### M4 — Seleccionar repositorio autorizado
- **A4** [observable] — En navegador se puede conectar instalación, listar sólo repos autorizados y elegir rama · `bun test tests/e2e/web-repository.test.ts` → PASS contra GitHub falso.
- [ ] **T4** (R2, R3, R4) — Crear `src/application/ports/github.ts`, `src/infrastructure/github`, rutas/vistas de selección y `src/contracts/repository-snapshot.ts`. Resolver SHA al seleccionar; comprobar propiedad del proyecto y acceso al repo en servidor. Manejar revocación, rate limit y árbol truncado con mensajes recuperables. · effect: behavior · test: tests/e2e/web-repository.test.ts::selects authorized repository and freezes commit

### M5 — Inventario seguro y explicable
- **A5** [observable] — El operador revisa selección y exclusiones; fixtures hostiles no ejecutan código ni filtran secretos · `bun test tests/integration/github-ingestion.test.ts` → PASS.
- [ ] **T5** (R4, R5, R14) — Crear `src/application/sources`, `src/domain/intake/source-selection.ts` y UI de inventario. Reusar lectores de intake y detección de secretos seleccionados en T1. Aplicar límites R5, snapshots inmutables, hashes y selección explícita; no seguir URLs, submódulos ni symlinks. Lectura adicional: contratos RepositorySnapshot y puertos GitHub de M4. · effect: behavior · test: tests/integration/github-ingestion.test.ts::bounds untrusted files and never executes repository content

### M6 — Corregir y aprobar contexto sin contrato UX obligatorio
- **A6** [observable] — Repo sin ux.json llega a contexto aprobado tras correcciones humanas; conflictos bloquean y editar después invalida aprobación · `bun test tests/e2e/web-context.test.ts` → PASS.
- [ ] **T6** (R2, R6, R7) — Crear `src/application/context`, `src/contracts/context-revision.ts` y vistas de evidencia/edición/aprobación. Reusar ProductContext/precedencia de develop cuando sus tests satisfagan R6. Separar completitud de origen y adaptar guard de producción; preservar compatibilidad de lectura legacy. Patrón: `src/core/state/gates.ts`. · effect: behavior · test: tests/e2e/web-context.test.ts::approves corrected context without ux json and invalidates stale approval

## E2 — Generar, revisar y descargar el design system
Estimated LOC: 4600

### M7 — Publicación transaccional y worker
- **A7** [observable] — Fallos inyectados, doble claim y worker vencido nunca publican revisiones incompletas o duplicadas · `bun test tests/integration/job-recovery.test.ts tests/integration/revision-store.test.ts` → PASS.
- [ ] **T7** (R8, R13) — Crear `src/application/jobs`, puertos JobStore/RevisionStore, `src/infrastructure/jobs`, blob store y tablas jobs/revisions en `src/infrastructure/persistence`; entrada `src/bootstrap/worker.ts`. Implementar D4/D5 con CAS, fencing, heartbeat y cancelación; inyectar fallos entre cada persistencia. Patrón: `tests/helpers/faulty-fs.ts` y tests del store actual, ampliando aserciones a hashes. · effect: behavior · test: tests/integration/revision-store.test.ts::keeps last published revision complete after every injected failure; tests/integration/job-recovery.test.ts::rejects expired worker publication

### M8 — Proveedor limitado y progreso web
- **A8** [observable] — Trabajo fake muestra progreso, se cancela y reporta salida inválida; ningún prompt contiene secretos canario · `bun test tests/integration/generation-provider.test.ts tests/e2e/web-jobs.test.ts` → PASS.
- [ ] **T8** (R2, R8, R9, R14) — Crear `src/application/ports/generation-provider.ts`, adapters fake/Anthropic en `src/infrastructure/providers` y UI de jobs con polling. Reusar presupuestos y validadores de agentes inventariados; no reutilizar dependencias de login CLI. Documentar credencial API y costo separado. Limitar reparación, timeout y payload sin herramientas. · effect: behavior · test: tests/integration/generation-provider.test.ts::bounds untrusted output and redacts secrets; tests/e2e/web-jobs.test.ts::shows progress and cancels generation

### M9 — Tres propuestas revisables sin Penpot
- **A9** [observable] — Tres propuestas fake se comparan en navegador y sólo una aprobación vigente permite generar sistema · `bun test tests/e2e/web-directions.test.ts` → PASS.
- [ ] **T9** (R7, R9, R10) — Crear `src/application/design/directions.ts` y previews en `src/interfaces/web`; reutilizar contratos y reglas de propuestas existentes cuando apliquen. Renderizar sólo vocabulario validado, nunca markup ejecutable del proveedor. Quitar Penpot como precondición del nuevo flujo, sin alterar evidencia histórica. · effect: behavior · test: tests/e2e/web-directions.test.ts::requires current human approval without penpot

### M10 — Tokens, componentes y documentación validados
- **A10** [observable] — Sistema fake contiene tokens light/dark, catálogo y DESIGN.md; ciclos, alias rotos y contraste insuficiente generan FAIL · `bun test tests/unit/design/system.test.ts tests/unit/tokens/validation.test.ts` → PASS.
- [ ] **T10** (R9, R11) — Crear `src/domain/design`, `src/domain/tokens`, `src/domain/validation`, contratos y caso de uso de sistema. Reusar contraste y compilación neutral que pase las pruebas; validar DTCG con biblioteca verificada, documentar decisiones en `docs/design-system-format.md`. No generar componentes de framework ni pantallas completas. · effect: behavior · test: tests/unit/design/system.test.ts::builds neutral system from approved inputs; tests/unit/tokens/validation.test.ts::rejects invalid aliases cycles and contrast

### M11 — Export reproducible y recorrido completo
- **A11** [observable] — Desde GitHub falso hasta descarga, el usuario no usa terminal; dos exports de una revisión tienen igual hash y un FAIL bloquea la descarga final · `bun test tests/e2e/web-export.test.ts tests/contracts/export.test.ts` → PASS.
- [ ] **T11** (R2, R7, R11, R12, R13) — Crear `src/application/export`, serialización pura, endpoint autenticado y UI de descarga. Incluir manifest, schemas, provenance y checksums; fijar orden y timestamps de archivo comprimido. Comparar bytes y validar con un consumidor sin imports de Heron. Retirar la CLI como interfaz soportada sólo al pasar este recorrido; actualizar README y documentación de instalación. · effect: behavior · test: tests/e2e/web-export.test.ts::completes browser journey and blocks failed or stale exports; tests/contracts/export.test.ts::produces byte identical portable archive

## E3 — Operar y recuperar la aplicación autohospedada
Estimated LOC: 1200

### M12 — Revocar, eliminar y restaurar sin fugas
- **A12** [observable] — Revocación bloquea un job pendiente, eliminación no afecta otros proyectos y restauración verifica hashes · `bun test tests/security/project-lifecycle.test.ts tests/integration/backup-restore.test.ts` → PASS.
- [ ] **T12** (R3, R8, R13, R14) — Implementar desconexión y eliminación confirmada en web/application, tombstone, fencing de publicación, limpieza de blobs y backup/restore consistente. Crear `docs/operations.md` con retención: sesiones revocadas inmediatamente, logs saneados 30 días y backups bajo retención explícita del operador. Los backups no se prometen borrados instantáneamente. · effect: behavior · test: tests/security/project-lifecycle.test.ts::revocation and deletion stop publication without cross project access; tests/integration/backup-restore.test.ts::restores all referenced hashes

### M13 — Despliegue reproducible y calidad del recorrido
- **A13** [observable] — Smoke test arranca web/worker, healthcheck pasa y UI cumple presupuestos y accesibilidad · `bun test tests/infra/web-engine.test.ts tests/web/accessibility.test.ts tests/perf/web.test.ts` → PASS.
- [ ] **T13** (R2, R3, R8, R14) — Crear `infra/docker`, configuración de web/worker con volumen local y secretos externos, healthchecks y pruebas de seguridad/accesibilidad/latencia. Documentar restore y limitación single-host. Ejecutar pruebas en entorno aislado; no desplegar infraestructura del usuario. Conservar CI limitado al quality gate de format/lint/typecheck/jscpd/ast-grep; ejecutar el recorrido fake explícitamente como evidencia de aceptación, sin credenciales externas. · effect: behavior · test: tests/infra/web-engine.test.ts::starts web and worker without exposed secrets; tests/web/accessibility.test.ts::supports keyboard and labeled controls; tests/perf/web.test.ts::meets documented query budget

### M14 — Medir el compilador y decidir si Rust merece trabajo adicional
- **A14** [observable] — El reporte contiene p95, RSS, corpus y decisión explícita sobre el presupuesto de compilación; no se sustituye TS por preferencia de lenguaje · `bun test tests/perf/compiler.test.ts` → mediciones válidas y reporte en `docs/benchmarks/compiler.md`.
- [ ] **T14** (R15) — Crear corpus en `fixtures/compiler`, benchmark `scripts/bench-compiler.ts` y prueba `tests/perf/compiler.test.ts`. Medir el compilador TS de E2 sobre 100/1,000/10,000 nodos, 30 muestras. Objetivo inicial: p95 ≤ 500 ms para 1,000 nodos en el entorno documentado, excluyendo IA y red. Si cumple, registrar no adopción de Rust y cerrar la tarea sin prototipo. Si falla por CPU, documentar el hotspot y dejar el experimento Rust como continuación fuera de V1, con paridad y criterio D8 obligatorios; no añadir un PR especulativo a estas entregas. · effect: tests · test: tests/perf/compiler.test.ts::measures representative compiler corpus

## Trazabilidad R → tarea → prueba

| Requisito | Tareas | Prueba principal |
|---|---|---|
| R1 | T1, T2 | migration-plan.test.ts |
| R2 | T3, T4, T6, T8, T11, T13 | web-export.test.ts |
| R3 | T3, T4, T12, T13 | auth.test.ts |
| R4 | T4, T5 | web-repository.test.ts |
| R5 | T5 | github-ingestion.test.ts |
| R6 | T6 | web-context.test.ts |
| R7 | T2, T6, T9, T11 | web-directions.test.ts |
| R8 | T7, T8, T12, T13 | job-recovery.test.ts |
| R9 | T8, T9, T10 | generation-provider.test.ts |
| R10 | T9 | web-directions.test.ts |
| R11 | T10, T11 | tokens/validation.test.ts |
| R12 | T11 | contracts/export.test.ts |
| R13 | T7, T11, T12 | revision-store.test.ts |
| R14 | T3, T5, T8, T12, T13 | project-lifecycle.test.ts |
| R15 | T14 | perf/compiler.test.ts; contracts/compiler-parity.test.ts obligatoria sólo si se propone adopción |

## Secuencia

E1 → E2 → E3. Tres PRs funcionales en total para V1. Rust no añade una entrega obligatoria: sólo se abre un experimento posterior si la medición lo justifica. No se inician PRs automáticos en repos de usuarios, Penpot o multi-tenant dentro de estas entregas.
