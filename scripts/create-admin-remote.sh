#!/bin/bash

# =====================================================
# CREATE ADMIN USER ON PRODUCTION
# =====================================================
# Run this script from DigitalOcean console or SSH

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  👤 Create Admin User (Production)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if database exists
if [ ! -f "${DATABASE_PATH:-./revenue-radar.db}" ]; then
    echo "❌ Database not found at ${DATABASE_PATH:-./revenue-radar.db}"
    echo "   Make sure the app has started at least once"
    exit 1
fi

# Create admin user via Node.js
node - <<'EOF'
const Database = require('better-sqlite3');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function hashPassword(password) {
  const bcrypt = require('bcrypt');
  return await bcrypt.hash(password, 12);
}

async function createAdmin() {
  try {
    const dbPath = process.env.DATABASE_PATH || './revenue-radar.db';
    const db = new Database(dbPath);

    console.log('');
    const email = await question('Admin email: ');
    const password = await question('Admin password: ');
    const fullName = await question('Full name: ');
    const accountName = await question('Account name (default: "Admin Account"): ') || 'Admin Account';

    console.log('');
    console.log('Creating admin user...');

    // Check if email exists
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) {
      console.log('❌ User with this email already exists');
      process.exit(1);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert user
    const result = db.prepare(`
      INSERT INTO users (
        email, password_hash, full_name, role, account_name,
        is_active, is_email_verified, created_at, updated_at
      ) VALUES (?, ?, ?, 'admin', ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(email.toLowerCase(), passwordHash, fullName, accountName);

    console.log('');
    console.log('✅ Admin user created successfully!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Login Details');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`Email: ${email}`);
    console.log(`Role: admin`);
    console.log(`Account: ${accountName}`);
    console.log('');
    console.log('Login at: https://your-domain.com/dashboard/login.html');
    console.log('');

    db.close();
    rl.close();
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createAdmin();
EOF

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
