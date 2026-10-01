> SYNTHETIC — fixture data, not a real product.

# Membership — master plan

## Metadata

- Project: conflict
- Stage: 01-mvp
- Date: 2026-09-01
- Mode: template
- Consolidated context files: context/md/brand.md

Source: plan1 §Metadata

## Executive summary

A membership program where members unlock partner benefits from a mobile app, partners publish and validate them, and admins run the program from a dashboard.

Source: plan1 §Summary, plan2 §Summary

## Scope (MoSCoW)

### Must

- M1: Benefit catalog visible to active members.
- M2: Benefit redemption validated by the partner.

### Should

- S1: Member and partner management for admins.

### Could

- C1: Push reminders before a membership expires.

### Won't

- W1: Corporate onboarding.

Source: plan1 §Scope, plan3 §Scope

## Actors and permissions

| Actor | Can | Cannot |
|---|---|---|
| Member `ACT-MEMBER` | Browse benefits; Redeem a benefit | See other members' data |
| Partner `ACT-PARTNER` | Publish benefits; Validate redemptions | See member data |
| Admin `ACT-ADMIN` | Manage members; Manage partners | Edit a partner's benefits |

Source: plan1 §Actors, D1

## Business rules

- RN-1: A benefit is visible only to active members.
- RN-2: A redemption is validated once by the partner that offers the benefit.
- RN-3: A membership expires at the end of its paid period.

Source: plan1 §Rules, plan2 §Rules

## Functional requirements

- RF-1: Members can browse benefits.
- RF-2: Members can redeem a benefit with a QR code.
- RF-3: Partners can publish benefits and validate redemptions.
- RF-4: Admins can manage members and partners.

Source: plan1 §Requirements, plan2 §Requirements

## Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| RNF-1 | Benefit list response time | Under 2 seconds on a mobile connection |
| RNF-2 | Personal data protection | Encrypted at rest and in transit |

Source: plan2 §Quality

## Domain and data

| Entity | Description | Key fields |
|---|---|---|
| Member | A person with a membership | name, status, expiresAt |
| Partner | A business that offers benefits | name, location |
| Benefit | An offer published by a partner | title, partner, validUntil |
| Redemption | A member using a benefit | member, benefit, redeemedAt |

Source: plan1 §Data

## Open questions

None
