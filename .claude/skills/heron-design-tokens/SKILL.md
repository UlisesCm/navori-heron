---
name: heron-design-tokens
description: Use when writing, validating or exporting DTCG design tokens in Heron (.tokens.json, .resolver.json), layering primitive/semantic/component, theming light/dark, deriving a brand color variant, or wiring Terrazzo and colorjs.io. Relevant from P5 (src/tokens). Not for contrast thresholds (heron-accessibility) or Penpot sync.
metadata:
  type: reference
  maxWords: 850 # reference cap is 500; body ~806 words; carries the DTCG facts the model cannot recall exactly plus Heron's rules
---

# heron-design-tokens

**Estado:** `src/tokens/` es [P5]; no existe en P1. Esta skill es la guía para escribirlo y revisarlo. Antes de usar versiones, lee `package.json`: MASTER (Stack y librerías) fija `@terrazzo/parser` 2.7.1 y `colorjs.io` 0.7.1 (RNF-15: solo las del Stack; agregar otra exige ADR).

## Formato DTCG 2025.10 (verificado)

Fuentes, consultadas 2026-09-30: https://www.designtokens.org/TR/2025.10/format/ · https://www.designtokens.org/TR/2025.10/resolver/ · módulo Color https://www.designtokens.org/TR/2025.10/color/.

- Un token es un objeto con `$value`; la clave del padre es el nombre. `$type` (opcional por token) se hereda del grupo más cercano o del token referenciado; **nunca se adivina por el contenido**: sin tipo resoluble el token es inválido. `$description` y `$extensions` (clave de vendor, se preservan) son opcionales.
- **Nombres:** no pueden empezar con `$` ni contener `{`, `}` ni `.` (el punto separa el path del alias). Distinguen mayúsculas; evita nombres que difieran solo por caja.
- **Color:** `$value: { colorSpace, components, alpha?, hex? }`; `components` son números o `none`; `alpha` 0–1 (omitido = 1); `hex` es fallback de 6 dígitos. Espacios incluyen `srgb`, `srgb-linear`, `hsl`, `oklab`, `oklch` (L 0–1, C ≥ 0, H [0,360)), `display-p3`.
- **Dimension:** `$value: { value: number, unit: "px" | "rem" }`; `unit` es obligatorio incluso en 0. **No** es un string `"16px"`.
- **Alias:** `"{group.token}"` (llaves) apunta a un token completo y resuelve a su `$value`; `{ "$ref": "#/colors/blue/$value" }` (JSON Pointer, RFC 6901) apunta a cualquier ubicación (p. ej. `.../components/0` o `.../$value/unit`). Los dos son obligatorios para las herramientas; la curly es la que usa Heron para token→token.
- **Archivos:** `.tokens.json` (o `.tokens`); media type `application/design-tokens+json`.
- **Resolver (`.resolver.json`):** `version` debe ser `"2025.10"`; `sets` (fuentes ordenadas; la última gana), `modifiers` con `contexts` (DEBERÍA tener ≥ 2; 0 contextos es error; un modifier no referencia otro modifier) y `default`, y `resolutionOrder` obligatorio (el orden es significativo; no se referencia `#/resolutionOrder/…`). Una permutación = una combinación de contextos → un conjunto final de tokens.

```json
{
  "color": {
    "$type": "color",
    "brand": { "600": { "$value": { "colorSpace": "oklch", "components": [0.55, 0.18, 250], "hex": "#0b63c5" } } }
  },
  "semantic": { "action": { "primary": { "background": { "$type": "color", "$value": "{color.brand.600}" } } } }
}
```

(Ejemplo ilustrativo; el `hex` debe coincidir con los `components`.)

## Reglas de Heron (MASTER)

- **RN-17 — capas:** `primitive → semantic → component`. Component tokens solo si aportan valor; semántica mínima: background, surface, content, border, action, interactive, feedback (success/warning/danger/info), focus, disabled, selected; estados cuando apliquen: default, hover, pressed, focused, selected, disabled, loading. Evitar explosión innecesaria de tokens (brief §18, §19).
- **Dirección de alias:** component → semantic → primitive; nunca al revés ni saltando la semántica en pantallas. Un valor arbitrario fuera de tokens es hallazgo del validador `arbitrary values` (brief §28).
- **Light/dark:** el Resolver define el modifier de tema y el export lleva archivos **pre-resueltos** `light` y `dark` junto a `resolver` (MASTER §Export `dist/`: `tokens/` primitive, semantic, component, resolver, light, dark). Los validadores comprueban paridad light/dark y que cada par semántico cumpla RNF-9 en ambos temas (ver `heron-accessibility`).
- **Variante de marca (RN-15, D16):** si el color de marca es inutilizable para una función (p. ej. contraste insuficiente como fondo de acción), se deriva una variante en OKLCH que preserva hue y carácter: **Δhue ≤ 10°**, configurable (D16). Se registra una `Decision` con la causa, el color original, la variante y el Δhue medido. Nunca se mezclan colores de referencias matemáticamente (RN-12).
- **Validación:** `@terrazzo/parser` valida DTCG y resuelve el Resolver 2025.10 (MASTER, plan3); `colorjs.io` hace conversión OKLCH/sRGB y contraste. Ambos solo se importan desde `src/tokens/` (tabla `VENDORS`, ver `heron-architecture`). Antes de usar un API, léelo en https://terrazzo.app/docs/reference/js-api/ (consultado 2026-09-30); no lo recuerdes de memoria.
- **Determinismo (RNF-2):** serializar con `canonicalJson` (claves ordenadas, sin fechas); mismo input → mismos bytes por `SOURCE_DATE_EPOCH`; ordenar con `compareStrings`, no `localeCompare`. Redondea componentes con una política fija y documentada.
- Los tokens dicen **qué valores existen**; `DESIGN.md` dice cómo y por qué usarlos y no copia `UX.md` (RN-18).

## Errores frecuentes

- `"$value": "16px"` o `{ "value": "16" }`: la dimensión es `{ value: number, unit }`.
- Punto, `{` o `}` en un nombre de token: rompe los alias.
- `$type` ausente sin padre que lo defina: token inválido.
- Resolver con `version` distinta de `"2025.10"` o con un modifier sin contextos (error); con uno solo, advertir (DEBERÍA tener ≥ 2).
- Referenciar un modifier desde otro modifier o un set.
- Aprobar una variante de marca sin la decisión registrada.

## Checklist

- [ ] Versiones de `@terrazzo/parser`/`colorjs.io` leídas de `package.json`.
- [ ] Cada token tiene `$type` resoluble; dimensiones con `unit`; nombres sin `$ { } .`.
- [ ] Capas respetadas; component tokens justificados.
- [ ] Light y dark pre-resueltos y con paridad; contraste validado por par.
- [ ] Variante de marca con Δhue ≤ 10° y `Decision` registrada.
- [ ] Export idéntico byte a byte en dos corridas.

Si algún punto falla, corrígelo y repite toda la lista.
