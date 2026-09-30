# ADR 0001: Persistencia del estado de Heron

- Estado: aceptada
- Fecha: 2026-09-30
- Referencias: `specs/_master/01-heron/MASTER.md` (Arquitectura, decisión 4), D10; diseño en `specs/0001-heron-core/design.md` (DP2 a DP6)

## Contexto

Heron guarda, por producto, el modo, la fase, las decisiones de gate y los hashes de los artefactos. Ese estado debe poder revisarse en Git junto al producto, sobrevivir a una caída a mitad de una escritura, y tolerar un segundo proceso que intente escribir a la vez (CLI hoy, web en una parte posterior).

Las invocaciones de IA corren solo en el host, donde están los CLIs con sesión (D10); el servidor web es un plano de control. Por eso V1 no necesita cola de jobs, consultas relacionales ni acceso remoto concurrente.

## Decisión

Persistir en el filesystem, dentro de `.heron/` del repo del producto, versionado con Git:

1. **JSON canónico versionado.** Cada documento (`project.json`, `state.json`, `intake/mode.json`) lleva `schemaVersion`; el serializado es determinista para que Git no vea ruido.
2. **Escritura atómica.** Cada archivo se escribe a un temporal (`open` con `wx`, `write`, `fsync`, `close`) y se promueve con `rename`, con `fsync` del directorio padre.
3. **Staging por run.** Los artefactos se preparan en `.heron/staging/{runId}/` y se promueven en orden lexicográfico. Con el lock tomado, cualquier staging de otro run pertenece a un proceso muerto y se borra (`STAGING_RECOVERED`).
4. **`state.json` es el punto de commit.** Se promueve siempre al final y se valida antes que cada `artifacts[].path` exista. Una caída antes de ese `rename` deja el `state.json` anterior, válido y sin referencias rotas; una diferencia de hash con un artefacto ya promovido se detecta en el siguiente comando (`INPUTS_CHANGED`).
5. **Lock de un escritor con reclamo.** `.heron/.lock` se toma con `wx` y sin espera: si está vivo, el segundo escritor falla de inmediato con exit 6. Un lock vencido (mismo host y pid muerto; otro host con más de 1 h; archivo ilegible de más de 30 s) se reclama mediante un mutex `.heron/.lock.reclaim`, que evita carreras entre reclamantes. Además `commit` recibe `expectedRevision` y falla si `stateRevision` cambió en disco.
6. **Un único importador de `node:fs`.** Solo `src/core/store/**` toca el filesystem (más dos scripts de build acotados), y solo escribe bajo `.heron/`; lo verifica `tests/repo/boundaries.test.ts`.

`.heron/.gitignore` excluye lo transitorio (`.lock`, `.lock.reclaim`, `staging/`, `cache/`, `logs/`, `penpot/snapshots/`); todo lo demás se versiona.

## Alternativas consideradas

- **SQLite.** Da transacciones y consultas, pero el estado no se ve en un diff de Git, exige migraciones y un binario opaco por producto, y nada en V1 necesita consultas ni cola de jobs (D10). Descartada.
- **Postgres (u otro servidor de base de datos).** Añade un servicio que operar y credenciales para un caso de un solo escritor local; contradice el uso por CLI desde un clon (D20). Descartada.
- **Almacenamiento direccionado por contenido.** Complica el diff en Git sin mejorar la garantía de integridad que ya da el commit por `state.json`. Descartada.

## Consecuencias

- El estado se revisa, se ramifica y se restaura con Git; no hay autorreparación: un documento corrupto da exit 3 y el remedio es restaurarlo desde Git.
- Sin base de datos no hay consultas ni agregación entre productos; si una parte futura las necesita, habrá que derivar un índice desde los archivos.
- El lock protege solo procesos que comparten el filesystem; en un FS compartido entre hosts el reclamo espera 1 h, por diseño.
- Un lector concurrente puede ver transitoriamente un artefacto más nuevo que `state.json` y `status` reporta `INPUTS_CHANGED`; se acepta porque `status` es informativo.
- El `fsync` por archivo cuesta latencia; es aceptable para documentos pequeños.
- Cambios incompatibles en un documento suben `schemaVersion`; un Heron antiguo que lee una versión mayor falla nombrando la versión soportada, y nunca escribe un documento que no pudo leer.
