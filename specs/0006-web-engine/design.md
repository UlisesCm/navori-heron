# Heron Web Engine — Diseño

## Enfoque

Monolito modular TypeScript con web y worker como dos procesos del mismo entregable. Bun sigue siendo runtime. La web es el producto; CLI y sesiones locales de agentes dejan de definir el diseño. Rust queda como experimento acotado al compilador, fuera de la ruta crítica de V1.

Decisiones propuestas por este plan, no afirmaciones sobre capacidades ya implementadas. Veredicto: CONCERNS por cambio de topología, autenticación y persistencia. Revisión realizada en el mismo contexto, sin subagentes por instrucción del usuario; no se presenta como auditoría independiente.

## Estado actual frente al objetivo

| Área | Estado comprobado | Objetivo |
|---|---|---|
| Análisis inicial en main | P1: CLI, dominio, contratos, filesystem | Reutilizar reglas y tests, sustituir composición y transporte |
| Base del PR en develop, 2c55af6 | Research, agentes, intake y Penpot; nuevo gate pasa sobre esta base | Inventariar y seleccionar reuso antes de reconstruir |
| Contexto | UX.md + ux.json condicionan producción | Contexto normalizado y aprobado, independiente del origen |
| Persistencia | Archivos mutables promovidos antes de state.json | Revisiones publicadas transaccionalmente |
| IA | Roadmap basado en CLIs del host | Puerto de proveedor para API de servidor y fake determinista |
| Revisión visual | Penpot obligatorio en el plan anterior | Preview web; Penpot opcional posterior |
| Distribución | bun link | Servicio web autohospedable |

## Componentes y carpetas

```text
src/
  bootstrap/                    composición/configuración de web y worker
  interfaces/web/               rutas HTTP, autenticación, vistas y recursos browser
  application/                  casos de uso por capacidad y puertos
    projects/ sources/ context/ jobs/ approvals/ design/ export/
  domain/                       reglas puras
    workflow/ intake/ design/ tokens/ validation/
  contracts/                    formatos versionados de API y artefactos
  infrastructure/
    github/                     GitHub App, autorización y lectura a SHA
    persistence/                SQLite, migraciones, repositorios y blob store
    providers/                  API IA y fake
    jobs/                       leases y ejecución
    penpot/                     integración posterior
    security/                   redacción y transporte restringido
bin/                            entradas técnicas server/worker, no producto CLI
schemas/ prompts/ templates/ tests/ docs/ specs/
```

Se crean únicamente carpetas con implementación. No se introduce monorepo ni un package por módulo. Los recursos de UI se sirven localmente; no se sube contenido a servicios de preview externos.

## Decisiones

### D1 — Reuso y limpieza antes de funcionalidades (R1)

E1 compara commits fijos de main y develop, preserva módulos útiles y registra decisiones. No se hace merge ciego, reset ni eliminación masiva. `core/state` migra a `domain/workflow`; `core/store` permanece como compatibilidad local hasta que sus lectores dejen de necesitarlo. Los adapters CLI se retiran sólo después de existir el recorrido web equivalente; retirar soporte público no obliga a destruir los tests útiles.

Las reglas generadas se actualizan mediante la configuración del harness y su render, nunca reescribiendo bloques managed a mano. El master anterior permanece intacto hasta su conciliación mediante comandos soportados; esta spec no declara cerrado su seguimiento.

### D2 — Web autohospedable para una organización (R2, R3)

API y vistas SSR con Hono y TypeScript en el navegador para progreso y previews. No se añade una SPA ni un framework de estado antes de necesitarlo. Las nuevas dependencias se verifican y fijan en lockfile en la entrega que las introduce; no se reutilizan como verificadas las versiones futuras citadas por el roadmap histórico.

Login GitHub mediante flujo web soportado por GitHub App, con state de un solo uso y sesión de servidor. Cookie HttpOnly, SameSite, Secure bajo HTTPS; control Origin/CSRF en mutaciones. Una allowlist administrada limita operadores. La identidad de usuario y la autorización sobre instalación/repositorio son verificaciones separadas. Cada proyecto pertenece a un operador en V1; no hay colaboración implícita entre operadores.

Validar documentación oficial vigente de GitHub sobre permisos, tokens, revocación y flujo de login al implementar E1. No solicitar permiso de escritura de contenido ni PRs en V1. Secretos de app y proveedor se configuran en servidor; tokens de sesión no se guardan en texto claro y los tokens GitHub persistidos se cifran con una clave fuera de la DB.

### D3 — Snapshot GitHub y selección explícita (R4, R5, R6, R14)

`RepositorySnapshot` identifica installationId, repositoryId y commitSha. El adapter lista el árbol y descarga blobs seleccionados del commit; no hace checkout ejecutable ni ejecuta Git hooks. Un árbol truncado debe paginarse por subárbol o fallar con diagnóstico, nunca presentarse completo.

El descubrimiento prioriza specs del harness, UX, documentos de producto, tokens, CSS y componentes. No depende de Navori en runtime. La web muestra selección, exclusiones y presupuesto. Archivos excluidos por secreto no se incorporan automáticamente aunque el modelo los solicite. GitHub API sólo en destinos predefinidos; URLs dentro de documentos no se descargan.

`ProductContext` conserva evidencia por dato y origen extracted/provided/inferred. Una validación explícita determina completitud; no basta cambiar un booleano de modo. Se conservan invariantes de aprobación pero se sustituye la obligatoriedad del par UX.md/ux.json. Los documentos legacy se leen sin modificar el repositorio fuente.

### D4 — SQLite y artefactos inmutables (R7, R8, R13)

Una instancia en un host, SQLite WAL en disco local; no NFS ni múltiples réplicas escritoras en V1. Backend y worker usan la misma DB con transacciones breves. SQLite contiene proyectos, snapshots, revisiones, aprobaciones, jobs y sesiones. Los bytes grandes viven como blobs inmutables por hash en almacenamiento local restringido.

Publicación: escribir y sincronizar blobs → verificar hashes → transacción DB que compara expectedRevision y publica manifest/revisión. Nunca publicar referencias a bytes no durables. Una caída previa al commit deja blobs huérfanos, no una revisión parcial. GC conserva cualquier blob referenciado por revisión o trabajo activo y usa un período de gracia de 24 h. Backup coordinado incluye DB y todos sus blobs referenciados; restauración verifica hashes antes de servir.

Migraciones de DB versionadas con backup previo; no migración destructiva automática de `.heron/`. GitHub y export son fronteras externas, no la base de datos operativa. Git sigue conservando el historial de documentos publicados, no las sesiones ni la cola.

### D5 — Jobs durables, no framework de workflows (R8, R9, R13)

Estados: queued, running, succeeded, failed, cancelled. Claim transaccional, lease y token de fencing por intento. Sólo el dueño vigente puede publicar. Idempotency key ligada a proyecto, operación y revisión de entrada; mismo key con distinto payload se rechaza. Los artefactos y aprobaciones siguen una revisión; los jobs son estado operacional separado.

No se mantiene transacción, lock ni conexión HTTP abierta durante IA. Progreso mediante polling autenticado inicialmente. Retry no significa exactly-once del proveedor: no se puede garantizar ausencia de costo duplicado después de una caída; sí se garantiza una sola publicación local. Errores se muestran con remedio y sin secretos.

### D6 — IA de servidor, sin herramientas (R9, R10)

`GenerationProvider` recibe tarea, contrato de salida, fuentes y presupuesto; devuelve contenido no confiable y usage si existe. Primer adapter real: API de Anthropic; requiere credencial y facturación independientes de una suscripción de escritorio. Adapter fake obligatorio para todos los tests del recorrido. El contrato permite añadir otros proveedores sin cambiar dominio ni jobs.

No se conceden herramientas, shell, acceso al repo, GitHub ni aprobación. El worker valida schemas, referencias y reglas antes de persistir resultados. Contenido y logs de proveedor no se guardan crudos por defecto. Máximo dos reparaciones de schema; no retry automático de un error de autenticación.

### D7 — Diseño neutral y preview web (R7, R10, R11, R12)

La dirección incluye paleta, tipografía, densidad, lenguaje de componentes y una composición de muestra marcada SYNTHETIC. La UI renderiza datos validados, nunca HTML/JS generado por el modelo. Seleccionar una dirección registra hashes y actor.

El primer sistema exportable contiene tokens primitive/semantic, light/dark, DESIGN.md, catálogo neutral de componentes, provenance, schemas, manifest y reporte. DTCG se valida con librería existente antes de plantear una implementación propia. Accesibilidad automatizada cubre contraste y datos comprobables; no afirma certificar accesibilidad completa de un producto no implementado.

Export ordena rutas y JSON, fija timestamps del archivo comprimido y no agrega runId/fecha aleatoria a contenido determinista. Inputs idénticos para reproducibilidad significa artefactos aprobados idénticos; no significa que dos invocaciones IA producirán los mismos bytes.

### D8 — Rust sólo con un caso medido (R15)

Prototipo opcional `crates/heron-compiler` con protocolo JSON versionado por stdin/stdout y límites de tamaño. Entradas: árbol neutral y tokens resueltos. Salidas: findings y plan determinista. Sin filesystem del workspace, red, DB o credenciales. Batch por documento, no proceso por nodo.

Comparar 100, 1,000 y 10,000 nodos, 30 muestras por tamaño; medir arranque + serialización + IPC + cálculo y RSS. Adoptar sólo con equivalencia del corpus, mejora ≥30% de p95 total en la carga representativa que exceda su presupuesto y build verificado en plataformas soportadas. Si no hay cuello de botella, registrar no adopción y no mantener dos motores de producción. WASM y FFI quedan fuera.

## Contratos principales

Todos los documentos públicos llevan kind y schemaVersion. Schemas son la fuente de validación y se generan JSON Schemas para export.

- `RepositorySnapshot`: propietario, repo/installation IDs, commitSha y manifest de fuentes.
- `SourceEvidence`: ruta, blob/hash, localización y origen.
- `ContextRevision`: contexto normalizado, evidencia, conflictos y campos faltantes.
- `Approval`: actor, revisión, propósito y hashes vinculados.
- `GenerationJob`: idempotency key, revisión de entrada, estado, lease, fencing token, progreso y error saneado.
- `DesignRevision`: dirección, tokens, componentes, reporte y manifest de blobs.
- Respuestas HTTP con errores de dominio; ningún caso de uso depende de códigos de salida CLI, TTY ni stdout.

## Fallos y pruebas que los contienen

| Riesgo | Prueba requerida |
|---|---|
| Rehacer trabajo ya disponible en develop | Inventario con commits y regresiones antes de mover módulos |
| Repo privado de otro operador | Denegación en API, jobs y descarga, no sólo en UI |
| Rama cambia durante análisis | Todos los blobs y resultados conservan el SHA fijado |
| Prompt injection o salida ejecutable | Corpus hostil no causa herramientas, fetch ni ejecución en preview |
| Caída entre blob y DB | Última revisión visible conserva todos sus hashes |
| Worker viejo termina después de retry | Fencing rechaza publicación del intento anterior |
| Aprobación mientras cambia contexto | expectedRevision falla; no se aprueba contenido nuevo silenciosamente |
| Revocación durante un job | Se comprueba autorización antes de capturar y antes de publicar |
| Eliminación compite con generación | Tombstone impide publicación; limpieza no afecta otros proyectos |
| Export no determinista | Dos archivos comprimidos con iguales entradas tienen el mismo hash |

## Entregas funcionales y política de PRs

Una spec de proyecto con tres entregas, no ocho specs técnicas ni un PR por milestone:

1. **E1 — Repo → contexto aprobado.** Absorbe inventario, limpieza mínima, composición, sesión y GitHub; termina en una acción completa del usuario.
2. **E2 — Contexto → design system descargable.** Absorbe persistencia transaccional, jobs, proveedor, propuestas, validación y export; no se integra un worker sin consumidor.
3. **E3 — Aplicación operable.** Incluye revocación, eliminación, backups, distribución y pruebas operacionales. Mide el compilador; no exige escribir Rust si no hay cuello de botella.

Cada entrega incluye frontend, backend, contratos, tests y documentación necesarios para su resultado. Los milestones son checkpoints verificables dentro del PR. Refactors no necesarios para el recorrido quedan fuera. No se retrasa autorización, redacción, confinamiento o integridad hasta la última entrega.

Rust requiere un experimento posterior sólo si las mediciones lo justifican. Su eventual adopción no aumenta el número previsto de PRs de V1 ni se mezcla con un cambio de persistencia.

## Extensiones posteriores, no bloqueantes

PR de publicación con permisos de escritura opt-in y confirmación de diff; Penpot como target del compilador; pantallas completas y revisiones selectivas por grafo; colaboración entre operadores. Cada extensión requiere su spec, no se cuela en V1.
