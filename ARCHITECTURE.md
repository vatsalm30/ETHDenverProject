# Deadline Derby — Architecture & Developer Guide

**Confidential Invoice Financing on Canton Network**

A hackathon dApp built on the Canton Global Synchronizer that demonstrates Canton's privacy-first model through a Dutch-auction invoice financing marketplace. Multiple parties (Supplier, Buyer, Banks) interact with contracts where data visibility is enforced at the **ledger level**, not the application layer.

---

## Table of Contents

1. [What is Deadline Derby?](#what-is-deadline-derby)
2. [Privacy Model](#privacy-model)
3. [Repository Layout](#repository-layout)
4. [Daml Smart Contracts](#daml-smart-contracts)
5. [Contract Lifecycle](#contract-lifecycle)
6. [Backend Architecture](#backend-architecture)
7. [Frontend Architecture](#frontend-architecture)
8. [Build System](#build-system)
9. [Running the Demo](#running-the-demo)
10. [Key URLs](#key-urls)
11. [Privacy Visibility Matrix](#privacy-visibility-matrix)
12. [How Canton Privacy Works Here](#how-canton-privacy-works-here)

---

## What is Deadline Derby?

Deadline Derby solves the **cash-flow gap** problem in B2B trade finance:

- A **Supplier** ships goods and creates a $100,000 invoice, due in 90 days.
- They need cash **today**, not in 90 days.
- Multiple **Banks** compete in a live **Dutch auction** (price falls every second).
- The first bank to click "GRAB" wins the invoice at the current rate.
- The winning bank pays the supplier immediately (e.g. $97,600).
- At maturity, the **Buyer** pays the bank the full face value ($100,000).
- The **Buyer** can optionally pay early via **Sprint Boost** and earn a cash bounty.

What makes this different from traditional fintech is that **competitive pricing, winning bid details, and the bank's margin are all confidential** — enforced by Canton's sub-transaction privacy protocol, not by application-level access control.

---

## Privacy Model

### The Core Problem Canton Solves

In a traditional database or on Ethereum, all data is either fully public or protected by application-layer checks (which can be bypassed). Canton's participant nodes are architected so that a node **never receives the payload of a contract unless it is a signatory or observer** of that contract.

### What Each Party Sees

| Contract          | Supplier | Buyer | Winning Bank | Losing Banks | Synchronizer |
|-------------------|:--------:|:-----:|:------------:|:------------:|:------------:|
| `Invoice`         | ✅ full  | ✅ full | ❌           | ❌           | hash only    |
| `FinancingAuction`| ✅ full  | ❌     | ✅ full     | ✅ full      | hash only    |
| `WinningBid`      | ✅ full  | ❌     | ✅ full     | **❌ blind** | hash only    |
| `FinancedInvoice` | ✅ full  | ✅ full (no rate) | ✅ full | ❌   | hash only    |
| `BankOwnership`   | ✅       | **❌ no rate** | ✅ full | ❌      | hash only    |
| `SprintBoostOffer`| ❌       | ✅ full | ✅ full     | ❌           | hash only    |
| `PaidInvoice`     | ✅ full  | ✅ full | ✅ full     | ❌           | hash only    |

**Key privacy guarantees:**

1. **Losing banks are completely blind to the winning bid.** They know the auction ended but have zero knowledge of who won or at what rate. Canton's sub-transaction protocol ensures their nodes never receive the packet.

2. **The buyer never sees the bank's purchase rate.** `BankOwnership` (which contains `purchaseRate` and `purchaseAmount`) excludes the buyer as a signatory and observer. The buyer sees only the face value they owe — not the bank's margin.

3. **The Global Synchronizer only sees commitment hashes.** No business data (invoice amounts, party names, bid prices) is exposed to the SV operators.

4. **Sprint Boost negotiation is private.** The supplier is excluded — they already received their cash and have no need to know the early-payment terms.

---

## Repository Layout

```
ETHDenverProject/
├── ARCHITECTURE.md            ← This file
├── CLAUDE.md                  ← Instructions for Claude Code
└── project/
    ├── Makefile               ← Build & run automation (make build, make start)
    ├── compose.yaml           ← Docker Compose orchestration
    ├── .env                   ← Base environment (SDK versions, ports)
    │
    ├── common/
    │   └── openapi.yaml       ← Contract-first API spec (generates Java + TS types)
    │
    ├── daml/
    │   ├── multi-package.yaml ← Lists all Daml packages to compile
    │   ├── build.gradle.kts   ← Builds DARs + generates Java bindings
    │   │
    │   ├── invoice-finance/   ← ★ NEW — Deadline Derby Daml package
    │   │   ├── daml.yaml      ← SDK 3.4.10, package: quickstart-invoice-finance
    │   │   └── daml/InvoiceFinance/
    │   │       └── Core.daml  ← All 7 templates (see below)
    │   │
    │   └── licensing/         ← Original quickstart contracts (unchanged)
    │       └── daml/Licensing/
    │           ├── AppInstall.daml
    │           └── License.daml
    │
    ├── backend/
    │   └── src/main/java/com/digitalasset/quickstart/
    │       ├── App.java                    ← Spring Boot entry point
    │       ├── ledger/
    │       │   └── LedgerApi.java          ← ★ EXTENDED: multi-party create/exercise
    │       ├── repository/
    │       │   └── DamlRepository.java     ← ★ EXTENDED: invoice-finance PQS queries
    │       ├── service/
    │       │   ├── InvoiceFinanceApiImpl.java  ← ★ NEW: 6 REST controllers
    │       │   └── (original services unchanged)
    │       └── (config, security, pqs — unchanged)
    │
    └── frontend/
        └── src/
            ├── App.tsx                     ← ★ EXTENDED: /deadline-derby route
            ├── components/
            │   └── Header.tsx              ← ★ EXTENDED: nav link
            ├── stores/
            │   ├── invoiceFinanceStore.tsx ← ★ NEW: all invoice finance state
            │   └── (original stores — unchanged)
            └── views/
                ├── DeadlineDerbyView.tsx   ← ★ NEW: full UI (auction ticker, horse race)
                └── (original views — unchanged)
```

---

## Daml Smart Contracts

### File: `project/daml/invoice-finance/daml/InvoiceFinance/Core.daml`

All seven templates live in a single module. After `make build-daml`, they compile to:

```
project/daml/invoice-finance/.daml/dist/quickstart-invoice-finance-0.0.1.dar
```

Java bindings are generated to:

```
project/backend/build/generated-daml-bindings/quickstart_invoice_finance/
```

---

### Template 1: `Invoice`

**Purpose:** Represents an invoice from supplier to buyer. Only these two parties see it initially. Banks have zero visibility.

```daml
template Invoice
  with
    operator  : Party   -- AppProvider platform (co-signs, enables single-service-account backend)
    supplier  : Party   -- Creates the invoice
    buyer     : Party   -- Will pay the invoice at maturity
    invoiceId : Text
    amount    : Decimal
    description     : Text
    paymentTermDays : Int
    issueDate       : Date
    dueDate         : Date
    status    : Text    -- "PENDING_CONFIRMATION" | "CONFIRMED" | ...
  where
    signatory operator, supplier
    observer  buyer     -- ← Banks NOT listed here
```

**Choices:**
- `Invoice_BuyerConfirm` — buyer confirms goods received (controller: `operator`)
- `Invoice_StartAuction` — supplier launches Dutch auction (controller: `operator`)

---

### Template 2: `FinancingAuction`

**Purpose:** The live Dutch auction. All eligible banks are `observer`s — they watch the price fall in real time. The buyer is NOT included, preventing price visibility.

```daml
template FinancingAuction
  with
    operator            : Party
    supplier / buyer    : Party
    eligibleBanks       : [Party]  -- All banks can see the auction
    startRate           : Decimal  -- Auction opens here (e.g. 98.0 = 98%)
    reserveRate         : Decimal  -- Floor price (e.g. 95.0 = 95%)
    auctionDurationSecs : Int
    status              : Text     -- "OPEN" | "CLOSED"
  where
    signatory operator
    observer  eligibleBanks    -- ← buyer excluded
```

**Choices:**
- `FinancingAuction_BankGrab` — first bank to call this wins (creates `WinningBid`)
- `FinancingAuction_Cancel` — operator/supplier can cancel

**Privacy note:** All 12 eligible banks can see the auction parameters (face value, start/floor rates, duration). But they cannot see each other's intent to bid, and they will never see the `WinningBid` that's created for the winner.

---

### Template 3: `WinningBid` ⭐ (Critical Privacy Contract)

**Purpose:** Records the auction outcome with full financial details. Only the `operator` and the **winning bank** are parties. Losing banks receive nothing.

```daml
template WinningBid
  with
    operator       : Party
    supplier       : Party    -- Needed to build downstream contracts
    buyer          : Party    -- Same
    bank           : Party    -- Winning bank ONLY
    purchaseRate   : Decimal  -- e.g. 97.6 (%)
    purchaseAmount : Decimal  -- e.g. $97,600
    status         : Text
  where
    signatory operator
    observer  bank             -- ← buyer NOT here; losing banks NOT here
```

**Choices:**
- `WinningBid_Settle` — immediately creates `FinancedInvoice` (public) and `BankOwnership` (private)

**Canton guarantee:** When this contract is created, the protocol sends packets only to participants of `operator` and `bank`. No other node receives any bytes. This is not encryption — the data simply never leaves the winning node.

---

### Template 4: `FinancedInvoice`

**Purpose:** The "horse" racing to the payment finish line. Visible to all three trade parties, but deliberately **does not contain the purchase rate**.

```daml
template FinancedInvoice
  with
    operator / supplier / buyer / bank : Party
    amount            : Decimal  -- Face value ONLY (not purchaseRate)
    paymentStatus     : Text     -- "ACTIVE" | "SPRINT_BOOST_ACTIVE" | "PAID"
    sprintBoostActive : Bool
    sprintBoostBounty : Decimal
  where
    signatory operator, supplier, buyer, bank
```

**Choices:**
- `FinancedInvoice_ActivateSprintBoost` — buyer offers early payment with bounty
- `FinancedInvoice_Pay` — buyer pays face value

---

### Template 5: `BankOwnership` ⭐ (Confidential Margin)

**Purpose:** Holds the bank's purchase price. The buyer is excluded. This is the contract that proves Canton's privacy: the buyer can see `FinancedInvoice.amount` (face value they owe) but never `BankOwnership.purchaseRate` (bank's margin).

```daml
template BankOwnership
  with
    operator       : Party
    bank           : Party
    purchaseRate   : Decimal    -- Confidential
    purchaseAmount : Decimal    -- Confidential
    faceValue      : Decimal
  where
    signatory operator
    observer  bank              -- ← buyer NOT here
```

---

### Template 6: `SprintBoostOffer`

**Purpose:** Private negotiation between buyer and bank for early payment. The supplier is excluded — they already received cash on Day 1.

```daml
template SprintBoostOffer
  with
    operator         : Party
    buyer            : Party
    bank             : Party
    earlyPaymentDate : Date
    bountyAmount     : Decimal
    offerStatus      : Text
  where
    signatory operator
    observer  buyer, bank       -- ← supplier NOT here
```

---

### Template 7: `PaidInvoice`

**Purpose:** Immutable final settlement record. All three trade parties see it.

```daml
template PaidInvoice
  with
    operator / supplier / buyer / bank : Party
    sprintBoosted : Bool
    bountyPaid    : Decimal
  where
    signatory operator, supplier, buyer, bank
```

---

## Contract Lifecycle

```
Supplier creates Invoice
         │
         ▼
    Invoice (PENDING_CONFIRMATION)
    [visible: supplier, buyer]
         │
    Buyer confirms
         │
         ▼
    Invoice (CONFIRMED)
         │
    Supplier starts auction
         │
         ▼
    FinancingAuction (OPEN)
    [visible: supplier, ALL eligible banks]
    [buyer: ❌ excluded]
         │
    Bank grabs at current price
         │    (other banks see auction disappear — nothing else)
         ▼
    WinningBid (PENDING_SETTLEMENT)
    [visible: operator, winning bank ONLY]
         │
    Auto-settle
         │
         ├──▶ FinancedInvoice (ACTIVE)      [visible: supplier, buyer, winning bank]
         │
         └──▶ BankOwnership                 [visible: operator, winning bank ONLY]
                                             [buyer: ❌ no purchase rate]
              │
    [Optional] Buyer activates Sprint Boost
              │
              ▼
         FinancedInvoice (SPRINT_BOOST_ACTIVE)
              │
    Buyer pays
              │
              ▼
         PaidInvoice                         [visible: all three trade parties]
```

---

## Backend Architecture

### Key Files

| File | Purpose |
|------|---------|
| `InvoiceFinanceApiImpl.java` | REST controller implementing all 6 OpenAPI interfaces |
| `DamlRepository.java` | PQS queries filtered by party (enforces what each party can fetch) |
| `LedgerApi.java` | gRPC to Canton Ledger API — extended with `createAsParties()` and `exerciseAsParties()` |

### API Endpoints

All endpoints require authentication. The PQS automatically filters contracts by the authenticated party.

```
GET  /invoices                          List invoices visible to caller
POST /invoices                          Supplier creates invoice
POST /invoices/{id}:confirm             Buyer confirms invoice
POST /invoices/{id}:start-auction       Supplier launches Dutch auction

GET  /auctions                          List open auctions visible to caller
POST /auctions/{id}:grab                Bank grabs auction at current rate
POST /auctions/{id}:cancel              Cancel open auction

GET  /financed-invoices                 List financed invoices visible to caller
POST /financed-invoices/{id}:pay        Buyer pays invoice
POST /financed-invoices/{id}:sprint-boost  Buyer activates Sprint Boost

GET  /bank-ownerships                   Bank sees its purchase rates (buyer excluded)
GET  /paid-invoices                     List settled invoices
```

### How Party-Filtered Queries Work

The `DamlRepository` queries the PQS (Party Query Store) with `WHERE` clauses that match the authenticated party to the relevant fields:

```java
// Banks only see WinningBids where they won:
pqs.activeWhere(WinningBid.class,
    "payload->>'bank' = ? OR payload->>'operator' = ?",
    party, party);

// Buyers cannot see BankOwnership (it's not in the query):
pqs.activeWhere(BankOwnership.class,
    "payload->>'bank' = ? OR payload->>'operator' = ?",
    party, party);
// If caller is buyer, they get 0 results — not because we filter them out,
// but because the PQS never received those contracts in the first place.
```

The PQS only indexes contracts that were **actually delivered to a participant's node**. Because `BankOwnership` never sends packets to the buyer's node (Canton's sub-transaction protocol), the buyer's PQS table has no rows for that template.

### Java Binding Package Names

After running `./gradlew :daml:codeGen`, the generated classes follow this convention:

| Daml | Java |
|------|------|
| Package `quickstart-invoice-finance` | `quickstart_invoice_finance.*` |
| Module `InvoiceFinance.Core` | `quickstart_invoice_finance.invoicefinance.core.*` |
| Template `Invoice` | `quickstart_invoice_finance.invoicefinance.core.Invoice` |
| Choice `Invoice_StartAuction` | `quickstart_invoice_finance.invoicefinance.core.Invoice.Invoice_StartAuction` |

---

## Frontend Architecture

### Key Files

| File | Purpose |
|------|---------|
| `views/DeadlineDerbyView.tsx` | Main dApp page — auction ticker, horse race, privacy badges |
| `stores/invoiceFinanceStore.tsx` | React Context state + all API calls |
| `components/Header.tsx` | Extended with 🏇 Deadline Derby nav link |
| `App.tsx` | Extended with `/deadline-derby` route + `InvoiceFinanceProvider` |

### Role Detection

The frontend detects the current user's role from their username/party ID and adjusts the UI:

- **Supplier** → sees "Create Invoice" + "Start Auction" buttons
- **Buyer** → sees "Confirm" + "Sprint Boost" + "Pay" buttons
- **Bank** → sees live auction ticker with GRAB button + confidential BankOwnership table
- **Operator** → sees everything

### Key UI Components

**`AuctionTicker`** — Live Dutch auction countdown:
- Starts at `startRate` (e.g. 98%)
- Falls linearly to `reserveRate` (e.g. 95%) over `auctionDurationSecs`
- Displays current rate, advance amount, time remaining
- GRAB button triggers `grabAuction()` API call with the current rate

**`HorseRace`** — Visual progress bar for financed invoices:
- Shows time progress toward due date
- Animates with 🐎 emoji, switches to 🚀 when Sprint Boost is active

**`PrivacyBadge`** — Shows what the current party can/cannot see:
- Green ✓ = visible; Red ✗ = excluded by Canton
- Updates automatically based on detected role

---

## Build System

### Quick Start

```bash
cd project/

# First time setup
make setup          # Interactive: choose auth mode, generate .env.local

# Build everything (Daml → DAR → Java bindings → Spring Boot → React → Docker)
make build

# Start all services
make start

# Rebuild just the Daml contracts + generate Java bindings
./gradlew :daml:build

# Rebuild just the backend
make restart-backend

# Frontend with hot-reload
make start-vite-dev
```

### Build Order for Invoice Finance Changes

1. Edit Daml contracts in `project/daml/invoice-finance/daml/InvoiceFinance/Core.daml`
2. Run `cd project && ./gradlew :daml:build` → compiles DAR + generates Java bindings
3. Run `make restart-backend` → rebuilds Spring Boot with new bindings
4. If you changed `common/openapi.yaml`, also run `cd frontend && npm run gen:openapi`
5. Run `make restart-frontend` → rebuilds React

### Generated Code Locations

| Source | Generated Output |
|--------|-----------------|
| `daml/invoice-finance/` | `daml/invoice-finance/.daml/dist/quickstart-invoice-finance-0.0.1.dar` |
| Daml DAR (via Transcode) | `backend/build/generated-daml-bindings/quickstart_invoice_finance/` |
| `common/openapi.yaml` | `backend/build/generated-spring/` (Java interfaces) |
| `common/openapi.yaml` | `frontend/src/openapi.d.ts` (TypeScript types) |

---

## Running the Demo

### Prerequisites

- Docker 27+ with 8 GB memory allocation
- Daml SDK 3.4.10 (`make install-daml-sdk`)
- Node.js 18+

### Demo Script (for judges)

```bash
# Terminal 1: Start everything
cd project && make setup && make build && make start

# Wait for all services to be healthy (~3 minutes)
make status
```

Open the app at `http://app-provider.localhost:3000`

Navigate to **🏇 Deadline Derby** in the nav.

**Demo flow:**

1. **Login as Supplier** → Create an invoice for $100,000, 90 days
2. **Login as Buyer** → Confirm the invoice (goods delivered)
3. **Back to Supplier** → Start auction: 98% start, 95% floor, 60 seconds
4. **Login as Bank1** → Watch price fall in real time, GRAB at ~97.6%
5. **Login as Bank2** → Try to look at Bank1's winning bid → **nothing visible** ← privacy demo
6. **Back to Buyer** → See financed invoice face value but **no purchase rate** ← privacy demo
7. **Buyer activates Sprint Boost** → $400 bounty for early payment
8. **Buyer clicks Pay** → Invoice settled, PaidInvoice created

### Shared-Secret Users (for local testing)

The default `AUTH_MODE=shared-secret` supports the following users. These are configured in `docker/backend-service/onboarding/env/shared-secret.env`.

Add these roles to the onboarding config to get multi-party behavior:

| Username | Role |
|----------|------|
| `app-provider` | Operator / Supplier |
| `app-user-1` | Buyer |
| `bank-1` | Bank #1 |
| `bank-2` | Bank #2 |

---

## Key URLs

| Service | URL |
|---------|-----|
| App Provider UI | `http://app-provider.localhost:3000` |
| App User Wallet | `http://wallet.localhost:2000` |
| Backend API | `http://localhost:8080` |
| Swagger UI | `http://localhost:9090` |
| Keycloak (if oauth2) | `http://localhost:8082` |
| Grafana (if enabled) | `http://localhost:3030` |

---

## Privacy Visibility Matrix

### During Auction (`FinancingAuction` is live)

```
                    ┌────────────────────────────────────────────────┐
                    │            FinancingAuction Contract           │
                    │  startRate: 98%, reserveRate: 95%, 60s        │
                    │  eligibleBanks: [Bank1, Bank2, Bank3, ...]     │
                    └────────────────────────────────────────────────┘
                              Delivered to:
Supplier ────────────────────── ✅ (signatory-owner)
Buyer ───────────────────────── ❌ (not an observer)
Bank1 ───────────────────────── ✅ (observer in eligibleBanks)
Bank2 ───────────────────────── ✅ (observer in eligibleBanks)
Bank3 ───────────────────────── ✅ (observer in eligibleBanks)
GlobalSynchronizer ─────────── hash only (0xabc123...)
Competitor (not in list) ────── ❌ (not an observer)
```

### After Bank2 Wins (`WinningBid` created)

```
                    ┌────────────────────────────────────────────────┐
                    │               WinningBid Contract              │
                    │  bank: Bank2                                   │
                    │  purchaseRate: 97.6%                           │
                    │  purchaseAmount: $97,600                       │
                    └────────────────────────────────────────────────┘
                              Delivered to:
Supplier ────────────────────── ✅ (signatory, knows who won + price)
Buyer ───────────────────────── ❌ (not a party anywhere)
Bank1 ───────────────────────── ❌ (lost — completely blind)
Bank2 ───────────────────────── ✅ (observer — the winner)
Bank3 ───────────────────────── ❌ (lost — completely blind)
GlobalSynchronizer ─────────── hash only (0xdef456...)
```

Bank1 and Bank3 know the auction ended (the `FinancingAuction` contract they observed was archived). They know they didn't win. They have **zero bytes** of information about who did win or at what price.

### BankOwnership (confidential margin)

```
                    ┌────────────────────────────────────────────────┐
                    │             BankOwnership Contract             │
                    │  bank: Bank2                                   │
                    │  purchaseRate: 97.6%    ← CONFIDENTIAL        │
                    │  purchaseAmount: $97,600 ← CONFIDENTIAL       │
                    │  faceValue: $100,000                           │
                    └────────────────────────────────────────────────┘
                              Delivered to:
Supplier ────────────────────── ✅ (signatory)
Buyer ───────────────────────── ❌ (cannot see bank's margin)
Bank2 ───────────────────────── ✅ (observer — their own ownership)
GlobalSynchronizer ─────────── hash only
```

The buyer sees `FinancedInvoice.amount = $100,000` (what they owe) but never `BankOwnership.purchaseRate = 97.6%` (what the bank paid). This is not masked by the UI — the buyer's PQS database literally contains no rows for the `BankOwnership` template.

---

## How Canton Privacy Works Here

### Sub-Transaction Privacy Protocol

When a Canton transaction is committed:

1. Each signatory and observer of a created contract receives the contract's payload, encrypted with their public key.
2. Non-observers receive only a **cryptographic commitment hash** — they know a contract was created but cannot learn its content.
3. The Global Synchronizer (SV nodes) receives only commitment hashes and ordering information — no business data.

### Why Application-Layer Checks Aren't Enough

In a traditional web app, you might hide `purchaseRate` in the API response. But:
- A compromised backend could expose it.
- A determined attacker could query the database directly.
- The "trust" is centralized in the application layer.

In Canton, `purchaseRate` is stored **only on the winning bank's participant node**. The buyer's participant node never receives the data — there is nothing to leak, even if the application is fully compromised.

### The `operator` Co-Signatory Pattern

All Deadline Derby contracts include `operator : Party` (the AppProvider/platform party) as a co-signatory. This allows the backend to submit all commands using a single service account (the AppProvider's token), while still correctly modeling multi-party consent.

In production deployments, each trade party would have their own Canton participant node and submit commands directly. The `operator` pattern is a pragmatic simplification for the hackathon demo that maintains the correct privacy properties while working within the existing single-backend architecture.

---

*Built at ETHDenver 2026 on Canton Network. Open-source under BSD Zero Clause License.*
