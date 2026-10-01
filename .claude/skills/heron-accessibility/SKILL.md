---
name: heron-accessibility
description: Use when computing or judging contrast, writing accessibility findings (PASS/WARNING/FAIL), checking focus visibility, target sizes, reduced motion, color-independent communication or error states, or building accessibility validators in Heron. WCAG 2.2 thresholds and the contrast formula. Not for DTCG token syntax.
metadata:
  type: reference
  maxWords: 700 # reference cap is 500; carries thresholds, formula and test vectors the model must not approximate
---

# heron-accessibility

**Estado:** el validador de contraste y los de accesibilidad son [P5] (`src/tokens/contrast.ts`, `src/validation/`); aún no existen en P1. Fuente de requisitos: RNF-9 y RN-22 (MASTER), brief §27 (`specs/_master/01-heron/context/md/PLAN.md`).

## Umbrales (RNF-9, D16)

Fuente WCAG 2.2: https://www.w3.org/TR/WCAG22/ (consultado 2026-09-30).

| Qué | Umbral | Criterio WCAG 2.2 |
|---|---|---|
| Texto normal | ≥ 4.5:1 | 1.4.3 Contrast (Minimum) |
| Texto grande, componentes de UI, estados y foco | ≥ 3:1 | 1.4.3 (texto grande); 1.4.11 Non-text Contrast |
| Indicador de foco visible | visible y ≥ 3:1 contra adyacentes | 2.4.7 Focus Visible; 1.4.11 |
| Foco no oculto por contenido del autor | foco no totalmente cubierto | 2.4.11 Focus Not Obscured (Minimum), si aplica |
| Target web | ≥ 24×24 CSS px (o excepciones de espaciado) | 2.5.8 Target Size (Minimum) |
| Target mobile | ≥ 44×44 pt | umbral de Heron (D16), no es un criterio WCAG 2.2 AA |

Texto grande (WCAG): ≥ 18 pt, o ≥ 14 pt en negrita (≈ 24 px / 18.66 px). Los umbrales WCAG no se configuran; los de target mobile y el resto de D16 sí.

## Fórmula de contraste

Luminancia relativa de sRGB (cada canal 0–1): `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`; `L = 0.2126 R + 0.7152 G + 0.0722 B`. Razón: `(L1 + 0.05) / (L2 + 0.05)` con `L1` la mayor. Si el color tiene alfa, componlo contra el fondo antes de medir. Usa `colorjs.io` (Stack, 0.7.1) o el cálculo anterior; **no** redondees antes de comparar con el umbral: 4.499 es FAIL.

Vectores de referencia (el test debe incluirlos): `#000000` sobre `#FFFFFF` = **21.00**; `#767676` sobre `#FFFFFF` = **4.54** (±0.01). Cualquier par semántico se mide en light **y** dark (paridad, brief §28).

## Findings (RN-22)

Nunca un score 0–100. Cada hallazgo es `PASS`, `WARNING` o `FAIL` con evidencia estructurada:

```ts
type ContrastEvidence = { pair: { foreground: string; background: string; tokens?: [string, string] };
  measured: number; threshold: number; theme: "light" | "dark" };
```

- `FAIL`: incumple el umbral (par, valor medido y umbral en la evidencia; sin evidencia no hay finding).
- `WARNING`: no se puede evaluar o hay una excepción justificada pendiente (p. ej. fondo con imagen, componente de usuario).
- `PASS` también se registra con su medición, para que el reporte sea reproducible.
- Un anti-pattern sin justificación registrada es WARNING (RN-19).

## Qué validar en el output de producción (brief §27)

- **Contraste** AA de todos los pares semánticos (texto sobre su superficie, foco, bordes de controles, íconos que comunican estado).
- **Foco visible** en todo elemento interactivo, también sobre fondos de color (3:1) y sin quedar cubierto.
- **Navegación por teclado** donde aplique y semántica para lector de pantalla (guía en `DESIGN.md`).
- **Target mínimo** web 24×24 CSS px, mobile 44×44 pt.
- **Comunicación independiente del color** (SC 1.4.1): estado, error o selección llevan además texto, ícono o forma.
- **Movimiento reducido:** toda animación no esencial tiene alternativa (`prefers-reduced-motion`; SC 2.3.3 es AAA, pero la verificación está en el brief §27).
- **Comunicación de errores:** el error se identifica en texto, junto al campo, con causa y cómo corregirlo; no solo con color (SC 3.3.1, 3.3.3).
- **Estado deshabilitado** reconocible sin depender solo del color; los componentes inactivos están exentos del umbral pero no de ser claros.

## Complemento manual: Penpot

La skill vendorizada `penpot-audit-accessibility` (`.claude/skills/penpot-audit-accessibility/SKILL.md`) audita un diseño en Penpot contra WCAG 2.1/2.2 y propone arreglos sin aplicarlos. Es de invocación manual (`disable-model-invocation`) y no sustituye a los validadores deterministas de Heron: úsala para revisión visual en Penpot; los findings de Heron salen del código con evidencia.

## Checklist

- [ ] Umbrales leídos de RNF-9/D16, no recordados; texto grande clasificado por tamaño/peso reales.
- [ ] Vectores 21.00 y 4.54 (±0.01) cubiertos por un test.
- [ ] Cada finding trae `{pair, measured, threshold}`; ningún score numérico agregado.
- [ ] Light y dark medidos; foco, target y movimiento reducido revisados.
- [ ] Estado y error no dependen solo del color.

Si algún punto falla, corrígelo y repite toda la lista.
