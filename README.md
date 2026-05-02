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
- Add login/signup along with other OAuth providers (Should be somewhere in Google Cloud Console)
- Refractor UI design and explore different map designs
- Create docker files in client and server to containerize
- Set up google cloud account, blah blah we will go more into depth on this later