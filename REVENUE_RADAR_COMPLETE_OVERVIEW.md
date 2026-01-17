# Revenue Radar - Complete Software Project Overview

> **Copy this entire document into ChatGPT to give it full context on Revenue Radar's complete codebase, architecture, and capabilities.**

---

## Executive Summary

**Revenue Radar** is a full-stack B2B SaaS platform designed for small-to-medium businesses (restaurants, retail, local shops) to analyze invoices, track inventory, detect cost savings opportunities, and manage business operations. The platform uses AI (Anthropic Claude) for invoice OCR and intelligent analysis.

**Primary Value Proposition:**
- Automatically detect cost savings opportunities from invoice data
- Smart inventory management with predictive stockout alerts
- AI-powered invoice OCR and analysis
- Real-time financial analytics and payroll tracking
- Email autopilot for automatic invoice capture

**Target Market:**
- Restaurants and food service
- Retail and distribution
- Local businesses with vendors
- Any business processing invoices regularly

---

## Tech Stack

### Backend
| Component | Technology |
|-----------|------------|
| Runtime | Node.js + Express.js |
| Database | SQLite with better-sqlite3 (WAL mode) |
| Authentication | JWT tokens + bcryptjs password hashing |
| AI Integration | Anthropic Claude API |
| Email Sending | Nodemailer (SMTP) + Resend API |
| File Parsing | SheetJS (xlsx), pdf.js |
| Encryption | CryptoJS (for IMAP passwords) |
| IMAP | node-imap + mailparser |

### Frontend
| Component | Technology |
|-----------|------------|
| Framework | Vanilla HTML/CSS/JavaScript (no framework) |
| Styling | Custom dark theme with gold accents (#d4af37) |
| Charts | Chart.js for financial visualizations |
| Design | Premium Apple/Rolex aesthetic |

### Deployment
| Component | Technology |
|-----------|------------|
| Platform | DigitalOcean App Platform |
| CI/CD | GitHub auto-deploy on push to main |
| Domain | app.revenueradar.io (production) |
| Database | Persistent SQLite on attached volume |

---

## Project File Structure

```
ai-sales-backend/
├── # Main Application
├── server.js                        # Express server entry point (~148KB)
├── config.js                        # Environment configuration
│
├── # Database
├── database.js                      # SQLite init & query functions (~72KB)
├── database-schema.sql              # Core tables (~460 lines)
├── database-schema-business-intel.sql  # Business analytics tables (~466 lines)
├── database-schema-email-autopilot.sql # Email monitoring tables
│
├── # Authentication System
├── auth-routes.js                   # Login, register, password reset (~16KB)
├── auth-middleware.js               # JWT validation, RBAC, rate limiting (~16KB)
├── auth-service.js                  # Token generation, sessions (~22KB)
├── trial-middleware.js              # 30-day/20-invoice trial enforcement (~7KB)
├── signup-routes.js                 # Self-signup & admin approval (~36KB)
│
├── # Business Intelligence
├── business-intel-routes.js         # Opportunities, inventory, payroll APIs (~57KB)
├── opportunity-engine.js            # Cost savings detection (~27KB)
├── reorder-engine.js                # Inventory reorder recommendations (~24KB)
├── inventory-intelligence.js        # Inventory health scoring (~25KB)
│
├── # Email Services
├── email-service.js                 # SMTP/Resend sending + templates (~47KB)
├── email-imap-service.js            # IMAP inbox monitoring (~24KB)
├── email-monitor-routes.js          # Email autopilot configuration (~20KB)
├── email-monitor-service.js         # Background email processing (~14KB)
├── imap-config-detector.js          # Auto-detect email provider settings (~10KB)
│
├── # Core API Routes
├── api-routes.js                    # Invoice OCR, MLAs, opportunities (~48KB)
├── api-key-routes.js                # API key management (~11KB)
├── admin-analytics-routes.js        # Admin dashboard analytics (~20KB)
├── stripe-routes.js                 # Stripe subscription webhooks (~17KB)
├── health-routes.js                 # System health monitoring (~12KB)
├── backup-routes.js                 # Database backup endpoints (~3KB)
├── backup-service.js                # Automated backup logic (~11KB)
├── error-handler.js                 # Global error handling (~17KB)
│
├── # Dashboard HTML Pages
├── dashboard/
│   ├── login.html                   # Login page
│   ├── request-access.html          # Admin approval signup form
│   ├── signup.html                  # Self-service trial signup
│   ├── index.html                   # Dashboard entry point
│   ├── rep-view.html                # Sales rep dashboard
│   ├── manager-view.html            # Manager dashboard
│   ├── vp-view.html                 # VP/Business owner dashboard (main)
│   ├── admin-ops.html               # System admin operations
│   ├── inventory.html               # Inventory management
│   ├── business-analytics.html      # Financial analytics
│   ├── upload-invoice.html          # Invoice upload/OCR
│   ├── upload-mla.html              # MLA contract upload
│   ├── connect-email.html           # Email inbox connection
│   ├── onboarding.html              # New user onboarding
│   ├── billing.html                 # Subscription management
│   ├── pricing.html                 # Pricing page
│   ├── user-management.html         # Admin user management
│   └── debug-auth.html              # Auth debugging (dev only)
│
├── # Utility Scripts
├── scripts/
│   ├── create-admin.js              # Create admin user
│   ├── reset-password.js            # Reset user password
│   └── seed-demo-users.js           # Seed demo accounts
│
└── .env                             # Environment variables (not committed)
```

---

## Database Schema

### Core User Tables

```sql
-- Users with role-based access
users (
  id, email, name, password_hash,
  role: 'rep'|'manager'|'admin'|'viewer'|'customer_admin'|'demo_business'|'demo_viewer',
  account_name, team_id,
  is_trial, trial_started_at, trial_expires_at,
  trial_invoices_used, trial_invoices_limit (20),
  subscription_status: 'trial'|'active'|'expired'|'cancelled'
)

-- Active sessions with JWT tracking
sessions (
  user_id, token_jti, refresh_token_hash,
  ip_address, user_agent, is_active,
  expires_at, refresh_expires_at
)

-- Admin approval queue for access requests
signup_requests (
  email, name, company_name, requested_role,
  reason, linkedin_url, password_hash,
  status: 'pending'|'approved'|'denied',
  approval_token, denial_token,
  reviewed_by, reviewed_at
)
```

### Invoice & OCR Tables

```sql
-- Invoice processing jobs
ingestion_runs (
  run_id (UUID), user_id, account_name, vendor_name,
  file_name, file_size, status, error_message
)

-- Extracted line items from invoices
invoice_items (
  run_id, description, quantity,
  unit_price_cents, total_cents, category
)
```

### MLA (Master Lease Agreement) Tables

```sql
-- Customer contracts
mla_contracts (
  contract_number, account_name, vendor_name,
  effective_date, end_date, status
)

-- Contract-approved pricing
mla_products (
  mla_id, sku, description, price_cents,
  uom, min_qty, max_qty, approved
)
```

### Opportunity Detection Tables

```sql
-- AI-detected cost savings opportunities
detected_opportunities (
  opportunity_type: 'price_increase'|'bulk_discount'|'vendor_consolidation'|
                   'contract_renewal'|'seasonal_buying'|'waste_reduction'|
                   'payment_terms'|'competitive_pricing'|'rebate_eligible',
  impact_type: 'cost_savings'|'revenue'|'efficiency'|'risk_mitigation',
  estimated_value_cents, confidence_score (0-100), urgency,
  status: 'new'|'viewed'|'in_progress'|'won'|'lost'|'expired',
  vendor_name, sku, supporting_data (JSON), action_items (JSON)
)

-- Custom detection rules
opportunity_rules (
  account_name, industry, name, description,
  triggers (SKUs), conditions, actions,
  times_fired, opportunities_created, revenue_generated_cents
)
```

### Inventory Management Tables

```sql
-- Product inventory
inventory_items (
  user_id, sku, product_name, category,
  current_quantity, min_quantity, max_quantity, par_level,
  avg_unit_cost_cents, vendor_name, lead_time_days
)

-- Daily consumption tracking
inventory_usage (
  inventory_item_id, date, daily_usage,
  quantity_received, quantity_wasted
)

-- Smart reorder suggestions
reorder_recommendations (
  recommendation_type: 'urgent_reorder'|'discount_opportunity'|'holiday_prep'|
                      'bulk_opportunity'|'overstock_warning'|'usage_spike'|'usage_drop',
  priority: 'critical'|'high'|'medium'|'low',
  suggested_quantity, potential_savings_cents, reasoning (JSON)
)
```

### Financial Tables

```sql
-- Payroll periods
payroll_entries (
  period_start, period_end,
  gross_payroll_cents, employer_taxes_cents, benefits_cents,
  total_labor_cost_cents, employee_count, hours_worked
)

-- Operating expenses by category
expense_entries (
  category: 'cogs'|'inventory'|'utilities'|'rent'|'insurance'|
           'marketing'|'equipment'|'supplies'|'professional'|'technology',
  amount_cents, vendor_name, is_recurring
)

-- Realized cost savings
cost_savings (
  savings_type: 'negotiated_price'|'bulk_purchase'|'vendor_switch'|
               'contract_renegotiation'|'waste_reduction'|'process_optimization',
  original_cost_cents, new_cost_cents, savings_cents,
  annualized_savings_cents, realized_date
)
```

### Email Autopilot Tables

```sql
-- IMAP inbox monitors
email_monitors (
  email_address, imap_host, imap_port,
  encrypted_password, check_interval_minutes,
  enable_cost_savings_detection, enable_duplicate_detection,
  total_invoices_found, total_savings_detected_cents
)

-- Processed email queue
email_invoice_queue (
  monitor_id, email_uid, sender_email, subject,
  status: 'pending'|'processing'|'completed'|'skipped'|'error',
  opportunities_detected, savings_detected_cents
)
```

### Subscription Tables

```sql
-- Stripe subscriptions
subscriptions (
  user_id, stripe_customer_id, stripe_subscription_id,
  plan_id, plan_name, status, amount_cents, interval
)

-- Payment history
payment_history (
  stripe_payment_intent_id, amount_cents, status,
  receipt_url, failure_reason
)
```

---

## API Endpoints Reference

### Authentication (`/auth/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/login` | POST | Public | Login, returns JWT tokens |
| `/auth/logout` | POST | Auth | Logout, invalidate session |
| `/auth/refresh` | POST | Public | Refresh access token |
| `/auth/me` | GET | Auth | Get current user profile |
| `/auth/change-password` | POST | Auth | Change password |
| `/auth/forgot-password` | POST | Public | Request password reset email |
| `/auth/reset-password` | POST | Public | Reset password with token |
| `/auth/verify-email` | GET | Public | Verify email with token |
| `/auth/sessions` | GET | Auth | List active sessions |
| `/auth/sessions/:id` | DELETE | Auth | Revoke specific session |
| `/auth/trial-status` | GET | Auth | Get trial usage stats |

### Signup & Access Requests (`/signup/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/signup/register` | POST | Public | Self-service trial signup |
| `/signup/request-access` | POST | Public | Submit admin approval request |
| `/signup/request-status/:email` | GET | Public | Check request status |
| `/signup/approve/:token` | GET | Token | One-click email approval |
| `/signup/deny/:token` | GET | Token | One-click email denial |

### Admin Signup Management (`/api/signup-requests/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/signup-requests` | GET | Admin | List all requests |
| `/api/signup-requests/:id` | GET | Admin | Get request details |
| `/api/signup-requests/:id/approve` | POST | Admin | Approve from dashboard |
| `/api/signup-requests/:id/deny` | POST | Admin | Deny from dashboard |

### Invoice Processing (`/api/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/analyze-invoice` | POST | Auth | Upload & OCR invoice with Claude AI |
| `/api/ingestion-runs` | GET | Auth | List processed invoices |
| `/api/ingestion-runs/:id` | GET | Auth | Get invoice details with line items |
| `/api/flagged-issues` | GET | Auth | Get detected issues from invoices |
| `/api/flagged-issues/:id/resolve` | POST | Auth | Mark issue as resolved |

### Business Intelligence (`/api/bi/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/bi/opportunities` | GET | Auth | List detected opportunities |
| `/api/bi/opportunities/summary` | GET | Auth | Opportunity stats |
| `/api/bi/opportunities/analyze` | POST | Auth | Run opportunity detection |
| `/api/bi/opportunities/:id` | PATCH | Auth | Update opportunity status |
| `/api/bi/savings` | GET | Auth | List cost savings records |
| `/api/bi/savings/summary` | GET | Auth | Savings summary by type |
| `/api/bi/savings` | POST | Auth | Record manual cost savings |
| `/api/bi/contacts` | GET | Auth | List extracted contacts |
| `/api/bi/contacts/extract` | POST | Auth | Extract contacts from text |
| `/api/bi/inventory` | GET | Auth | List inventory items |
| `/api/bi/inventory/upload` | POST | Auth | Bulk upload from Excel |
| `/api/bi/inventory/recommendations` | GET | Auth | Get reorder suggestions |
| `/api/bi/inventory/recommendations/generate` | POST | Auth | Generate fresh recommendations |
| `/api/bi/inventory/recommendations/summary` | GET | Auth | Recommendation summary |
| `/api/bi/inventory/recommendations/:id/dismiss` | PATCH | Auth | Dismiss recommendation |
| `/api/bi/inventory/recommendations/:id/action` | PATCH | Auth | Mark as actioned |
| `/api/bi/inventory/health` | GET | Auth | Inventory health score (A-F) |
| `/api/bi/inventory/stockout-alerts` | GET | Auth | Predictive stockout alerts |
| `/api/bi/inventory/purchase-order` | GET | Auth | Generate PO recommendations |
| `/api/bi/inventory/dashboard` | GET | Auth | Comprehensive inventory dashboard |
| `/api/bi/inventory/forecast/:id` | GET | Auth | Item supply forecast |
| `/api/bi/inventory/analyze` | POST | Auth | Trigger full inventory analysis |
| `/api/bi/inventory/send-alerts` | POST | Auth | Send stockout alert emails |
| `/api/bi/inventory/send-digest` | POST | Auth | Send inventory digest email |
| `/api/bi/inventory/export-po` | GET | Auth | Export PO as CSV/JSON |
| `/api/bi/inventory/usage` | POST | Auth | Record inventory usage |
| `/api/bi/inventory/usage/bulk` | POST | Auth | Bulk usage from snapshot |
| `/api/bi/inventory/price` | POST | Auth | Record price observation |
| `/api/bi/suppliers` | GET | Auth | Supplier performance report |
| `/api/bi/suppliers/:name/trends` | GET | Auth | Supplier price trends |
| `/api/bi/price-alerts` | GET | Auth | Recent price change alerts |
| `/api/bi/payroll` | GET | Auth | Get payroll entries |
| `/api/bi/payroll` | POST | Auth | Add payroll entry |
| `/api/bi/payroll/upload` | POST | Auth | Upload parsed payroll file |
| `/api/bi/expenses` | GET | Auth | Get expense entries |
| `/api/bi/expenses` | POST | Auth | Add expense entry |
| `/api/bi/financial-summary` | GET | Auth | Financial dashboard data |
| `/api/bi/analytics/financial` | GET | Auth | Financial analytics |
| `/api/bi/achievements` | GET | Auth | User achievements & streaks |

### Admin Analytics (`/api/admin/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/admin/usage-analytics` | GET | Admin | Platform usage stats |
| `/api/admin/system-health` | GET | Admin | Server health metrics |
| `/api/admin/financial-metrics` | GET | Admin | Revenue/subscription metrics |
| `/api/admin/top-customers` | GET | Admin | Top users by activity |
| `/api/admin/error-monitoring` | GET | Admin | Recent errors |
| `/api/admin/system-alerts` | GET | Admin | Active system alerts |
| `/api/admin/recent-activity` | GET | Admin | Recent user activity |
| `/api/admin/endpoint-stats` | GET | Admin | API endpoint statistics |
| `/api/admin/live-users` | GET | Admin | Currently active users |
| `/api/admin/users` | GET | Admin | List all users |
| `/api/admin/users` | POST | Admin | Create user |

### Email Autopilot (`/api/email-monitor/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/email-monitor/setup` | POST | Auth | Configure IMAP monitor |
| `/api/email-monitor/test-connection` | POST | Auth | Test IMAP connection |
| `/api/email-monitor/list` | GET | Auth | List configured monitors |
| `/api/email-monitor/:id/toggle` | POST | Auth | Enable/disable monitor |
| `/api/email-monitor/activity` | GET | Auth | Recent processing activity |

### Stripe Integration (`/api/stripe/*`)
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/stripe/create-checkout-session` | POST | Auth | Start subscription checkout |
| `/api/stripe/create-portal-session` | POST | Auth | Customer billing portal |
| `/api/stripe/webhook` | POST | Public | Stripe webhook handler |

---

## Key Features Deep Dive

### 1. Invoice OCR & Analysis
**How it works:**
1. User uploads PDF/image invoice to `/api/analyze-invoice`
2. Claude AI extracts: vendor name, invoice date, line items, totals
3. System auto-classifies categories using keyword matching
4. Price history tracked for trend analysis
5. Opportunities detected based on price changes, patterns

**Extracted Data:**
- Vendor name and contact info
- Invoice date and number
- Line items: description, quantity, unit price, total
- Subtotal, tax, shipping, total
- Payment terms

### 2. Cost Savings Detection (opportunity-engine.js)

The Opportunity Engine detects:

| Type | Detection Logic |
|------|-----------------|
| **Price Increase** | Current price > 5% above 90-day average |
| **Bulk Discount** | High-volume items where bulk buying saves 10%+ |
| **Vendor Consolidation** | Same items from 3+ vendors = consolidation opportunity |
| **Contract Renewal** | MLA expiring within 90 days |
| **Seasonal Buying** | Pre-buy before seasonal price increases |
| **Waste Reduction** | High waste ratio detected from usage data |
| **Payment Terms** | Early payment discounts available |

### 3. Smart Inventory Management (reorder-engine.js)

**Recommendation Types:**

| Type | Description |
|------|-------------|
| **urgent_reorder** | Below critical threshold, needs immediate order |
| **discount_opportunity** | Vendor offering bulk discount now |
| **holiday_prep** | Seasonal buildup needed (Thanksgiving, Christmas, etc.) |
| **bulk_opportunity** | Hit quantity threshold for better pricing |
| **overstock_warning** | Excess inventory, consider selling |
| **usage_spike** | Abnormal consumption detected |
| **usage_drop** | Sudden decrease in usage (investigate) |
| **supply_forecast** | Days-of-supply projections |

**Seasonal Factors by Month:**
- January: 0.85 (post-holiday slow)
- February: 0.90 (Valentine's bump)
- March: 0.95 (spring pickup)
- April-May: 1.0 (normal)
- June-August: 1.1 (summer peak)
- September: 1.0 (back to normal)
- October: 1.15 (Halloween prep)
- November: 1.35 (Thanksgiving surge)
- December: 1.4 (holiday peak)

### 4. Inventory Intelligence (inventory-intelligence.js)

**Health Score Components:**
- Stock level health (items at/above par)
- Critical items (below 50% of min)
- Overstock waste risk
- Active recommendations

**Grade Scale:**
- A: 90-100% (Excellent)
- B: 75-89% (Good)
- C: 60-74% (Fair)
- D: 40-59% (Poor)
- F: Below 40% (Critical)

### 5. Financial Analytics

**VP Dashboard Charts:**
- Expense breakdown by category (pie chart)
- Spending trends over time (line chart)
- Budget vs. actual comparison
- Payroll as % of total expenses

**Financial Summary Endpoint:**
```json
{
  "totals": {
    "expenses": 125000,  // cents
    "payroll": 85000,
    "inventory": 0,
    "savings": 15000
  },
  "breakdown": [
    {"category": "Payroll", "amount": 85000},
    {"category": "cogs", "amount": 25000},
    {"category": "utilities", "amount": 8000}
  ],
  "trend": [
    {"date": "Jan 1", "amount": 5000},
    {"date": "Jan 2", "amount": 4500}
  ]
}
```

### 6. Email Autopilot

**Supported Providers:**
- Gmail (imap.gmail.com)
- Outlook/Microsoft (outlook.office365.com)
- Yahoo (imap.mail.yahoo.com)
- AOL (imap.aol.com)
- iCloud (imap.mail.me.com)
- Zoho (imap.zoho.com)
- Any custom IMAP server

**Processing Flow:**
1. Connect to IMAP inbox
2. Search for unread emails with attachments
3. Filter for invoice-related keywords
4. Extract PDF/Excel attachments
5. Process through Claude AI
6. Detect opportunities
7. Send alerts if savings found

### 7. Role-Based Access Control

| Role | Dashboard Access | Write Access | Admin Functions |
|------|-----------------|--------------|-----------------|
| `admin` | All | All | Yes |
| `customer_admin` | All | Own data | Limited |
| `manager` | Manager, Rep | Team data | No |
| `rep` | Rep | Own data | No |
| `viewer` | Rep (read-only) | None | No |
| `demo_business` | VP only | None (read-only) | No |
| `demo_viewer` | All (read-only) | None (read-only) | No |

### 8. Trial System

**Limits:**
- 30-day time limit
- 20 invoice processing limit

**Warning Emails Sent At:**
- 3 days remaining
- 3 invoices remaining
- 1 day remaining
- Last invoice

**Expiration Actions:**
- subscription_status set to 'expired'
- is_active set to 0
- API returns 403 with `trialExpired: true`

### 9. Admin Approval Workflow

**Flow:**
1. User visits `/dashboard/request-access.html`
2. Submits: name, email, company, role, reason, LinkedIn
3. System creates signup_requests record with status='pending'
4. Admin receives email with approve/deny links
5. Clicking link validates token, creates/rejects user
6. User receives welcome email (approved) or rejection email (denied)

**Token Security:**
- Unique approve/deny tokens per request
- 7-day expiration
- Single-use (invalidated after action)

---

## Code Patterns & Conventions

### API Response Format
```javascript
// Success
res.json({
  success: true,
  data: {...},
  count: 10  // for lists
});

// Error
res.status(400).json({
  success: false,
  error: 'Error message',
  code: 'ERROR_CODE'
});
```

### Authentication Flow
```javascript
// Login response
{
  accessToken: 'jwt...',
  refreshToken: 'refresh...',
  expiresIn: 900, // 15 minutes
  user: { id, email, name, role, accountName }
}

// Token refresh
POST /auth/refresh
Body: { refreshToken: '...' }
Returns: { accessToken, expiresIn }

// Frontend storage
localStorage.setItem('accessToken', token);
```

### Database Pattern
```javascript
const db = require('./database');
const database = db.getDatabase();

// Prepared statements (safe from SQL injection)
const user = database.prepare('SELECT * FROM users WHERE id = ?').get(userId);
const users = database.prepare('SELECT * FROM users WHERE role = ?').all('rep');
const result = database.prepare('INSERT INTO users (email) VALUES (?)').run(email);
```

### Currency Convention
- All money stored as INTEGER cents
- Field naming: `*_cents` (e.g., `amount_cents`, `savings_cents`)
- Convert for display: `(amount / 100).toFixed(2)`
- API returns cents, frontend converts to dollars

---

## Environment Variables

```env
# Server
PORT=5050
NODE_ENV=production

# Database
DB_PATH=./revenue-radar.db

# JWT Secrets
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# Anthropic Claude API
ANTHROPIC_API_KEY=sk-ant-xxx

# Email (Resend - primary)
RESEND_API_KEY=re_xxx

# Email (SMTP - fallback)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-email
SMTP_PASS=your-password
EMAIL_FROM=noreply@revenueradar.io

# Admin Notifications
ADMIN_NOTIFICATION_EMAIL=quietsignallayer@gmail.com

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Security
ALLOWED_ORIGINS=https://app.revenueradar.io
EMAIL_PASSWORD_KEY=encryption-key-for-imap-passwords
```

---

## Demo & Founder Accounts

### Founder Accounts (Always Seeded)
| Email | Password | Role |
|-------|----------|------|
| admin@revenueradar.com | Admin123! | admin |
| taylor@revenueradar.com | Taylor123! | admin |
| victorianj23@gmail.com | Victoria123! | admin |

### Demo Accounts (Safe to Share)
| Email | Password | Access |
|-------|----------|--------|
| business@demo.revenueradar.com | DemoShop2026! | VP Dashboard only |
| demo@revenueradar.com | Demo2026! | All dashboards (read-only) |

---

## Recent Development (January 2026)

### VP/Business Dashboard Enhancements
- Financial Overview Charts with Chart.js
- Quick Action Tiles (Payroll, Expenses, Inventory, Reports)
- Upload Payroll tile with drag & drop modal
- Excel/CSV/PDF payroll file parsing
- Support for: ADP, Toast, Gusto, QuickBooks, Paychex, Square
- `/api/bi/payroll/upload` endpoint for parsed data
- Fixed chart overflow with proper container constraints

### Authentication Improvements
- Standardized `authToken` → `accessToken` naming
- Fixed token refresh flow across all dashboards
- Improved demo user restrictions

### Admin Dashboard Polish
- Premium Apple/Rolex spacing aesthetic
- Signup requests management section
- Real-time system health monitoring

---

## Deployment

### Production Deployment
1. Push to `main` branch on GitHub
2. DigitalOcean auto-deploys within 2-3 minutes
3. Health check at `/health`

### Build & Run Commands
```bash
# Install dependencies
npm install

# Run server
node server.js

# Create admin user
node scripts/create-admin.js

# Reset user password
node scripts/reset-password.js
```

---

## Security Features

### Authentication
- Bcrypt password hashing (10 salt rounds)
- JWT with 15-minute access token expiration
- Refresh tokens with 30-day expiration
- Password history (prevent reuse of last 5)
- Account lockout after 5 failed attempts
- Session management with IP/user-agent tracking

### Data Protection
- HTTPS enforced in production
- IMAP passwords encrypted with CryptoJS
- Input sanitization (XSS, SQL injection prevention)
- Audit logging of all actions
- Rate limiting on sensitive endpoints

### Access Control
- Role-based access (RBAC)
- Resource ownership validation
- Account-level data isolation
- Demo accounts restricted to read-only

---

## Support

- **GitHub Issues:** https://github.com/anthropics/claude-code/issues
- **Admin Email:** quietsignallayer@gmail.com
- **Health Check:** `/health`
- **Admin Dashboard:** `/dashboard/admin-ops.html`

---

*Last Updated: January 2026*
*Document Version: Complete Technical Overview*

**To use:** Copy this entire document into ChatGPT to give it full context on Revenue Radar's architecture, features, and codebase.
