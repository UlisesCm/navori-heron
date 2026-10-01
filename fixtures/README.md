# Fixtures

All fixtures are SYNTHETIC: they describe invented products and are never derived from a real one.

Convention (P1):

- Every fixture has a `SYNTHETIC` file at its root (`SYNTHETIC fixture — not a real product.`).
- Every `.md` file starts with the line `> SYNTHETIC — fixture data, not a real product.`.
- JSON files carry no marker key: the harness draft validates `ux.json` with a strict object, so an
  extra key would make the fixture invalid. P4 closes the final rule for JSON (P4.A6).
- `navori.config.json` uses the default `sdd.specsDir` (`specs`) and its `name` equals the directory name.

| Fixture | Purpose | Expected result |
|---|---|---|
| `membership-product` | Complete UX (`UX.md` + valid `ux.json`), 3 surfaces, 6 screens, 3 flows, 2 patterns | `FULL PRODUCT` |
| `no-ux` | Master plan without `UX.md` and `ux.json` | `REFERENCE ONLY`, no findings |
| `ux-only-md` | `UX.md` without `ux.json` | `REFERENCE ONLY`, `UX_INCONSISTENT` |
| `ux-only-json` | Valid `ux.json` without `UX.md` | `REFERENCE ONLY`, `UX_INCONSISTENT` |
| `ux-invalid` | `ux.json` with exactly 3 schema or relation issues | `REFERENCE ONLY`, `UX_CONTRACT_INVALID` |
| `closed-stage` | Stages `01-alpha` and `02-beta` closed, `03-gamma` abandoned, none active | Falls back to `02-beta` |

Tests never write inside `fixtures/`: they call `copyFixture` and work on a temporary copy.
