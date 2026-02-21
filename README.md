
# InvoiceNow 🏁

> A competitive Dutch auction marketplace for invoice financing — built on Canton Network at ETHDenver 2025.

Suppliers sitting on confirmed invoices shouldn't have to wait 30–90 days to get paid. InvoiceNow lets them sell invoices immediately through a live auction where financiers compete for the best rate, producing market-driven pricing instead of opaque take-it-or-leave-it terms.

---

## How It Works

1. A supplier uploads a confirmed invoice and sets a reserve rate
2. Financiers submit sealed bids in a Dutch auction
3. The winning bid closes the auction — supplier gets liquidity, financier gets the receivable
4. Settlement is handled on-chain via Canton smart contracts with privacy guarantees baked in at the ledger level

ZK proofs are used selectively to allow financiers to verify invoice legitimacy without exposing sensitive counterparty details.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Daml on Canton Network |
| Backend | Spring Boot (Java 21) |
| Frontend | React + Vite |
| Auth | OAuth2 (Keycloak) or shared-secret |
| Runtime | Docker Compose |
| Database | PostgreSQL |

---

## Repo Structure

```
project/
├── daml/               # Smart contracts (invoice-finance package)
├── backend/            # Spring Boot API service
├── frontend/           # React + Vite UI
├── common/
│   └── openapi.yaml    # Shared API contract
├── compose.yaml        # Docker Compose orchestration
└── docker/             # Module configs, env files, onboarding scripts
```

---

## Running Locally

**Prerequisites:** Docker (8 GB+ memory), Make, Node.js, Java 21, Daml SDK

```bash
cd project
make setup    # configure auth, observability, test mode
make build
make start
```

### Key URLs

| Service | URL |
|---------|-----|
| App frontend | http://app-provider.localhost:3000 |
| User wallet | http://wallet.localhost:2000 |
| Backend API / Swagger | http://localhost:9090 |
| Grafana (if enabled) | http://localhost:3030 |

### Useful Commands

```bash
make stop              # stop all services
make clean-all         # full reset
make logs              # view logs
make install-daml-sdk  # upgrade Daml SDK
make test              # run all tests
```

---

## Troubleshooting

If something won't start:

```bash
cd project
make clean-all && make build && make start
```

Check that Docker has at least **8 GB** of memory allocated and your Daml SDK is up to date (`make install-daml-sdk`).

---

## Team

Built at ETHDenver 2025 by Jacob, Manu, and Vatsal.

Licensed under the BSD Zero Clause License.
