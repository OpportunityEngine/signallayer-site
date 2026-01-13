#!/usr/bin/env node

// =====================================================
// RESET ADMIN PASSWORD SCRIPT
// =====================================================
// Script to reset password for existing admin users
// Usage: node scripts/reset-admin-password.js <email> <new-password>
// =====================================================

const bcrypt = require('bcryptjs');
const db = require('../database');

async function resetPassword() {
  const email = process.argv[2];
  const newPassword = process.argv[3];

  if (!email || !newPassword) {
    console.log('Usage: node scripts/reset-admin-password.js <email> <new-password>');
    console.log('Example: node scripts/reset-admin-password.js admin@example.com NewPassword123!');
    process.exit(1);
  }

  try {
    const database = db.getDatabase();

    // Check if user exists
    const user = database.prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?').get(email);

    if (!user) {
      console.log(`\n❌ User not found: ${email}`);
      console.log('\nExisting users:');
      const users = database.prepare('SELECT email, name, role FROM users').all();
      users.forEach(u => console.log(`  - ${u.email} (${u.role})`));
      process.exit(1);
    }

    console.log(`\n📧 Found user: ${user.name} (${user.email})`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Has password_hash: ${user.password_hash ? 'Yes (' + user.password_hash.substring(0, 20) + '...)' : 'NO - THIS IS THE PROBLEM!'}`);

    // Hash new password
    console.log('\n⏳ Hashing new password...');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Update password
    database.prepare(`
      UPDATE users
      SET password_hash = ?,
          password_changed_at = CURRENT_TIMESTAMP,
          failed_login_attempts = 0,
          locked_until = NULL
      WHERE email = ?
    `).run(passwordHash, email);

    console.log(`\n✅ Password reset successfully for ${email}`);
    console.log(`   New password: ${newPassword}`);
    console.log('\n🔐 You can now login with the new credentials.\n');

  } catch (error) {
    console.error('\n❌ Error resetting password:', error.message);
    process.exit(1);
  }
}

resetPassword();
