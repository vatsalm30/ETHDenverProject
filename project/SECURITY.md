# Moved

This document was consolidated into the single main guide at the repository root:

**README.md**
# Security Model: Canton Invoice Finance dApp

## Authentication Modes

| Mode | Mechanism | How users authenticate |
|------|-----------|----------------------|
| `shared-secret` | Static credentials in `.env.local` | Username + password via Basic Auth |
| `oauth2` | Keycloak OIDC | OAuth2 Authorization Code flow; JWT bearer tokens |

Switch via `make setup` → `AUTH_MODE`.

---

## Access Control Matrix — REST Endpoints

| Endpoint | COMPANY | INSTITUTION | Unauthenticated |
|----------|---------|------------|-----------------|
| `POST /auth/register` | ✅ (shared-secret only) | ✅ | ✅ |
| `GET /invoices` | Own invoices only | ❌ | ❌ |
| `POST /invoices` | ✅ | ❌ | ❌ |
| `DELETE /invoices/{id}` | Own invoice only | ❌ | ❌ |
| `GET /auctions` | Own auctions only | All OPEN auctions | ❌ |
| `POST /auctions/{id}:bid` | ❌ | ✅ | ❌ |
| `GET /auctions/{id}/my-bid-status` | ❌ | Own bid only | ❌ |
| `POST /auctions/{id}:close` | Own auction only | ❌ | ❌ |
| `POST /auctions/{id}:cancel` | Own auction only | ❌ | ❌ |
| `GET /financed-invoices` | Own (company side) | Own (winner only) | ❌ |
| `POST /financed-invoices/{id}:pay` | ✅ | ❌ | ❌ |
| `GET /bank-ownerships` | ❌ | Own ownerships only | ❌ |
| `GET /paid-invoices` | Own (company side) | Own (winner only) | ❌ |
| `GET /profile` | ✅ | ✅ | ❌ |
| `PUT /profile` | ✅ | ✅ | ❌ |

**Enforcement**: Spring Security filter chain + username-keyed ownership maps in
`InvoiceFinanceApiImpl`. The Canton ledger also enforces privacy at the contract level.

---

## DTO Field Access Matrix

### `FinancingAuctionDto` — returned by `GET /auctions`

| Field | COMPANY (own auction) | INSTITUTION (eligible) |
|-------|-----------------------|----------------------|
| `contractId`, `invoiceId`, `amount`, `description`, `dueDate` | ✅ | ✅ |
| `startRate`, `reserveRate`, `eligibleBanks`, `status` | ✅ | ✅ |
| `currentBestRate` | ✅ | ✅ |
| `auctionEndTime` | ✅ | ✅ |
| `averageBid` | ✅ (populated when bids exist) | ✅ (market calibration signal) |
| `bidCount` | ✅ | ❌ (null / absent) |

### `BidStatusDto` — returned by `GET /auctions/{id}/my-bid-status`

| Field | Requester (the institution) | Any other party |
|-------|-----------------------------|----------------|
| `hasBid` | ✅ | N/A (endpoint not accessible) |
| `isWinning` | ✅ | N/A |
| `myRate` | ✅ (own rate only) | N/A |
| `currentBestRate` | ✅ | N/A |
| `averageBid` | ✅ (calibration signal) | N/A |

### `PaidInvoiceDto` — returned by `GET /paid-invoices`

| Field | COMPANY | INSTITUTION (winner) |
|-------|---------|---------------------|
| `contractId`, `invoiceId`, `amount`, `description` | ✅ | ✅ |
| `sprintBoosted`, `bountyPaid` | ✅ | ✅ |
| `paymentTxHash` | ✅ | ✅ |
| `bridgeState` | ✅ | ✅ |
| Purchase rate / margin | ❌ (not in DTO) | Via `BankOwnershipDto` only |

### `BankOwnershipDto` — returned by `GET /bank-ownerships`

Only returned to the **winning institution**. COMPANY users receive an empty list.
This is the only DTO that exposes `purchaseRate` and `purchaseAmount`.

---

## Multi-Tenancy Isolation

All users in the demo share a single Canton party (the AppProvider operator party).
Isolation is enforced at the application layer via username-keyed maps:

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `invoiceOwner` | pseudo-contractId | username | Only creator can auction/delete |
| `auctionOwner` | contractId | username | Only creator can close/cancel |
| `financedInvoiceCompany` | contractId | company username | FI visibility for company |
| `financedInvoiceWinner` | contractId | institution username | FI visibility for institution |
| `bankOwnershipWinner` | contractId | institution username | BO visibility for institution |
| `paidInvoiceCompany` | contractId | company username | Paid invoice visibility for company |
| `paidInvoiceWinner` | contractId | institution username | Paid invoice visibility for institution |

**Username source**: `SecurityContextHolder.getContext().getAuthentication().getName()`
— the authenticated principal's name, not the Canton party ID.

---

## `averageBid` Disclosure Policy

The market average bid (`averageBid`) is disclosed to **all eligible institutions** as a
calibration signal. It does NOT reveal:

- Which institution placed which bid (bids are keyed by username internally, average is a scalar)
- How many bids exist (that is `bidCount`, shown only to the company)
- Any individual bid value other than the caller's own `myRate`

The average is computed over all bids in the in-memory `AuctionBidStore` at query time.

---

## CSRF Policy

| Auth mode | CSRF | Rationale |
|-----------|------|-----------|
| `shared-secret` | Disabled | No browser session cookies; Basic Auth header per request |
| `oauth2` | Enabled | Session-based; browser cookies in use |

In OAuth2 mode, `/auth/register` is CSRF-exempt (public registration endpoint) but still
returns 401 — sign-up UI is hidden in OAuth2 mode by design.

---

## Known Security Limitations (Demo Scope)

1. **No real EVM authorization**: The mock EVM settlement has no wallet signatures or
   on-chain verification. `paymentTxHash` is cryptographically derived (SHA-256) but
   not submitted to any blockchain.

2. **Bid store is in-memory**: Bids are not persisted. A backend restart clears all bid
   state, which could allow a re-bid after a restart (edge case in the demo).

3. **Single-party demo**: Because all users share the AppProvider Canton party, Daml
   contract privacy is effectively bypassed — any party can technically see any contract
   via gRPC. The application layer enforces data isolation instead.

4. **Rate limits**: No rate limiting on bid placement. In production, add per-user
   rate limiting on `POST /auctions/{id}:bid`.
