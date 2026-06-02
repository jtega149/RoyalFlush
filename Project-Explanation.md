# Royal Flush — GCP Deployment Explained

Interview prep doc: what we built, why each piece exists, and how to explain the cloud setup in your own words.

---

## 1. High-level architecture

```text
Browser
   │
   ├─► Cloud Run (client) — nginx serves static React (Vite build)
   │       nginx proxies /auth, /reviews, /api → API (API_UPSTREAM env)
   │
   └─► Cloud Run (server) — Node.js / Express API
           │
           ├─► Cloud SQL (PostgreSQL) — via Unix socket /cloudsql/...
           ├─► Cloud Storage (GCS) — private review images + signed URLs
           └─► Google Geocoding API — server-side proxy only
```

| Component | GCP service | Repo piece |
|-----------|-------------|------------|
| Frontend | Cloud Run (`royalflush-web`, port 80) | `client/Dockerfile` → nginx |
| Backend | Cloud Run (`server`, port 3001) | `server/Dockerfile` |
| Database | Cloud SQL PostgreSQL | `server/config/database.js` |
| Images | Cloud Storage bucket | `server/config/storage.js`, upload in `reviewsController.js` |
| Images registry | Artifact Registry | `docker push` targets |

**Important:** Postgres is **not** in a Docker container in production. Only the app runs in containers; the database is **managed Cloud SQL**.

---

## 2. Why two Cloud Run services?

- **Client:** Static files after `vite build`. nginx is small and fast for HTML/JS/CSS.
- **Server:** Dynamic API (auth, reviews, DB, GCS signing).

Different URLs → cross-origin requests → need **CORS** and **cookie** settings (see §8).

---

## 3. Cloud SQL (PostgreSQL)

### What we did

1. Created a Cloud SQL instance (e.g. `free-trial-first-project` in `us-east1`).
2. Created a database (e.g. `royalflush`) and an app user (not only `postgres`).
3. Started **fresh** — no Render migration; `seedAllTables()` in `server.js` creates schema on API startup.

### Connection modes

| Environment | `PGHOST` | `PGPORT` | SSL in `pg`? |
|-------------|----------|----------|----------------|
| Local + Auth Proxy | `127.0.0.1` | `5433` (if Mac Postgres uses 5432) | **No** |
| Cloud Run + connector | `/cloudsql/PROJECT:REGION:INSTANCE` | omit | **No** |
| Remote host (e.g. old Render) | hostname | `5432` | **Yes** |

Logic lives in `server/config/database.js`:

- Socket path `/cloudsql/...` → no port, no SSL (Cloud Run sidecar handles encryption to Cloud SQL).
- `127.0.0.1` / `localhost` → no SSL (plain TCP to local proxy).
- Other hosts → SSL with `rejectUnauthorized: false` (common for managed DBs).

### Local dev: Cloud SQL Auth Proxy

- Install: `brew install cloud-sql-proxy`
- Auth once: `gcloud auth application-default login`
- Run: `cloud-sql-proxy royal-flush-494001:us-east1:free-trial-first-project --port 5433`
- App `.env`: `PGHOST=127.0.0.1`, `PGPORT=5433`, plus `PGUSER`, `PGPASSWORD`, `PGDATABASE`

**Why port 5433?** Mac often has local Postgres on 5432 → proxy binds to 5433.

**Docker Compose note:** Inside a container, `127.0.0.1` is the **container**, not your Mac. Use `PGHOST=host.docker.internal` if you run the API in Docker but the proxy on the host.

---

## 4. Docker images

### Server (`server/Dockerfile`)

- `node:22-alpine`, `npm ci --omit=dev`, `COPY` app, `CMD npm run start`
- Listens on `process.env.PORT || 3001` (Cloud Run can set `PORT`)

### Client (`client/Dockerfile`)

- **Stage 1:** Node builds Vite app (`VITE_GOOGLE_MAPS_API_KEY`; empty `VITE_API_URL` for same-origin)
- **Stage 2:** nginx + `API_UPSTREAM` at runtime via `docker-entrypoint.sh`
- **Stage 2:** nginx serves `dist/` only — no Node in production image
- `apk upgrade` on Alpine to reduce OS CVE noise in scans

### `.dockerignore` (server)

Must exclude secrets and junk:

- `.env`, `royal-flush-storage-key.json`, `node_modules`

**Never bake the GCS JSON key into the production image.**

### Build for Cloud Run: `linux/amd64`

Apple Silicon builds **arm64** by default. Cloud Run needs **amd64**:

```bash
docker build --platform linux/amd64 -t REGION-docker.pkg.dev/PROJECT/REPO/server:latest ./server
```

Same for `client`. Error if wrong arch: *manifest must support amd64/linux*.

---

## 5. Artifact Registry

1. Create Docker repository in GCP (e.g. `royalflush` in `us-east1`).
2. `gcloud auth configure-docker us-east1-docker.pkg.dev`
3. `docker build` + `docker push` for `server:latest` and `client:latest`

Multiple **digests** after several pushes is normal — each push is a new immutable image; tag `latest` moves.

---

## 6. Cloud Run — API (server)

### Deploy settings (conceptual)

| Setting | Value |
|---------|--------|
| Image | `.../server:latest` |
| Port | `3001` |
| Service account | Dedicated SA (e.g. `royalflush-api@...`) |
| Cloud SQL | Add connection `PROJECT:REGION:INSTANCE` |
| Auth | **Allow unauthenticated** (see §7) |

### Environment variables

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | `production` |
| `PGHOST` | `/cloudsql/PROJECT:REGION:INSTANCE` |
| `PGUSER`, `PGDATABASE` | Cloud SQL credentials |
| `PGPASSWORD`, `JWT_SECRET` | Prefer **Secret Manager** references |
| `GCS_BUCKET_NAME` | Bucket name |
| `GOOGLE_MAPS_API_KEY` | Server geocode proxy only |
| `CLIENT_URL` | Production frontend origin for CORS |

**Do not set** `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run — use the attached service account.

**Do not set** `PGPORT` when using `/cloudsql/...` socket.

### Enable APIs (project)

- Cloud Run, Cloud SQL Admin, Artifact Registry, Secret Manager
- **IAM Service Account Credentials API** — required for `getSignedUrl()`

---

## 7. “Allow unauthenticated” on Cloud Run

This does **not** mean anyone can use your app without logging in.

| Layer | Meaning |
|-------|---------|
| **Cloud Run invoker** | Who can HTTP-hit the `*.run.app` URL |
| **Your app** | JWT in httpOnly cookie, `authenticateToken` on protected routes |

Browsers cannot send Google IAM tokens for public users, so the API URL must be **publicly invokable**. Security is **JWT + middleware + rate limits**, not Cloud Run IAM.

---

## 8. Frontend ↔ API wiring

### Client → API (production)

- Browser calls the **web** origin only (`/auth`, `/reviews`, `/api`).
- **nginx** on the client container proxies to the API (`API_UPSTREAM` env on the web Cloud Run service).
- `VITE_API_URL` is empty in production builds (same-origin fetches).

### `CLIENT_URL` (server)

- Set on the **API** Cloud Run service.
- Used in `server.js` for CORS `allowedOrigins` with `http://localhost:5173` for local dev.

### Cookies (`server/controllers/auth.js`)

Production (via nginx proxy, cookies are first-party on the web host):

- `secure: true`, `sameSite: 'lax'`, `path: '/'`
- `clearCookie` uses the same options as `res.cookie`

Local dev: `sameSite: 'strict'`, `secure: false`. Vite dev server proxies API paths to `localhost:3001`.

### `trust proxy`

`app.set('trust proxy', 1)` in production so Express respects HTTPS behind Cloud Run’s proxy (cookies, secure flags).

---

## 9. GCS, IAM, and signed URLs

### Local dev

- `GOOGLE_APPLICATION_CREDENTIALS=./royal-flush-storage-key.json` in `server/.env`
- docker-compose can mount the key at `/app/royal-flush-storage-key.json`

### Production

- Cloud Run service account has **Storage Object Admin** (or similar) on the bucket.
- `new Storage()` in `storage.js` uses **Application Default Credentials** — no JSON file in the container.

### Upload flow (`createReview`)

1. Multer receives files in memory.
2. `bucket.file(path).save(buffer)` — stores path like `reviews/123.jpg` in DB as JSON array in `image_url`.

### Read flow (`getMyReviews`, `getReviewsByLocation`)

- DB stores **object paths**, not public URLs.
- `file.getSignedUrl({ action: 'read', expires: ... })` returns temporary HTTPS URL for the browser.

### IAM you needed (common 500 fixes)

1. **Enable** `iamcredentials.googleapis.com`
2. Grant the Cloud Run SA **Service Account Token Creator** on **itself** (allows `signBlob` for signed URLs)

Error without this: `Permission 'iam.serviceAccounts.signBlob' denied`

Upload worked before signing worked because **upload** only needs bucket write; **signed URL** needs sign permission.

---

## 10. Secret Manager vs plain env vars

| | Plain env on Cloud Run | Secret Manager reference |
|--|------------------------|---------------------------|
| Who sees value | Anyone with Cloud Run edit access | Same runtime, hidden in UI |
| In container | `process.env.PGPASSWORD` | Still `process.env.PGPASSWORD` |
| Good for | Non-secrets (`PGHOST`, `CLIENT_URL`) | `PGPASSWORD`, `JWT_SECRET` |

Two secrets: `db-password`, `jwt-secret` → map to `PGPASSWORD`, `JWT_SECRET` in Cloud Run (version `latest` is fine).

---

## 11. Google Maps API keys

Two keys (recommended):

| Key | Used where | Application restriction | API restriction |
|-----|------------|-------------------------|-----------------|
| **Browser** | `VITE_GOOGLE_MAPS_API_KEY` in client build | **HTTP referrers** (Cloud Run web URL + `localhost:5173/*`) | Maps JavaScript API, **Places API** |
| **Server** | `GOOGLE_MAPS_API_KEY` on API | None (Cloud Run has no fixed referrer) | **Geocoding API** only |

**Do not** put referrer restriction on the server key — geocode breaks.

**Do not** use one key for both with referrers only — breaks server.

`RefererNotAllowedMapError` → browser key missing your **web** Cloud Run URL in referrers.

Client uses Places (`nearbySearch` for restrooms) + Maps JS; server proxies geocode in `server.js` `/api/geocode`.

---

## 12. Deploy order (checklist)

1. Cloud SQL instance + DB + user  
2. Local test: proxy + `npm run dev` + `npm run dev` (client)  
3. Service account + bucket IAM + Secret Manager  
4. Build/push **server** image (`linux/amd64`)  
5. Deploy **API** Cloud Run + Cloud SQL connection + env/secrets  
6. Note API URL → build **client** → deploy web with `API_UPSTREAM`  
7. Build/push **client** image  
8. Deploy **client** Cloud Run (port 80)  
9. Set `CLIENT_URL` on API to web URL  
10. Update Maps browser key referrers  
11. Smoke test: signup, review + image, “my reviews”, “use my location”

---

## 13. Errors we hit (and fixes) — good interview stories

| Symptom | Cause | Fix |
|---------|--------|-----|
| `address already in use` :5432 | Local Postgres on Mac | Proxy on `--port 5433` |
| `does not support SSL` locally | SSL to proxy on localhost | `database.js` skips SSL for `127.0.0.1` |
| `ECONNREFUSED 127.0.0.1:5433` in Docker | Container localhost ≠ host | `host.docker.internal` or run API on host |
| GCS key `/app/...` ENOENT on `npm run dev` | `.env` had Docker path | `./royal-flush-storage-key.json` locally |
| `amd64/linux` manifest error | arm64 image from M1 Mac | `docker build --platform linux/amd64` |
| `RefererNotAllowedMapError` | Browser key referrers | Add web `*.run.app/*` to key |
| `/reviews/mine` 500, IAM API disabled | Signed URLs need IAM Credentials API | Enable `iamcredentials.googleapis.com` |
| `signBlob` denied | SA can’t sign | Token Creator on SA → itself |
| `injected env (0)` in Docker | `.env` not in image | Normal; use `env_file` in compose or Cloud Run env |

---

## 14. Security summary (how to say it in an interview)

- **Network:** HTTPS via Cloud Run; DB not public — Cloud SQL connector only from API service.  
- **Auth:** bcrypt passwords, JWT in httpOnly cookies, protected routes with middleware.  
- **Secrets:** Secret Manager for DB password and JWT; no keys in git (`.gitignore`).  
- **Storage:** Private bucket; time-limited signed URLs instead of public objects.  
- **Least privilege:** Dedicated service account with Cloud SQL Client + bucket access + sign permission only as needed.  
- **Input:** Validation, rate limits on auth and writes.  
- **Maps:** Separate keys, referrer + API restrictions on browser key.

---

## 15. What you did *not* use (and why)

| Thing | Why not |
|-------|---------|
| Postgres in Docker on GCP | Not durable; Cloud SQL is managed |
| GCS JSON key in Cloud Run image | SA + ADC is GCP best practice |
| Cloud Run env for `VITE_*` on client | Vite needs build-time injection |
| Require authentication on Cloud Run | Blocks normal browser traffic to API |

---

## 16. Useful commands reference

```bash
# Project
gcloud config set project royal-flush-494001

# Local DB tunnel
cloud-sql-proxy royal-flush-494001:us-east1:free-trial-first-project --port 5433

# Build & push server
docker build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/royal-flush-494001/royalflush/server:latest ./server
docker push us-east1-docker.pkg.dev/royal-flush-494001/royalflush/server:latest

# Build & push client; set API_UPSTREAM on web Cloud Run deploy
docker build --platform linux/amd64 \
  --build-arg VITE_GOOGLE_MAPS_API_KEY="..." \
  -t us-east1-docker.pkg.dev/royal-flush-494001/royalflush/client:latest ./client
docker push us-east1-docker.pkg.dev/royal-flush-494001/royalflush/client:latest
# gcloud run deploy WEB ... --set-env-vars="API_UPSTREAM=https://YOUR-API.run.app"

# Quick API check
curl https://YOUR-API.run.app/auth/me   # expect 401, not 500
```

---

## 17. One-minute interview pitch

> “Royal Flush is a full-stack restroom review app. I deployed it on GCP using two Cloud Run services — nginx for the React frontend and Node/Express for the API. The database is Cloud SQL Postgres, connected via the Cloud SQL connector on Cloud Run and the Auth Proxy locally. Review photos go to a private GCS bucket; the API generates signed URLs so images aren’t public. I used a dedicated service account with Secret Manager for credentials, configured CORS and cross-site cookies for separate frontend/backend URLs, and split Google Maps keys between browser Places/Maps JS and server-side geocoding. I containerized with Docker, pushed to Artifact Registry, and built amd64 images from an M1 Mac for Cloud Run.”

---

## Related files in this repo

| File | Role |
|------|------|
| `Deployment.md` | Step-by-step deploy commands |
| `README.md` | Local Cloud SQL proxy notes |
| `server/config/database.js` | DB connection / SSL / socket |
| `server/config/storage.js` | GCS bucket client |
| `server/controllers/reviewsController.js` | Upload + signed URLs |
| `server/server.js` | CORS, geocode proxy, seed |
| `client/Dockerfile` | Vite build + nginx proxy |
| `client/nginx.conf.template` | API upstream proxy rules |
| `server/.env.example` / `client/.env.example` | Safe templates for dev |

---

*Update URLs, service names, and dates if your GCP resources change.*
