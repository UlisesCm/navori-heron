# Fixtures

All fixtures are SYNTHETIC: they describe invented products and are never derived from a real one.

Convention (P1, closed by P4 / DR30):

- Every fixture has a `SYNTHETIC` file at its root. Its first line is `SYNTHETIC fixture — not a real product.`,
  then a blank line, then the manifest: the byte-ordered list of every data file of the fixture (every regular
  file except `SYNTHETIC`: `.md` and `.json`, `navori.config.json` included), one repo-relative path per line.
- Every `.md` file starts with the line `> SYNTHETIC — fixture data, not a real product.`.
- JSON files carry no marker key: the harness validates `ux.json` with a strict object, so an extra key would
  make the fixture invalid. The manifest is what declares them SYNTHETIC.
- `navori.config.json` uses the default `sdd.specsDir` (`specs`) and its `name` equals the directory name.

| Fixture | Purpose | Expected result |
|---|---|---|
| `membership-product` | Complete product: `MASTER.md` (the role sections of the real template), `DECISIONS.md` (D1, D2), `parts.json`, `UX.md` + valid `ux.json` (3 surfaces, 3 actors, 6 screens, 3 flows, 2 patterns), `context/DIGEST.md` (real 8-section template), `context/CODEBASE.md` and `context/md/brand.md` | `FULL PRODUCT` |
| `conflict` | Same as `membership-product`, except `ACT-PARTNER.capabilities` in `ux.json` also lists "See member data", which `MASTER.md` forbids | `FULL PRODUCT`, exactly one actor conflict (`CONFLICT-001`) |
| `no-ux` | Master plan without `UX.md` and `ux.json` | `REFERENCE ONLY`, no findings |
| `ux-only-md` | `UX.md` without `ux.json` | `REFERENCE ONLY`, `UX_INCONSISTENT` |
| `ux-only-json` | Valid `ux.json` without `UX.md` | `REFERENCE ONLY`, `UX_INCONSISTENT` |
| `ux-invalid` | `ux.json` with exactly 3 schema or relation issues | `REFERENCE ONLY`, `UX_CONTRACT_INVALID` |
| `closed-stage` | Stages `01-alpha` and `02-beta` closed, `03-gamma` abandoned, none active | Falls back to `02-beta` |

Tests never write inside `fixtures/`: they call `copyFixture` and work on a temporary copy.

## Harness probe (DR12)

The four harness JSON of `membership-product` and `conflict` (`index.json`, `state.json`, `parts.json`, `ux.json`)
validate against the real schemas of navori-harness commit `aa149ad5` (`packages/cli/src/lib/master/schema.ts`:
`MasterIndexSchema`, `MasterStateSchema`, `PartsSchema`, `UxContractSchema`). The templates the Markdown files
follow (`master`, `ux`, `digest`, `decisions` in `packages/core/core-assets/master-plan/en/`) are from the same commit.
The probe is manual; run it from a navori-harness checkout at `aa149ad5` (read-only, writes nothing):

```sh
HERON=<path to navori-heron> bun -e 'const s=await import("./packages/cli/src/lib/master/schema.ts");const{readFileSync:r}=require("node:fs");const k=[["index.json",s.MasterIndexSchema],["01-mvp/state.json",s.MasterStateSchema],["01-mvp/parts.json",s.PartsSchema],["01-mvp/ux.json",s.UxContractSchema]];let bad=0;for(const f of ["membership-product","conflict"])for(const[p,z]of k){const x=z.safeParse(JSON.parse(r(`${process.env.HERON}/fixtures/${f}/specs/_master/${p}`,"utf8")));if(!x.success){bad++;console.log(f,p,JSON.stringify(x.error.issues))}}console.log(bad===0?"ok: 8/8 valid":`FAIL: ${bad}`);process.exit(bad===0?0:1)'
```

Result on 2026-10-01: `ok: 8/8 valid`.
