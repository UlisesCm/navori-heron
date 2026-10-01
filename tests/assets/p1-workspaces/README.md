# P1 workspaces (goldens)

SYNTHETIC: every workspace derives from an invented fixture in `fixtures/`, never from a real product.

Each directory holds the `.heron/` that the P1 code wrote with `init`. They are frozen on purpose: they prove
that later contract changes keep reading what P1 persisted (spec 0002, R4).

## Provenance

- Code: commit `9f7a0c7` (P1), checked out with `git worktree add <tmp> 9f7a0c7` and `bun install --frozen-lockfile`.
- Command: `SOURCE_DATE_EPOCH=1790769600 bun bin/heron.ts init <copy of fixtures/{membership-product,no-ux}>`.
- Generated: 2026-09-30.
- Copied: `.heron/` without `staging/` and `.lock`. The fixture itself is not duplicated; tests combine
  `fixtures/<name>` with `tests/assets/p1-workspaces/<name>/.heron` through `copyFixture`.

Never regenerate these with newer code. Tests never write here; they work on a temporary copy.
