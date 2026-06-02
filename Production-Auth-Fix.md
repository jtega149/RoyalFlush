# Production Auth Fix — Learning Notes

This document captures a production authentication bug in Royal Flush: what broke, why it only showed up in certain browsers, and how we fixed it. It is meant as a reference for future interviews, portfolio discussions, and debugging similar issues.

---

## The app architecture (relevant context)

Royal Flush runs as **two separate Cloud Run services**:

| Service | Role | Example URL pattern |
|---------|------|---------------------|
| **Web (client)** | nginx serves the React (Vite) build | `https://royalflush-web-….run.app` |
| **API (server)** | Node/Express + JWT auth + Postgres | `https://server-….run.app` |

The frontend was built with `VITE_API_URL` pointing directly at the **API** hostname. The browser called the API cross-origin with `credentials: 'include'` so httpOnly JWT cookies could be sent.

**Local dev worked fine.** Production did not — at least not consistently.

---

## What we observed

### Symptom 1: Signup “worked” but login did not

- `POST /auth/signup` succeeded — users were created in the database.
- Login appeared to fail afterward (including the automatic login after signup on the client).
- No session persisted; the app behaved as if the user were logged out.
- In DevTools, it looked like “no JWT” was created.

### Symptom 2: Browser-dependent behavior

| Environment | Login |
|-------------|-------|
| **Local** (`localhost:5173` → `localhost:3001`) | Worked |
| **Chrome (normal window)** | Often worked |
| **Chrome (incognito)** | Failed |
| **Safari (normal window)** | Failed |

### Symptom 3: Logout failed when login did work

In Chrome normal mode, after a successful login, **logout did not clear the session** — the user still appeared logged in on refresh.

---

## What signup vs login actually do

These behave differently by design:

**Signup** (`signUpUser`) only inserts a row and returns JSON. It does **not** set a cookie or issue a JWT.

**Login** (`loginUser`) validates credentials, signs a JWT, and sets an httpOnly `token` cookie.

The client signup flow calls signup, then immediately calls login:

```js
await authApi.signup(username, email, password)
await authApi.login(user.email, user.password)
window.location.href = '/'
```

So a “signup that doesn’t log you in” usually means **login’s cookie step failed**, not signup itself.

---

## Initial misread: “No JWT”

The JWT is stored in an **httpOnly cookie**, not in:

- The login response body (only `{ message: 'Login successful' }`)
- `localStorage` or `sessionStorage`

To debug correctly:

1. **Network** → `POST …/auth/login` → check **Response headers** for `Set-Cookie`.
2. **Application → Cookies** → check the hostname where the request was sent.

Before the fix, cookies were set on the **API** domain while the user’s tab was on the **web** domain — a cross-site cookie scenario.

---

## Root cause: cross-site cookies in production

### Why local worked

`http://localhost:5173` and `http://localhost:3001` are treated as **same-site** (same registrable domain, different port). Cookies with `SameSite=Strict` work as expected.

### Why production broke

`royalflush-web-….run.app` and `server-….run.app` are **different sites**. Browsers classify `*.run.app` under the public suffix `run.app`, so two Cloud Run URLs are not same-site.

The API set cookies with production options intended for cross-origin use:

```js
res.cookie('token', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'none',  // required for cross-site cookies
  maxAge: 7 * 24 * 60 * 60 * 1000,
})
```

That makes the `token` cookie a **third-party cookie** from the browser’s perspective: the page is on the web origin, the cookie lives on the API origin.

Modern browsers block or restrict third-party cookies:

- **Safari (ITP)** — blocks cross-site cookies by default, even in normal browsing.
- **Chrome incognito** — blocks third-party cookies.
- **Chrome normal** — may still allow them for now, which explained the inconsistent behavior.

**Result:** The server often *did* send `Set-Cookie`, but the browser refused to store it. Signup still succeeded because it never depended on a cookie.

### Secondary bug: logout

When login did work (Chrome normal), logout still failed because `clearCookie` did not match how the cookie was set:

```js
// Login set secure + sameSite: 'none'
res.cookie('token', token, { secure: true, sameSite: 'none', ... })

// Logout used defaults only
res.clearCookie('token')  // browser often keeps the cookie
```

Browsers require matching `path`, `secure`, and `sameSite` to clear a cookie. The API returned “Logout successful” while the session cookie remained.

---

## The fix: same-origin API via nginx proxy

Instead of fighting third-party cookie rules, we made API calls **same-origin** from the browser’s point of view.

### Idea

The browser only talks to the **web** URL. nginx on the client container **proxies** API paths to the real backend:

```
Browser  →  https://royalflush-web…/auth/login
                ↓ (nginx proxy_pass)
            https://server…/auth/login
```

The login response’s `Set-Cookie` is associated with the **web** hostname (first-party cookie). Safari, incognito, and Chrome all accept it.

### Code and config changes

| Area | Change |
|------|--------|
| **`client/nginx.conf.template`** | Proxy `/auth/`, `/reviews/`, `/api/` to upstream API |
| **`client/docker-entrypoint.sh`** | Substitute `API_UPSTREAM` env var into nginx config at container start |
| **`client/Dockerfile`** | Use template + entrypoint; empty `VITE_API_URL` for production builds |
| **`client/src/api.js`** | `API_BASE` defaults to `''` (same-origin paths) |
| **`client/vite.config.js`** | Dev proxy so local dev matches production behavior |
| **`server/controllers/auth.js`** | Shared `tokenCookieOptions()` with `sameSite: 'lax'` in prod; `clearCookie` uses same options |

### New production env var: `API_UPSTREAM`

Set on the **web** Cloud Run service only:

```bash
API_UPSTREAM=https://server-….run.app   # no trailing slash
```

This is the backend URL nginx forwards to. It is **not** read by React — only by nginx at startup.

### Cookie options after the fix

With same-origin requests, production cookies no longer need `SameSite=None`:

```js
// Production (via proxy)
sameSite: 'lax'
secure: true
path: '/'
```

Logout uses the same options when calling `clearCookie`.

---

## Deployment checklist (what we had to redeploy)

1. **Rebuild & push server image** — auth cookie + logout fixes.
2. **Rebuild & push client image** — nginx proxy, empty `VITE_API_URL`, Maps key at build time.
3. **Redeploy API** (`server`) — image update only; existing env/secrets/Cloud SQL preserved.
4. **Redeploy web** (`royalflush-web`) — new image + `API_UPSTREAM` pointing at API URL.

Verify after deploy:

- Network requests go to `https://royalflush-web…/auth/…`, not the API host.
- Cookie `token` appears under the **web** hostname.
- Login works in Safari and incognito.
- Logout removes the cookie and `/auth/me` returns 401.

---

## Related production issue: Google Maps (`ApiTargetBlockedMapError`)

Separate from auth, the map failed until:

1. **`VITE_GOOGLE_MAPS_API_KEY`** was passed at **`docker build`** (`--build-arg`), not Cloud Run runtime.
2. The **browser** API key had **API restrictions** including Maps JavaScript API and Places API (not just Geocoding).
3. **HTTP referrer** restrictions included the Cloud Run web URL and `localhost:5173/*`.

Server geocoding uses a **different** key (`GOOGLE_MAPS_API_KEY` on the API service) without referrer restrictions.

---

## Lessons learned

1. **Same-site vs cross-site matters for cookies.** Two Cloud Run URLs are not “almost the same domain” — they are different sites for cookie policy.

2. **“Works in Chrome, fails in Safari/incognito”** is a strong signal for third-party / cross-site cookie blocking, not necessarily a broken backend.

3. **Signup succeeding while login fails** can mean the write path works but session establishment (cookies) does not.

4. **httpOnly JWTs are invisible in Application → Local Storage.** Debug via `Set-Cookie` and Cookies for the correct hostname.

5. **`clearCookie` must mirror `cookie` options** (`secure`, `sameSite`, `path`) or logout silently fails.

6. **Vite env vars are build-time.** `VITE_*` values must be set during `docker build`, not only as Cloud Run env vars on the web service.

7. **Same-origin proxy is a durable pattern** for SPAs on one host + API on another when you want cookie-based sessions without `SameSite=None` and third-party cookie dependency.

8. **Local dev can hide production cookie bugs** because localhost ports are same-site; use a dev proxy or staging that mirrors production topology.

---

## One-line summary (for interviews)

> Royal Flush auth failed in production because the React app and Express API lived on different Cloud Run domains, so JWT cookies were third-party and blocked by Safari and incognito; we fixed it by proxying `/auth`, `/reviews`, and `/api` through nginx on the frontend so cookies became first-party, and we aligned `clearCookie` with `res.cookie` for logout.

---

*Document created after fixing production auth — June 2025.*
