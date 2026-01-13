#!/usr/bin/env node

// =====================================================
// RESET PASSWORD SCRIPT
// =====================================================
// Quick script to reset a user's password
// Usage: node scripts/reset-password.js <email> <new-password>
// =====================================================

const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log('\nUsage: node scripts/reset-password.js <email> <new-password>');
    console.log('Example: node scripts/reset-password.js admin@example.com MyNewPass1!\n');
    process.exit(1);
  }

  try {
    const database = db.getDatabase();

    // Check if user exists
    const user = database.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);

    if (!user) {
      console.log(`\n❌ User not found: ${email}\n`);
      process.exit(1);
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);

    // Update password
    database.prepare(`
      UPDATE users
      SET password_hash = ?,
          failed_login_attempts = 0,
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE email = ?
    `).run(passwordHash, email);

    console.log('\n✅ Password reset successfully!');
    console.log(`   User: ${user.name} (${email})`);
    console.log(`   New password: ${newPassword}\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

resetPassword();
