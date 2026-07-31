1717 Sports Arena — Local Setup
===============================

Quick steps to run the website locally on Windows:

1. Install backend dependencies

```powershell
cd backend
npm install
```

2. Create the host (admin) account (only needed the first time)

```powershell
cd backend
node setup-host.js
```

You will be prompted for a username and password. You can also set them via
`ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables. There is no
default password — never hardcode admin credentials.

3. Start the backend API server

```powershell
# from repository root
cd backend
node server.js
```

The backend uses the `.env` file located at `backend/.env` (already included).

4. Open the frontend

- Open `http://localhost:4000` in your browser — the server now also serves the
  website (index.html, host.html, css/, js/, images/).
- The admin dashboard is at `http://localhost:4000/host.html`.
- Change your admin password from the dashboard (top-right → Change Password).
  It requires your current password and at least 8 characters for the new one.

Optional: Use the provided PowerShell helper to launch the backend and open the site:

```powershell
.\start-website.ps1
```

Notes
- The database file `turf.db` is stored in `backend/` (created automatically by the server).
- Uploaded images are saved to `backend/uploads` and served at `http://localhost:4000/uploads/...`.
- Razorpay uses test keys from `.env`. Replace them with your live keys before going live.
- The server ignores client-supplied prices — slot amounts are always recomputed
  server-side, so tampering with the page cannot change what you're charged.

Security
- CORS is restricted to an allowlist. For a custom domain, set `ALLOWED_ORIGINS`
  in `backend/.env` as a comma-separated list, e.g.
  `ALLOWED_ORIGINS=https://yourturf.com,https://www.yourturf.com`.
- Rate limiting is on: 300 API requests per 15 min per IP, 10 host-login attempts,
  20 bookings, and 30 reviews per 15 min.
- HTTPS: to serve over HTTPS, put your certificate/key paths in `backend/.env`:
  `SSL_CERT_PATH=...` and `SSL_KEY_PATH=...`. The server starts in HTTPS mode when both are set.

If anything errors during startup, copy the error and ask for help.

Deployment (going public)
========================

The backend is a Node.js/Express server with a file-based SQLite database, so it
cannot run on a static-only host like Netlify. Deploy the whole app (or at least the
backend) on a service that runs Node.js servers.

Option A — Deploy everything to Render (simplest, recommended)
-------------------------------------------------------------
1. Push this folder to a GitHub/GitLab repo.
2. In Render: New → Blueprint, select the repo. It will use `render.yaml`.
   - Set the secrets it asks for: `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
     `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
   - The host (admin) account is **created automatically** on first start from
     `ADMIN_USERNAME`/`ADMIN_PASSWORD` — you don't need to run `setup-host.js` on the server.
   - A 1GB persistent disk is mounted at `/data`, where the SQLite DB and uploads live,
     so data survives redeploys.
3. Your site will be at `https://one717-sports-arena.onrender.com` (update the URL in
   `render.yaml` first if you change the service name).
   - CORS is automatic for same-origin requests, so nothing else needs configuring.

Option B — Netlify (frontend) + Render/Railway (backend)
--------------------------------------------------------
1. Deploy the backend on Render (use a Web Service, not a static site) or Railway
   using the included `Dockerfile`/`Procfile`. Set `JWT_SECRET`, `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, and `ALLOWED_ORIGINS` to your Netlify site URL.
2. In `index.html` and `host.html`, add this line just BEFORE the
   `<script src="js/config.js">` tag:

   ```html
   <script>window.__BACKEND_URL__ = 'https://your-backend.onrender.com';</script>
   ```

3. Deploy the frontend files (index.html, host.html, css/, js/, images/) to Netlify.

Option C — Deploy everything to Fly.io
--------------------------------------
1. Install `flyctl` (https://fly.io/docs/flyctl/install/) and log in (`fly auth login`).
2. From this folder run:
   ```powershell
   fly launch --no-deploy          # uses fly.toml; creates the app
   fly volumes create data --region bom --size 1   # persistent disk for the DB + uploads
   fly secrets set JWT_SECRET=... ADMIN_USERNAME=... ADMIN_PASSWORD=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
   fly deploy
   ```
3. Open `https://1717-sports-arena.fly.dev` (adjust the region/app name in `fly.toml`
   first if you change them).

Notes for going live
- HTTPS is provided automatically by the hosting platform (Render/Netlify).
  The local HTTPS mode (`SSL_CERT_PATH`/`SSL_KEY_PATH`) is only for self-hosted setups.
- Backend data lives on a persistent disk; your local `backend/turf.db` is NOT
  transferred. The admin account is auto-created from the env vars on first boot.
- Never commit `backend/.env` or `backend/turf.db` (see `.gitignore`).

