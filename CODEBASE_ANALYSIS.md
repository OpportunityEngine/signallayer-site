# Revenue Radar / QuietSignal - Complete Codebase Analysis

**Generated:** January 21, 2026
**Production Site:** king-prawn-app-pc8hi.ondigitalocean.app
**Repository:** OpportunityEngine/signallayer-site

---

## Executive Summary

Revenue Radar (also known as QuietSignal / "King Prawn") is a **production-grade AI-powered sales intelligence platform** for invoice processing, email automation, cost savings detection, and revenue analytics. The application is built on Node.js/Express with SQLite and deployed on DigitalOcean App Platform.

### Current Status
- **23 tests passing** (all green)
- **~180+ API endpoints** across 18 route files
- **35+ dashboard pages** for different user roles
- **Email Autopilot** with Google/Microsoft OAuth
- **Invoice parsing** with vendor-specific AI (Cintas, Sysco, etc.)

### Known Production Issues
1. **DATABASE_PATH** - Fixed in code, but DigitalOcean disk needs provisioning
2. **Dashboard hardcoded values** - Fixed, awaiting deployment
3. **Public debug endpoints** - MUST REMOVE before production

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     REVENUE RADAR ARCHITECTURE                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │     │   Backend   │     │   Database  │
│  Dashboard  │────▶│  Express.js │────▶│   SQLite    │
│   (HTML/JS) │     │  Node.js    │     │   (WAL)     │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │             │
       ▼            ▼             ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Email      │  │  Invoice    │  │  Business   │
│  Autopilot  │  │  Parser V2  │  │  Intel      │
│  (IMAP/OAuth)│  │  (AI/OCR)   │  │  (Opps)     │
└─────────────┘  └─────────────┘  └─────────────┘
```

### Technology Stack
- **Runtime:** Node.js with Express 5.2.1
- **Database:** SQLite with better-sqlite3 (WAL mode)
- **Authentication:** JWT with refresh tokens
- **Email:** IMAP + OAuth 2.0 (Google, Microsoft)
- **PDF Processing:** pdf-parse + Tesseract OCR
- **Image Processing:** Sharp
- **Payments:** Stripe
- **Deployment:** DigitalOcean App Platform

---

## 2. Directory Structure

```
/ai-sales-backend (297MB)
├── server.js (4,569 lines) ─────────── Main Express server
├── database.js (2,802 lines) ──────── SQLite initialization
├── config.js ──────────────────────── Configuration management
│
├── Routes (15 files, ~14,500 lines)
│   ├── api-routes.js ──────────────── Main API endpoints
│   ├── auth-routes.js ─────────────── Authentication
│   ├── email-monitor-routes.js ────── Email monitor management
│   ├── email-oauth-routes.js ──────── OAuth callbacks
│   ├── business-intel-routes.js ───── Opportunities/inventory
│   ├── stripe-routes.js ───────────── Payment processing
│   ├── admin-analytics-routes.js ──── Admin dashboards
│   └── [8 more route files]
│
├── Services
│   ├── email-check-service.js ─────── Email processing (NEW)
│   ├── email-imap-service.js ──────── IMAP monitoring (LEGACY)
│   ├── email-oauth-service.js ─────── OAuth token refresh
│   ├── auth-service.js ────────────── JWT/password handling
│   ├── backup-service.js ──────────── Database backups
│   └── email-service.js ───────────── SMTP sending
│
├── Invoice Processing
│   ├── universal-invoice-processor.js ─ Entry point (any format)
│   ├── invoice-parser.js ──────────────── V1 parser (fallback)
│   └── services/invoice_parsing_v2/ ───── V2 parser (current)
│       ├── index.js ───────────────────── Main entry
│       ├── vendorDetector.js ──────────── Vendor identification
│       ├── genericParser.js ───────────── Fallback parser
│       ├── validator.js ───────────────── Confidence scoring
│       └── parsers/cintasParser.js ────── Cintas-specific
│
├── Business Logic
│   ├── opportunity-engine.js ──────── Opportunity detection
│   ├── reorder-engine.js ──────────── Smart inventory reorder
│   └── inventory-intelligence.js ──── Inventory tracking
│
├── Dashboard (35+ HTML files)
│   ├── login.html ─────────────────── Authentication
│   ├── my-invoices.html ───────────── User invoice history
│   ├── vp-view.html ───────────────── Business dashboard
│   ├── business-analytics.html ────── Analytics
│   ├── manager-view.html ──────────── Manager dashboard
│   ├── rep-view.html ──────────────── Sales rep dashboard
│   └── [30+ more pages]
│
├── Database Schemas (13 SQL files)
│   ├── database-schema.sql ────────── Core schema
│   ├── database-schema-email-autopilot.sql
│   ├── database-schema-business-intel.sql
│   └── [10 more schema files]
│
├── Tests
│   ├── test/email-invoice-flow.test.js (11 tests)
│   └── test/user-id-attribution.test.js (12 tests)
│
└── Scripts (17 utility scripts)
    ├── scripts/dev/check-db-state.js
    └── scripts/diagnose-invoice-visibility.js
```

---

## 3. Core Features

### 3.1 Email Invoice Autopilot
**Status:** Production-ready with verified insert flow

**Flow:**
1. User connects Gmail/Outlook via OAuth
2. System creates email_monitor with OAuth tokens
3. Every 5-15 minutes, checks for new emails
4. Extracts PDF/image attachments
5. Processes through invoice parser
6. Creates ingestion_run with VERIFIED user_id
7. Stores invoice_items with line item data
8. Updates monitor statistics

**Key Files:**
- `email-check-service.js` - New service with observability
- `email-oauth-service.js` - Token refresh
- `email-monitor-routes.js` - API endpoints

### 3.2 Invoice Parsing (V2)
**Status:** Production-ready with vendor-specific parsers

**Supported Formats:**
- PDF (digital and scanned)
- Images (JPG, PNG, HEIC, WebP)
- Phone photos (auto-rotate, deskew)

**Vendor Parsers:**
- Cintas (X##### SKUs, employee subtotals)
- Sysco, US Foods (food distributors)
- Generic fallback (any vendor)

**Confidence Scoring:**
- Extraction confidence (0-1): Is text readable?
- Parse confidence (0-100): Is math valid?
- Combined: 30% extraction + 70% parsing

### 3.3 Business Intelligence
**Status:** Fully implemented

**Features:**
- Opportunity detection (7 types)
- Cost savings tracking
- Inventory management
- Payroll & expense analytics
- Price alerts
- Vendor performance

**Opportunity Types:**
1. Price Increase Detection
2. Bulk Discount Opportunities
3. Vendor Consolidation
4. Contract Renewal Alerts
5. Historical Low Prices
6. Seasonal Buying
7. Waste Reduction

### 3.4 Authentication & Authorization
**Status:** Production-ready

**Roles:**
- `admin` - Full system access
- `manager` - Team management
- `customer_admin` - VP dashboard
- `rep` - Sales rep
- `viewer` - Read-only
- `demo_business`, `demo_viewer` - Demo accounts

---

## 4. Database Schema

### Core Tables
```sql
users (id, email, name, password_hash, role, is_trial, ...)
teams (id, name, manager_id)
ingestion_runs (id, run_id, user_id NOT NULL, vendor_name, status, ...)
invoice_items (id, run_id FK, description, quantity, total_cents, ...)
email_monitors (id, user_id NOT NULL, email_address, oauth_*, is_active, ...)
email_processing_log (id, monitor_id, email_uid, status, skip_reason, ...)
opportunities (id, account_name, opportunity_type, status, estimated_value_cents, ...)
```

### Critical Constraints
- `ingestion_runs.user_id` - NOT NULL (enforced by trigger)
- `email_monitors.user_id` - NOT NULL (enforced by trigger)
- These prevent "invisible invoice" bugs

---

## 5. API Endpoints Summary

| Category | Count | Key Endpoints |
|----------|-------|---------------|
| Auth | 17 | /auth/login, /auth/register, /auth/me |
| Email Monitors | 20 | /api/email-monitors, /api/email-oauth/* |
| Invoices | 10 | /api/uploads/recent, /ingest |
| Business Intel | 30+ | /api/bi/opportunities, /api/bi/inventory |
| Admin | 15 | /api/admin/*, /api/debug/* |
| Stripe | 5 | /stripe/checkout, /stripe/webhook |
| **Total** | **~180+** | |

---

## 6. Current Production Issues

### CRITICAL - Must Fix
| Issue | Status | Action Required |
|-------|--------|-----------------|
| Public debug endpoint | VULNERABILITY | Remove `/public-debug-invoice-status` |
| Hardcoded encryption key | SECURITY | Set EMAIL_ENCRYPTION_KEY env var |
| DigitalOcean disk not provisioned | DATA LOSS | Add disk in DO console |

### HIGH - Should Fix
| Issue | Status | Action Required |
|-------|--------|-----------------|
| Dashboard hardcoded values | FIXED IN CODE | Awaiting deployment |
| DATABASE_PATH confusion | FIXED IN CODE | Monitor for regression |
| Missing payment failure email | TODO | Add to stripe-routes.js |

### MEDIUM - Nice to Have
| Issue | Status | Action Required |
|-------|--------|-----------------|
| 9 backup files in repo | CLEANUP | Delete .bak files |
| Deleted agent files | UNSTAGED | Commit deletions |
| Verbose SQL logging | PERF | Disable in production |

---

## 7. Test Coverage

```
✓ 23 tests passing (0 failures)

test/email-invoice-flow.test.js (11 tests)
  ✓ Database Identity
  ✓ Email Monitor Creation
  ✓ Ingestion Run Insert Verification
  ✓ Counter Increment Logic
  ✓ Email Processing Log
  ✓ User Visibility

test/user-id-attribution.test.js (12 tests)
  ✓ Manual Upload Attribution
  ✓ Email Import Attribution
```

**Missing Test Coverage:**
- Invoice parsing accuracy
- Stripe webhook handling
- OAuth token refresh
- Rate limiting
- API error responses

---

## 8. Deployment Configuration

### DigitalOcean App Platform (.do/app.yaml)
```yaml
name: revenue-radar
region: nyc

services:
  - name: revenue-radar-api
    environment_slug: node-js
    instance_size_slug: basic-xxs
    http_port: 5050

    envs:
      - key: DATABASE_PATH
        value: /data/revenue-radar.db
      - key: NODE_ENV
        value: production

    disk:  # CRITICAL - Must be provisioned
      name: data
      size_gb: 1
      mount_path: /data
```

### Required Environment Variables
```bash
# Critical (must be set)
JWT_SECRET=<64-byte-hex>
DATABASE_PATH=/data/revenue-radar.db
EMAIL_ENCRYPTION_KEY=<32-byte-hex>

# OAuth (for email autopilot)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...

# Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 9. Key File Paths

### Entry Points
- `/server.js` - Main Express server
- `/database.js` - Database initialization

### Email System
- `/email-check-service.js` - Email processing (NEW)
- `/email-imap-service.js` - IMAP service (LEGACY)
- `/email-oauth-service.js` - OAuth tokens

### Invoice Parsing
- `/universal-invoice-processor.js` - Entry point
- `/services/invoice_parsing_v2/index.js` - V2 parser
- `/services/invoice_parsing_v2/parsers/cintasParser.js` - Cintas

### Dashboards
- `/dashboard/vp-view.html` - Business dashboard
- `/dashboard/my-invoices.html` - Invoice history
- `/dashboard/business-analytics.html` - Analytics

### Debug Scripts
- `/scripts/dev/check-db-state.js` - DB inspection
- `/scripts/diagnose-invoice-visibility.js` - Debug visibility

---

## 10. Recent Commits (Context)

```
96c7b91 Add debugging and fix ccAvgImpact update in loadMetrics
b8baf7e Fix persistent storage and dashboard data binding
1747648 Add verified insert flow and DB debugging infrastructure
180b848 Align utility scripts with DATABASE_PATH fix
0f75c40 Fix DATABASE_PATH env var mismatch - ROOT CAUSE
```

---

## Document History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-21 | Claude Opus 4.5 | Initial comprehensive analysis |

