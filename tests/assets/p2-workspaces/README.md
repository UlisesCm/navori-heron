# P2 workspaces (goldens)

SYNTHETIC: every workspace derives from an invented fixture in `fixtures/`, never from a real product.

Each directory holds the `.heron/` that the P2 code wrote with `init`, five manual `references add` and
`research render`, over the already rewritten `membership-product` fixture and with no gate decisions (spec 0004,
DR24). They are frozen on purpose: they prove that the P4 contracts keep reading what P2 persisted (R18).

## Provenance

- Code: commit `b8ee0a9` (P2), checked out with `git worktree add <tmp>/heron-p2 b8ee0a9` and `bun install --frozen-lockfile`.
- Generated: 2026-10-01, after rewriting the fixture and before touching any P4 contract.
- Commands, all run in the P2 checkout with `SOURCE_DATE_EPOCH=1790769600` over a copy of `fixtures/membership-product`:
  1. `bun bin/heron.ts init <copy>`
  2. five times `bun bin/heron.ts references add <copy> --source manual --origin "<origin>" --reason "<n>" --study "<n>" --do-not-copy "<n>" --influence "<n>"`, with the origins `Linear pricing page`, `Stripe dashboard`, `Notion onboarding`, `Airbnb search` and `Spotify library`
  3. `bun bin/heron.ts research render <copy>`
- Copied: `.heron/` without `staging/` and `.lock`. The fixture itself is not duplicated; tests combine
  `fixtures/<name>` with `tests/assets/p2-workspaces/<name>/.heron` through `copyP2Workspace`.

Never regenerate these with newer code. Tests never write here; they work on a temporary copy.
