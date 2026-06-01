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




### Resources for Christoper:
- To learn / Get started with docker: https://youtu.be/DQdB7wFEygo?si=esimDqHlx5G8EWE4


- Use redis to run multiple server instances