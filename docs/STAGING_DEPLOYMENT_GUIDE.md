# SavoryBites — Staging Deployment, Operations & Rollback Guide

## 1. Staging Architecture Overview

The SavoryBites staging environment replicates the production operational profile while using isolated infrastructure, databases, and test destinations.

```
                      [ Client HTTPS Traffic ]
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │     Nginx Gateway     │ :8443 / :443 (TLS Termination)
                     └───────────┬───────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            ▼                                         ▼
   /api/*, /health*, /docs                       All Other Routes
┌───────────────────────┐                 ┌───────────────────────┐
│    FastAPI Backend    │ :8000           │   Next.js Frontend    │ :3000
│  (Uvicorn / Python)   │                 │     (Standalone)      │
└───────────┬───────────┘                 └───────────────────────┘
            │
            ▼
┌───────────────────────┐
│ PostgreSQL Staging DB │ :5432
│(restaurant_db_staging)│
└───────────────────────┘
```

---

## 2. Infrastructure & Service Components

| Component | Technology | Role | Staging Port |
| :--- | :--- | :--- | :--- |
| **Reverse Proxy** | Nginx Alpine | HTTPS/TLS termination, request routing, proxy headers | `8443` (HTTPS), `8080` (HTTP) |
| **Frontend** | Next.js 16.4.2 Standalone | Server-rendered App Router UI, client hydration | `3000` (internal) |
| **Backend** | FastAPI + Uvicorn (Python 3.12) | REST API, authentication, RBAC, business workflows | `8000` (internal) |
| **Database** | PostgreSQL 17 | Relational persistence, constraints, foreign keys | `5432` / `5433` |
| **Email Sink** | Staging Mailbox / Memory Sink | Password recovery & contact inquiry testing | Configurable SMTP |

---

## 3. Environment & Secret Management

All staging settings are configured via environment variables. Never commit real credentials to source control.

| Variable Name | Required | Staging Value / Description |
| :--- | :---: | :--- |
| `ENVIRONMENT` | Yes | `staging` |
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | Yes | `postgresql+psycopg://postgres:<password>@postgres:5432/restaurant_db_staging` |
| `FRONTEND_URL` | Yes | `https://staging.savorybites.local:8443` |
| `NEXT_PUBLIC_API_URL` | Yes | `https://staging.savorybites.local:8443` |
| `JWT_SECRET_KEY` | Yes | Minimum 32 random characters (unique to staging). |
| `TRUSTED_PROXIES` | Yes | Upstream proxy IPs/CIDRs (e.g. `127.0.0.1,::1,10.0.0.0/8,nginx`). |
| `ALLOWED_CORS_ORIGINS`| Yes | `https://staging.savorybites.local:8443,http://localhost:3000` |
| `SMTP_HOST` | No | Staging test inbox SMTP server (e.g. `smtp.mailtrap.io`). If omitted, emails route to memory sink. |
| `EMAILS_FROM_EMAIL` | Yes | `noreply@savorybites.staging` |

---

## 4. Database Provisioning & Migrations

### A. Initializing a Fresh Staging Database
To create the schema, synchronize sequences, seed baseline roles/tables/payment methods, and provision staging staff accounts in a single automated step:
```bash
python backend/scripts/init_staging_db.py
```

### B. Applying Incremental Migrations
When deploying schema updates to an existing staging database:
```bash
cd backend
alembic upgrade head
```

---

## 5. Health Monitoring & Observability

### A. Health Probes
- **Liveness Probe**: `GET /health`
  - Validates that the application process is running and responding.
  - Returns `{"status": "ok", "environment": "staging"}` (HTTP 200).
- **Readiness Probe**: `GET /health/ready`
  - Performs an active `SELECT 1` query against PostgreSQL.
  - Returns `{"status": "ready", "database": "connected"}` (HTTP 200) or HTTP 503 Service Unavailable if disconnected.

### B. Diagnostic Logging
- Unhandled server exceptions are masked on the client (`500 Internal Server Error`) while full stack traces are logged to backend stderr for operator analysis.
- Authentication failures and rate-limit triggers emit structured warning logs including client IP.

---

## 6. Rollback and Recovery Procedures

### A. Application Rollback (Zero Data Loss)
If an application bug is identified after deployment:
1. Re-tag or redeploy the previous container image tags:
   ```bash
   docker compose -f docker-compose.staging.yml down
   # Switch to previous image tag or commit
   docker compose -f docker-compose.staging.yml up -d
   ```
2. Verify system readiness:
   ```bash
   curl -f http://127.0.0.1:8000/health/ready
   ```

### B. Migration Rollback
If a newly applied migration needs to be reverted:
1. Identify target migration revision:
   ```bash
   alembic history
   ```
2. Revert migration:
   ```bash
   alembic downgrade <target_revision>
   ```
3. *Note on Backward Compatibility*: All migrations from `20260914_01` through `20261023_13` follow additive schema conventions (adding nullable columns or dedicated tables). Existing database records remain valid during rollbacks.

### C. Database Disaster Recovery
To restore staging from a PostgreSQL backup snapshot:
```bash
pg_restore -U postgres -d restaurant_db_staging --clean /backups/staging_snapshot.dump
```
