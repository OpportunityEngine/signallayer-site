#!/usr/bin/env node

// =====================================================
// UNLOCK USER ACCOUNT SCRIPT
// =====================================================
// Unlocks a user account that has been locked due to
// too many failed login attempts
// =====================================================

const readline = require('readline');
const db = require('../database');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function unlockUser() {
  console.log('\n========================================');
  console.log('  UNLOCK USER ACCOUNT');
  console.log('========================================\n');

  try {
    const email = await question('Email address to unlock: ');

    const database = db.getDatabase();

    // Check if user exists
    const user = database.prepare('SELECT id, email, failed_login_attempts, locked_until FROM users WHERE email = ?').get(email);

    if (!user) {
      console.log('\n❌ User not found!');
      rl.close();
      return;
    }

    console.log('\nUser found:');
    console.log(`  Email: ${user.email}`);
    console.log(`  Failed attempts: ${user.failed_login_attempts}`);
    console.log(`  Locked until: ${user.locked_until || 'Not locked'}`);

    // Unlock the account
    database.prepare(`
      UPDATE users
      SET failed_login_attempts = 0,
          locked_until = NULL
      WHERE email = ?
    `).run(email);

    console.log('\n✅ Account unlocked successfully!');
    console.log('\nYou can now login with this email address.\n');

  } catch (error) {
    console.error('\n❌ Error unlocking user:', error.message);
  } finally {
    rl.close();
  }
}

// Run
unlockUser();
