const { Pool } = require('pg');

// Postgres connection. Set DATABASE_URL (e.g. Neon/Supabase) in backend/.env or Render env vars.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : undefined
});

// Convert SQLite-style '?' placeholders to Postgres '$1, $2, ...'
function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Postgres folds unquoted identifiers to lowercase, so column names like
// 'advanceAmount' come back as 'advanceamount'. Convert row keys back to
// the camelCase the rest of the app expects.
const KEY_MAP = {
  totalamount: 'totalAmount',
  advanceamount: 'advanceAmount',
  balanceamount: 'balanceAmount',
  balancestatus: 'balanceStatus',
  collectedcash: 'collectedCash',
  collectedonline: 'collectedOnline',
  createdat: 'createdAt',
  paymentid: 'paymentId',
  refundstatus: 'refundStatus',
  paymentmode: 'paymentMode',
  passwordhash: 'passwordHash',
  imagepath: 'imagePath'
};

function normalizeRow(row) {
  if (!row) return row;
  const out = {};
  for (const key of Object.keys(row)) out[KEY_MAP[key] || key] = row[key];
  return out;
}

async function get(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return normalizeRow(result.rows[0]);
}

async function all(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return result.rows.map(normalizeRow);
}

async function run(sql, params = []) {
  const result = await pool.query(toPostgres(sql), params);
  return { changes: result.rowCount, rows: result.rows.map(normalizeRow) };
}

// Create tables if they don't exist (runs on every server start).
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      sport TEXT NOT NULL,
      format TEXT NOT NULL,
      slots TEXT NOT NULL,          -- stored as JSON string, e.g. ["06:00 - 07:00","07:00 - 08:00"]
      totalAmount INTEGER NOT NULL,
      advanceAmount INTEGER NOT NULL,
      balanceAmount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending-payment',   -- pending-payment | advance-paid | cancelled | completed
      paymentMode TEXT NOT NULL DEFAULT 'online',       -- online (₹100/slot advance) | cash (full payment at turf)
      balanceStatus TEXT NOT NULL DEFAULT 'due',        -- due | collected
      createdAt TEXT NOT NULL,
      paymentId TEXT,
      refundStatus TEXT,
      deletedAt TEXT
    )
  `);

  // Existing databases created before paymentMode existed get the column added here.
  await pool.query(`
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paymentMode TEXT NOT NULL DEFAULT 'online'
  `);

  // Host recovery: soft-deleted bookings keep their row but are hidden by default.
  await pool.query(`
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deletedAt TEXT
  `);

  // How the host collected the balance at the turf (cash and/or online transfer).
  // Existing databases get these columns added here.
  await pool.query(`
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS collectedCash INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS collectedOnline INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS host_users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      imagePath TEXT,
      createdAt TEXT NOT NULL
    )
  `);

  // Slots the host has blocked for a date (host unavailability / other appointments).
  // slots is a JSON array of 24h labels, e.g. ["06:00 - 07:00","18:00 - 19:00"].
  // One row per date; an empty/missing row means the whole day is open.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      date TEXT PRIMARY KEY,
      slots TEXT NOT NULL
    )
  `);
}

module.exports = { pool, initSchema, get, all, run };
