const bcrypt = require('bcryptjs');
const db = require('./db');
const readline = require('readline');

// Reads the admin username/password from environment variables if set,
// otherwise prompts interactively. No default passwords are stored in code.

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function envOrPrompt(envKey, promptText) {
  return process.env[envKey] || ask(promptText);
}

(async () => {
  const username = (await envOrPrompt('ADMIN_USERNAME', 'Admin username: ')).trim();
  if (!username) {
    console.error('❌ Username cannot be empty.');
    rl.close();
    process.exit(1);
  }

  let password = await envOrPrompt('ADMIN_PASSWORD', 'Admin password (min 8 chars): ');
  if (password.length < 8) {
    console.error('❌ Password must be at least 8 characters.');
    rl.close();
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    await db.initSchema();
    await db.run('INSERT INTO host_users (username, passwordHash) VALUES (?, ?)', [username, passwordHash]);
    console.log('✅ Host user created successfully:', username);
  } catch (err) {
    if (String(err.message).includes('unique') && String(err.message).includes('host_users')) {
      console.log('⚠️ Host user already exists. No changes made.');
    } else {
      console.error('Error creating host user:', err.message);
    }
  }
  rl.close();
})();
