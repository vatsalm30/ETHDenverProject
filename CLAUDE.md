# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Canton Network Quickstart — a full-stack scaffold for building Canton Network (CN) applications on the Global Synchronizer. Demonstrates a licensing workflow (request → approval → issuance → renewal) between an App Provider and App Users using Daml smart contracts.

## Repository Layout

All application code lives under `project/`:

- **`project/daml/`** — Daml smart contracts (licensing business logic in `licensing/daml/`, tests in `licensing-tests/`)
- **`project/backend/`** — Spring Boot 3.4.2 service (Java 21, gRPC to Canton Ledger API, PostgreSQL)
- **`project/frontend/`** — React 18 + TypeScript + Vite 6 UI
- **`project/common/openapi.yaml`** — OpenAPI spec shared between backend and frontend (contract-first development)
- **`project/integration-test/`** — Playwright E2E tests
- **`project/docker/`** — Docker Compose configs, module services (Keycloak, Splice Onboarding, PQS, Observability)
- **`project/buildSrc/`** — Custom Gradle convention plugins

Supporting directories: `sdk/` (documentation, images), `flake.nix` (Nix dev environment).

## Build & Development Commands

All commands run from `project/` directory:

```bash
make setup              # Interactive profile config (auth mode, observability, test mode)
make build              # Build everything: frontend, backend, Daml, Docker images
make start              # Start all services via Docker Compose
make stop               # Stop all services

# Individual builds
make build-frontend     # cd frontend && npm install && npm run build
make build-backend      # ./gradlew :backend:build
make build-daml         # ./gradlew :daml:build distTar

# Quick rebuild & restart
make restart-backend    # Rebuild backend + restart its container
make restart-frontend   # Rebuild frontend + restart nginx

# Testing
make test               # Runs Daml tests (make test-daml)
make test-daml          # ./gradlew :daml:testDaml
make integration-test   # Playwright E2E (requires TEST_MODE=on, AUTH_MODE=oauth2)

# Frontend dev with hot reload
make start-vite-dev     # Starts Docker services + Vite dev server (proxies to backend:8080)

# Utilities
make status             # Docker container status
make logs / make tail   # View/follow Docker logs
make clean-all          # Remove all build artifacts, containers, volumes
make install-daml-sdk   # Install/upgrade Daml SDK
```

Frontend-specific (from `project/frontend/`):
```bash
npm run gen:openapi     # Generate TypeScript types from common/openapi.yaml
npm run dev             # Vite dev server
npm run lint            # ESLint
```

## Architecture Notes

**Contract-first API**: `project/common/openapi.yaml` generates both Java server stubs (via OpenAPI Generator Gradle plugin) and TypeScript client types (`npm run gen:openapi`). When modifying the API, edit the OpenAPI spec first, then regenerate both sides.

**Daml code generation**: Daml contracts compile to DAR files, then the Transcode plugin generates Java bindings used by the backend. The backend communicates with Canton participant nodes via gRPC (Ledger API).

**Auth modes**: Controlled by `AUTH_MODE` env var in `.env.local` — either `oauth2` (Keycloak) or `shared-secret`. Switch via `make setup`.

**Configuration**: `.env` has base settings (SDK versions, ports). `make setup` generates `.env.local` with deployment-specific config (party hint, auth mode, observability toggle, test mode).

**Backend structure** (`com.digitalasset.quickstart`):
- `service/` — REST API implementations (generated interfaces from OpenAPI)
- `ledger/` — gRPC communication with Canton Ledger API
- `repository/` — Data access (Daml contracts via PQS, tenant properties)
- `security/` — Auth (OAuth2 + shared-secret), token management
- `pqs/` — Party Query Store integration for reading contract state

**Frontend structure** (`project/frontend/src/`):
- `views/` — Page components (Home, AppInstalls, Licenses, Login, TenantRegistration)
- `stores/` — State management modules
- `components/` — Reusable UI components
- `api.ts` — Axios-based API client from OpenAPI types

## Key URLs (when running locally)

- App Provider UI: `http://app-provider.localhost:3000`
- App User Wallet: `http://wallet.localhost:2000`
- Backend API: `localhost:8080`
- Keycloak (if enabled): `localhost:8082`
- Grafana (if enabled): `localhost:3030`
- Swagger UI: `localhost:9090`

## Build System

Gradle multi-project build (backend + daml) with convention plugins in `buildSrc/`. Frontend uses npm/Vite (not Gradle-managed). Docker Compose orchestrates ~15+ services including Splice LocalNet, Canton participants, and optional modules.

Minimum Docker 27.0.0 / Compose 2.27.0 required. Recommended 8 GB Docker memory allocation.
