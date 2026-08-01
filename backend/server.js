const Razorpay = require('razorpay');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
require('dotenv').config();
const db = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Make sure the uploads folder exists before Multer tries to write to it.
// Uses DATA_DIR (persistent disk on Render/Railway) if set, otherwise backend/uploads.
const UPLOAD_DIR = path.join(process.env.DATA_DIR || __dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Log which payment mode is active so it's obvious before going live.
// Test keys start with rzp_test_, live keys with rzp_live_.
const RP_KEY = process.env.RAZORPAY_KEY_ID || '';
if (!RP_KEY || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn('⚠️  Razorpay keys are missing. Payments will fail.');
} else if (RP_KEY.startsWith('rzp_test_')) {
  console.warn('ℹ️  Razorpay is in TEST mode — no real money moves.');
} else {
  console.log('✅ Razorpay is LIVE — real payments are enabled.');
}

// ---- File upload setup ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname.replace(/\s+/g, '-');
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPG, PNG, or WEBP images are allowed'));
  }
});

// Serve uploaded images publicly
app.use('/uploads', express.static(UPLOAD_DIR));
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-env-file';

// ---------- SECURITY HARDENING ----------

// Auto-create the host account on first run (no need to run setup-host.js on a
// deployed server). Uses ADMIN_USERNAME/ADMIN_PASSWORD env vars.
async function ensureHostAccount() {
  const row = await db.get('SELECT COUNT(*) AS n FROM host_users');
  const count = Number(row && row.n) || 0;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || String(password).length < 8) {
    console.warn('⚠️  No host account exists. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars, or run `node setup-host.js` in backend/.');
    return;
  }
  await db.run('INSERT INTO host_users (username, passwordHash) VALUES (?, ?)',
    [username, bcrypt.hashSync(String(password), 10)]);
  console.log('✅ Auto-created host account:', username);
}

// Security headers (CSP left at Express defaults because the site uses inline onclick handlers)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // uploaded images load cross-origin
  // 'same-origin' (helmet's default) severs popup access to the opener, which makes
  // Razorpay's card 3DS/OTP window open as a blank about:blank tab. Allow popups.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }
}));

// Reject oversized JSON bodies early (prevents memory-exhaustion via huge payloads)
app.use(express.json({ limit: '16kb' }));

// Restrict CORS to an explicit allowlist. Same-origin requests (the backend serving
// the frontend, e.g. single-host deploy) are always allowed with zero config.
// Override via ALLOWED_ORIGINS in backend/.env — comma-separated, e.g.
// https://yourturf.com,https://www.yourturf.com — for cross-origin setups (Netlify frontend).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'null,http://localhost:4000,http://127.0.0.1:4000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const sameOrigin = origin && host && origin.replace(/^https?:\/\//, '').split('/')[0].toLowerCase() === host.toLowerCase();
  const isAllowed = !origin || sameOrigin || allowedOrigins.includes(origin);

  if (origin && isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(isAllowed ? 204 : 403);
  next();
});

// The app sits behind Cloudflare + Render, so the rate limiter must trust the
// X-Forwarded-For header to see real client IPs. Without this, express-rate-limit
// logs validation errors and cannot identify users correctly.
app.set('trust proxy', 1);

// Rate limiting: 300 requests / 15 minutes per IP across the whole API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', apiLimiter);

// Stricter limits on sensitive endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' }
});
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many booking requests. Try again later.' }
});
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment requests. Try again later.' }
});
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reviews. Try again later.' }
});

// Serve ONLY the public frontend files (never the backend folder or its .env/db)
const SITE_ROOT = path.join(__dirname, '..');
app.get('/', (req, res) => res.sendFile(path.join(SITE_ROOT, 'index.html')));
app.get('/host.html', (req, res) => res.sendFile(path.join(SITE_ROOT, 'host.html')));
app.use('/css', express.static(path.join(SITE_ROOT, 'css')));
app.use('/js', express.static(path.join(SITE_ROOT, 'js')));
app.use('/images', express.static(path.join(SITE_ROOT, 'images')));

// ---- Pricing rules (must match the frontend slot grid in js/booking.js) ----
const ADVANCE_PER_SLOT = 100;
const VALID_SPORTS = ['football', 'cricket'];
const VALID_FORMATS = ['5s', '6s'];

// Only verified payments block a slot. A booking that was created but never paid
// for must NOT hold a slot hostage, so availability counts only these statuses.
const CONFIRMED_STATUSES = ['advance-paid', 'completed'];

function getPriceForHour(hour) {
  if (hour >= 6 && hour < 14) return 500;
  if (hour >= 14 && hour < 18) return 750;
  if (hour >= 18 && hour < 22) return 1000;
  return null; // outside opening hours
}

// Parse a slot label like "07:00 - 08:00" into { start, end } or null if malformed
function parseSlotLabel(label) {
  const m = /^([0-9]{2}):00 - ([0-9]{2}):00$/.exec(label);
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (end !== start + 1) return null;
  return { start, end };
}

// Local YYYY-MM-DD for the server's timezone
function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------- HELPER: verify host login token ----------
function requireHostAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.hostUser = decoded;
    next();
  });
}

// ================= HOST LOGIN =================
app.post('/api/host/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = await db.get('SELECT * FROM host_users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const validPassword = bcrypt.compareSync(password, user.passwordHash);
  if (!validPassword) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// ================= PUBLIC: create a booking =================
app.post('/api/bookings', bookingLimiter, async (req, res) => {
  const { name, phone, date, sport, format, slots } = req.body;

  if (!name || !phone || !date || !sport || !format || !slots || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid booking details' });
  }
  if (!/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }
  if (!VALID_SPORTS.includes(sport) || !VALID_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'Invalid sport or format' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date' });
  }
  if (slots.length > 16) {
    return res.status(400).json({ error: 'Too many slots selected' });
  }

  // Amounts are computed on the server — client-supplied amounts are ignored
  let totalAmount = 0;
  for (const label of slots) {
    const parsed = parseSlotLabel(label);
    if (!parsed) return res.status(400).json({ error: 'Invalid slot format' });
    const price = getPriceForHour(parsed.start);
    if (price === null) return res.status(400).json({ error: 'Slot outside opening hours' });
    totalAmount += price;
  }
  const advanceAmount = Math.min(ADVANCE_PER_SLOT * slots.length, totalAmount);
  const balanceAmount = totalAmount - advanceAmount;

  // Past slots on today's date can never be booked
  if (date === localDateISO()) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const pastSlot = slots.find(label => {
      const parsed = parseSlotLabel(label);
      return parsed.start * 60 <= nowMinutes;
    });
    if (pastSlot) {
      return res.status(400).json({ error: 'One or more selected slots have already started. Please choose a future slot.' });
    }
  }

  // Check for slot conflicts against existing CONFIRMED bookings for same date
  // (both sports share the same play area, so slots block across sports)
  const existing = await db.all(
    `SELECT slots FROM bookings WHERE date = ? AND status IN ('advance-paid', 'completed')`,
    [date]
  );

  const takenSlots = existing.flatMap(row => JSON.parse(row.slots));
  const conflict = slots.some(s => takenSlots.includes(s));
  if (conflict) {
    return res.status(409).json({ error: 'One or more selected slots are already booked' });
  }

  const id = 'TA1717-' + Date.now().toString().slice(-6);
  const createdAt = new Date().toISOString();

  await db.run(`
    INSERT INTO bookings (id, name, phone, date, sport, format, slots, totalAmount, advanceAmount, balanceAmount, status, balanceStatus, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending-payment', 'due', ?)
  `, [id, name, phone, date, sport, format, JSON.stringify(slots), totalAmount, advanceAmount, balanceAmount, createdAt]);

  res.json({ success: true, bookingId: id });
});

// ================= PUBLIC: mark booking as paid (called after payment success) =================
app.post('/api/bookings/:id/confirm-payment', async (req, res) => {
  const { id } = req.params;
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  await db.run(`UPDATE bookings SET status = 'advance-paid' WHERE id = ?`, [id]);
  res.json({ success: true });
});

// ================= PUBLIC: get already-booked slots for a date (for frontend slot grid) =================
// Both sports share the same play area, so booked slots are shared across sports.
app.get('/api/bookings/slots', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date is required' });

  const rows = await db.all(
    `SELECT slots FROM bookings WHERE date = ? AND status IN ('advance-paid', 'completed')`,
    [date]
  );

  const bookedSlots = rows.flatMap(row => JSON.parse(row.slots));

  // For today, also flag slots whose start time has already passed
  const pastSlots = [];
  if (date === localDateISO()) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    for (let h = 6; h < 22; h++) {
      if (h * 60 <= nowMinutes) {
        pastSlots.push(`${String(h).padStart(2, '0')}:00 - ${String(h + 1).padStart(2, '0')}:00`);
      }
    }
  }

  res.json({ bookedSlots, pastSlots });
});

// ================= PUBLIC: look up bookings by phone number =================
app.get('/api/bookings/lookup', async (req, res) => {
  const { phone } = req.query;
  if (!phone || !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }
  const rows = await db.all('SELECT * FROM bookings WHERE phone = ? ORDER BY createdAt DESC', [phone]);
  const bookings = rows.map(b => ({ ...b, slots: JSON.parse(b.slots) }));
  res.json({ bookings });
});

// ================= PUBLIC: customer cancels their own booking =================
// Verifies the phone number matches, then cancels. If the advance was already paid
// and the slot is still in the future, the payment is refunded.
app.post('/api/bookings/:id/cancel', async (req, res) => {
  const { id } = req.params;
  const { phone } = req.body;
  if (!phone || !/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: 'Valid 10-digit phone number required' });
  }

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.phone !== phone) return res.status(403).json({ error: 'This phone number does not match the booking' });
  if (booking.status === 'cancelled') return res.status(400).json({ error: 'This booking is already cancelled' });

  // A booking that already happened cannot be cancelled
  if (booking.date < localDateISO()) {
    return res.status(400).json({ error: 'This booking date has already passed' });
  }

  await db.run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [id]);

  // Refund the advance for paid bookings that are still in the future
  if ((booking.status === 'advance-paid' || booking.status === 'completed') && booking.paymentId) {
    refundPayment(id, booking.paymentId, 'Customer cancelled the booking');
  }

  res.json({ success: true, message: 'Booking cancelled.' });
});

// ================= PUBLIC: submit a review =================
app.post('/api/reviews', reviewLimiter, async (req, res) => {
  const { name, rating, text } = req.body;
  if (!name || !rating || !text) return res.status(400).json({ error: 'Missing review details' });
  if (name.length > 100 || text.length > 2000) return res.status(400).json({ error: 'Review too long' });
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Invalid rating' });

  const createdAt = new Date().toISOString();
  await db.run('INSERT INTO reviews (name, rating, text, createdAt) VALUES (?, ?, ?, ?)',
    [name, r, text, createdAt]);
  res.json({ success: true });
});

// ================= PUBLIC: get all reviews =================
app.get('/api/reviews', async (req, res) => {
  const reviews = await db.all('SELECT * FROM reviews ORDER BY createdAt DESC');
  res.json(reviews);
});

// ================= HOST-ONLY: get all bookings (requires login token) =================
app.get('/api/host/bookings', requireHostAuth, async (req, res) => {
  const rows = await db.all('SELECT * FROM bookings ORDER BY createdAt DESC');
  const bookings = rows.map(b => ({ ...b, slots: JSON.parse(b.slots) }));
  res.json(bookings);
});

// ================= HOST-ONLY: update booking status (cancel) =================
app.patch('/api/host/bookings/:id/status', requireHostAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['pending-payment', 'advance-paid', 'cancelled', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  await db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, id]);

  // When the host cancels a paid booking, refund the advance automatically
  if (status === 'cancelled' && (booking.status === 'advance-paid' || booking.status === 'completed') && booking.paymentId) {
    refundPayment(id, booking.paymentId, 'Host cancelled the booking');
    return res.json({ success: true, refund: 'initiated' });
  }
  res.json({ success: true });
});

// ================= HOST-ONLY: delete a booking entirely =================
// Removes the booking from the system (no refund, no revenue impact). Used to
// drop bookings whose advance was never collected (e.g. abandoned pending-payment).
app.delete('/api/host/bookings/:id', requireHostAuth, async (req, res) => {
  const { id } = req.params;
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [id]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });

  // Never silently delete a paid booking — cancel+refund instead so money isn't lost
  if (booking.status === 'advance-paid' || booking.status === 'completed') {
    return res.status(409).json({ error: 'Paid bookings cannot be deleted. Cancel the slot instead to trigger a refund.' });
  }

  await db.run('DELETE FROM bookings WHERE id = ?', [id]);
  res.json({ success: true });
});

// ================= HOST-ONLY: mark balance collected =================
app.patch('/api/host/bookings/:id/collect-balance', requireHostAuth, async (req, res) => {
  const { id } = req.params;
  await db.run(`UPDATE bookings SET balanceStatus = 'collected', status = 'completed' WHERE id = ?`, [id]);
  res.json({ success: true });
});

// ================= HOST-ONLY: upload a news/poster post =================
app.post('/api/host/news', requireHostAuth, upload.single('image'), async (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  const createdAt = new Date().toISOString();

  const result = await db.run(
    'INSERT INTO news_posts (title, description, imagePath, createdAt) VALUES (?, ?, ?, ?) RETURNING id',
    [title, description || '', imagePath, createdAt]
  );

  res.json({ success: true, id: result.rows[0].id });
});

// ================= PUBLIC: get all news/poster posts =================
app.get('/api/news', async (req, res) => {
  const posts = await db.all('SELECT * FROM news_posts ORDER BY createdAt DESC');
  res.json(posts);
});

// ================= HOST-ONLY: delete a news post =================
app.delete('/api/host/news/:id', requireHostAuth, async (req, res) => {
  await db.run('DELETE FROM news_posts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ================= PUBLIC: create a Razorpay order for the advance amount =================
app.post('/api/payment/create-order', paymentLimiter, async (req, res) => {
  const { bookingId, amount } = req.body;
  if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  if (booking.status !== 'pending-payment') return res.status(400).json({ error: 'Booking is not awaiting payment' });
  if (!amount || Number(amount) !== booking.advanceAmount) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const order = await razorpay.orders.create({
      amount: booking.advanceAmount * 100,
      currency: 'INR',
      receipt: 'receipt_' + booking.id
    });
    res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ error: 'Could not create payment order' });
  }
});

// ================= PUBLIC: verify payment signature (critical security step) =================
// Refunds a payment that was captured for a booking that ended up cancelled.
// Never throws into the request path — failures are just logged.
async function refundPayment(bookingId, paymentId, note) {
  try {
    const refund = await razorpay.payments.refund(paymentId, { notes: { bookingId, reason: note } });
    await db.run(`UPDATE bookings SET refundStatus = ? WHERE id = ?`, ['refunded', bookingId]);
    console.log(`💸 Refund initiated for ${bookingId}: ${refund.id}`);
    return true;
  } catch (err) {
    console.error(`⚠️ Refund failed for ${bookingId}:`, err && err.message || err);
    await db.run(`UPDATE bookings SET refundStatus = 'failed' WHERE id = ?`, [bookingId]);
    return false;
  }
}

app.post('/api/payment/verify', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest('hex');

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    return res.status(400).json({ success: false, error: 'Payment verification failed' });
  }

  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return res.status(404).json({ success: false, error: 'Booking not found' });

  // The slot must still be free — it was only held in 'pending-payment' state and
  // never blocked other customers. If someone else confirmed it first, cancel this
  // booking so the paid amount can be refunded.
  const existing = await db.all(
    `SELECT slots FROM bookings WHERE date = ? AND id != ? AND status IN ('advance-paid', 'completed')`,
    [booking.date, bookingId]
  );
  const takenSlots = existing.flatMap(row => JSON.parse(row.slots));
  const conflict = JSON.parse(booking.slots).some(s => takenSlots.includes(s));
  if (conflict) {
    await db.run(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`, [bookingId]);
    refundPayment(bookingId, razorpay_payment_id, 'Slot taken while customer was paying');
    return res.json({
      success: false,
      conflict: true,
      error: 'Your slot was taken while you were paying. Please re-book a different slot; the advance will be refunded.'
    });
  }

  await db.run(`UPDATE bookings SET status = 'advance-paid', paymentId = ? WHERE id = ?`, [razorpay_payment_id, bookingId]);
  res.json({ success: true });
});

// ================= HOST-ONLY: change admin password (requires current password) =================
app.post('/api/host/change-password', requireHostAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new passwords are required' });
  if (String(newPassword).length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = await db.get('SELECT * FROM host_users WHERE username = ?', [req.hostUser.username]);
  if (!user) return res.status(401).json({ error: 'Host account not found' });

  const validCurrent = bcrypt.compareSync(currentPassword, user.passwordHash);
  if (!validCurrent) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = bcrypt.hashSync(String(newPassword), 10);
  await db.run('UPDATE host_users SET passwordHash = ? WHERE id = ?', [newHash, user.id]);
  res.json({ success: true, message: 'Password changed successfully' });
});

// ================= HOST-ONLY: reset all bookings & revenue (requires re-entering password) =================
app.post('/api/host/reset-data', requireHostAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required to confirm reset' });

  const user = await db.get('SELECT * FROM host_users WHERE username = ?', [req.hostUser.username]);
  if (!user) return res.status(401).json({ error: 'Host account not found' });

  const validPassword = bcrypt.compareSync(password, user.passwordHash);
  if (!validPassword) return res.status(401).json({ error: 'Incorrect password' });

  // Wipe bookings only — reviews and news posts are left untouched
  await db.run('DELETE FROM bookings');

  res.json({ success: true, message: 'All bookings and revenue data have been reset.' });
});

// Automatically cancel bookings whose advance was never paid (e.g. the customer
// closed the checkout popup). Runs every 5 minutes.
const PENDING_PAYMENT_TTL_MIN = 30;
setInterval(() => {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TTL_MIN * 60 * 1000).toISOString();
  db.run(`UPDATE bookings SET status = 'cancelled' WHERE status = 'pending-payment' AND createdAt < ?`, [cutoff])
    .catch(err => console.error('⚠️ TTL cleanup failed:', err.message));
}, 5 * 60 * 1000);

async function startServer() {
  await db.initSchema();
  await ensureHostAccount();

  // Start the server — HTTPS if SSL cert/key paths are provided in backend/.env
  const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
  const SSL_CERT_PATH = process.env.SSL_CERT_PATH;

  if (SSL_KEY_PATH && SSL_CERT_PATH) {
    https.createServer({
      key: fs.readFileSync(SSL_KEY_PATH),
      cert: fs.readFileSync(SSL_CERT_PATH)
    }, app).listen(PORT, () => {
      console.log(`🔒 1717 Sports Arena backend (HTTPS) running at https://localhost:${PORT}`);
    });
  } else {
    http.createServer(app).listen(PORT, () => {
      console.log(`🚀 1717 Sports Arena backend running at http://localhost:${PORT}`);
    });
  }
}

startServer().catch(err => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
