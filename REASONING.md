# Implementation reasoning

## Scope

This implementation deliberately keeps the assessment-sized surface small: one user role, batch-level inventory, no sales history, and no supplier or reporting modules. The dashboard is the primary authenticated workflow.

## Data model

`User` stores a name, unique lowercase email, and bcrypt hash. `Batch` stores medicine name, batch number, quantity, expiry date, unit price, status (`active`, `near-expiry`, or `quarantined`), reorder threshold, and owner. `Notification` stores reorder events with an open-event deduplication key. Ownership is included in every batch and notification query so one account cannot see or mutate another account's data.

## Safety rules

The backend is the source of truth for sellable stock. Every sellable count, alert list, medicine stock lookup, and dispense query requires positive quantity, an expiry date at or after today's start, and an `active` or `near-expiry` status. Expired and quarantined records remain available for audit and editing, but never count as sellable or eligible for dispensing. The clock endpoint marks batches expiring within seven days as `near-expiry` and expired batches as `quarantined`.

Dispensing pre-checks the full eligible stock before making changes. It then walks eligible batches in expiry order, using conditional `$inc` updates so a batch cannot be reduced below the quantity observed. If any update loses a race, prior changes from this request are restored and the request fails rather than partially completing.

## Tradeoffs

A MongoDB transaction would be the strongest option, but local standalone MongoDB installations commonly do not support transactions. The conditional updates and rollback provide practical all-or-nothing behavior without requiring a replica set, while keeping the code understandable for a short assessment.

The frontend intentionally uses the browser's native prompt for the small dispense action instead of adding another large modal workflow. CRUD has a dedicated modal because it benefits from structured validation and clearer field affordances.

## Data workflows

The import endpoint accepts batch arrays, parses quantities such as `10 units` and ISO or `dd/mm/yyyy` dates, and reports imported, deduplicated, and rejected rows without changing existing stock for invalid input. Reorder checks create one open notification per user and medicine while usable stock is below its threshold; `GET /outbox` exposes those events. In development, the Vite proxy keeps browser requests same-origin while forwarding API, clock, and outbox paths to the backend on port 5000.
