// Quick diagnostic script to test database connection
require('dotenv').config();
const { Pool } = require('pg');

console.log('🔍 Testing Neon Database Connection...\n');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? '✓ Set' : '✗ Missing');
console.log('Node version:', process.version);
console.log('');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function testConnection() {
  try {
    console.log('Attempting to connect to Neon database...');
    const client = await pool.connect();
    console.log('✅ Successfully connected to Neon database!');

    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('\n📊 Database Info:');
    console.log('  Time:', result.rows[0].current_time);
    console.log('  PostgreSQL:', result.rows[0].pg_version.split(',')[0]);

    client.release();
    await pool.end();

    console.log('\n✅ Connection test successful! Your Neon database is working correctly.');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Connection failed!');
    console.error('Error:', error.message);
    console.error('\nCommon fixes:');
    console.error('1. Check your DATABASE_URL in .env file');
    console.error('2. Verify your Neon database is active');
    console.error('3. Check internet connection');
    console.error('4. Ensure SSL settings are correct');
    process.exit(1);
  }
}

testConnection();
