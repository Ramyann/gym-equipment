# Frontend local setup

Run `npm install`, then `npm run dev` in this folder. Vite serves the UI at http://127.0.0.1:5173 and proxies `/api` to the backend on port 8788. `STUDIO_BACKEND_URL` overrides the development/preview upstream.

Run `npm run dev` separately in the sibling `gym-studio-backend` folder. The backend owns accounts, PostgreSQL, email, AI provider settings, full-stack Docker Compose and deployment instructions in its `docs/self-hosting.md`.

This frontend's Dockerfile and `deployment/nginx.conf.template` serve the browser app and proxy API requests. They belong with the frontend. For production set `STUDIO_API_UPSTREAM` to the backend's private address and use the backend deployment guide for the full setup.

After editing model definitions, run `npm run backend:sync`; `npm run backend:check` verifies shared contracts. These aliases invoke the tooling owned by the backend. `npm run test:studio` invokes its combined frontend/backend checks.
