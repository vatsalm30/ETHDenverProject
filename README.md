
# InvoiceNow — Invoice Financing on Canton Network

> **ETHDenver Hackathon Project** | Built on the Canton Network Global Synchronizer using Daml smart contracts, ZK proofs, sealed-bid Dutch auctions, and decentralized settlement.

---

## What Is InvoiceNow?

Invoice financing is a **$3+ trillion global market** built on a structural inefficiency: suppliers who have completed legitimate work and hold confirmed invoices are forced to wait **30, 60, or even 90 days** for payment while their capital sits frozen in receivables.

This liquidity gap creates cascading operational risk — suppliers cannot pay their own vendors, fund new production, or invest in growth while waiting on buyers to fulfill payment terms.

**Existing solutions are broken:**
- Traditional factoring companies offer take-it-or-leave-it rates with zero competitive transparency
- Suppliers have no mechanism to verify whether the terms they receive reflect fair market pricing
- The entire system relies on a single intermediary's margin requirements rather than real supply and demand

**InvoiceNow fixes this** by creating a competitive Dutch auction marketplace where:
1. Suppliers sell confirmed invoices immediately for working capital
2. Financiers bid in real time for the right to fund those invoices
3. Market dynamics produce rates anchored to genuine supply and demand — not an intermediary's margin

---

## How It Improves Existing Processes

| Existing Process | InvoiceNow |
|-----------------|----------------|
| Single intermediary sets the rate | Competitive Dutch auction — market sets the rate |
| Opaque pricing, no transparency | On-chain bids, verifiable results |
| Manual verification of invoice legitimacy | ZK proofs verify invoice validity without exposing sensitive data |
| Weeks of onboarding and credit checks | Trust score computed on-chain from verifiable history |
| Settlement delays, wire transfer risk | Atomic settlement on Canton's Global Synchronizer |
| Counterparty risk on both sides | Smart contract holds funds in escrow until conditions are met |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Canton Global Synchronizer               │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   Supplier   │    │  Auction     │    │  Financier   │  │
│  │  Participant │◄──►│  Contract    │◄──►│  Participant │  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘  │
│         │                   │                   │           │
│         │            ┌──────▼───────┐           │           │
│         │            │  ZK Proof    │           │           │
│         │            │  Verifier    │           │           │
│         │            └──────┬───────┘           │           │
│         │                   │                   │           │
│         └───────────────────▼───────────────────┘           │
│                    Atomic Settlement                         │
└─────────────────────────────────────────────────────────────┘
         ▲                                        ▲
         │                                        │
┌────────┴──────────┐                  ┌──────────┴────────┐
│  Spring Boot API   │                  │  React + Vite UI  │
│  (backend/)        │                  │  (frontend/)      │
└───────────────────┘                  └───────────────────┘
```

**Stack:**
- **Smart Contracts:** Daml (invoice-finance package on Canton Network)
- **Backend:** Spring Boot (Java 21) — REST API over Canton Ledger API
- **Frontend:** React + Vite
- **Runtime:** Docker Compose — participant node, validator, PostgreSQL, auth, observability
- **Privacy Layer:** Canton's contract-level visibility enforcement + ZK proofs

---

## How the ZK Proofs Work

This is the core technical innovation. Here is exactly what is happening and why it matters.

### The Problem ZK Proofs Solve

When a supplier submits an invoice to the auction, they face a fundamental dilemma:

- **Financiers need to verify the invoice is real** — that the buyer actually owes the money, the amount is correct, and the invoice has not already been sold elsewhere (double-financing fraud)
- **But the supplier cannot expose raw invoice data** — it contains buyer identity, contract terms, payment history, and business relationships that are commercially confidential

Without ZK proofs, you are forced to choose: either expose sensitive data to every potential financier, or accept unverified invoices and absorb fraud risk. Both options are unacceptable. ZK proofs eliminate this tradeoff entirely.

### What a ZK Proof Actually Is

A Zero-Knowledge proof is a cryptographic method that lets one party (the **prover**) convince another party (the **verifier**) that a statement is true — **without revealing any information beyond the truth of the statement itself.**

Classic analogy: Imagine proving you know the solution to a maze without ever showing the path. You walk out the exit. The verifier is convinced you knew the route. They learned nothing about which turns you took.

In InvoiceNow: the supplier proves their invoice satisfies all validity conditions **without revealing the invoice itself.**

### What We Prove With ZK

For each invoice submitted to the auction, a ZK proof is generated that attests to the following statements simultaneously, without revealing the underlying data:

**1. Invoice Existence and Authenticity**
```
PROVE: hash(invoice_data) == committed_hash
       AND invoice was signed by valid_buyer_key
       AND signature is cryptographically valid

WITHOUT REVEALING: invoice_data, buyer_identity, contract_terms
```

**2. Invoice Value Range**
```
PROVE: invoice_amount >= minimum_threshold
       AND invoice_amount <= maximum_threshold

WITHOUT REVEALING: exact invoice_amount
```

This uses a **range proof** — a ZK construction that proves a number falls within a range. Financiers know the invoice is worth financing. They do not know the exact face value until after the auction closes and settlement occurs.

**3. No Double-Financing (Nullifier Check)**
```
PROVE: nullifier = hash(invoice_id || supplier_secret) is UNIQUE
       AND nullifier does NOT exist in the on-chain NullifierRegistry

WITHOUT REVEALING: invoice_id, supplier_secret
```

This is the most important fraud-prevention mechanism in the system.

Every invoice generates a unique **nullifier** — a cryptographic fingerprint derived from the invoice ID and a secret only the supplier knows. When the ZK proof is verified on-chain, the nullifier is written to a registry contract. If a supplier attempts to submit the same invoice a second time (to a different financier, or in a new auction), the nullifier already exists in the registry and the proof is **rejected at the contract level.**

The double-financing fraud is detected cryptographically — without ever revealing which invoice was duplicated, who the buyer was, or any other details. The proof simply fails.

**4. Supplier Trust Score Threshold**
```
PROVE: trust_score >= required_minimum_for_this_auction
       AND trust_score was derived from verified on-chain history

WITHOUT REVEALING: exact trust_score, individual transaction history
```

### ZK Proof Flow — Step by Step

```
SUPPLIER SIDE  (off-chain computation in zk-bank-service)
──────────────────────────────────────────────────────────

1. Supplier uploads invoice to zk-bank-service

2. Service constructs the witness (all private inputs):
   witness = {
     invoice_data,         ← private: raw invoice contents
     supplier_secret,      ← private: supplier's blinding factor
     buyer_pubkey,         ← private: who signed the invoice
     amount,               ← private: face value
     nullifier_preimage    ← private: invoice_id + secret
   }

3. Prover runs the ZK circuit over the witness:
   (proof, public_outputs) = PROVE(circuit, witness)

   public_outputs (visible to everyone on-chain):
   {
     committed_hash,       ← hash of invoice, verifiable without contents
     nullifier,            ← unique fingerprint, registered to prevent reuse
     amount_range_valid,   ← boolean: invoice is within acceptable range
     trust_threshold_met   ← boolean: supplier qualifies for this auction tier
   }

   NOTE: In development, MOCK_ZK=true skips real proof generation
   for fast iteration. Remove this flag for production.

CANTON LEDGER SIDE  (on-chain Daml contract execution)
───────────────────────────────────────────────────────

4. Supplier submits SubmitInvoice command to AuctionContract:
   {
     proof,                ← the ZK proof blob
     public_outputs,       ← the verified claims
     invoice_commitment    ← cryptographic binding to the invoice
   }

5. AuctionContract calls the ZK Verifier module:
   verify(proof, public_outputs) → bool
   (if false: transaction rejected, invoice not entered)

6. Verifier checks the NullifierRegistry:
   registry.contains(nullifier) → REJECT if already present

7. If all checks pass:
   - Nullifier written to NullifierRegistry (permanently locked)
   - Invoice enters the active auction queue
   - Eligible financiers are notified per Canton's privacy model
```

### Why Canton Is the Right Chain for This

Canton's privacy model means **contract state is only delivered to explicitly named stakeholders** — enforced at the ledger protocol level, not the application layer. This is architecturally different from any public chain.

- ZK proof data is verified on-chain with full cryptographic guarantees
- But the proof and its public outputs are only visible to the relevant auction parties
- A financier not participating in Invoice X's auction **never receives Invoice X's data** at all — it is never transmitted to their node
- This is not filtering — it is enforced by the Canton participant nodes cryptographically

On Ethereum, all of this would be globally readable. That alone would make enterprise invoice financing impossible.

---

## Trust Scoring System

Beyond per-invoice ZK proofs, the system maintains an on-chain **trust score** for each participant.

### How Trust Scores Are Computed

| Factor | Weight | Description |
|--------|--------|-------------|
| On-time payment rate | 40% | Percentage of past invoices settled by due date |
| Default rate | 30% | Percentage of invoices that went to dispute or default |
| Volume history | 15% | Total value of successfully settled invoices |
| Time on network | 15% | Age of the participant's Canton identity |

The score is computed off-chain and committed on-chain via a ZK proof — the **score itself is cryptographically verified as correct** without revealing every individual transaction that contributed to it.

### Why This Matters

A financier bidding on an invoice needs confidence in two independent things:
1. The invoice is authentic and unforgeable (handled by the invoice ZK proof)
2. The supplier has a history of honest behavior (handled by trust score proof)

Both are verified cryptographically. Neither requires a centralized credit bureau, a bank reference, or a manual underwriting process.

---

## The Dutch Auction Mechanism

### How the Auction Works

InvoiceNow uses a **sealed-bid descending Dutch auction:**

```
1. SUBMISSION
   Supplier submits invoice + ZK proof
   Auction opens at a starting discount rate (e.g. 8.0%)
   — financier would pay $92,000 for a $100,000 invoice

2. PRICE DESCENT
   The discount rate falls over time:

   t=0min:   8.0% discount  →  financier pays $92,000
   t=10min:  7.5% discount  →  financier pays $92,500
   t=20min:  7.0% discount  →  financier pays $93,000
   t=30min:  6.5% discount  →  financier pays $93,500
   ...

   The longer financiers wait, the better the rate for the supplier
   but the higher the risk another financier takes the deal first

3. SEALED BID SUBMISSION
   Financiers submit their maximum acceptable discount rate (sealed)
   Bids are hidden until auction closes — prevents front-running

4. CLEARING
   Auction closes when:
   - A bid matches the current descending price, OR
   - A time limit is reached

   Winning financier: lowest discount rate bid that covers the invoice
   They pay: face_value × (1 - winning_discount_rate)
   They collect: full face_value at invoice maturity

5. ATOMIC SETTLEMENT ON CANTON
   - Funds transfer from financier to supplier
   - Invoice ownership transfers to financier
   - Nullifier permanently locked in registry
   - All in one atomic transaction — no partial settlement risk
```

### Why a Dutch Auction

- **Suppliers get the best possible rate** — financier competition drives discount rates down
- **Financiers reveal their true cost of capital** — no incentive to bid strategically below true preference
- **No information asymmetry** — ZK proofs give all financiers the same verified facts about the invoice
- **Front-running is impossible** — sealed bids prevent financiers from adjusting based on others' revealed bids
- **Price discovery is real** — the clearing rate reflects genuine market supply and demand

---

## Quickstart

### Prerequisites

- Docker + Docker Compose (**8 GB+ memory allocation required**)
- Make
- Node.js + npm
- Java 21
- Daml SDK

### First-Time Setup

```bash
cd project
make setup    # prompts for auth mode, observability, test mode
make build
make start
```

### ZK Bank Service

```bash
cd zk-bank-service
npm install
MOCK_ZK=true node src/server.js     # fast dev/mock mode
node src/server.js                   # real proof generation
```

Use `MOCK_ZK=true` during development to skip proof generation latency. Remove it when testing the full cryptographic flow.

---

## Service URLs

| Service | URL |
|---------|-----|
| App frontend | http://app-provider.localhost:3000 |
| App user wallet | http://wallet.localhost:2000 |
| App provider wallet | http://wallet.localhost:3000 |
| ANS UI (user) | http://ans.localhost:2000 |
| ANS UI (provider) | http://ans.localhost:3000 |
| Backend API | http://localhost:8080 |
| Swagger UI | http://localhost:9090 |
| Keycloak (OAuth2 mode) | http://keycloak.localhost:8082 |
| Grafana | http://localhost:3030 |
| SV UI | http://sv.localhost:4000 |
| Scan UI (tx monitor) | http://scan.localhost:4000 |
| Vite dev server | http://app-provider.localhost:5173 |

---

## Daily Dev Commands

```bash
# From project/
make start              # start all services
make stop               # stop all services
make status             # container health check
make logs               # view logs
make tail               # follow logs live
make build              # full rebuild
make build-daml         # Daml contracts + DARs only
make build-backend      # Spring Boot only
make build-frontend     # React/Vite only
make restart-backend    # hot restart backend
make restart-frontend   # hot restart frontend
make clean-all          # wipe all artifacts, containers, volumes
make install-daml-sdk   # upgrade Daml SDK to latest
```

### Frontend Hot Reload

**Terminal A** (`project/`):
```bash
make start-vite-dev
```

**Terminal B** (`project/frontend/`):
```bash
npm run dev
npm run gen:openapi     # regenerate API client from openapi.yaml
npm run lint
```

---

## Testing

```bash
cd project
make test               # full test suite
make test-daml          # Daml contract unit tests
make integration-test   # Playwright E2E (project/integration-test/)
```

---

## Project Structure

```
project/
├── daml/
│   └── invoice-finance/       # Core smart contracts
│       ├── Invoice.daml        # Invoice template
│       ├── Auction.daml        # Dutch auction logic
│       ├── NullifierRegistry.daml
│       └── Settlement.daml
├── backend/                   # Spring Boot API service
├── frontend/                  # React + Vite UI
├── common/
│   └── openapi.yaml           # Shared API schema (backend ↔ frontend)
├── compose.yaml               # Docker Compose orchestration
└── docker/
    ├── backend-service/
    └── modules/
        ├── localnet/          # Splice LocalNet (Canton infrastructure)
        ├── keycloak/          # OAuth2 identity provider
        ├── pqs/               # Participant Query Store
        └── observability/     # Grafana + Prometheus + Loki

zk-bank-service/               # ZK proof generation service (Node.js)
├── src/
│   └── server.js
└── package.json
```

---

## Canton Privacy Model — Why It Matters Here

**Public blockchain** (Ethereum, Solana): all state is globally visible. Every invoice, every bid, every settlement — readable by anyone. This makes enterprise invoice financing impossible.

**Canton Network**: contract state is **only delivered to explicitly named stakeholders**, enforced at the ledger protocol level.

This means:
- **Suppliers** see their own invoices and auction outcomes only
- **Financiers** see only auctions they are eligible to participate in
- **Non-participating nodes** receive none of the invoice data — it is never transmitted to them
- **Settlement events** are visible to the network, but not invoice contents or bid amounts

This is not application-layer filtering. It is cryptographically enforced by the Canton participant nodes. The ZK proofs layer on top of this to provide additional guarantees even within the set of stakeholders who can see a given invoice.

---

## Auth Modes

**OAuth2 (default):** Local Keycloak instance. Realistic browser flows with proper identity federation. Pre-configured tenants: `AppProvider` and `AppUser`.

```bash
# Keycloak admin console
http://keycloak.localhost:8082/admin/master/console/
```

**Shared-secret:** Simpler, faster for local dev. No Keycloak dependency.

Set during `make setup`. Can be reconfigured anytime by re-running `make setup`.

---

## Port Reference

### Suffix Scheme

| Suffix | Service |
|--------|---------|
| `901` | Ledger API |
| `902` | Admin API |
| `903` | Validator Admin API |
| `975` | JSON (HTTP) Ledger API |

### Prefix by Role

| Prefix | Role |
|--------|------|
| `4xxx` | Super Validator |
| `3xxx` | App Provider |
| `2xxx` | App User |

### Key Ports

| Service | Port |
|---------|------|
| Backend Service | 8080 |
| Swagger UI (external) | 9090 |
| PostgreSQL | 5432 |
| App Provider Ledger API | 3901 |
| App User Ledger API | 2901 |
| SV Ledger API | 4901 |
| Keycloak | 8082 |
| Grafana | 3030 |

---

## Troubleshooting

**Services fail to start:**
```bash
cd project
make clean-all
make build
make start
```

**Common causes:**
- Docker memory under 8 GB — increase in Docker Desktop settings
- Stale Daml SDK — run `make install-daml-sdk`
- Port conflict — check `make status` and `make logs`

**Collect debug bundle:**
```bash
cd project
make capture-logs
# In another terminal, reproduce the issue, then:
tar -czvf quickstart-logs.tar.gz logs
```

---

## External Token Transfers

For integrations requiring external token transfers, use Registry API endpoints rather than direct contract queries:

```
http://scan.localhost:4000/registry/transfer-instruction/v1/transfer-factory
```

---

## Legal

This project inherits Digital Asset Quickstart terms and licensing conditions. By using the software and binaries, you are subject to those terms.

Built on [Splice LocalNet](https://github.com/hyperledger-labs/splice/tree/main/cluster/compose/localnet).  
Licensed under the **BSD Zero Clause License**.

Upstream documentation: [Canton Network Quickstart](https://docs.digitalasset.com/build/3.3/quickstart/download/cnqs-installation.html)

Vulnerability reporting: https://www.digitalasset.com/responsible-disclosure

---

*Built at ETHDenver by Jacob, Manu, and Vatsal*
