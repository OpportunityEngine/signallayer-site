#!/usr/bin/env node

// =====================================================
// CREATE FOUNDER ACCOUNTS SCRIPT
// =====================================================
// Recreates the founder/admin accounts on production
// Usage: node scripts/create-founders.js
// =====================================================

const bcrypt = require('bcryptjs');
const db = require('../database');

const founders = [
  {
    email: 'admin@revenueradar.com',
    name: 'Admin',
    password: 'Admin123!',
    role: 'admin',
    accountName: 'System'
  },
  {
    email: 'taylor@revenueradar.com',
    name: 'Taylor',
    password: 'Taylor123!',
    role: 'admin',
    accountName: 'Revenue Radar'
  },
  {
    email: 'victorianj23@gmail.com',
    name: 'Victoria',
    password: 'Victoria123!',
    role: 'admin',
    accountName: 'Revenue Radar Admin'
  }
];

async function createFounders() {
  console.log('\n========================================');
  console.log('  CREATING FOUNDER ACCOUNTS');
  console.log('========================================\n');

  try {
    const database = db.getDatabase();

    for (const founder of founders) {
      // Check if user already exists
      const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(founder.email);

      if (existing) {
        // Update existing user
        const passwordHash = await bcrypt.hash(founder.password, 10);
        database.prepare(`
          UPDATE users
          SET password_hash = ?, name = ?, role = ?, account_name = ?, is_active = 1
          WHERE email = ?
        `).run(passwordHash, founder.name, founder.role, founder.accountName, founder.email);
        console.log(`✅ Updated: ${founder.email}`);
      } else {
        // Create new user
        const passwordHash = await bcrypt.hash(founder.password, 10);
        const result = database.prepare(`
          INSERT INTO users (email, name, password_hash, role, account_name, is_active, is_email_verified, created_at)
          VALUES (?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP)
        `).run(founder.email, founder.name, passwordHash, founder.role, founder.accountName);
        console.log(`✅ Created: ${founder.email} (ID: ${result.lastInsertRowid})`);
      }
    }

    console.log('\n========================================');
    console.log('  FOUNDER ACCOUNTS READY');
    console.log('========================================');
    console.log('\nCredentials:');
    founders.forEach(f => {
      console.log(`  ${f.email} / ${f.password}`);
    });
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

createFounders();
