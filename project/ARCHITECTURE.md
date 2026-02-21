# Architecture: Canton Invoice Finance dApp

## Overview

A cross-chain invoice financing platform built on the **Canton Network** (Global Synchronizer),
with a mock **EVM settlement layer** that demonstrates cross-chain narrative for ETHDenver.

```
Company (Supplier)          Institution (Bank/Lender)
        │                              │
  create invoice                  discover auctions
  start auction ──────────────── place sealed bid
  close auction ─── Canton ───── winner confirmed
        │            Ledger             │
  pay invoice ────── commit ────── maturity payout
        │                              │
        └──── EVM Settlement ──────────┘
              PENDING → CONFIRMING → CONFIRMED
```

---

## Canton Lifecycle (Primary Chain)

| Step | Actor | Daml Template | Notes |
|------|-------|--------------|-------|
| 1 | Company | `Invoice` (in-memory) | Pseudo-contract, no ledger write yet |
| 2 | Company | `FinancingAuction` | Written to Canton ledger; starts sealed-bid window |
| 3 | Institution | In-memory bid store | `AuctionBidStore` — never touches ledger |
| 4 | Company | `closeAuction` | Archives `FinancingAuction`; creates `FinancedInvoice` + `BankOwnership` |
| 5 | Company | `payFinancedInvoice` | Archives `FinancedInvoice`; creates `PaidInvoice` on ledger |
| 6 | Service | `EvmSettlementService` | **Fires after Canton PaidInvoice commit** |

**Finality policy — Canton-first:** The EVM settlement trigger in `payFinancedInvoice()` is
called inside the `.thenApply()` callback that runs after the Canton ledger acknowledges the
`PaidInvoice` creation. EVM state is therefore always a post-hoc annotation, never a
prerequisite for Canton settlement.

---

## EVM Settlement Layer (Mock)

Implemented in `EvmSettlementService.java`. No real blockchain calls, no web3 dependencies.

### State machine

```
PENDING ──(5s)──→ CONFIRMING ──(15s)──→ CONFIRMED
```

- **PENDING**: `triggerSettlement()` called immediately after Canton PaidInvoice commit.
- **CONFIRMING**: Scheduler advances after 5 seconds (simulates EVM block inclusion).
- **CONFIRMED**: Scheduler advances after 15 seconds from creation (simulates finality).

### Persistence

Stored in PostgreSQL table `evm_settlements`:

| Column | Type | Description |
|--------|------|-------------|
| `invoice_id` | TEXT PK | The invoice business ID (not contract ID) |
| `tx_hash` | TEXT | `0x` + 64 hex chars, SHA-256 of `invoiceId:epochSec` |
| `bridge_state` | TEXT | PENDING / CONFIRMING / CONFIRMED |
| `created_epoch` | BIGINT | Unix epoch seconds when PENDING was inserted |

**Survival across restarts:** All state is in PostgreSQL, not in-memory. The `@Scheduled`
advancement job runs every 5 seconds and uses epoch arithmetic — no state is lost if the
backend restarts between transitions.

### Tx hash generation

```
SHA-256(invoiceId + ":" + epochSeconds) → 32-byte digest → 0x{hex} (66 chars total)
```

Deterministic from invoice ID + timestamp. Unique per payment event.

---

## Sealed-Bid Privacy Model

### In-memory bid store (`AuctionBidStore`)

| Signal | Visible to | Notes |
|--------|-----------|-------|
| `currentBestRate` | All eligible institutions + Company | Rounded to 2dp; never reveals identity |
| `averageBid` | All eligible institutions | Market calibration; revealed after ≥1 bid |
| `bidCount` | Company only | Shown on AuctionStatusCard |
| `myRate` | The bidding institution only | Returned in `BidStatusDto.myRate` |
| Winner identity | Company only (at close) | Revealed in `CloseAuctionResult` |

### Canton contract visibility

| Contract | Signatories | Observers | Who can see it |
|----------|------------|-----------|----------------|
| `Invoice` | operator, supplier, buyer | — | Supplier + Buyer |
| `FinancingAuction` | operator, supplier, buyer | eligibleBanks | All parties |
| `WinningBid` | operator, supplier, buyer, bank | — | Winner bank only |
| `BankOwnership` | operator, bank | — | Bank only |
| `FinancedInvoice` | operator, supplier, buyer, bank | — | All trade parties |
| `PaidInvoice` | operator, supplier, buyer, bank | — | All trade parties |

---

## State Persistence Map

| State | Storage | Survives restart? |
|-------|---------|------------------|
| Pending invoices | In-memory `ConcurrentHashMap` | ❌ No |
| Auction end times | DB `auction_end_times` | ✅ Yes |
| Auction owners | DB `auction_owners` | ✅ Yes |
| Bid store (bids) | In-memory `AuctionBidStore` | ❌ No (bids lost on restart) |
| FI ownership | DB `fi_owners` | ✅ Yes |
| BO winners | DB `bo_winners` | ✅ Yes |
| Paid owners | DB `paid_owners` | ✅ Yes |
| EVM settlements | DB `evm_settlements` | ✅ Yes |

---

## Known Limitations (Demo / Hackathon)

1. **Archive-self bug** in deployed package `@b2fe96ff`: All consuming choices double-archive.
   Workaround: bypass all choices via `ledger.archive()` + `ledger.createAndGetId()`.

2. **Shared Canton party**: All users share the AppProvider party in the demo. Multi-tenancy
   is enforced at the application layer (username-keyed maps), not the Daml privacy layer.

3. **Bid store is in-memory**: If the backend restarts during an active auction, bid history
   is lost. Auction ownership and end times survive (they're in DB), but bids do not.

4. **EVM is mock**: No actual Ethereum node, no real gas, no wallet required. The tx hash
   is SHA-256 derived and the state machine runs in a Spring `@Scheduled` job.
