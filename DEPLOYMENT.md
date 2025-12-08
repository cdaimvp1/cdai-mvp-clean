# Deployment Checklist (Azure)

Use this as a lightweight pre-flight before pushing to Azure (App Service or Container Apps). The project is split into a backend (Node/Express + Socket.IO) and a Vite frontend.

## 1) Environment Variables
- `OPENAI_API_KEY` (required by workflow engine)
- Optional: `PORT` (defaults to 5006)
- Do **not** hardcode secrets; set them in Azure App Settings.

## 2) Backend Pre-Flight
From the project root:
```bash
npm ci
node server.js
```
Verify it binds on port 5006 (or your configured `PORT`).

## 3) Frontend Build Pre-Flight
From `frontend/`:
```bash
npm ci
npm run build
```
Outputs to `frontend/dist/`. Fix any build errors before deployment.

## 4) Socket Endpoint
- Update `frontend/src/socket.ts` to the Azure backend URL (e.g., `https://<your-app>.azurewebsites.net`).
- In `server.js`, tighten CORS to your deployed frontend origin(s) instead of `"*"`.

## 5) Production Serve Options
- **Static hosting**: Serve `frontend/dist/` from a static host (Azure Static Web Apps or Azure Storage + CDN) and point it at the live backend URL in `socket.ts`.
- **Single container**: Add a Dockerfile to build both frontend and backend; serve `frontend/dist/` via a static server or Express static middleware, and run `server.js` for Socket.IO/API.

## 6) Logging & Persistence
- Current ledger/telemetry is in-memory. For auditability, add durable storage (Blob/Table/DB) and production logging (e.g., Azure Application Insights).
- Add auth/rate-limiting before exposing publicly.

## 7) Quick Smoke Test (local)
1) Start backend: `node server.js`
2) Start frontend: from `frontend/`, `npm run dev` (or serve `dist/`)
3) Open the app, run a governed workflow, and verify:
   - Governance panel live updates
   - Parsed rules populate
   - Ledger entries stream
   - Governance Controls panel opens from chat command (“governance controls”)

## 8) Azure App Service Notes
- Set `WEBSITE_NODE_DEFAULT_VERSION` as needed.
- Configure `PORT` in App Settings if not using 5006.
- Ensure WebSockets are enabled for Socket.IO.

## 9) Container App Notes
- Expose the backend port.
- Mount `frontend/dist/` (or bake into the image) and serve it statically.
- Keep WebSockets enabled.

## 10) Post-Deploy Checks
- Validate CORS and socket connectivity from the deployed frontend.
- Confirm governed workflows execute and telemetry flows end-to-end.
