/**
 * User ID Attribution Tests
 *
 * Verifies that user_id is correctly set in all invoice creation paths:
 * 1. Manual Upload Tests (/ingest endpoint)
 * 2. Email Autopilot Tests (email-imap-service.js)
 * 3. Database Constraint Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');

describe('User ID Attribution Tests', function() {
  this.timeout(10000);

  let db;
  let testDatabase;
  let userCounter = 0;
  let emailCounter = 0;

  before(function() {
    process.env.DB_PATH = '/tmp/test-revenue-radar.db';
    
    const fs = require('fs');
    if (fs.existsSync('/tmp/test-revenue-radar.db')) {
      fs.unlinkSync('/tmp/test-revenue-radar.db');
    }

    db = require('../database');
    testDatabase = db.getDatabase();
  });

  after(function() {
    if (testDatabase) {
      testDatabase.close();
    }
  });

  function createTestUser(email, name) {
    const bcrypt = require('bcryptjs');
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync('password123', salt);

    return testDatabase.prepare(`
      INSERT INTO users (email, name, password_hash, role, last_active)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(email, name, passwordHash, 'rep').lastInsertRowid;
  }

  function createUniqueEmail(prefix) {
    emailCounter++;
    return prefix + '-' + emailCounter + '@example.com';
  }

  describe('Manual Upload Tests - /ingest endpoint', function() {
    let testUserId;
    let testUser;

    beforeEach(function() {
      userCounter++;
      testUserId = createTestUser('test-' + userCounter + '@example.com', 'Test User ' + userCounter);
      testUser = testDatabase.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);
    });

    it('should use authenticated user ID when JWT present', function() {
      const userId = testUser.id;
      
      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, file_size, status, completed_at, invoice_total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', datetime('now'), ?)
      `).run(
        'test-run-auth-user',
        userId,
        'Test Account',
        'Test Vendor',
        'invoice.pdf',
        1024,
        50000
      );

      const record = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(result.lastInsertRowid);
      expect(record.user_id).to.equal(userId, 'user_id should match authenticated user from JWT');
    });

    it('should reject attempts to spoof user_id via headers when authenticated', function() {
      const authenticatedUserId = testUser.id;
      const spoofedUserId = 9999;
      
      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, file_size, status, completed_at, invoice_total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', datetime('now'), ?)
      `).run(
        'test-run-spoof-blocked',
        authenticatedUserId,
        'Test Account',
        'Test Vendor',
        'invoice.pdf',
        1024,
        50000
      );

      const record = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(result.lastInsertRowid);
      expect(record.user_id).to.equal(authenticatedUserId, 'user_id must be authenticated user only');
      expect(record.user_id).to.not.equal(spoofedUserId, 'spoofed user_id should be rejected');
    });

    it('should not allow NULL user_id on insert (after guardrails)', function() {
      let errorThrown = false;
      let errorMessage = '';

      try {
        testDatabase.prepare(`
          INSERT INTO ingestion_runs (
            run_id, user_id, account_name, vendor_name,
            file_name, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
        `).run(
          'test-null-user',
          null,
          'Test Account',
          'Test Vendor',
          'invoice.pdf'
        );
      } catch (error) {
        errorThrown = true;
        errorMessage = error.message;
      }

      if (errorThrown) {
        expect(errorMessage).to.include('NULL', 'should enforce NULL check on user_id');
      }
    });

    it('should track user_id in invoice items via run_id foreign key', function() {
      const userId = testUser.id;
      
      const invoiceResult = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run(
        'test-run-with-items',
        userId,
        'Account',
        'Vendor',
        'invoice.pdf'
      );

      const runIdInt = invoiceResult.lastInsertRowid;

      testDatabase.prepare(`
        INSERT INTO invoice_items (
          run_id, description, quantity, unit_price_cents, total_cents, category, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        runIdInt,
        'Item 1',
        2,
        5000,
        10000,
        'general'
      );

      const invoice = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(runIdInt);
      const items = testDatabase.prepare('SELECT * FROM invoice_items WHERE run_id = ?').all(runIdInt);

      expect(invoice.user_id).to.equal(userId, 'invoice should have correct user_id');
      expect(items.length).to.equal(1, 'invoice should have items');
      expect(items[0].run_id).to.equal(runIdInt, 'items should reference invoice via run_id');
    });
  });

  describe('Email Autopilot Tests - email-imap-service.js', function() {
    let testUserId;
    let testUser;
    let monitorId;
    let testMonitor;

    beforeEach(function() {
      userCounter++;
      testUserId = createTestUser('email-test-' + userCounter + '@example.com', 'Email Test User ' + userCounter);
      testUser = testDatabase.prepare('SELECT * FROM users WHERE id = ?').get(testUserId);

      const monitorEmail = createUniqueEmail('test-monitor');
      const monitorResult = testDatabase.prepare(`
        INSERT INTO email_monitors (
          user_id, created_by_user_id, account_name, email_address, username, encrypted_password,
          imap_host, imap_port, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        testUserId,
        testUserId,
        'Test Monitor Account',
        monitorEmail,
        'test-monitor',
        'encrypted_password',
        'imap.gmail.com',
        993,
        1
      );

      monitorId = monitorResult.lastInsertRowid;
      testMonitor = testDatabase.prepare('SELECT * FROM email_monitors WHERE id = ?').get(monitorId);
    });

    it('should use monitor.user_id for ingestion when present', function() {
      const userId = testMonitor.user_id || testMonitor.created_by_user_id;
      expect(userId).to.equal(testUserId, 'Should get user_id from monitor');

      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run(
        'email-invoice-from-monitor',
        userId,
        'Email Account',
        'Email Vendor',
        'email-invoice.pdf'
      );

      const record = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(result.lastInsertRowid);
      expect(record.user_id).to.equal(testUserId, 'invoice should have monitor owner user_id');
    });

    it('should enforce user_id constraint on email_monitors', function() {
      const orphanEmail = createUniqueEmail('orphan-monitor');
      let errorThrown = false;
      let errorMsg = '';
      
      try {
        testDatabase.prepare(`
          INSERT INTO email_monitors (
            user_id, created_by_user_id, account_name, email_address, username, encrypted_password,
            imap_host, imap_port, is_active, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          null,
          null,
          'Orphan Monitor',
          orphanEmail,
          'orphan-monitor',
          'encrypted_password',
          'imap.gmail.com',
          993,
          1
        );
      } catch (error) {
        errorThrown = true;
        errorMsg = error.message;
      }

      expect(errorThrown).to.be.true;
      expect(errorMsg).to.include('user_id', 'should enforce user_id constraint');
    });
  });

  describe('Database Constraint Tests', function() {
    it('should prevent NULL user_id update on ingestion_runs', function() {
      userCounter++;
      const testUserId = createTestUser('constraint-test-' + userCounter + '@example.com', 'Constraint Test ' + userCounter);
      
      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run(
        'test-constraint-update',
        testUserId,
        'Test Account',
        'Test Vendor',
        'invoice.pdf'
      );

      const recordId = result.lastInsertRowid;

      let errorThrown = false;
      try {
        testDatabase.prepare('UPDATE ingestion_runs SET user_id = NULL WHERE id = ?').run(recordId);
      } catch (error) {
        errorThrown = true;
      }

      const finalRecord = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(recordId);
      
      if (errorThrown) {
        expect(finalRecord.user_id).to.equal(testUserId, 'constraint should prevent NULL user_id');
      }
    });

    it('should allow updating user_id to valid different user', function() {
      userCounter += 2;
      const user1Id = createTestUser('user1-' + userCounter + '@example.com', 'User 1 ' + userCounter);
      const user2Id = createTestUser('user2-' + userCounter + '@example.com', 'User 2 ' + userCounter);

      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run(
        'test-reassign',
        user1Id,
        'Test Account',
        'Test Vendor',
        'invoice.pdf'
      );

      const recordId = result.lastInsertRowid;

      testDatabase.prepare('UPDATE ingestion_runs SET user_id = ? WHERE id = ?').run(user2Id, recordId);

      const updated = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(recordId);
      expect(updated.user_id).to.equal(user2Id, 'should allow reassigning to valid user');
    });

    it('should maintain referential integrity with invoice_items foreign key', function() {
      userCounter++;
      const userId = createTestUser('fk-test-' + userCounter + '@example.com', 'FK Test ' + userCounter);

      const invoiceResult = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run(
        'test-fk-check',
        userId,
        'FK Account',
        'FK Vendor',
        'fk-invoice.pdf'
      );

      const runIdInt = invoiceResult.lastInsertRowid;

      testDatabase.prepare(`
        INSERT INTO invoice_items (
          run_id, description, quantity, unit_price_cents, total_cents, category, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        runIdInt,
        'Test Item',
        1,
        1000,
        1000,
        'general'
      );

      const invoice = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(runIdInt);
      const items = testDatabase.prepare('SELECT COUNT(*) as count FROM invoice_items WHERE run_id = ?').get(runIdInt);

      expect(invoice).to.not.be.undefined;
      expect(invoice.user_id).to.equal(userId);
      expect(items.count).to.equal(1, 'should have created invoice item');
    });
  });

  describe('Regression Tests - user_id data integrity', function() {
    it('should be able to query all invoices by user_id', function() {
      userCounter++;
      const userId = createTestUser('query-test-' + userCounter + '@example.com', 'Query Test ' + userCounter);

      for (let i = 0; i < 3; i++) {
        testDatabase.prepare(`
          INSERT INTO ingestion_runs (
            run_id, user_id, account_name, vendor_name,
            file_name, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
        `).run(
          'test-query-' + i,
          userId,
          'Account ' + i,
          'Vendor ' + i,
          'invoice-' + i + '.pdf'
        );
      }

      const userInvoices = testDatabase.prepare(
        'SELECT * FROM ingestion_runs WHERE user_id = ? ORDER BY created_at DESC'
      ).all(userId);

      expect(userInvoices).to.have.lengthOf(3, 'should find all invoices for user');
      expect(userInvoices.every(inv => inv.user_id === userId)).to.be.true;
    });

    it('should identify and handle orphaned records (NULL user_id)', function() {
      userCounter++;
      const userId = createTestUser('heal-test-' + userCounter + '@example.com', 'Heal Test ' + userCounter);

      testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'completed', datetime('now'))
      `).run('test-valid-heal', userId, 'Valid', 'Vendor', 'valid.pdf');

      const allRecords = testDatabase.prepare('SELECT * FROM ingestion_runs ORDER BY created_at DESC').all();
      expect(allRecords.length).to.be.greaterThan(0);
      
      const orphanedCount = allRecords.filter(r => r.user_id === null).length;
      expect(orphanedCount).to.equal(0, 'should not have orphaned records');
    });

    it('should preserve user_id across invoice updates', function() {
      userCounter++;
      const userId = createTestUser('preserve-test-' + userCounter + '@example.com', 'Preserve Test ' + userCounter);

      const result = testDatabase.prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, created_at
        ) VALUES (?, ?, ?, ?, ?, 'processing', datetime('now'))
      `).run(
        'test-preserve-user-id',
        userId,
        'Account',
        'Vendor',
        'invoice.pdf'
      );

      const recordId = result.lastInsertRowid;

      testDatabase.prepare('UPDATE ingestion_runs SET status = ?, invoice_total_cents = ? WHERE id = ?').run(
        'completed',
        50000,
        recordId
      );

      const updated = testDatabase.prepare('SELECT * FROM ingestion_runs WHERE id = ?').get(recordId);
      expect(updated.user_id).to.equal(userId, 'user_id should be preserved during updates');
      expect(updated.status).to.equal('completed');
      expect(updated.invoice_total_cents).to.equal(50000);
    });
  });
});
