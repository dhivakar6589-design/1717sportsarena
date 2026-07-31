const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// By default the database lives in backend/. On platforms with a persistent disk
// (Render/Railway), set DATA_DIR so the DB survives redeploys.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// This creates (or opens if it already exists) a file called turf.db
// That single file IS your entire database — bookings, reviews, host account, everything.
const db = new Database(path.join(DATA_DIR, 'turf.db'));

// Improves performance and safety for concurrent reads/writes
db.pragma('journal_mode = WAL');

// ---- Create tables (only runs if they don't already exist) ----

db.exec(`
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
    balanceStatus TEXT NOT NULL DEFAULT 'due',        -- due | collected
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS host_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS news_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    imagePath TEXT,
    createdAt TEXT NOT NULL
  )
`);

// Migrations for columns added later (safe to run on every start)
try { db.exec(`ALTER TABLE bookings ADD COLUMN paymentId TEXT`); } catch (e) {}
try { db.exec(`ALTER TABLE bookings ADD COLUMN refundStatus TEXT`); } catch (e) {}

module.exports = db;
