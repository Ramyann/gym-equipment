# Frontend repository layout

| Location | Purpose |
| --- | --- |
| `src/` | React UI, browser state, API client, Three.js scenes, thumbnails and browser exports |
| `rack-generator/` | Browser CAD engine, model definitions, document validation and geometry tests |
| `public/` | Browser assets, equipment thumbnails, fonts and catalog imagery |
| `scripts/` | Frontend rendering, screenshots, performance checks, printable-export verification and gym fixtures |
| `e2e/` | Browser tests |
| `docs/` | Frontend/CAD documentation, research evidence and UI screenshots |
| `deployment/nginx.conf.template`, `Dockerfile` | Hosting the browser app and forwarding its API requests |
| `.github/workflows/ci.yml` | Frontend build and test checks |
| `node_modules/`, `dist/` | Ignored installed dependencies and generated browser build |

The sibling backend owns account/authentication services, database migrations, email, provider calls, persistence tests, full-stack Compose, shared-contract synchronization and deployment/MVP guides. Its `shared/` directory contains generated validation contracts required by the API and allows that repository to build independently.

The CAD engine is frontend runtime code, even though it also runs in Node for geometry tests and offline asset generation. Moving it to the API would break in-browser equipment generation and exports. Research images and reference tools support catalog maintenance; they do not ship in the production browser bundle unless explicitly referenced.

Old local verification outputs and Wrangler cache were preserved in the backend's ignored `.data/frontend-cleanup-archive/`; they are not application source. Active backend databases and `.env` settings remain in place. Empty legacy `server/` and `supabase/` folders were removed.
