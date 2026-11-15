# SavoryBites — Free Cloud Deployment Guide (Neon + Render + Vercel)

Repository: `https://github.com/EcleoCelis/SavoryResto`

## Architecture Overview

- **Database:** Neon Free PostgreSQL (1 GB storage, 100 CU-hrs/month, sleeps after 5 min idle and wakes on request).
- **Backend API:** Render Free Web Service (`runtime: docker`, built from `backend/Dockerfile` via `render.yaml`).
  - Curated dish photography (`backend/media/dishes/*.webp`) is tracked in Git and baked into the container image.
  - Note: Render Free has an ephemeral filesystem, so newly uploaded dish photos or avatars created at runtime via the UI will reset on container sleep/redeploy unless connected to object storage (e.g., Cloudflare R2).
- **Frontend UI:** Vercel Hobby (Next.js App Router).
  - Leaving `NEXT_PUBLIC_API_URL` unset and setting `BACKEND_INTERNAL_URL` enables same-origin `/api/:path*` proxy rewrites in `next.config.ts`, keeping `HttpOnly` auth cookies working seamlessly across desktop & mobile browsers.

---

## Step 1 — Provision Free PostgreSQL on Neon

1. Sign in to [Neon](https://neon.tech) and create a new project (e.g., `savoryresto`, PostgreSQL 17).
2. Copy the **Pooled connection string** (or direct connection string), e.g.:
   `postgresql://neondb_owner:<password>@ep-...-pooler....aws.neon.tech/neondb?sslmode=require`
   *(Note: `backend/app/core/config.py` and `backend/scripts/init_staging_db.py` automatically normalize `postgresql://` and `postgres://` to `postgresql+psycopg://`.)*
3. From your local project root, initialize the schema, Alembic stamp, catalog dishes, dish image URLs, inventory/recipes, tables, payment methods, and staging staff accounts in one command:

```powershell
$env:DATABASE_URL="postgresql://neondb_owner:<password>@<neon-host>/neondb?sslmode=require"
backend\.venv\Scripts\python.exe backend\scripts\init_staging_db.py
Remove-Item Env:DATABASE_URL
```

---

## Step 2 — Deploy FastAPI Backend on Render

1. Sign in to [Render](https://render.com) with GitHub.
2. Click **New + -> Blueprint** (or **New + -> Web Service**) and connect `EcleoCelis/SavoryResto` (`main` branch).
   - If using Blueprint, `render.yaml` pre-configures `rootDir: backend`, `dockerfilePath: ./Dockerfile`, `plan: free`, `PORT=10000`, `healthCheckPath: /health`, and auto-generates `JWT_SECRET_KEY`.
3. Set the prompted environment variables on Render:
   - `DATABASE_URL`: your Neon connection string from Step 1
   - `FRONTEND_URL`: temporarily `https://savory-resto.vercel.app` (update once Vercel assigns your exact URL)
   - `ALLOWED_CORS_ORIGINS`: comma-separated list including your exact Vercel production/preview origin(s), e.g. `https://savory-resto.vercel.app`
4. Wait for Render deploy completion and verify:
   - `https://<your-render-service>.onrender.com/health` returns `{"status":"ok","environment":"staging"}`
   - `https://<your-render-service>.onrender.com/health/ready` returns `{"status":"ready","database":"connected"}`

---

## Step 3 — Deploy Next.js Frontend on Vercel

1. Sign in to [Vercel](https://vercel.com) with GitHub and click **Add New... -> Project**.
2. Import `EcleoCelis/SavoryResto` (Framework Preset: **Next.js**, Root Directory: `.`).
3. Configure Environment Variables in Vercel:
   - `BACKEND_INTERNAL_URL` = `https://<your-render-service>.onrender.com` *(exact Render URL, no trailing slash)*
   - Leave `NEXT_PUBLIC_API_URL` **unset/empty** so browser calls stay same-origin (`/api/v1/...`) via `next.config.ts` rewrites.
4. Click **Deploy** and copy your live Vercel URL (e.g. `https://savory-resto.vercel.app`).
5. Return to **Render -> Environment** and update `FRONTEND_URL` and `ALLOWED_CORS_ORIGINS` to match your exact Vercel URL (`https://<your-vercel-domain>.vercel.app`), then trigger a manual/auto restart on Render so CORS and CSRF origin validation allow browser logins & mutations.

---

## Default Staging Staff Credentials

Provisioned by `backend/scripts/init_staging_db.py` (override via `STAGING_MANAGER_PASSWORD` / `STAGING_KITCHEN_PASSWORD` before running the script, and change them immediately if sharing publicly):

- **Manager (`/staff/login` -> `/manager`):** `manager@savorybites.staging` / `StagingManagerPass2026!`
- **Kitchen (`/staff/login` -> `/kds`):** `kitchen@savorybites.staging` / `StagingKitchenPass2026!`
