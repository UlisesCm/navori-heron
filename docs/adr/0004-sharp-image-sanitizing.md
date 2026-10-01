# ADR 0004: Saneo de imágenes con sharp

- Estado: aceptada
- Fecha: 2026-09-30
- Referencias: `specs/0002-research/design.md` (DR13, DR14, DR15, DR21); `specs/_master/01-heron/MASTER.md` (Seguridad); D15, D16

## Contexto

Las referencias visuales y los logos de marca llegan como archivos ajenos (screenshots, descargas, adjuntos). Una imagen puede traer metadata sensible (EXIF con GPS, XMP, IPTC, perfil ICC), declarar dimensiones enormes para agotar memoria, o ser un formato activo (SVG) o animado (GIF) disfrazado. El moodboard las muestra en HTML y los assets se versionan en Git (D15), así que lo que se guarda debe ser inerte, acotado y estable byte a byte.

Heron corre en Bun y no puede depender de binarios del sistema (ImageMagick, `cwebp`) ni de un servicio externo. Se necesita decodificar PNG, JPEG y WebP, aplicar la orientación EXIF, re-codificar sin metadata y rechazar lo desmedido antes de decodificar (D16: 20 MB y 50 MP).

## Decisión

Usar `sharp@0.35.5` (versión exacta, `bun.lock` versionado) detrás de `src/security/images/sanitize.ts`, el único importador del paquete (lo exige `tests/repo/boundaries.test.ts`):

1. **Orden de defensas.** Tamaño del archivo (≤ 20 MiB) → magic bytes PNG/JPEG/WebP **antes** de sharp, porque sharp también acepta SVG y GIF → `metadata()` con `limitInputPixels: 50_000_000` (un PNG de 68 bytes que declara 9000×9000 se rechaza sin decodificar) → el formato que reporta sharp debe coincidir con los magic bytes → `autoOrient()` → WebP `quality: 82, effort: 4` sin `keepMetadata` → verificación propia de que el RIFF de salida solo contiene `VP8 `, `VP8L`, `VP8X` o `ALPH`. Una animación conserva solo el primer cuadro.
2. **Carga perezosa.** `import("sharp")` literal y en caché: `init`, `status` y `references add --source manual` no pagan los 22–47 ms de la carga ni fallan si falta el binario nativo; las órdenes con imagen salen con `IMAGE_ENGINE_UNAVAILABLE` (exit 5) y el remedio `bun install --frozen-lockfile`.
3. **Sin scripts de instalación.** `package.json` declara `"trustedDependencies": []`. Bun ejecuta los scripts de ciclo de vida de una lista por defecto salvo que `trustedDependencies` exista, en cuyo caso la reemplaza; `[]` no permite ninguno. `sharp` 0.35.5 y sus dependencias (`@img/sharp-*`, `@img/sharp-libvips-*`, `@img/colour`, `detect-libc`, `semver`) no tienen scripts `install` ni `postinstall`, de modo que `[]` es más estricto que "solo sharp" de MASTER y no rompe la instalación (`bun pm untrusted`: 0). Revertir es agregar `"sharp"` a la lista.
4. **Dedupe por contenido de salida.** El asset se nombra por el sha256 del WebP resultante; el sha256 del original se guarda como trazabilidad (DR21).

Fuentes consultadas el 2026-09-30: `npm view sharp@0.35.5` y el registro público (https://www.npmjs.com/package/sharp: `latest` = 0.35.5, publicada el 2026-09-27, `engines.node >= 20.9.0`, binarios por `optionalDependencies` `@img/sharp-*` 0.35.5 y `@img/sharp-libvips-*` 1.3.4); https://sharp.pixelplumbing.com/install (binarios precompilados por plataforma; Bun se instala con `bun add sharp`); https://sharp.pixelplumbing.com/api-output (la salida elimina por defecto toda la metadata, incluido el perfil ICC); https://bun.com/docs/install/lifecycle (`trustedDependencies`).

## Alternativas consideradas

- **`jimp` (JS puro).** Evita el binario nativo, pero no se verificó que ofrezca un límite de píxeles previo a la decodificación ni salida WebP controlable; sin esas dos garantías, el orden de defensas de la Decisión no se puede cumplir. Descartada sin sonda propia.
- **`@napi-rs/canvas` o `canvas`.** Traen API de dibujo que no se necesita y no se verificó que expongan el control de metadata de salida y el límite de píxeles que pide R11. Descartada sin sonda propia.
- **ImageMagick o `cwebp` por línea de comandos.** Exige instalar herramientas del sistema, y `child_process` está prohibido en la tabla de fronteras (P3 lo revisa). Descartada.
- **Guardar el original sin recodificar.** Conserva EXIF/GPS/XMP y formatos activos en Git. Descartada por RN-36 y R11.
- **Limpiar la metadata a mano (parser propio de JPEG/PNG).** Es una superficie de ataque nueva y frágil frente a cada formato. Descartada.

## Consecuencias

- Una dependencia con binario nativo por plataforma: `bun install` baja paquetes `@img/*` (6 paquetes, ~1,3 s en la sonda) y libvips (LGPL-3.0-or-later) llega como paquete aparte, enlazado dinámicamente. Cualquier distribución futura debe respetar esa licencia y no copiar libvips dentro del repo.
- Un upgrade de sharp puede cambiar los bytes de salida; un re-import crea entonces otro asset con otro sha256. Se acepta (acotado) y el original se identifica por `original.sha256`.
- La verificación de chunks de salida es una defensa propia: si una versión futura de sharp conservara metadata, la importación falla con `IMAGE_UNREADABLE` en vez de guardarla.
- `doctor` no gana un check de sharp en P2 (cambiaría el resumen de P1); la falta del motor se explica en cada orden que lo necesita.
- Se acepta que sharp decodifica contenido ajeno dentro del proceso; los límites de bytes y de píxeles, y la comprobación previa de magic bytes, acotan ese riesgo. Aislar el decodificador en un proceso aparte queda como alternativa si una parte futura recibe subidas de usuarios no confiables (P8).
