const { Pool } = require('pg');

// Postgres connection. Set DATABASE_URL (e.g. Neon/Supabase) in backend/.env or Render env vars.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // Keep PostgreSQL connections low enough for a free/small database.
  max: 5,
  min: 0,

  // Close idle connections after 30 seconds.
  idleTimeoutMillis: 30000,

  // Don't wait indefinitely for a connection.
  connectionTimeoutMillis: 10000,

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

  // Archive of old, finished bookings. Same shape as `bookings`. Rows are moved
  // here (copy + delete) by archiveOldBookings() to keep the live table small.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS archive_bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      date TEXT NOT NULL,
      sport TEXT NOT NULL,
      format TEXT NOT NULL,
      slots TEXT NOT NULL,
      totalAmount INTEGER NOT NULL,
      advanceAmount INTEGER NOT NULL,
      balanceAmount INTEGER NOT NULL,
      status TEXT NOT NULL,
      paymentMode TEXT,
      balanceStatus TEXT,
      createdAt TEXT NOT NULL,
      paymentId TEXT,
      refundStatus TEXT,
      deletedAt TEXT,
      collectedCash INTEGER NOT NULL DEFAULT 0,
      collectedOnline INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Existing archive tables created before the collection columns existed get
  // them added here too, mirroring the ALTERs on the live bookings table.
  await pool.query(`
    ALTER TABLE archive_bookings ADD COLUMN IF NOT EXISTS paymentMode TEXT
  `);
  await pool.query(`
    ALTER TABLE archive_bookings ADD COLUMN IF NOT EXISTS balanceStatus TEXT
  `);
  await pool.query(`
    ALTER TABLE archive_bookings ADD COLUMN IF NOT EXISTS deletedAt TEXT
  `);
  await pool.query(`
    ALTER TABLE archive_bookings ADD COLUMN IF NOT EXISTS collectedCash INTEGER NOT NULL DEFAULT 0
  `);
  await pool.query(`
    ALTER TABLE archive_bookings ADD COLUMN IF NOT EXISTS collectedOnline INTEGER NOT NULL DEFAULT 0
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

// Move finished bookings (completed/cancelled) whose play date is at least
// `months` in the past out of the live `bookings` table into `archive_bookings`,
// preserving full history while keeping the live table small and fast. The move
// is wrapped in a transaction so a crash can never lose data halfway. Runs
// automatically on server start (see server.js).
async function archiveOldBookings(months = 3) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cy = cutoff.getFullYear();
  const cm = String(cutoff.getMonth() + 1).padStart(2, '0');
  const cd = String(cutoff.getDate()).padStart(2, '0');
  const cutoffDate = `${cy}-${cm}-${cd}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(toPostgres(`
      INSERT INTO archive_bookings (id, name, phone, date, sport, format, slots, totalAmount, advanceAmount, balanceAmount, status, paymentMode, balanceStatus, createdAt, paymentId, refundStatus, deletedAt, collectedCash, collectedOnline)
      SELECT id, name, phone, date, sport, format, slots, totalAmount, advanceAmount, balanceAmount, status, paymentMode, balanceStatus, createdAt, paymentId, refundStatus, deletedAt, collectedCash, collectedOnline
      FROM bookings
      WHERE status IN ('completed', 'cancelled') AND date < $1
    `), [cutoffDate]);
    const result = await client.query(toPostgres(`
      DELETE FROM bookings
      WHERE status IN ('completed', 'cancelled') AND date < $1
    `), [cutoffDate]);
    await client.query('COMMIT');
    const count = result.rowCount || 0;
    if (count > 0) {
      console.log(`🗄️ Archived ${count} old booking(s) (completed/cancelled, play date before ${cutoffDate}).`);
    }
    return count;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initSchema, get, all, run, archiveOldBookings };
