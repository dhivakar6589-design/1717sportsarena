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
- Uploaded news images go to Cloudflare R2 when `R2_BUCKET` is set, otherwise to
  `backend/uploads` on local disk. Either way they are served at `/uploads/...`.
  See "News images (Cloudflare R2)" below — on a host with no persistent disk you
  must use R2 or uploads vanish on every redeploy.
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

News images (Cloudflare R2)
--------------------------
Every free and low-cost host discards its local disk on redeploy, so news posters
must live in object storage. Set these in `backend/.env` (and as secrets on your
host) to switch uploads from disk to a Cloudflare R2 bucket:

```ini
R2_BUCKET=1717-sports-arena
R2_ACCESS_KEY_ID=<R2 API token access key id>
R2_SECRET_ACCESS_KEY=<R2 API token secret>
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://media.1717sportsarena.com
```

- Create the bucket at Cloudflare → R2 → Create bucket.
- Create an R2 API token (R2 → Manage R2 API Tokens) with **Object Read & Write**
  scoped to that bucket only.
- `R2_ENDPOINT` defaults to `https://<bucket>.r2.cloudflarestorage.com` if omitted.
- `R2_PUBLIC_URL` is optional. The app serves images through its own
  `/uploads/<name>` route either way, so this is only needed if you later want to
  put a CDN in front of the bucket.
- Leave these unset and the app keeps using `DATA_DIR/uploads`, which is correct
  for local development and fine on a host with a real persistent disk.

Existing rows keep working: the `/uploads/...` path stored in the database is the
same on both backends.

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
   - Set the R2 vars too (see "News images (Cloudflare R2)") so uploaded posters
     survive redeploys. The free plan has no persistent disk, so this is required.
3. Your site will be at `https://1717-sports-arena.onrender.com`.
   - CORS is automatic for same-origin requests, so nothing else needs configuring.

Note on the free plan: the service sleeps after ~15 minutes of inactivity and the
first request then takes ~30 seconds to wake it. `render.yaml` deliberately does
NOT set `healthCheckPath` — a scheduled health poll counts as traffic, keeps the
instance awake around the clock, and exhausts the 750 monthly instance hours.
Removing that poll is what lets a low-traffic site stay inside the allowance.
If cold starts hurt customers, a $7/month Starter instance removes the sleep.

Option B — A host that never sleeps (always-on free tier)
---------------------------------------------------------
Same code, no config changes needed; deploy from the same repo and set the same
environment variables.

- **Northflank** — the free Sandbox runs two services that do not sleep, which
  matters because this site takes real payments and a 30-second cold start during
  checkout loses bookings. Requires a card to verify the account.
- **Koyeb** — one free instance, scales to zero after an hour of idleness (a
  shorter wait than Render's 15 minutes). Requires a card with a $29 hold, and
  Koyeb was acquired by Mistral in 2026 with its free Starter plan being retired,
  so treat it as a short-term option.
- **Railway** — $1/month of usage credit on the free plan. A quiet turf-booking
  site fits inside that; it will not once traffic picks up.

What is NOT a free option any more, despite older tutorials saying otherwise:
Heroku (free dynos ended Nov 2022), Fly.io (permanent allowances ended Oct 2024,
now a 2-hour trial then pay-as-you-go from ~$2/month), Glitch (ended 2025), and
Cyclic (shut down 2024).

Option C — Netlify (frontend) + Node host (backend)
--------------------------------------------------
1. Deploy the backend on Render (use a Web Service, not a static site) or Railway
   using the included `Dockerfile`/`Procfile`. Set `JWT_SECRET`, `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`, and `ALLOWED_ORIGINS` to your Netlify site URL.
2. In `index.html` and `host.html`, add this line just BEFORE the
   `<script src="js/config.js">` tag:

   ```html
   <script>window.__BACKEND_URL__ = 'https://your-backend.onrender.com';</script>
   ```

3. Deploy the frontend files (index.html, host.html, css/, js/, images/) to Netlify.

Custom domain (www.1717sportsarena.com)
-----------------------------------------
Whichever host you pick, connecting the domain is the same three steps:

1. Point the DNS records at the host. For `www.1717sportsarena.com` an `A` record
   (Render, VPS) or a `CNAME` (Netlify, Northflank, Koyeb) plus a host-provided
   domain. The provider usually shows the exact value to use.
2. Add the custom domain in the host's dashboard so it issues an HTTPS
   certificate. Your hosting provider handles renewal.
3. Add both hostnames to `ALLOWED_ORIGINS`:
   `https://www.1717sportsarena.com,https://1717sportsarena.com`
   `render.yaml` already ships these values, so a Render deploy needs no change.

Keep `www` and the apex working. The canonical tag, `sitemap.xml` and `robots.txt`
all reference `https://www.1717sportsarena.com/`, and Google treats the two
hostnames as separate sites, so redirect the apex to `www` (or the reverse) at the
DNS or host level rather than serving both with 200s. Also add your live domain to
Razorpay → Settings → Website & App, otherwise checkout rejects it.

Option D — Fly.io (no longer free, ~$2/month)
----------------------------------------------
Fly ended its permanent free allowances in October 2024, so `fly.toml` targets a
paid deployment. It is still the cheapest always-on option if you would rather
pay a couple of dollars than accept cold starts.
1. Install `flyctl` (https://fly.io/docs/flyctl/install/) and log in (`fly auth login`).
2. From this folder run:
   ```powershell
   fly launch --no-deploy          # uses fly.toml; creates the app
   fly secrets set DATABASE_URL=... JWT_SECRET=... ADMIN_USERNAME=... ADMIN_PASSWORD=... RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...
   fly deploy
   ```
   No volume is needed — news images live in R2, not on disk.
3. Open `https://1717-sports-arena.fly.dev` (adjust the region/app name in `fly.toml`
   first if you change them).

Option E — A small VPS (most reliable, ~$5/month)
--------------------------------------------------
A $5-6 VPS (Hetzner, Contabo) running the included `Dockerfile` directly. Nothing
sleeps, you get a real disk, and there is no platform quota to hit. For a
business taking payments this is the option that behaves predictably.

```powershell
docker build -t arena .
docker run -d -p 80:4000 --env-file backend/.env arena
```
Put Caddy or nginx in front for TLS, and point the domain at the server's IP.

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

