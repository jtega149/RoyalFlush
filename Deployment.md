# GCP deployment: Cloud SQL + Cloud Run

This guide walks through deploying **Royal Flush** on Google Cloud:

- **Cloud SQL** — managed PostgreSQL (replaces Render Postgres)
- **Cloud Run** — your `server` and `client` Docker images
- **Cloud Storage** — review images (you already use this locally)

```mermaid
flowchart TB
  subgraph users [Users]
    Browser[Browser]
  end

  subgraph gcp [Google Cloud]
    FE[Cloud Run - client nginx]
    CR[Cloud Run - server API]
    SQL[(Cloud SQL PostgreSQL)]
    GCS[Cloud Storage]
  end

  Browser --> FE
  Browser --> CR
  CR --> SQL
  CR --> GCS
```

---

## Before you start

| Requirement | Notes |
|-------------|--------|
| Google account + billing | Cloud SQL always has some monthly cost (~$10+ for smallest instance). Cloud Run has a generous free tier. |
| [gcloud CLI](https://cloud.google.com/sdk/docs/install) | `gcloud auth login` and `gcloud auth application-default login` |
| Docker | To build images locally (or use Cloud Build later) |
| Render DB access | For `pg_dump` when you migrate data |

Pick and stick to one **region** for everything (example: `us-central1`). Mixing regions adds latency and cost.

Set shell variables once (replace values):

```bash
export PROJECT_ID="your-gcp-project-id"
export REGION="us-central1"
export SQL_INSTANCE="royalflush-db"
export DB_NAME="royalflush"
export DB_USER="royalflush_app"
export AR_REPO="royalflush"          # Artifact Registry repo name
export API_SERVICE="royalflush-api"
export WEB_SERVICE="royalflush-web"
```

---

## Phase 0 — Code changes to make before production

Do these on a branch before the first real deploy. They are not GCP-console steps, but Cloud Run will not work well without them.

### 1. Database SSL (Cloud SQL socket)

When Cloud Run connects via the **Cloud SQL connector**, Postgres is reached over a Unix socket (`/cloudsql/...`). Your `server/config/database.js` always enables SSL, which can break socket connections.

Use SSL only when connecting over the public internet (e.g. Render, or Cloud SQL public IP):

```js
const useSocket = process.env.PGHOST?.startsWith('/cloudsql')

const config = {
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: useSocket ? undefined : process.env.PGPORT,
  database: process.env.PGDATABASE,
  ...(useSocket ? {} : { ssl: { rejectUnauthorized: false } }),
}
```

### 2. CORS — allow your production frontend URL

`server/server.js` currently only allows `http://localhost:5173`. Add your deployed client URL:

```js
const allowedOrigins = [
  'http://localhost:5173',
  process.env.CLIENT_URL,
].filter(Boolean)

app.use(cors({
  origin: allowedOrigins,
  methods: 'GET,POST,PUT,DELETE,PATCH',
  credentials: true,
}))
```

Set `CLIENT_URL=https://royalflush-web-xxxxx.run.app` (your real Cloud Run web URL) on the API service.

### 3. Auth cookies (different domains)

If the **client** and **API** are on different hostnames (two Cloud Run services), browsers treat cookies as cross-site. Update cookie options in `server/controllers/auth.js` for production:

- `secure: true`
- `sameSite: 'none'` (not `'strict'`)

Keep `httpOnly: true`. Login only works from the real HTTPS frontend URL.

### 4. Do not ship the GCS key file to Cloud Run

Locally you mount `royal-flush-storage-key.json`. In production, Cloud Run should use the **service account attached to the service** (Application Default Credentials). Remove the volume mount from production deploy; grant the service account access to your bucket (Phase 4).

### 5. Client build-time API URL

`client/Dockerfile` bakes in `VITE_API_URL` at **build** time. When building the client image for production:

```bash
docker build \
  --build-arg VITE_API_URL=https://YOUR-API-URL.run.app \
  --build-arg VITE_GOOGLE_MAPS_API_KEY=your-maps-key \
  -t royalflush-client:latest \
  ./client
```

---

## Phase 1 — Create the GCP project

```bash
gcloud projects create "$PROJECT_ID"   # skip if project already exists
gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com
```

Link a billing account in the [Cloud Console](https://console.cloud.google.com/billing) if you have not already.

---

## Phase 2 — Create Cloud SQL (PostgreSQL)

### Option A — Console (good first time)

1. Open [Cloud SQL](https://console.cloud.google.com/sql) → **Create instance** → **PostgreSQL**.
2. Instance ID: `royalflush-db`, region: `us-central1` (same as `REGION`).
3. Choose **Enterprise** or **Sandbox** tier:
   - **Sandbox / smallest**: cheapest for learning; may sleep or have limits.
   - **db-f1-micro** or **db-g1-small**: typical small prod/hobby.
4. Set a strong **postgres** user password (save in a password manager).
5. Create the instance (takes several minutes).

Then create app database and user:

1. **Databases** → Create database → name: `royalflush`.
2. **Users** → Add user → name: `royalflush_app`, strong password.

Note the **Instance connection name** on the Overview page:

`PROJECT_ID:REGION:royalflush-db`

### Option B — gcloud

```bash
gcloud sql instances create "$SQL_INSTANCE" \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --root-password="CHOOSE-A-STRONG-ROOT-PASSWORD"

gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

gcloud sql users create "$DB_USER" \
  --instance="$SQL_INSTANCE" \
  --password="CHOOSE-A-STRONG-APP-PASSWORD"
```

### Connection methods (pick one for Cloud Run)

| Method | Pros | Cons |
|--------|------|------|
| **Cloud SQL connector** (recommended) | No public DB IP; IAM-based; works with `--add-cloudsql-instances` | `PGHOST` is a socket path |
| **Public IP + SSL** | Works like Render with `PGHOST` + `PGPORT` | Must allow Cloud Run egress / authorize networks; more exposure |

This guide uses the **connector** (recommended).

---

## Phase 3 — Migrate data from Render

On your machine (with Postgres client tools installed):

```bash
# 1. Export from Render (use Render's external connection string)
pg_dump "postgresql://USER:PASS@HOST:PORT/DB?sslmode=require" \
  --no-owner --no-acl -F c -f royalflush.dump

# 2. Import into Cloud SQL via Cloud SQL Auth Proxy (easiest for first migration)

# Install proxy: https://cloud.google.com/sql/docs/postgres/sql-proxy
cloud-sql-proxy "$PROJECT_ID:$REGION:$SQL_INSTANCE" &

# Connect through localhost (proxy listens on 127.0.0.1:5432 by default)
pg_restore -h 127.0.0.1 -U "$DB_USER" -d "$DB_NAME" --no-owner --no-acl royalflush.dump
```

If the database is empty and you only need schema, running the app once is enough — `seedAllTables()` in `server.js` creates tables on startup. Use `pg_dump` when you have real users/reviews to keep.

---

## Phase 4 — IAM and Cloud Storage

### Service account for Cloud Run API

```bash
gcloud iam service-accounts create royalflush-api \
  --display-name="Royal Flush API"

export SA_EMAIL="royalflush-api@${PROJECT_ID}.iam.gserviceaccount.com"

# Cloud SQL Client (required for connector)
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/cloudsql.client"

# GCS — adjust bucket name to match GCS_BUCKET_NAME in your .env
export GCS_BUCKET="your-bucket-name"

gsutil iam ch serviceAccount:${SA_EMAIL}:objectAdmin gs://${GCS_BUCKET}
```

Do **not** copy `royal-flush-storage-key.json` into the production image. The attached service account is the credential.

Store secrets in **Secret Manager** (optional but better than plain env for passwords):

```bash
echo -n "your-jwt-secret" | gcloud secrets create jwt-secret --data-file=-
echo -n "your-db-password" | gcloud secrets create db-password --data-file=-

gcloud secrets add-iam-policy-binding jwt-secret \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

---

## Phase 5 — Build and push the server image

### Artifact Registry

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION"

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

### Build server (from repo root)

```bash
docker build -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/server:latest" ./server
docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/server:latest"
```

Ensure `.dockerignore` excludes `.env`, `node_modules`, `uploads`, and `royal-flush-storage-key.json`.

---

## Phase 6 — Deploy the API to Cloud Run

Connection name variable:

```bash
export INSTANCE_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
```

Deploy with Cloud SQL attached:

```bash
gcloud run deploy "$API_SERVICE" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/server:latest" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --service-account="$SA_EMAIL" \
  --add-cloudsql-instances="$INSTANCE_CONNECTION" \
  --port=3001 \
  --set-env-vars="NODE_ENV=production" \
  --set-env-vars="PGHOST=/cloudsql/${INSTANCE_CONNECTION}" \
  --set-env-vars="PGUSER=${DB_USER}" \
  --set-env-vars="PGDATABASE=${DB_NAME}" \
  --set-env-vars="GCS_BUCKET_NAME=${GCS_BUCKET}" \
  --set-env-vars="CLIENT_URL=https://PLACEHOLDER-WEB-URL" \
  --set-secrets="PGPASSWORD=db-password:latest,JWT_SECRET=jwt-secret:latest" \
  --set-env-vars="GOOGLE_MAPS_API_KEY=your-key"
```

Notes:

- Cloud Run sets **`PORT`** automatically; your app uses `process.env.PORT || 3001`. Using `--port=3001` matches your Dockerfile; either align container listen port with Cloud Run’s `PORT` or keep `--port=3001` explicitly.
- Replace `PLACEHOLDER-WEB-URL` after you deploy the client (Phase 7), then update the service:  
  `gcloud run services update "$API_SERVICE" --region="$REGION" --update-env-vars="CLIENT_URL=https://..."`
- For secrets, use `--set-secrets` as above, or set env vars in the console for a first test.

Copy the deployed URL:

```bash
gcloud run services describe "$API_SERVICE" --region="$REGION" --format='value(status.url)'
```

### Verify API + database

```bash
curl -s "$(gcloud run services describe $API_SERVICE --region=$REGION --format='value(status.url)')/auth/me"
# Expect 401 or similar — not a connection error
```

Check logs if the container exits on startup:

```bash
gcloud run services logs read "$API_SERVICE" --region="$REGION" --limit=50
```

Common failures: wrong `PGHOST`, SSL on socket, missing `roles/cloudsql.client`, wrong password.

---

## Phase 7 — Deploy the client to Cloud Run

```bash
export API_URL="$(gcloud run services describe $API_SERVICE --region=$REGION --format='value(status.url)')"

docker build \
  --build-arg VITE_API_URL="$API_URL" \
  --build-arg VITE_GOOGLE_MAPS_API_KEY="your-maps-key" \
  -t "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/client:latest" \
  ./client

docker push "${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/client:latest"

gcloud run deploy "$WEB_SERVICE" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/client:latest" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=80
```

Get the web URL and **update the API** `CLIENT_URL` + redeploy or update env if you used a placeholder.

Restrict **Google Maps API key** in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) to your web URL and API URL HTTP referrers.

---

## Phase 8 — Environment variable checklist (API)

| Variable | Example / notes |
|----------|-----------------|
| `NODE_ENV` | `production` |
| `PGHOST` | `/cloudsql/PROJECT:REGION:INSTANCE` |
| `PGUSER` | `royalflush_app` |
| `PGPASSWORD` | Secret Manager or env |
| `PGDATABASE` | `royalflush` |
| `PGPORT` | Omit when using socket |
| `JWT_SECRET` | Long random string (secret) |
| `GCS_BUCKET_NAME` | Your bucket |
| `GOOGLE_MAPS_API_KEY` | Server-side geocode proxy |
| `CLIENT_URL` | `https://royalflush-web-....run.app` |

`PG*` match what `server/config/database.js` already reads.

---

## Phase 9 — Optional hardening (after it works)

- **Custom domains** — Map `api.yourdomain.com` and `app.yourdomain.com` in Cloud Run → Manage custom domains.
- **Min instances** — `gcloud run services update ... --min-instances=1` if you want less cold start (costs more).
- **Private Cloud SQL only** — Disable public IP on the SQL instance when using the connector only.
- **CI/CD** — Cloud Build trigger on `main` to build/push/deploy both images.
- **Firebase Hosting** instead of client Cloud Run — often cheaper for static Vite builds; API stays on Cloud Run.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `Failed to initialize database tables` on startup | Wrong credentials, SSL on socket, or Cloud SQL not attached to service |
| Login works locally, not in prod | CORS, `CLIENT_URL`, or `sameSite` / `secure` cookie settings |
| Images fail to upload | Service account lacks `objectAdmin` on bucket; wrong `GCS_BUCKET_NAME` |
| Frontend calls `localhost:3001` | Client image built without correct `VITE_API_URL` |
| 403 from Maps | API key HTTP referrer restrictions |

---

## Order of operations (summary)

1. Enable APIs, create project.
2. Create Cloud SQL + database + user.
3. Migrate data (or let `seedAllTables` create empty schema).
4. Create service account + IAM (Cloud SQL client, GCS).
5. Apply code changes (SSL, CORS, cookies).
6. Build & push **server** image → deploy API with `--add-cloudsql-instances`.
7. Build **client** with `VITE_API_URL` → deploy web → set `CLIENT_URL` on API.
8. Test login, reviews, image upload, geocode.

---

## Local dev vs production

| | Local | Production |
|---|--------|------------|
| Postgres | Render or docker-compose Postgres | Cloud SQL |
| GCS auth | JSON key file in docker-compose | Cloud Run service account |
| Client API URL | `http://localhost:3001` | Cloud Run API URL baked at build |
| DB connection | `PGHOST=...render.com` + SSL | `/cloudsql/...` socket |

You do **not** run a Postgres Docker container in production on GCP for this setup.
