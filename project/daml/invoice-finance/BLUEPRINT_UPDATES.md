# Blueprint Alignment Updates (Feb 2026)

This document describes the changes made to align the Deadline Derby invoice-finance module with the Project Report and InvoiceArena blueprints. All changes are **additive and backward-compatible** — the existing flow (Dutch auction, closeAuction, pay) is unchanged.

## 1. Blueprint 1: Auditor Aggregation

### AuditLedger template
- **File:** `daml/InvoiceFinance/Core.daml`
- **Purpose:** Auditor sees aggregate settlement data only (amount, period). No rate, no bank identity.
- **Signatory:** operator  
- **Observer:** auditor

### PaidInvoice_ReportToAuditLedger choice
- **Template:** PaidInvoice
- **Controller:** operator
- **Parameters:** auditor (Party), year (Int), month (Int)
- **Creates:** AuditLedger with invoiceId, settledAmount, year, month
- **Usage:** After an invoice is paid, the operator exercises this to report to the auditor for compliance.

---

## 2. Blueprint 2: Market Rate Oracle

### MarketRateOracle template
- **Purpose:** Volume-weighted average rate from settlements. Supports rate guardrails.
- **Fields:** sumRateVolume, totalVolume, numSettlements
- **Current rate:** sumRateVolume / totalVolume (when totalVolume > 0)
- **Bootstrap:** Create with sumRateVolume=0, totalVolume=0, numSettlements=0

### MarketRateOracle_IngestSettlement choice
- **Parameters:** annualizedRate, faceValue
- **Effect:** Archives self, creates new oracle with updated running totals

### BankOwnership_ReportToOracle choice
- **Template:** BankOwnership
- **Controller:** operator
- **Parameters:** oracleId (ContractId MarketRateOracle), termDays (Decimal)
- **Effect:** Computes annualized rate from purchaseRate and termDays, exercises oracle's IngestSettlement

---

## 3. Blueprint 2: Rate Guardrails

### FinancingAuction_BankGrab — optional oracle parameter
- **New parameter:** oracleId : Optional (ContractId MarketRateOracle)
- **When None:** No guardrail (backward compatible; current backend flow unaffected)
- **When Some:** If oracle has data (totalVolume > 0), enforces:
  - bidAnnualized ≤ oracleRate × 2.0 (max)
  - bidAnnualized ≥ oracleRate × 0.1 (min)
- **Note:** The current backend bypasses BankGrab (creates WinningBid directly), so guardrails apply only when BankGrab is exercised via scripts or future API.

---

## 4. Daml Script Privacy Tests

### Package: invoice-finance-tests
- **Location:** `project/daml/invoice-finance-tests/`
- **Run:** `daml test --project-root invoice-finance-tests` or `./gradlew -p daml testInvoiceFinanceDaml`

### testPrivacy
- Full flow: create invoice → confirm → auction → bank grabs → settle → pay → report to audit → report to oracle
- **Assertion 1:** Losing bank (bank2) cannot see WinningBid — `query @WinningBid bank2` returns empty
- **Assertion 2:** Buyer cannot see BankOwnership — `query @BankOwnership buyer` returns empty

### testRateGuardrail
- Seeded oracle at ~10% annualized
- Attempts bid at 50% advance (= ~202% annualized)
- Asserts the choice fails via `mustFail`

---

## 5. Backend / Frontend

No changes were made to the backend or frontend. The new choices can be exercised via:
- Daml Script (see `invoice-finance-tests`)
- Future REST endpoints (report-to-audit, report-to-oracle, oracle bootstrap)
- Canton Console

The existing `closeAuction` flow is unchanged — it creates WinningBid directly and does not use BankGrab.
