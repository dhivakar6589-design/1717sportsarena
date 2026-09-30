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

The backend reads config from `backend/.env` (gitignored — you must create it). Minimum required:

```ini
DATABASE_URL=postgres://user:password@host:5432/dbname?sslmode=require
JWT_SECRET=<long random string>
ADMIN_USERNAME=yourhostname
ADMIN_PASSWORD=yourpassword
```

The database schema (tables + columns) is created automatically on first start —
no migration step needed.

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
- Data lives in PostgreSQL via `DATABASE_URL` (Neon, Supabase, or any hosted Postgres).
  Tables are created automatically on first start.
- Uploaded images are saved to `backend/uploads` and served at `http://localhost:4000/uploads/...`.
  Set `DATA_DIR` to move that folder onto a persistent disk.
- Razorpay is fully integrated (order creation, signature verification, refunds on
  cancellation). It uses whatever `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are in
  the environment — test keys locally, live keys on the deployed server.
- The server ignores client-supplied prices — slot amounts are always recomputed
  server-side, so tampering with the page cannot change what you're charged.

WhatsApp messages (host alerts + automatic customer confirmations)
------------------------------------------------------------------
Uses Meta's WhatsApp Cloud API (Node 18+ has built-in `fetch`, no extra npm
package). Set these in `backend/.env`:

- `WHATSAPP_TOKEN` — Meta permanent access token (System User token).
- `WHATSAPP_PHONE_ID` — the WhatsApp Business number's Phone Number ID.
- `HOST_WHATSAPP` — host's personal WhatsApp in E.164 format, e.g. `918123456789`
  (only needed for the host alerts below).

What gets sent automatically:
- To the HOST (`HOST_WHATSAPP`): when a customer creates a booking, and again when
  the advance payment is confirmed.
- To the CUSTOMER (their booking phone number we sent to): an automatic booking
  confirmation whenever the advance payment is confirmed (online booking) or the
  host manually books a slot for them. Customer numbers are +91 Indian mobiles.

All messages are best-effort (never block or fail a booking/save). Leave the vars
empty to disable WhatsApp entirely.

IMPORTANT (Meta policy): To proactively message a customer who has not messaged
you first in the last 24h, Meta requires an APPROVED message template created in
Meta Business Manager. The code sends a plain-text message, which works whenever
there is an open 24h customer-initiated conversation. For reliable proactive
confirmations, create a confirmation template in Meta, then switch the customer
send to `type:'template'` with the component params in `backend/whatsapp.js`.


Security
- CORS is restricted to an allowlist. For a custom domain, set `ALLOWED_ORIGINS`
  in `backend/.env` as a comma-separated list, e.g.
  `ALLOWED_ORIGINS=https://yourturf.com,https://www.yourturf.com`.
- Rate limiting is on: 300 API requests per 15 min per IP, 10 host-login attempts,
  20 bookings, 20 payment requests, 20 booking lookups, and 30 reviews per 15 min.
- `JWT_SECRET` is REQUIRED when `NODE_ENV=production`. The server refuses to boot
  without it rather than falling back to a guessable default. In local dev it
  falls back to a random per-process secret, so restarting invalidates sessions.
- There is no endpoint that marks a booking paid without a verified Razorpay
  signature. Payment state can only be changed by `POST /api/payment/verify`.
- HTTPS: to serve over HTTPS, put your certificate/key paths in `backend/.env`:
  `SSL_CERT_PATH=...` and `SSL_KEY_PATH=...`. The server starts in HTTPS mode when both are set.

If anything errors during startup, copy the error and ask for help.

Deployment (going public)
========================

The backend is a Node.js/Express server backed by PostgreSQL, so it cannot run on a
static-only host like Netlify. Deploy the whole app (or at least the backend) on a
service that runs Node.js servers.

Option A — Deploy everything to Render (simplest, recommended)
-------------------------------------------------------------
1. Push this folder to a GitHub/GitLab repo.
2. In Render: New → Blueprint, select the repo. It will use `render.yaml`.
   - Set the secrets it asks for: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME`,
     `ADMIN_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
   - `DATABASE_URL` must point at a hosted PostgreSQL (Neon, Supabase, etc.).
     Render's own free Postgres is no longer available, so create the database
     with a provider first and paste the connection string into the secret.
   - The host (admin) account is **created automatically** on first start from
     `ADMIN_USERNAME`/`ADMIN_PASSWORD` — you don't need to run `setup-host.js` on the server.
   - Uploaded news images need a persistent disk to survive redeploys. On a paid
     Render plan, add a disk mounted at `/data` and set `DATA_DIR=/data`. Bookings
     themselves are safe regardless — they live in PostgreSQL.
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
   fly volumes create data --region bom --size 1   # persistent disk for uploaded images
   fly secrets set DATABASE_URL=... JWT_SECRET=... ADMIN_USERNAME=... ADMIN_PASSWORD=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
   fly deploy
   ```
3. Open `https://1717-sports-arena.fly.dev` (adjust the region/app name in `fly.toml`
   first if you change them).

Notes for going live
- HTTPS is provided automatically by the hosting platform (Render/Netlify).
  The local HTTPS mode (`SSL_CERT_PATH`/`SSL_KEY_PATH`) is only for self-hosted setups.
- Bookings live in your PostgreSQL database, not in the repo or on a disk.
  The admin account is auto-created from the env vars on first boot.
- Never commit `backend/.env` (see `.gitignore`).

Activating real (live) payments
------------------------------
The payment code is already live-ready. To switch from the test keys to real
money:

1. Activate your Razorpay live account: dashboard.razorpay.com → Settings →
   Accounts & Details → complete KYC, then activate the payments.
2. Add your website domain (e.g. `www.1717sportsarena.com`) under
   Razorpay Dashboard → Settings → Website & App.
3. Get your live keys: Razorpay Dashboard → Settings → API Keys → "Generate Key".
   Live Key ID starts with `rzp_live_`.
4. On the hosting platform (Render), open your service → Environment → Secrets
   and set:
   - `RAZORPAY_KEY_ID` = your `rzp_live_...` Key ID
   - `RAZORPAY_KEY_SECRET` = your live Key Secret
   Then redeploy/restart. Render secrets override the `.env` file and are never
   stored in git.
5. Verify: open the server logs — you should see
   `✅ Razorpay is LIVE — real payments are enabled.` If it says TEST mode, the
   live keys are not loaded.
6. Do a small real test booking (₹100 advance) and confirm the slot appears in
   the host dashboard. Note that self-cancellation from My Bookings does NOT
   trigger a refund — advances are non-refundable by the site's stated policy.
   Refunds only fire automatically if a slot is taken by someone else mid-payment.

Never paste the live Key Secret into chat, commit it to the repo, or put it in
`backend/.env` on a shared machine. Keep it in the platform's secret store.

