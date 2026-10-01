# Research (P2)

Research registra referencias visuales y datos de marca con provenance completa, **sin IA**, en `.heron/research/` y `.heron/brand/`. Todo es determinista y versionable en Git. Las defensas frente a contenido externo están en [docs/security.md](security.md); la frontera de fuentes, en el [ADR 0003](adr/0003-research-source-boundary.md).

Los comandos requieren `heron init` previo (exit 3 si no hay `.heron/`). La salida de los comandos está en inglés; los archivos generados (`REFERENCES.md`, moodboard) usan el idioma del producto.

## Flujo

1. `heron init [path] --locale es`: fija el idioma de las salidas (`--locale` valida un tag BCP 47; sin él se conserva el previo y, sin ninguno, las salidas salen en `en` con el aviso `LOCALE_FALLBACK`).
2. `heron references add …` o `heron references import <file.json>`: captura cada referencia con su provenance. La primera mueve la fase `initialized`/`intake-ready` a `researching`.
3. `heron brand add …`: registra insumos de marca con su origen (opcional, en cualquier fase).
4. `heron research render`: regenera las cuatro salidas y las deja listas para abrir.
5. Con 5 o más referencias con provenance completa (D16), `heron gate research approve` pasa a `research-ready`. Con menos, el gate falla nombrando el conteo.

`references add|import|remove` y `brand add` regeneran las salidas en la misma transacción; `research render` sirve para reconstruirlas y es idempotente: si los bytes no cambian, no escribe ni sube la revisión.

## Comandos

```text
heron references add [path] --source <kind> [--origin <text>] [--url <url>] [--file <path>] [--screenshot]
    [--allow-local] --reason <text> --study <text>... --do-not-copy <text>... --influence <text>...
    [--crop <x,y,w,h=note>]... [--json]
heron references list [path] [--all] [--json]
heron references show <REF-n> [path] [--json]
heron references compare <REF-n> <REF-n> [<REF-n> <REF-n>] [path] [--json]
heron references remove <REF-n> [path] [--reason <text>] [--json]
heron references import <file.json> [path] [--allow-local] [--json]
heron brand add [path] --kind <kind> --origin <origin> --value <text> [--file <path>] [--reference <REF-n>] [--note <text>] [--json]
heron research render [path] [--json]
```

### Provenance obligatoria

Toda referencia lleva `source`, `origin`, `reason`, `studies[]`, `doNotCopy[]` e `influences[]` (cada lista con 1 a 20 elementos de hasta 500 caracteres), más `capturedAt` (ISO-8601, del reloj del contexto) y el modo efectivo al capturar. Si falta alguno: exit 2, `PROVENANCE_INCOMPLETE` nombra los campos faltantes con su flag (p. ej. `reason (--reason), doNotCopy (--do-not-copy)`) y no se escribe nada.

### Fuentes (`--source`)

| Fuente      | Requiere                                               | Qué guarda                                                          |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `manual`    | `--origin`                                             | Solo la provenance, sin I/O                                         |
| `url`       | `--url` (el origen se deriva; `--origin` no se admite) | La página como `research/sources/{sha256}.txt` o `.md`, `untrusted` |
| `image`     | `--file` y `--origin` (`--screenshot`, `--crop`)       | WebP saneado en `research/assets/{sha256}.webp`                     |
| `design-md` | `--file` y `--origin`, o `--url` sin `--origin`        | El DESIGN.md como `research/sources/{sha256}.md`, `untrusted`       |

`--allow-local` solo se admite con `--url` (ver [SSRF](security.md#ssrf)). Una fuente no registrada (`penpot`, `refero`) responde `ADAPTER_NOT_AVAILABLE` (exit 5).

### Crops

`--crop "x,y,w,h=nota"` (enteros ≥ 0, repetible, solo en `image`) marca una zona del screenshot con su nota; el rectángulo debe caber en la imagen ya orientada (si no, `CROP_INVALID`, exit 2). El moodboard resalta cada crop.

### Importación por lote

`heron references import <file.json>` lee un `ReferenceBatch` (esquema `schemas/reference-batch.v1.schema.json`): todo o nada, hasta 200 referencias y 1 MiB, con claves estrictas (un error de tipeo como `doNotcopy` falla). Cada ítem usa los mismos campos que `references add` (`source`, `origin`, `reason`, `studies`, `doNotCopy`, `influences`, `file`, `url`, `screenshot`, `crops`), sin `allowLocal`: lo autoriza solo `--allow-local` en la línea de comandos. El archivo del lote y las rutas que lista deben estar dentro del repo; las relativas se resuelven desde el directorio del lote. Un lote válido es una sola transición y una sola entrada de historial; si un ítem falla (`PROVENANCE_INCOMPLETE`, `REFERENCE_INPUT_INVALID`, `BATCH_INVALID`, captura), no se escribe nada.

```json
{
  "kind": "ReferenceBatch",
  "schemaVersion": 1,
  "references": [
    {
      "source": "manual",
      "origin": "Home de un competidor",
      "reason": "Jerarquía clara del hero",
      "studies": ["Jerarquía tipográfica"],
      "doNotCopy": ["Marca y logotipo"],
      "influences": ["Densidad de la cabecera"]
    }
  ]
}
```

### Comparar, listar y quitar

`list` muestra las referencias activas y el conteo frente al mínimo (`--all` incluye las retiradas); `show` una referencia completa con sus crops y hallazgos; `compare` de 2 a 4 referencias lado a lado, con los valores compartidos en estudios, qué no copiar e influencias (`Shared: … | none`, sin inventar coincidencias). `remove` es baja lógica: la referencia queda con `removed` en `references.json` y sus assets se conservan.

### Marca

`brand add` exige un `--kind` de los 11 (`logo`, `brand-color`, `secondary-color`, `font`, `brand-guidelines`, `screenshot`, `url`, `existing-product`, `competitor`, `liked-reference`, `disliked-reference`) y un `--origin` válido: `provided`, `derived`, `inferred` o `reference-derived`. Sin origen o con uno inválido: exit 2 (`BRAND_INPUT_INVALID`), sin escribir. `reference-derived` exige `--reference <REF-n>` (una referencia activa) y ese flag solo se admite con ese origen. `--file` guarda un logo saneado en `brand/assets/`. `brand add` no invalida la aprobación del gate research.

## Salidas y layout

```text
.heron/
  research/
    references.json          fuente de verdad (atado al gate research)
    provenance.json          proyección derivada de las referencias (atado al gate research)
    REFERENCES.md            vista derivada, idioma del producto; no editar a mano
    moodboards/index.html    vista estática con CSP, sin recursos externos
    assets/{sha256}.webp     imágenes saneadas
    sources/{sha256}.md|.txt texto externo tal cual, untrusted
  brand/
    brand.json               insumos de marca con su origen
    assets/{sha256}.webp     imágenes de marca saneadas
```

Todo se versiona en Git (D15); `status` avisa con `ASSETS_LARGE` si las imágenes superan 50 MiB. Los originales nunca se copian: de un archivo local solo se guarda el nombre y si venía del repo o de fuera. Cada salida declara el modo: `reference-only` mientras exista una referencia activa capturada en ese modo, aunque el proyecto ya esté en `full`. `research render` en fases de producción solo puede reescribir las vistas; si `references.json` o `provenance.json` cambiaran, sale con exit 3 (`TRANSITION_NOT_ALLOWED`). Desde una fase de producción tampoco se puede `references add|import|remove`: el research queda congelado.

## Códigos de salida

| Código | En research                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | OK                                                                                                                                                                                                                                                                                    |
| 2      | Entrada inválida o incompleta (`PROVENANCE_INCOMPLETE`, `REFERENCE_INPUT_INVALID`, `REFERENCE_NOT_FOUND`, `BATCH_INVALID`, `CROP_INVALID`, `BRAND_INPUT_INVALID`, `INVALID_URL`, `UNSUPPORTED_MEDIA_TYPE`, `INPUT_TOO_LARGE`, `IMAGE_UNREADABLE`, `PATH_NOT_FOUND`, `LOCALE_INVALID`) |
| 3      | Política: `SSRF_BLOCKED`, `UNSAFE_PATH`, no inicializado, `TRANSITION_NOT_ALLOWED`, documento inválido                                                                                                                                                                                |
| 5      | Red o motor no disponible: `FETCH_FAILED`, `IMAGE_ENGINE_UNAVAILABLE`, `ADAPTER_NOT_AVAILABLE`                                                                                                                                                                                        |
| 6      | Lock tomado por otro escritor o revisión de `state.json` cambiada                                                                                                                                                                                                                     |
| 1      | Error inesperado                                                                                                                                                                                                                                                                      |

## Recorrido manual sobre `monorepo-fullstack` (P2.A9)

Comprueba P2 con un producto real de forma segura. Heron solo escribe `.heron/`; el resto del repo no se toca.

1. **Rama desechable.** En `monorepo-fullstack`: `git switch -c chore/heron-research`. Antes de empezar y al final, `git status` debe mostrar cambios solo bajo `.heron/`.
2. **Inicializar.** `heron init <repo> --locale es`. Debe mostrar `REFERENCE ONLY`.
3. **Screenshot con crop.** Pasa la ruta explícita, incluso fuera del repo:

   ```bash
   heron references add <repo> --source image --screenshot \
     --file /ruta/absoluta/screenshot.png \
     --origin "<producto y pantalla>" --reason "<por qué>" \
     --study "<qué se estudia>" --do-not-copy "branding" \
     --influence "<decisión que influye>" --crop "<x>,<y>,<w>,<h>=<nota>"
   ```

   El original no se toca; en `.heron/` solo queda su nombre de archivo, nunca la ruta.

4. **URL pública y DESIGN.md externo.** Una referencia con `--source url --url https://…` (sin `--allow-local`) y otra con `--source design-md --url <URL https pública del DESIGN.md>` (o `--file <ruta>.md`), ambas con razón, estudios, qué no copiar e influencias. Revisa el bloque `Security findings` de la salida: cualquier `SUSPICIOUS_INSTRUCTION` o `HIDDEN_TEXT` es un aviso para ti, Heron no actúa sobre él.
5. **Completar y renderizar.** Suma referencias hasta tener al menos 5 (`heron references list <repo>` muestra el conteo y `heron references add` indica cuándo está `ready for: heron gate research approve`). Luego `heron research render <repo>` y abre `.heron/research/moodboards/index.html` en el navegador. En cada tarjeta verifica fuente, razón, qué se estudia, qué no copiar y, en el screenshot, el crop resaltado. Opcional: `heron gate research approve <repo> --yes`.
6. **Cierre.** Responde "Aprobado" si todo cumple. Commitear `.heron/` en esa rama es decisión tuya.
