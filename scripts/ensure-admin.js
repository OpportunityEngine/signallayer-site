#!/usr/bin/env node

// =====================================================
// ENSURE ADMIN USER EXISTS
// =====================================================
// Creates default admin user if no users exist
// Runs automatically on server startup
// =====================================================

const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');

async function ensureAdmin() {
  try {
    const database = db.getDatabase();

    // Check if any users exist
    const userCount = database.prepare('SELECT COUNT(*) as count FROM users').get();

    if (userCount.count > 0) {
      console.log('✅ Users already exist, skipping admin creation');
      return;
    }

    console.log('📝 No users found, creating default admin user...');

    // Default admin credentials
    const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@revenueradar.com';
    const password = process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMe123!';
    const name = 'Admin';
    const accountName = 'System';

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    // Create admin user
    database.prepare(`
      INSERT INTO users (email, name, password_hash, role, account_name, is_active, is_email_verified, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, 1, 1, datetime('now'), datetime('now'))
    `).run(email, name, passwordHash, accountName);

    console.log('✅ Default admin user created!');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   ⚠️  CHANGE PASSWORD IMMEDIATELY AFTER FIRST LOGIN!');

  } catch (error) {
    console.error('❌ Error ensuring admin user:', error.message);
  }
}

// Run if called directly
if (require.main === module) {
  ensureAdmin();
}

module.exports = ensureAdmin;
