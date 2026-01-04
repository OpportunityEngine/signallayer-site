#!/usr/bin/env node

// =====================================================
// CREATE ADMIN USER SCRIPT
// =====================================================
// Interactive script to create an admin user
// Usage: node scripts/create-admin.js
// =====================================================

const readline = require('readline');
const bcrypt = require('bcryptjs');
const db = require('../database');
const config = require('../config');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function validatePassword(password) {
  // Min 8 chars, uppercase, lowercase, number, special char
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain number';
  if (!/[!@#$%^&*]/.test(password)) return 'Password must contain special character (!@#$%^&*)';
  return null;
}

async function createAdmin() {
  console.log('\n========================================');
  console.log('  CREATE ADMIN USER');
  console.log('========================================\n');

  try {
    // Get email
    let email;
    while (true) {
      email = await question('Email address: ');
      if (validateEmail(email)) {
        break;
      }
      console.log('❌ Invalid email format. Please try again.\n');
    }

    // Check if user exists
    const database = db.getDatabase();
    const existing = database.prepare('SELECT id FROM users WHERE email = ?').get(email);

    if (existing) {
      console.log('\n❌ User with this email already exists!');
      rl.close();
      return;
    }

    // Get full name
    const fullName = await question('Full Name: ');

    // Get password
    let password;
    while (true) {
      password = await question('Password (min 8 chars, uppercase, lowercase, number, special): ');
      const validationError = validatePassword(password);

      if (!validationError) {
        break;
      }
      console.log(`❌ ${validationError}\n`);
    }

    // Confirm password
    const confirmPassword = await question('Confirm Password: ');

    if (password !== confirmPassword) {
      console.log('\n❌ Passwords do not match!');
      rl.close();
      return;
    }

    // Get account name
    const accountName = await question('Account Name (or press Enter for "Default Account"): ') || 'Default Account';

    console.log('\n⏳ Creating admin user...');

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    // Insert user
    const result = database.prepare(`
      INSERT INTO users (email, name, password_hash, role, account_name, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, 1, datetime('now'), datetime('now'))
    `).run(email, fullName, passwordHash, accountName);

    console.log('\n✅ Admin user created successfully!');
    console.log('\n========================================');
    console.log('  USER DETAILS');
    console.log('========================================');
    console.log(`Email:        ${email}`);
    console.log(`Name:         ${fullName}`);
    console.log(`Role:         admin`);
    console.log(`Account:      ${accountName}`);
    console.log(`User ID:      ${result.lastInsertRowid}`);
    console.log('========================================\n');

    console.log('🔐 You can now login with these credentials.\n');

  } catch (error) {
    console.error('\n❌ Error creating admin user:', error.message);
  } finally {
    rl.close();
  }
}

// Run
createAdmin();
