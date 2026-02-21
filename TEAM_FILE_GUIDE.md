# Team File Guide — Invoice Finance (Deadline Derby)

**Purpose:** This document explains each important file so you can communicate clearly with your team. Each section answers: *What is this file? What does it do? Why does it matter? Who touches it?*

---

## How This Project Flows

```
Daml (smart contracts)  →  Backend (Java, talks to ledger)  →  Frontend (React, talks to backend)
```

The **smart contracts** define the rules. The **backend** runs those rules and stores data. The **frontend** shows the UI and calls the backend.

---

# Part 1: Smart Contracts (Daml)

## `project/daml/invoice-finance/daml/InvoiceFinance/Core.daml`

**What it is:** The main file with all invoice-finance business logic. Written in Daml (Canton’s smart contract language).

**What it does:** Defines 9 contract types (templates) and the actions (choices) you can take on them.

**The 9 templates and their role:**

| Template | Purpose |
|----------|---------|
| **Invoice** | Unpaid invoice from supplier to buyer. Buyer must confirm it. Banks see nothing yet. |
| **FinancingAuction** | Dutch auction: price falls over time, first bank to grab wins. Banks see auction; buyer does not. |
| **WinningBid** | Private record of who won and at what rate. Only operator + winning bank see it. Losing banks see nothing. |
| **FinancedInvoice** | Active financed deal. All trade parties see it, but it does NOT include the bank’s purchase rate. |
| **BankOwnership** | Bank’s purchase rate and margin. Only operator + bank. Buyer cannot see it. |
| **SprintBoostOffer** | Buyer offers early payment for a bounty. Negotiation is private; supplier is not a party. |
| **PaidInvoice** | Final record once the invoice is paid. All three trade parties see it. |
| **AuditLedger** | Minimal settlement data for auditors (amount, period only). No rate, no bank identity. |
| **MarketRateOracle** | Running average of rates from settlements. Used for rate guardrails. |

**Choices:** Each template has choices (actions). For example: `Invoice_BuyerConfirm`, `Invoice_StartAuction`, `FinancingAuction_BankGrab`, `WinningBid_Settle`, etc.

**Who changes it:** Developers working on Daml. Changes affect contracts, privacy, and logic.

**Connects to:** Backend uses generated Java classes from this file. Frontend does not use it directly.

---

## `project/daml/invoice-finance/daml.yaml`

**What it is:** Config for the invoice-finance Daml package.

**What it does:** Sets Daml SDK version (3.4.10), package name (`quickstart-invoice-finance`), and dependencies.

**Who changes it:** Rarely. Only when updating Daml or dependencies.

---

## `project/daml/invoice-finance/BLUEPRINT_UPDATES.md`

**What it is:** Changelog describing recent changes (AuditLedger, MarketRateOracle, rate guardrails, tests).

**What it does:** Explains how the code was aligned with the blueprints and how to use the new choices.

**Who reads it:** Developers and anyone onboarding on the new features.

---

# Part 2: Tests (Daml Script)

## `project/daml/invoice-finance-tests/daml/InvoiceFinance/Scripts/PrivacyTests.daml`

**What it is:** Privacy tests for invoice finance, written in Daml Script.

**What it does:**
- **testPrivacy:** Runs full flow and checks that a losing bank cannot see `WinningBid`, and the buyer cannot see `BankOwnership`.
- **testRateGuardrail:** Seeds an oracle, then checks that an extreme bid is rejected by the guardrail.

**Why it matters:** Proves that Canton’s privacy guarantees work as intended in our contracts.

**Who changes it:** Anyone adding new privacy checks or changing contract behavior.

**How to run:** `daml test --project-root project/daml/invoice-finance-tests`

---

## `project/daml/invoice-finance-tests/daml.yaml`

**What it is:** Config for the test package.

**What it does:** Declares dependency on the compiled invoice-finance DAR (`.daml/dist/quickstart-invoice-finance-0.0.1.dar`).

**Who changes it:** Rarely. Only when changing test dependencies.

---

# Part 3: Backend (Java)

## `project/backend/src/main/java/com/digitalasset/quickstart/service/InvoiceFinanceApiImpl.java`

**What it is:** REST controller for all invoice finance APIs.

**What it does:** Implements the invoice finance operations: create invoice, confirm, start auction, grab auction, close auction, place bid, pay invoice, list invoices/auctions/financed invoices, etc.

**Important details:**
- Uses `LedgerApi` to create and exercise Daml choices.
- Uses `DamlRepository` to read contracts from the ledger (via PQS).
- Uses `AuctionBidStore` to track bids during live auctions.
- Operator submits all Daml commands; users authenticate and the backend acts as operator.

**Who changes it:** Backend developers. New API endpoints or changes to existing flows go here.

**Connects to:** OpenAPI spec (defines the API), Daml contracts (via generated Java bindings).

---

## `project/backend/src/main/java/com/digitalasset/quickstart/service/AuctionBidStore.java`

**What it is:** In-memory store for live auction bids.

**What it does:** When banks place bids in a live auction, this stores them. When the supplier closes the auction, it picks the winning bid and settles on the ledger.

**Who changes it:** Backend developers working on auction logic.

**Connects to:** Used by `InvoiceFinanceApiImpl` for `placeBid`, `closeAuction`, `getMyBidStatus`.

---

## `project/backend/src/main/java/com/digitalasset/quickstart/repository/DamlRepository.java`

**What it is:** Data access layer for Daml contracts.

**What it does:** Queries PQS (Party Query Store) to find invoices, auctions, winning bids, financed invoices, paid invoices, etc., by party and contract ID.

**Who changes it:** Backend developers when adding new contract queries.

**Connects to:** Used by `InvoiceFinanceApiImpl` and other services.

---

# Part 4: Frontend (React)

## `project/frontend/src/stores/invoiceFinanceStore.tsx`

**What it is:** React context store for all invoice finance state and API calls.

**What it does:** Holds state (invoices, auctions, financed invoices, bank ownerships, paid invoices) and exposes functions like `createInvoice`, `startAuction`, `closeAuction`, `payFinancedInvoice`, etc.

**Who changes it:** Frontend developers. New UI flows or API calls go through here.

**Connects to:** `api.ts` (HTTP client), `DashboardView.tsx` (main UI).

---

## `project/frontend/src/views/DashboardView.tsx`

**What it is:** Main screen for invoice finance (Deadline Derby).

**What it does:** Renders:
- Invoices (create, confirm, delete, start auction)
- Auctions (live ticker, grab/place bid, close)
- Financed invoices (pay, Sprint Boost)
- Bank ownerships (for banks)
- Paid invoices

**Who changes it:** Frontend developers. UI layout, modals, and flows live here.

**Connects to:** `invoiceFinanceStore`, `profileStore`, `userStore`.

---

## `project/frontend/src/api.ts`

**What it is:** API client that talks to the backend.

**What it does:** Builds HTTP requests from the OpenAPI spec, handles auth (tokens), and returns typed data.

**Who changes it:** When adding new endpoints or changing auth.

**Connects to:** `openapi.yaml`, backend REST API.

---

# Part 5: Shared API Contract

## `project/common/openapi.yaml`

**What it is:** OpenAPI 3.0 spec that defines all REST endpoints and data types.

**What it does:** Describes paths (e.g., `/invoices`, `/auctions/{id}/close`), request/response shapes, and schemas. Used to generate TypeScript types for the frontend and Java interfaces for the backend.

**Who changes it:** When adding or changing API endpoints. Both frontend and backend depend on it.

**Important sections for invoice finance:**
- `/invoices` — create, list, confirm, delete
- `/auctions` — list, grab, close, cancel, place bid
- `/financed-invoices` — list, pay, Sprint Boost
- `/bank-ownerships` — list
- `/paid-invoices` — list

---

# Part 6: Build & Configuration

## `project/daml/multi-package.yaml`

**What it is:** List of Daml packages to build together.

**What it does:** Ensures `invoice-finance` and `invoice-finance-tests` are compiled when you run the Daml build.

**Who changes it:** When adding new Daml packages.

---

## `project/daml/build.gradle.kts`

**What it is:** Gradle build configuration for Daml.

**What it does:** Defines tasks: `compileDaml`, `testDaml`, `testInvoiceFinanceDaml`, `codeGen` (generates Java bindings from DARs).

**Who changes it:** When changing build steps or adding test tasks.

---

## `project/compose.yaml` (Docker Compose)

**What it is:** Docker setup for the whole application.

**What it does:** Runs Canton, participants, backend, frontend, databases, etc.

**Invoice finance relevance:** Deploys the invoice-finance DAR to the ledger.

**Who changes it:** DevOps and deployment.

---

# Part 7: Documentation (Project Root)

## `ARCHITECTURE.md`

**What it is:** Architecture and developer guide.

**What it does:** Describes Deadline Derby, privacy model, repository layout, contract lifecycle, backend/frontend structure, how to run the demo.

**Who reads it:** New developers, reviewers, judges.

---

## `CLAUDE.md`

**What it is:** Instructions for AI coding assistants (e.g., Claude).

**What it does:** Explains project structure, build commands, key files.

**Who reads it:** AI tools and developers using them.

---

## `README.md`

**What it is:** Main project readme.

**What it does:** High-level overview, setup, and how to run the Canton quickstart.

---

# Quick Reference: "Where do I …?"

| Task | File(s) |
|------|---------|
| Change contract logic or add a template | `Core.daml` |
| Add a privacy test | `PrivacyTests.daml` |
| Add or change an API endpoint | `openapi.yaml` + `InvoiceFinanceApiImpl.java` |
| Change auction or bid behavior | `InvoiceFinanceApiImpl.java`, `AuctionBidStore.java` |
| Change UI layout or flows | `DashboardView.tsx` |
| Change what data the UI fetches | `invoiceFinanceStore.tsx` |
| Add a new query for contracts | `DamlRepository.java` |
| Update build or test tasks | `build.gradle.kts`, `multi-package.yaml` |
| Document new features | `ARCHITECTURE.md`, `BLUEPRINT_UPDATES.md` |

---

*This guide is for team communication. If you need more detail on a file, open it and use the table of contents above to navigate.*
