# Royal Flush

Making using the bathroom, quick, simple, and insightful.

### Contributors
- John Ortega
- Christopher Persaud

### Structure of project
```bash
React (static frontend)
    ↓
Cloud CDN + Cloud Storage (or Firebase Hosting)
    ↓
Node.js API
    ↓
Cloud Run (containerized backend)
    ↓
Database (Cloud SQL / Firestore)
```

### To dos:
- Set up Google Cloud project
- Add login/signup along with google OAuth as well to replace github oauth (Should be somewhere in Google Cloud Console)
- Change UI design to look cool asf and explore different map designs
- Create docker files in client and server to containerize
- Set up google cloud account, blah blah we will go more into depth on this cloud stuff later


## Test DB Locally

Install [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy) if you dont have it

OR install with Homebrew
```bash
brew install cloud-sql-proxy
```

Then run the following with the actual gcloud credentials

```bash
gcloud auth application-default login
cloud-sql-proxy YOUR_PROJECT_ID:YOUR_REGION:PROJECT_NAME
```

If this is successful it should expose Postgres on 127.0.0.1:5432
Then ensure you update the server/.env for the local development

```bash
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=USERNAME_WE_SET
PGPASSWORD=PASSWORD_WE_SET
PGDATABASE=DATABASE_NAME_WE_SET
```

## After local works
### We can then deploy to Cloud Run
```bash
PGHOST=/cloudsql/....
```
**NOTICE**
- NO ```PGPORT```
- SAME ```PGUSER```, ```PGPASSWORD```, ```PGDATABASE```

## Redeploying
```bash
# 1. Build & push server (from repo root or ./server)
docker build --platform linux/amd64 -t REGION-docker.pkg.dev/PROJECT/REPO/server:latest ./server
docker push REGION-docker.pkg.dev/PROJECT/REPO/server:latest

# 2. Redeploy API (same image tag or new tag)
gcloud run deploy YOUR-API-SERVICE --image=.../server:latest --region=REGION ...

# 3. Build & push client (no VITE_API_URL needed; still need Maps key if you use it)
docker build --platform linux/amd64 \
  --build-arg VITE_GOOGLE_MAPS_API_KEY="..." \
  -t REGION-docker.pkg.dev/PROJECT/REPO/client:latest ./client
docker push REGION-docker.pkg.dev/PROJECT/REPO/client:latest

# 4. Redeploy web WITH API_UPSTREAM
export API_URL="$(gcloud run services describe YOUR-API-SERVICE --region=REGION --format='value(status.url)')"
gcloud run deploy YOUR-WEB-SERVICE \
  --image=.../client:latest \
  --region=REGION \
  --set-env-vars="API_UPSTREAM=${API_URL}"
```


### Resources for Christoper:
- To learn / Get started with docker: https://youtu.be/DQdB7wFEygo?si=esimDqHlx5G8EWE4


- Use redis to run multiple server instances