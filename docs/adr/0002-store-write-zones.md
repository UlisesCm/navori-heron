# ADR 0002: Zonas de escritura del store

- Estado: aceptada
- Fecha: 2026-10-01
- Referencias: `specs/0003-agents-directions/design.md` (§Contracts 1, DR16, DR45); enmienda de DP2 en `docs/adr/0001-state-persistence.md`; `specs/_master/01-heron/MASTER.md` (Seguridad)

## Contexto

La ADR 0001 fijó que solo `src/core/store/**` importa `node:fs` y que escribe únicamente bajo `.heron/`. P3 necesita dos escrituras que esa regla no cubre: un directorio temporal vacío como `cwd` del agente (R1) y un log append-only de invocaciones (R15, R21). P5 sumará la exportación al directorio que elija el usuario. Hace falta enumerar las zonas permitidas en vez de abrir el store a cualquier ruta.

## Decisión

El store tiene cuatro zonas de escritura; fuera de ellas no se escribe.

1. **`FileStore`**: solo `.heron/`, transaccional (staging, `rename`, `fsync`, lock), como en la ADR 0001.
2. **`append-log`** (`src/core/store/append-log.ts`): solo `.heron/logs/<YYYY-MM-DD>.jsonl` (UTC), con `openSync(path, "a")` y sin `fsync` (best effort). `write` traga los errores del filesystem: un log nunca detiene un comando. La poda borra por nombre los archivos con más de `retentionDays` días y no toca otros nombres. `logs/` está en `.heron/.gitignore`.
3. **`TempDirPort`** (`src/core/store/temp-dir.ts`): directorios nuevos bajo `os.tmpdir()` (`mkdtemp`, modo 0700, archivos 0600, nombres planos validados), con `dispose` recursivo que ignora errores. Es el único archivo del store que importa `node:os`; `tests/repo/boundaries.test.ts` lo restringe junto con `src/app/context.ts`.
4. **`ExportWriter`** (P5, aún no existe): solo `--out`, resuelto con `resolveInside` y con reemplazo atómico del directorio. Esta ADR reserva la zona; P5 la amplía.

`FsPort.openSync` acepta además el flag `"a"`.

## Alternativas consideradas

- **Que el agente corra con `cwd` dentro de `.heron/`.** Le daría al hijo acceso de lectura al estado del producto. Descartada: R1 exige un directorio vacío ajeno al repo.
- **Escribir los logs con `writeAtomic`.** Reescribe el archivo entero por línea y exige `fsync` de archivo y directorio; un log es best effort y crece por append. Descartada.
- **Un puerto de escritura genérico con ruta libre.** Borra la frontera que verifican los tests. Descartada.

## Consecuencias

- Hay cuatro puntos de escritura auditables, cada uno con su test; un quinto exige otra ADR.
- Un log puede perder la última línea ante una caída o un disco lleno; es aceptable porque el estado del producto no depende de él.
- Un temporal que no se pudo borrar queda en `os.tmpdir()`; no contiene secretos (el contexto viaja por stdin).
- `status` y `doctor` derivan los totales de uso de `readLogEvents`; si los logs se podaron, los totales son cero y no hay aviso.
