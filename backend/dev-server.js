// DEV ONLY — lets the app run locally without installing PostgreSQL.
// Runs the real server.js against an embedded in-process Postgres (PGlite).
//   node dev-server.js
// Data is empty on every start and disappears when you stop it. It is NOT a
// substitute for a real database, and it must never be used in production.
// Real deployments use DATABASE_URL and ignore this file entirely.

const Module = require('module');
const path = require('path');

(async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const mem = await PGlite.create();
  const norm = r => ({ rows: r.rows, rowCount: r.affectedRows != null ? r.affectedRows : r.rows.length });

  // Substitute our in-memory Pool for the real `pg` Pool.
  const origRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'pg') {
      const real = origRequire.apply(this, arguments);
      class Pool {
        async query(sql, params) { return norm(await mem.query(sql, params)); }
        async connect() {
          return { query: async (s, p) => norm(await mem.query(s, p)), release() {} };
        }
      }
      return Object.assign({}, real, { Pool });
    }
    return origRequire.apply(this, arguments);
  };

  // JWT_SECRET is read before server.js runs, so set it here if the .env is missing.
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'local-dev-only-secret';

  console.log('🧪 DEV MODE: using an in-process, empty database. All data is discarded on exit.\n');
  require(path.join(__dirname, 'server.js'));
})();
