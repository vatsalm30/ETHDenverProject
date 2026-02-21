# InvoiceNow

**Confidential Invoice Financing on Canton Network with Zero-Knowledge Trust Scoring**

Built at ETHDenver 2026

---

## Table of Contents

1. [What Is InvoiceNow?](#what-is-deadline-derby)
2. [Why Canton Network?](#why-canton-network)
3. [Architecture Overview](#architecture-overview)
4. [Canton Network Deep Dive](#canton-network-deep-dive)
5. [Daml Smart Contracts](#daml-smart-contracts)
6. [Privacy Model](#privacy-model)
7. [Zero-Knowledge Trust Scoring](#zero-knowledge-trust-scoring)
8. [Tech Stack](#tech-stack)
9. [Repository Layout](#repository-layout)
10. [Prerequisites](#prerequisites)
11. [Getting Started](#getting-started)
12. [Development Workflow](#development-workflow)
13. [Testing](#testing)
14. [Port Reference](#port-reference)
15. [Troubleshooting](#troubleshooting)
16. [License](#license)

---

## What Is InvoiceNow?

InvoiceNow is a full-stack **confidential invoice financing platform** built on the Canton Network. It demonstrates how multi-party trade finance workflows can execute with cryptographic privacy guarantees that traditional systems cannot provide.

The core workflow:

1. A **Supplier** creates an invoice for goods delivered to a **Buyer**.
2. The **Buyer** confirms the invoice is legitimate.
3. The Supplier launches a **English auction** where eligible **Banks** compete to finance the invoice at the best rate.
4. The winning bank purchases the invoice at a discount, paying the supplier immediately.
5. The buyer pays the full face value at maturity — the bank pockets the spread.
6. Optionally, a **Sprint Boost** mechanism lets the buyer pay early in exchange for a bounty.

What makes this different from every other invoice financing demo is the **privacy**: losing banks never learn who won or at what rate. The buyer never sees the bank's margin. The supplier is excluded from early-payment negotiations that happen after they've already been paid. All of this is enforced at the ledger level by Canton, not by application-layer access controls that can be bypassed.

On top of this, **Zero-Knowledge (ZK) Trust Scoring** services independently verify the creditworthiness of every participant — suppliers, buyers, and banks — without revealing the underlying financial data to anyone on the network.

---

## Why Canton Network?

### The Problem with Existing Approaches

Traditional invoice financing platforms face a fundamental tension: all parties need to trust the platform operator, but the operator has access to everyone's data. Banks see each other's bids. Suppliers know which bank won and can infer margins. Buyers can see competitive pricing information. Any party with database access can reconstruct the full picture.

Public blockchains (Ethereum, Solana, etc.) make this worse, not better. Every transaction is globally visible. You can add encryption layers, but the execution model is fundamentally transparent — state changes are visible to every validator, and MEV extractors can front-run auction bids.

Even permissioned blockchains like Hyperledger Fabric share all data within a channel. You can create private data collections, but they're bolted on, not native to the execution model, and they don't compose cleanly with smart contract logic.

### Why Canton Solves This

Canton is the only production-grade distributed ledger where **privacy is a first-class property of the execution model**, not an afterthought.

**Sub-transaction privacy.** Canton doesn't broadcast entire transactions to all participants. Each participant only receives the parts of a transaction they are authorized to see. When a bank wins an auction, only the winning bank and the operator see the `WinningBid` contract. Losing banks see the auction close but receive zero information about the outcome. This isn't filtering at the API layer — the data physically never reaches their nodes.

**Composable privacy.** Daml's authorization model (signatories and observers) is checked at the ledger level. You can't accidentally leak data by writing a buggy query. If a party isn't listed as a signatory or observer on a contract, their participant node never receives the contract payload — only a cryptographic commitment hash proving the transaction happened.

**Global Synchronizer.** Canton's Global Synchronizer provides atomic, cross-participant transaction ordering without revealing transaction contents to the synchronizer itself. The synchronizer sees encrypted, blinded commitments — not cleartext contract data. This means you get the coordination benefits of a shared ledger without the privacy costs.

**Deterministic execution.** Daml contracts execute deterministically. There's no gas, no MEV, no front-running. When a bank submits a bid at rate X, that bid executes at rate X or fails — there's no intermediary that can sandwich the transaction.

**Enterprise-grade.** Canton is the production infrastructure behind the Canton Network, used by major financial institutions. It's not a testnet or a research prototype.

### Canton vs. Alternatives for This Use Case

| Requirement | Ethereum/L2 | Fabric | Canton |
|---|---|---|---|
| Per-party data visibility | No (global state) | Partial (channels) | Yes (sub-transaction) |
| Auction bid privacy | No (public mempool) | No (channel-wide) | Yes (observer-scoped) |
| Atomic multi-party settlement | Yes (but public) | Limited | Yes (private) |
| Deterministic execution | Yes | Yes | Yes |
| No MEV / front-running | No | Yes | Yes |
| Production financial infra | Limited | Yes | Yes |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          End Users (Browser)                        │
│         Supplier  ·  Buyer  ·  Bank  ·  Admin                      │
└──────────────┬──────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────┐
│   React + TypeScript + Vite  │  Frontend (Nginx :3000 / :2000)
│   Role-based dashboards      │
│   ZK trust score display     │
└──────────────┬───────────────┘
               │ HTTP/REST
               ▼
┌──────────────────────────────┐     ┌──────────────────────────────┐
│   Spring Boot Backend        │────▶│  ZK Trust Score Services     │
│   Java 21 · REST API         │     │                              │
│   Invoice lifecycle mgmt     │     │  zk-supplier-service (:3001) │
│   Auction orchestration      │     │  zk-bank-service     (:3002) │
│   Trust score integration    │     │  zk-buyer-service    (:3003) │
└──────────┬───────────────────┘     └──────────────────────────────┘
           │ gRPC (Ledger API)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canton Network (LocalNet)                    │
│                                                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ App Provider     │  │ App User        │  │ Super Validator  │  │
│  │ Participant      │  │ Participant     │  │ Participant      │  │
│  │ (:3901)          │  │ (:2901)         │  │ (:4901)          │  │
│  └────────┬─────────┘  └────────┬────────┘  └────────┬────────┘  │
│           │                     │                     │           │
│           ▼                     ▼                     ▼           │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              Global Synchronizer                          │    │
│  │   Atomic ordering · Encrypted commitments · No MEV        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────────────┐  ┌───────────┐  ┌──────────────────────┐   │
│  │ Private Sync     │  │ PostgreSQL│  │ PQS (Participant     │   │
│  │ (Provider domain)│  │ (multi-db)│  │  Query Store)        │   │
│  └──────────────────┘  └───────────┘  └──────────────────────┘   │
│                                                                   │
│  Optional: Keycloak (OAuth2) · Grafana · Prometheus · Loki       │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. The **frontend** presents role-specific dashboards (supplier, buyer, bank, admin). Each role only sees UI elements and data relevant to their position in the workflow.

2. The **Spring Boot backend** receives REST requests, validates them, checks ZK trust scores, and submits Daml commands to Canton via gRPC. It reads contract state from PostgreSQL via the Participant Query Store (PQS).

3. **ZK Trust Score services** are standalone Node.js microservices. The backend calls them before allowing certain actions (e.g., a bank must pass liquidity and legitimacy proofs before bidding). They run independently and the backend degrades gracefully if they're unreachable.

4. **Canton participant nodes** execute Daml contract logic. Each participant only stores and processes contracts where their party is a signatory or observer. The Global Synchronizer coordinates transaction ordering without seeing contract contents.

---

## Canton Network Deep Dive

### Participant Nodes

InvoiceNow runs three participant nodes, each representing a different organizational role:

| Participant | Ledger API | Admin API | Represents |
|---|---|---|---|
| App Provider | :3901 | :3902 | Platform operator (co-signs all contracts) |
| App User | :2901 | :2902 | Suppliers, buyers, and banks |
| Super Validator | :4901 | :4902 | Network infrastructure (Global Synchronizer) |

The **App Provider participant** acts as the platform operator. It co-signs every contract, enabling the backend service to submit commands on behalf of all roles using a single service account. In production, each organization would run its own participant node.

### Synchronization Domains

**Global Synchronizer** — Operated by the Super Validator. All transactions involving Canton Coin or requiring cross-organization coordination route through here. The synchronizer sees only encrypted, blinded commitments — never cleartext contract data.

**Private Synchronizer** — Operated by the App Provider. Transactions between the provider and users that don't need the Global Synchronizer can use this domain for reduced latency and cost.

### Participant Query Store (PQS)

PQS is a sidecar that streams ledger events from a participant node into PostgreSQL. The backend reads contract state from PQS rather than querying the ledger API directly. This provides:

- Fast SQL-based queries over contract state
- Historical data access (archived contracts)
- Reduced load on the participant node

### Splice LocalNet

For local development, the project uses [Splice LocalNet](https://github.com/hyperledger-labs/splice/tree/main/cluster/compose/localnet) — a Docker Compose-based setup that runs a complete Canton Network locally, including participants, validators, the Global Synchronizer, and supporting infrastructure.

### Authentication

Two modes are supported:

- **OAuth2** (default) — Keycloak provides multi-tenant identity management. Each organization (App Provider, App User) gets its own Keycloak realm with pre-configured users and clients. The backend authenticates to Canton via OAuth2 Client Credentials Flow.
- **Shared Secret** — Simplified auth for development. All services share a common secret for authentication.

---

## Daml Smart Contracts

All smart contracts live in `project/daml/invoice-finance/daml/InvoiceFinance/Core.daml`. The Daml language enforces authorization rules at the ledger level — there is no way to bypass visibility constraints through application code.

### Contract Lifecycle

```
  Supplier creates          Buyer confirms         Supplier starts auction
┌──────────┐            ┌──────────┐            ┌───────────────────┐
│ Invoice   │───────────▶│ Invoice   │───────────▶│ FinancingAuction  │
│ PENDING   │            │ CONFIRMED │            │ OPEN              │
└──────────┘            └──────────┘            └─────────┬─────────┘
                                                          │
                                              Bank grabs at current rate
                                                          │
                    ┌─────────────────────────────────────┼──────────────────┐
                    │                                     │                  │
                    ▼                                     ▼                  ▼
          ┌─────────────────┐               ┌──────────────────┐  ┌──────────────────┐
          │ WinningBid       │──── settle ──▶│ FinancedInvoice  │  │ BankOwnership    │
          │ (operator + bank)│               │ (all parties)    │  │ (operator + bank)│
          └─────────────────┘               └────────┬─────────┘  └──────────────────┘
                                                     │
                                          Optional Sprint Boost
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │ PaidInvoice      │
                                            │ (all parties)    │
                                            └─────────────────┘
```

### Contract Templates

**Invoice** — Created by the supplier with the operator as co-signatory. The buyer is an observer who can confirm delivery. Banks have zero visibility at this stage.

**FinancingAuction** — A English auction where the price starts high and falls. All eligible banks are observers and can see auction parameters, but the buyer is excluded from seeing competitive pricing. When a bank "grabs" the invoice at the current rate, the auction archives and a private `WinningBid` is created.

**WinningBid** — The most privacy-critical contract. Only the operator and the winning bank can see it. It contains the `purchaseRate` and `purchaseAmount`. Losing banks never learn who won. The buyer never sees how much the bank paid. Settlement creates two contracts: a public `FinancedInvoice` and a private `BankOwnership`.

**FinancedInvoice** — Visible to all three trade parties (supplier, buyer, bank) plus the operator. Critically, it does **not** contain the purchase rate or purchase amount. The buyer sees how much they owe at maturity but not what the bank paid the supplier.

**BankOwnership** — Contains the confidential purchase rate and amount. Only visible to the operator and the winning bank. The buyer is excluded — the bank's margin stays confidential.

**SprintBoostOffer** — An optional early-payment negotiation between the buyer and bank. The supplier is not a party (they already received their cash). This is a private negotiation that the supplier never sees.

**PaidInvoice** — The final immutable record. All three trade parties can see it.

---

## Privacy Model

Canton's privacy model is enforced at the **ledger delivery level**, not at the application layer. When a contract is created, only participant nodes whose parties are listed as signatories or observers receive the contract payload. All other nodes receive only a cryptographic commitment hash.

### Who Sees What

| Contract | Operator | Supplier | Buyer | Winning Bank | Losing Banks |
|---|:---:|:---:|:---:|:---:|:---:|
| Invoice | Yes | Yes (signatory) | Yes (observer) | — | — |
| FinancingAuction | Yes (signatory) | — | — | Yes (observer) | Yes (observer) |
| WinningBid | Yes (signatory) | — | — | Yes (observer) | **No** |
| FinancedInvoice | Yes (signatory) | Yes (signatory) | Yes (signatory) | Yes (signatory) | **No** |
| BankOwnership | Yes (signatory) | — | **No** | Yes (observer) | **No** |
| SprintBoostOffer | Yes (signatory) | **No** | Yes (observer) | Yes (observer) | — |
| PaidInvoice | Yes (signatory) | Yes (signatory) | Yes (signatory) | Yes (signatory) | **No** |

### Key Privacy Guarantees

- **Losing banks are blind.** They see the auction open and close, but never learn who won, at what rate, or any details of the settlement. Their participant nodes physically never receive the `WinningBid`, `FinancedInvoice`, or `BankOwnership` contracts.

- **Buyer never knows the bank's margin.** The `FinancedInvoice` contract that the buyer sees contains the face value (what they owe) but not the purchase rate (what the bank paid). The `BankOwnership` contract with the real numbers is invisible to the buyer.

- **Supplier excluded from Sprint Boost.** Once the supplier has been paid, they have no visibility into early-payment negotiations between the buyer and bank. The `SprintBoostOffer` contract does not list the supplier as a party.

- **Global Synchronizer sees nothing.** The synchronizer coordinates transaction ordering using encrypted, blinded commitments. It never sees cleartext contract data.

---

## Zero-Knowledge Trust Scoring

InvoiceNow integrates three independent ZK Trust Score services that evaluate participant creditworthiness without exposing the underlying financial data to the network. Each service runs as a standalone Node.js microservice.

### How It Works

Before a participant can take certain actions (e.g., a bank bidding on an auction), the backend calls the appropriate ZK service to verify eligibility. The ZK service evaluates private financial data against threshold conditions and returns a pass/fail result for each proof — without revealing the actual values to anyone.

The trust scores are displayed in the frontend dashboard as PASS/FAIL/PENDING badges with an overall tier rating (CERTIFIED, PROBATIONARY, PROVISIONAL, etc.).

### Supplier Trust Score (port 3001)

Evaluates whether a supplier is creditworthy enough to list invoices on the platform.

| Proof | What It Verifies | Condition |
|---|---|---|
| Proof 1 — Invoice Legitimacy | Invoice hash exists in the supplier registry | `hash ∈ registryMerkleTree` |
| Proof 2 — Repayment History | Historical repayment track record | `onTimePaid / totalInvoices ≥ 0.8` |
| Proof 3 — Volume | Sufficient recent trading activity | `invoicesLast6Months ≥ 3` |
| Proof 4 — Dispute Record | Low dispute rate | `totalDisputes / totalInvoices ≤ 0.1` |

**Tiers:** CERTIFIED (all 4 pass) → VERIFIED (3 pass) → PROVISIONAL (1-2 pass, invoice value cap of $5,000) → SUSPENDED (0 pass)

The supplier is never blocked from creating invoices, but their trust tier affects the invoice value cap and how banks perceive risk.

### Bank Trust Score (port 3002)

Evaluates whether a bank is eligible to participate in financing auctions.

| Proof | What It Verifies | Condition |
|---|---|---|
| Proof X — Liquidity | Sufficient reserves to cover financing | `reserveBalance ≥ 1.1 × financingAmount` |
| Proof Y — Legitimacy | Node has been active long enough | `currentTime - registrationTime ≥ 30 days` |
| Proof Z — Rate Compliance | Offered rate is within network norms | `offeredRate ≤ 1.2 × networkAverageRate` |

**Tiers:** CERTIFIED (all 3 pass, score 3/3) → PROBATIONARY (1-2 pass, bidding allowed with reduced score) → RATE_VIOLATION (rate exceeds network average by >20%)

Banks can still bid with a PROBATIONARY tier, but their reduced score is visible to the platform and may influence auction outcomes.

### Buyer Trust Score (port 3003)

Evaluates buyer reliability for banks assessing auction risk.

| Proof | What It Verifies | Condition |
|---|---|---|
| Proof 1 — Payment History | Track record of paying invoices | `totalPaid / totalObligation ≥ 0.8` |
| Proof 2 — Confirm Rate | Rate of confirming received invoices | `confirmed / totalReceived ≥ 0.7` |
| Proof 3 — Dispute Record | Low dispute frequency | `disputes / totalReceived ≤ 0.1` |
| Proof 4 — Timeliness | On-time payment rate | `onTimePayments / totalPayments ≥ 0.75` |

**Rule:** Buyers are **never** blocked from confirming invoices. Unverified buyers are flagged as HIGH_RISK on auctions so banks can factor it into their bidding decisions.

### Mock Mode

All ZK services support `MOCK_ZK=true` for development, which returns all-pass results instantly without running any proof computations. This is the default in the local development environment.

### Graceful Degradation

The backend is designed to never crash if a ZK service is unreachable. Each ZK client returns a fallback score (PROVISIONAL or PROBATIONARY) with clear status messaging. The system continues operating with degraded trust information rather than halting.

### Architecture: Why Separate Services?

The ZK services are intentionally decoupled from the Canton backend:

1. **Language independence.** ZK proof libraries (snarkjs, circom_runtime) are JavaScript/WASM-native. Running them in separate Node.js processes avoids JVM interop complexity.
2. **Independent scaling.** Trust score computation can be scaled independently of the Canton backend.
3. **Upgradability.** Proof circuits can be updated without redeploying the entire backend.
4. **Auditability.** Isolating proof logic makes it easier to audit and formally verify.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart contracts | Daml (compiled to DAR, executed on Canton) |
| Distributed ledger | Canton Network (Global Synchronizer, Splice LocalNet) |
| Backend | Spring Boot 3.4.2, Java 21, gRPC, PostgreSQL |
| Frontend | React 18, TypeScript, Vite 6, Framer Motion |
| ZK services | Node.js, snarkjs (supplier service), HTTP microservices |
| Auth | Keycloak (OAuth2) or shared-secret mode |
| API contract | OpenAPI 3.0 (contract-first: generates Java server stubs + TS client types) |
| Orchestration | Docker Compose (~15+ services), Make |
| Observability | Grafana, Prometheus, Loki, Tempo (optional) |
| Testing | Daml unit tests, Playwright E2E |

---

## Repository Layout

```
ETHDenverProject/
├── project/                        # Main application code
│   ├── daml/                       # Daml smart contracts
│   │   ├── invoice-finance/        #   Invoice financing workflow (Core.daml)
│   │   ├── licensing/              #   App licensing contracts
│   │   └── licensing-tests/        #   Daml test contracts
│   ├── backend/                    # Spring Boot backend service
│   │   └── src/main/java/com/digitalasset/quickstart/
│   │       ├── service/            #   REST API + ZK client integrations
│   │       ├── ledger/             #   gRPC Canton Ledger API client
│   │       ├── repository/         #   PQS data access layer
│   │       ├── security/           #   OAuth2 + shared-secret auth
│   │       └── pqs/                #   Participant Query Store integration
│   ├── frontend/                   # React + TypeScript + Vite UI
│   │   └── src/
│   │       ├── views/              #   Page components (Dashboard, Home, etc.)
│   │       ├── stores/             #   State management
│   │       ├── components/         #   Reusable UI components
│   │       └── api.ts              #   Generated API client
│   ├── common/                     # Shared OpenAPI spec
│   │   └── openapi.yaml
│   ├── docker/                     # Docker Compose configs
│   │   ├── modules/
│   │   │   ├── localnet/           #   Splice LocalNet (Canton infra)
│   │   │   ├── keycloak/           #   OAuth2 identity provider
│   │   │   ├── pqs/                #   Participant Query Store
│   │   │   ├── splice-onboarding/  #   Initialization scripts
│   │   │   └── observability/      #   Grafana + Prometheus stack
│   │   └── backend-service/        #   Backend container config
│   ├── integration-test/           # Playwright E2E tests
│   ├── buildSrc/                   # Gradle convention plugins
│   ├── compose.yaml                # Main Docker Compose file
│   ├── Makefile                    # Build/run orchestration
│   ├── .env                        # Base configuration
│   └── .env.local                  # Local overrides (generated by make setup)
│
├── zk-bank-service/                # ZK Bank Trust Score microservice
│   ├── server.js                   #   HTTP server (port 3002)
│   ├── src/bankProofs.js           #   Proof logic (liquidity, legitimacy, rate)
│   └── .env                        #   MOCK_ZK toggle
│
├── zk-supplier-service/            # ZK Supplier Trust Score microservice
│   └── (node_modules w/ snarkjs)   #   snarkjs + circom_runtime available
│
├── zk-buyer-service/               # ZK Buyer Trust Score microservice
│
├── sdk/                            # Documentation and images
│   └── docs/
│       ├── user/                   #   Topology, observability docs
│       └── images/                 #   Architecture diagrams
│
└── flake.nix                       # Nix development environment
```

---

## Prerequisites

- **Docker** 27.0.0+ and **Docker Compose** 2.27.0+
- **Docker memory**: 8 GB minimum (recommended)
- **Make**
- **Node.js** + npm (for frontend and ZK services)
- **Java 21** (for backend build tooling)
- **Daml SDK** (installable via `make install-daml-sdk`)

---

## Getting Started

### 1. Clone and enter the project

```bash
git clone <repository-url>
cd ETHDenverProject/project
```

### 2. Configure the environment

```bash
make setup
```

This interactive wizard asks you to choose:
- **Auth mode**: `oauth2` (default, recommended) or `shared-secret`
- **Observability**: on/off (Grafana, Prometheus, Loki)
- **Test mode**: on/off (enables Playwright integration tests)

Configuration is saved to `.env.local`. Re-run `make setup` any time to change settings.

### 3. Build everything

```bash
make build
```

This compiles Daml contracts to DAR files, builds the Spring Boot backend, and builds the React frontend.

### 4. Start all services

```bash
make start
```

First startup takes several minutes as Docker pulls images and Canton initializes. Subsequent starts are faster.

### 5. Start ZK Trust Score services

In separate terminals:

```bash
# Bank trust scoring (port 3002)
cd zk-bank-service && node server.js

# Supplier trust scoring (port 3001) — if implemented
cd zk-supplier-service && node server.js

# Buyer trust scoring (port 3003) — if implemented
cd zk-buyer-service && node server.js
```

### 6. Access the application

| URL | Description |
|---|---|
| http://app-provider.localhost:3000 | Main application UI |
| http://wallet.localhost:2000 | App User wallet |
| http://wallet.localhost:3000 | App Provider wallet |
| http://localhost:8080 | Backend REST API |
| http://localhost:9090 | Swagger UI |
| http://keycloak.localhost:8082 | Keycloak admin (if OAuth2 enabled) |
| http://localhost:3030 | Grafana dashboards (if observability enabled) |
| http://sv.localhost:4000 | Super Validator UI |
| http://scan.localhost:4000 | Network Scan UI |

### One-liner

```bash
cd project && make setup && make build && make start
```

---

## Development Workflow

All commands run from the `project/` directory unless otherwise noted.

### Daily Commands

```bash
make start              # Start all services
make stop               # Stop all services
make status             # Container status overview
make logs               # View aggregated logs
make tail               # Follow logs in real-time

make build              # Full build (Daml + backend + frontend)
make build-daml         # Compile Daml contracts only
make build-backend      # Build Spring Boot backend only
make build-frontend     # Build React frontend only

make restart-backend    # Rebuild + restart backend container
make restart-frontend   # Rebuild + restart frontend (Nginx)

make clean-all          # Nuclear option: remove all artifacts, containers, volumes
make install-daml-sdk   # Install or upgrade the Daml SDK
```

### Frontend Hot Reload

For fast UI iteration with Vite's hot-module replacement:

**Terminal A** (from `project/`):
```bash
make start-vite-dev
```

**Terminal B** (from `project/frontend/`):
```bash
npm run dev
```

Access the dev server at http://app-provider.localhost:5173.

### Regenerating API Types

The project uses contract-first development. The OpenAPI spec at `project/common/openapi.yaml` is the source of truth.

1. Edit `openapi.yaml`
2. Regenerate TypeScript types: `cd frontend && npm run gen:openapi`
3. Regenerate Java server stubs: `./gradlew :backend:build` (automatic via OpenAPI Generator plugin)

### Backend Debugging

Enable remote JVM debugging:

```bash
export DEBUG_ENABLED=true
make restart-backend
```

Attach your IDE debugger to `localhost:5005`.

---

## Testing

```bash
# Daml contract unit tests
make test-daml

# All tests (currently runs test-daml)
make test

# Playwright E2E integration tests
# Requires TEST_MODE=on and AUTH_MODE=oauth2 (set via make setup)
make integration-test
```

---

## Port Reference

### Application Services

| Service | Port | Description |
|---|---|---|
| Backend (Spring Boot) | 8080 | REST API |
| Backend Debug (JVM) | 5005 | Remote debugging (when `DEBUG_ENABLED=true`) |
| ZK Supplier Service | 3001 | Supplier trust scoring |
| ZK Bank Service | 3002 | Bank trust scoring |
| ZK Buyer Service | 3003 | Buyer trust scoring |

### Web UIs

| Service | Port | URL Pattern |
|---|---|---|
| App User UI | 2000 | `*.localhost:2000` |
| App Provider UI | 3000 | `*.localhost:3000` |
| Super Validator UI | 4000 | `*.localhost:4000` |
| Swagger UI | 9090 | `localhost:9090` |
| Vite Dev Server | 5173 | `app-provider.localhost:5173` |

### Canton Infrastructure

| Role | Ledger API | Admin API | JSON API | Validator API |
|---|---|---|---|---|
| App User | 2901 | 2902 | 2975 | 2903 |
| App Provider | 3901 | 3902 | 3975 | 3903 |
| Super Validator | 4901 | 4902 | 4975 | 4903 |

### Supporting Services

| Service | Port |
|---|---|
| PostgreSQL | 5432 |
| Keycloak | 8082 |
| Grafana | 3030 |

---

## Troubleshooting

### Startup Fails

```bash
cd project
make clean-all          # Wipe everything
make build              # Rebuild from scratch
make start              # Fresh start
```

### Common Issues

- **Out of memory**: Ensure Docker has at least 8 GB allocated. The full stack runs ~15 containers.
- **Daml SDK version mismatch**: Run `make install-daml-sdk` to install/upgrade.
- **Port conflicts**: Check that ports 2000, 3000, 3001-3003, 8080, 8082 are not in use by other applications.
- **ZK services not responding**: The backend falls back to PROVISIONAL/PROBATIONARY scores. Check that the ZK service processes are running and the correct ports are configured in the backend properties.

### Collecting Logs for Debugging

```bash
cd project
make capture-logs       # Run in a separate terminal (blocks)
make start              # Reproduce the issue
# Ctrl+C the capture-logs terminal
tar -czvf quickstart-logs.tar.gz logs
```

---

## License

BSD Zero Clause License (0BSD)

Copyright 2026 ETHDenver Hackathon Team

> Permission to use, copy, modify, and/or distribute this software for
> any purpose with or without fee is hereby granted.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
> WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES
> OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
> FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY
> DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
> AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
> OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
