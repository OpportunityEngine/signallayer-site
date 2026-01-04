#!/usr/bin/env node

// =====================================================
// GENERATE JWT SECRET SCRIPT
// =====================================================
// Generates a cryptographically secure JWT secret
// Usage: node scripts/generate-jwt-secret.js
// =====================================================

const crypto = require('crypto');

console.log('\n========================================');
console.log('  JWT SECRET GENERATOR');
console.log('========================================\n');

const secret = crypto.randomBytes(64).toString('hex');

console.log('Generated JWT Secret:\n');
console.log(secret);
console.log('\n⚠️  IMPORTANT: Keep this secret secure!');
console.log('Copy this to your .env file:\n');
console.log(`JWT_SECRET=${secret}\n`);
console.log('========================================\n');
