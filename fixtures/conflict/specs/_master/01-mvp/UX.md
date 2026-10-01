> SYNTHETIC — fixture data, not a real product.

# UX contract

## Metadata
<!-- ux-kind: metadata -->

Project: conflict. Stage: 01-mvp. Date: 2026-09-01. Mode: template. Surfaces: MOBILE, DASHBOARD, PARTNER. Actors: ACT-MEMBER, ACT-PARTNER, ACT-ADMIN.

## Sources and authority
<!-- ux-kind: sources -->

Base documents: DECISIONS.md, MASTER.md, parts.json, context/DIGEST.md, context/CODEBASE.md, context/md/brand.md. An explicit decision in DECISIONS.md wins over a UX inference.

## Surfaces
<!-- ux-kind: surfaces -->

- MOBILE: Member app, used by ACT-MEMBER (RN-1, RF-1, RF-2).
- DASHBOARD: Admin dashboard, used by ACT-ADMIN (RF-4).
- PARTNER: Partner portal, used by ACT-PARTNER (RN-2, RF-3).

## Actors
<!-- ux-kind: actors -->

- ACT-MEMBER: Member. Goal: use partner benefits.
- ACT-PARTNER: Partner. Goal: attract members with benefits.
- ACT-ADMIN: Admin. Goal: run the membership program.

## Journeys
<!-- ux-kind: journeys -->

- J01: First benefit (ACT-MEMBER, flow F01).
- J02: Run the program (ACT-ADMIN, flow F02).
- J03: Offer a benefit (ACT-PARTNER, flow F03).

## Flows
<!-- ux-kind: flows -->

- F01: Join (SCR-MOBILE-01, SCR-MOBILE-02).
- F02: Manage members (SCR-DASHBOARD-01, SCR-DASHBOARD-02).
- F03: Offer benefits (SCR-PARTNER-01, SCR-PARTNER-02).

## Information architecture
<!-- ux-kind: information-architecture -->

Each surface has a root list and one detail or action screen.

## Screen inventory
<!-- ux-kind: screens -->

- SCR-MOBILE-01: Benefit catalog.
- SCR-MOBILE-02: Benefit redemption.
- SCR-DASHBOARD-01: Member list.
- SCR-DASHBOARD-02: Member detail.
- SCR-PARTNER-01: Benefit publishing.
- SCR-PARTNER-02: Redemption validation.

## Functional components
<!-- ux-kind: components -->

- C01: Benefit list.
- C02: Member table.

## Functional patterns
<!-- ux-kind: patterns -->

- PT01: Benefit card.
- PT02: Data table.

## Global states
<!-- ux-kind: global-states -->

`loading`, `empty`, `error`, `unauthorized`, `membership-expired`.

## UX requirements
<!-- ux-kind: ux-requirements -->

- UX-1: A member must know the membership status before starting a redemption.
- UX-2: A partner must see the validation result immediately.

## Navigation
<!-- ux-kind: navigation -->

Each surface opens on its list and drills into one screen; there are no cross-surface links.

## Cross-surface flows
<!-- ux-kind: cross-surface -->

A redemption starts on MOBILE (ACT-MEMBER shows the code) and is validated on PARTNER (ACT-PARTNER scans it).

## Traceability matrix
<!-- ux-kind: traceability -->

| Requirement | Journey | Flow | Screens | Patterns |
|---|---|---|---|---|
| RF-1 | J01 | F01 | SCR-MOBILE-01 | PT01 |
| RF-2 | J01 | F01 | SCR-MOBILE-02 | — |
| RF-3 | J03 | F03 | SCR-PARTNER-01, SCR-PARTNER-02 | PT01 |
| RF-4 | J02 | F02 | SCR-DASHBOARD-01, SCR-DASHBOARD-02 | PT02 |

## Screen coverage
<!-- ux-kind: screen-coverage -->

Every screen covers at least one requirement and one flow.

## Open UX questions
<!-- ux-kind: open-questions -->

- Should a member see expired benefits in the catalog?

## Out of scope
<!-- ux-kind: out-of-scope -->

- Corporate onboarding.
- Review system.

## UX Contract validation
<!-- ux-kind: checklist -->

- [x] All human surfaces are declared.
- [x] Every Journey is composed of Flows.
- [x] Every Flow references screens.

## Heron constraints
<!-- ux-kind: heron-handoff -->

### Heron MUST preserve

Business rules, roles, permissions and requirements.

### Heron MAY improve

Screen grouping, navigation and pattern reuse.

### Heron owns

Layout, visual hierarchy, typography and the design system.
