# ADR 0003: Frontera de fuentes de research

- Estado: aceptada
- Fecha: 2026-10-01
- Referencias: `specs/0002-research/design.md` (§Contracts 4 y 5, DR10 a DR12, DR18, DR19, DR22); `specs/_master/01-heron/MASTER.md` (Seguridad); D28, D29. La numeración `0002` queda reservada para `0002-store-write-zones.md` (zonas de escritura, P3)

## Contexto

Research registra referencias visuales que vienen de fuera: páginas, DESIGN.md, screenshots y archivos del usuario. Todo eso es contenido ajeno: una URL puede apuntar a la red interna o a la metadata de un proveedor cloud (SSRF), una ruta puede escapar del repo, un texto puede traer frases con forma de instrucción para un agente. Heron escribe en el repo del producto, así que la captura no puede tener efectos secundarios ni decidir nada a partir de lo capturado.

P2 solo trae cuatro fuentes (`manual`, `url`, `image`, `design-md`), pero el enum ya reserva `penpot` (P6) y `refero` (P10). Hace falta una frontera que permita añadir fuentes sin tocar los casos de uso ni debilitar la seguridad, y que `tests/repo/boundaries.test.ts` pueda verificar.

## Decisión

1. **Un puerto, `ResearchSource`** (`src/research/ports.ts`): `capture(request): Promise<CaptureResult>`. Es sin estado, nunca escribe y nunca lanza ante entrada hostil: devuelve `{ ok: false, failure }` con un código de la lista cerrada `CAPTURE_FAILURE_CODES`. Sus efectos pasan solo por `request.services` (`fetcher`, `images`, `fs` de solo lectura, `root`). Devuelve los archivos a guardar (`CapturedFile`) y `app` los prepara en staging; el adapter no toca `.heron/`.
2. **Registro único.** `src/research/registry.ts` es el único importador de `src/research/adapters/**` (`sourceFor`, `availableSourceKinds`). Una fuente sin adapter registrado responde `ADAPTER_NOT_AVAILABLE` (exit 5).
3. **La red entra solo por `Fetcher`** (`createSafeFetcher`, `src/security/fetch/safe-fetch.ts`), con `Resolver` y `Transport` inyectados. `src/security/fetch/system.ts` es el único archivo con `fetch(` y `node:dns`; lo exige `tests/repo/boundaries.test.ts`. La política de destino está en [docs/security.md](../security.md#ssrf).
4. **Los archivos entran por una sonda de solo lectura** (`readInputFile`, D28): resuelve la ruta, comprueba tamaño y tipo, lee una sola vez y calcula los hashes sobre esos mismos bytes. Solo `src/core/store` escribe (ADR 0001).
5. **El contenido capturado es dato.** Se guarda tal cual con `trust: "untrusted"` y el escáner de `src/security/untrusted.ts` solo registra hallazgos; ningún código lee esos hallazgos para decidir. Las imágenes pasan por `src/security/images/sanitize.ts` ([ADR 0004](0004-sharp-image-sanitizing.md)).
6. **Las primitivas de seguridad son puras o inyectables.** `src/security/` no toca el filesystem; el clasificador de IP, el escape, la redacción y el escáner se prueban sin red. `src/research/` no importa `src/intake/ports.ts` en runtime.

## Alternativas consideradas

- **Lógica de captura dentro de cada caso de uso.** Duplica la política de red y de rutas por comando y no permite añadir una fuente sin tocar `app`. Descartada.
- **Un solo módulo de ingesta sin puerto.** Más corto hoy, pero Penpot y Refero traerían sus propios clientes de red sin pasar por la política SSRF. Descartada.
- **Dependencia externa para clasificar IP (`ipaddr.js`).** Son unas 120 líneas con la tabla IANA completa y falla cerrado ante una dirección que no parsea (DR12); una dependencia más amplía la superficie sin ganar cobertura. Descartada.
- **Sink de logs JSONL desde P2.** Ningún requisito lo pide y lo bloqueado ya queda en el envelope y en `references.json`; entra en P3 con su primer consumidor (DR22). Diferida.

## Consecuencias

- Añadir una fuente es un adapter más y una línea en el registro; hereda fetcher, sanitizer y lectura de archivos sin poder saltárselos.
- Los casos de uso capturan fuera del lock y comprueban `expectedRevision` al hacer commit (DR6): si otro comando escribió, exit 6 y la captura se repite.
- La política de red es estricta por diseño: `http` público no existe, y `--allow-local` autoriza solo destinos locales y se registra en la provenance. Un servicio local legítimo exige el flag explícito del operador.
- El `DNS` se resuelve una vez por salto y se conecta a la IP validada; un cambio posterior de resolución no afecta al salto en curso. El proxy de entorno (`HTTPS_PROXY`) lo respeta Bun; que excluya IP literales de `NO_PROXY` no está verificado y no cambia la decisión.
- La lectura de un archivo sufre una ventana TOCTOU local entre `lstat` y la lectura; se acepta porque la CLI es de un solo usuario. La Web UI (P8) deberá subir bytes, no rutas.
