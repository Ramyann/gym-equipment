# Gym Studio: local testing and Coolify deployment

## Two independent folders

- Frontend: `C:\Users\ACER PC\Desktop\gym-equipment` — React/Vite, Studio dashboard, builder, equipment library and templates.
- Backend: `C:\Users\ACER PC\Desktop\gym-studio-backend` — NestJS, private account workspaces, PostgreSQL, email and equipment research. It contains its own dependencies, model validators and Dockerfile and does not import files from the frontend at runtime.

The backend uses Nest's Express adapter and preserves the tested account/equipment services. Shared TypeScript geometry validation is the reason to choose Nest over a Go rewrite for this MVP. `vk-backend-v2` and the Go/Fiber `dashboard-backend` were inspected for reference; no application modules or credentials were copied.

## Quick local trial

Run `npm install` once in each folder. Start two terminals:

```powershell
cd "C:\Users\ACER PC\Desktop\gym-studio-backend"
npm run dev
```

```powershell
cd "C:\Users\ACER PC\Desktop\gym-equipment"
npm run dev
```

Open http://127.0.0.1:5173/account. Create an account, create a gym, customize equipment, use it in the gym, wait for Saved to cloud, sign out and sign in. An incognito login is a useful extra check because it starts without your existing browser cache.

The backend uses a persistent embedded PostgreSQL engine at `.data/postgres` unless DATABASE_URL is set. This is real API/database saving on your machine; no remote hosting purchase is needed. Keep the `.data` folder and run only one process against that embedded database. Production requires a regular PostgreSQL server.

Local equipment lookup defaults to **demo mode** when no provider key is present. Photo upload/camera inputs, editable measurements, parametric preview, library saving and gym placement can all be tried. The demo chooses the equipment type you select; it does not recognize a photo and its dimensions are labelled examples. Real image identification requires a provider key.

Password recovery messages appear at http://127.0.0.1:8788/dev/inbox. To also test confirmation, copy the backend `.env.example` to `.env`, set REQUIRE_EMAIL_VERIFICATION=true, and restart. The inbox route is local-only and disabled in production. With real SMTP configured, messages go to that SMTP service instead.

Existing development commands `npm run dev:studio`, `npm run dev:studio:local` and `npm run dev:api` in the frontend all launch the separate backend. Do not run more than one of those at once.

The backend `npm run dev` uses Node watch mode and automatically restarts when imported source/shared model files change. Restart an already-running older command once to enable it. Environment-file changes require a manual restart. Frontend model changes must be exported with `npm run backend:export` to refresh the independent backend's shared contracts; this export triggers the backend watcher. Production `npm start` remains an ordinary process.

## Repeatable persistence check

In the backend folder, with both services running:

```powershell
npx tsx scripts/smoke-local.ts
```

If a real provider is configured, use `npx tsx scripts/smoke-local.ts --live-ai` to authorize one live product research lookup instead of the photo demo. This can consume provider credits. The script preserves the configured provider and records its actual provenance.

This creates a local test account, customized photo-demo bench and gym; checks placed settings, signout, signin and server restoration; and generates a recovery email. Test credentials are in `.data/local-test-account.json`. Restart the backend, then run:

```powershell
npx tsx scripts/smoke-local.ts --restore
```

## Local Docker rehearsal with regular PostgreSQL and SMTP

Start Docker Desktop. Stop the host frontend first if using the default port 5173. From the frontend folder:

```powershell
docker compose up -d --build
```

Open http://127.0.0.1:5173 and http://127.0.0.1:8025 for Mailpit. Confirmation is enabled in this stack. The backend and database stay private in the Docker network; only the frontend and local email inbox are bound to loopback. Gym data persists in a named PostgreSQL volume. `docker compose down` stops the stack while retaining the database volume. Do not add `--volumes` unless intentionally discarding that test database.

To keep the host development app running and rehearse on port 5180 instead:

```powershell
$env:STUDIO_LOCAL_PORT='5180'
$env:STUDIO_SITE_URL='http://127.0.0.1:5180'
docker compose -p gym-studio-rehearsal up -d --build
```

These local credentials, HTTP domain, demo provider and Mailpit are for testing only. Public production uses HTTPS and a real mail service.

## Real equipment photo research

Set OPENROUTER_API_KEY or ANTHROPIC_API_KEY in the backend `.env`, optionally AI_PROVIDER and AI_MODEL, then restart. Keys never belong in VITE variables or browser storage. Blank AI_PROVIDER selects a configured key automatically; explicit `mock` forces the demo locally and is rejected in production.

The provider identifies equipment and researches dimensions, returning a strict template specification. Measurements and sources are reviewed and can be corrected before saving. The model is a parametric reconstruction, not a scanned mesh. Scale cannot reliably be recovered from a photo alone; unsupported or unknown products require user measurements.

AI_USER_DAILY_LIMIT defaults to 20 successful requests per account per UTC day; DAILY_LIMIT defaults to 100 for the whole site. Quotas are atomically reserved in PostgreSQL, failed requests refund their reservation, and cached requests count towards the account request limit. AI_CONCURRENCY defaults to 2 per backend process; provider calls share a 90-second analysis deadline. The research cache is persisted in PostgreSQL. Catalog-request GitHub integration is optional and disabled unless explicitly configured.

## Deploy both folders on Coolify

1. Save each folder in its own Git repository and create two Coolify applications using their Dockerfiles.
2. Create a private PostgreSQL resource with a dedicated database/user. Set up backups and test restoration. Do not publish its port.
3. Set backend runtime variables:

```dotenv
NODE_ENV=production
PORT=8788
DATABASE_URL=postgresql://studio:YOUR_PASSWORD@YOUR_INTERNAL_POSTGRES_HOST:5432/studio
SITE_URL=https://studio.example.com
SMTP_HOST=YOUR_SMTP_HOST
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=YOUR_SMTP_USER
SMTP_PASSWORD=YOUR_SMTP_PASSWORD
SMTP_FROM=Gym Studio <studio@example.com>
OPENROUTER_API_KEY=YOUR_PROVIDER_KEY
AI_USER_DAILY_LIMIT=20
DAILY_LIMIT=100
AI_CONCURRENCY=2
TRUST_PROXY=0
```

Production requires regular PostgreSQL, HTTPS SITE_URL and SMTP; all new accounts require email confirmation. For port 465 set SMTP_SECURE=true. For 587, Nodemailer uses STARTTLS when advertised. Leave TRUST_PROXY=0 unless the backend is isolated behind a known trusted proxy; set it to the verified number of trusted hops when necessary.

4. Put both app containers on the same private network. Configure frontend `STUDIO_API_UPSTREAM=http://YOUR_BACKEND_INTERNAL_NAME:8788` and expose frontend port 80 through Coolify's HTTPS domain. Set frontend `STUDIO_TRUSTED_PROXY_CIDR` to the actual trusted Coolify ingress IP/CIDR if using its reverse proxy, so Nginx forwards the real client IP. With the backend private and reachable only through Nginx, set backend TRUST_PROXY=1. Do not trust arbitrary proxy addresses. These frontend runtime variables are expanded into the Nginx template at container startup. Keep API traffic on the frontend's public origin, preserving HttpOnly/SameSite/Secure session cookies and server origin checks.
5. The backend applies idempotent schema migrations during startup, serves `/api/studio/health` (database check) and `/api/health` (equipment availability). Its container runs as an unprivileged user. The frontend serves `/healthz`, caches hashed assets, supports SPA routes and proxies `/api/`.
6. Verify actual confirmation/recovery email delivery, signout/signin, account isolation, saved gym/equipment restoration, HTTPS photo capture and a backup restore in the deployed environment.

## Validation and source maintenance

Frontend: `npm run build`, `npm run test:studio`, and the AI/model tests. Backend: `npm test`, `npm run build`, `npm audit`, plus the local persistence check above.

The frontend retains compatibility/export sources under `server/`. `npm run backend:export` updates matching backend sources and shared validation snapshots. It can overwrite backend code changes; choose one source of truth and commit both projects. It preserves `.env`, `.data`, the backend README and local smoke-test script.

Sessions store token hashes and passwords use salted scrypt. Confirmation/recovery tokens expire after 30 minutes and are single-use; password reset revokes old sessions. Workspaces are private to the authenticated account, upload revisions reject conflicts, offline changes remain locally cached, account switches invalidate stale requests, and guest import is explicit. User-visible backups and conflict resolution preserve reviewable data.
