# REVENUE RADAR - Complete Platform Overview

> **Copy this entire document into ChatGPT to give it full context on Revenue Radar for operational guidance, marketing insights, strategic planning, and technical support.**

---

## EXECUTIVE SUMMARY

**Revenue Radar** is a B2B SaaS platform that helps sales organizations automatically discover revenue opportunities hidden in their invoice and contract data. The platform uses AI-powered invoice analysis, email autopilot for automatic invoice capture, and a rules engine to surface upsell/cross-sell opportunities that would otherwise be missed.

**Primary Value Proposition:**
- Automatically find missed revenue opportunities in existing customer invoices
- Track MLA (Master Level Agreement) renewals before they expire
- Calculate and track sales commissions in real-time
- Gamify sales performance with SPIFs (Special Performance Incentive Funds)

**Target Market:**
- Sales organizations with complex pricing agreements
- Companies with high invoice volumes
- Businesses with MLA/contract-based selling
- Distribution and wholesale companies

---

## PLATFORM CAPABILITIES

### 1. Invoice Intelligence

**What it does:**
- Users upload invoices (PDF, Excel, CSV) OR connect email for auto-capture
- AI extracts line items, pricing, quantities, and customer data
- System compares against MLA contract pricing
- Identifies pricing discrepancies and opportunities

**Business Value:**
- Find customers paying off-contract prices (revenue recovery)
- Identify upsell opportunities based on purchase patterns
- Detect contract compliance issues
- Discover new leads from invoice contact data

### 2. Email Autopilot (IMAP Integration)

**What it does:**
- Connects to any IMAP email account (Gmail, Outlook, Yahoo, etc.)
- Automatically monitors for invoice-related emails
- Extracts and processes attachments without manual upload
- Runs on configurable schedules (every X minutes)

**Business Value:**
- Zero-touch invoice processing
- Never miss an invoice email
- Real-time opportunity detection
- Scales to high-volume operations

### 3. Opportunity Rules Engine

**What it does:**
- Define custom rules based on invoice content
- Automatically create opportunities when rules trigger
- Example: "If customer orders >100 units of SKU-123, recommend SKU-456 bundle"
- Track rule performance and win rates

**Business Value:**
- Codify institutional sales knowledge
- Ensure reps never miss obvious opportunities
- A/B test different sales strategies
- Improve over time with data

### 4. MLA/Contract Management

**What it does:**
- Track Master Level Agreements and their expiration dates
- Calculate renewal likelihood scores
- Assign MLAs to reps for proactive outreach
- Track review activity and outcomes

**Business Value:**
- Never let a contract expire without action
- Prioritize renewals by value and risk
- Measure rep engagement with contracts
- Forecast renewal revenue

### 5. Commission Tracking

**What it does:**
- Multiple commission structures (percentage, flat, tiered)
- Automatic calculation from closed opportunities
- Support for base, bonus, SPIF, and override commissions
- Pending → Approved → Paid workflow

**Business Value:**
- Accurate, real-time commission visibility
- Reduce compensation disputes
- Motivate reps with transparency
- Simplify payroll processing

### 6. SPIFs (Sales Contests)

**What it does:**
- Create time-limited sales competitions
- Track multiple metrics (deals closed, MLAs reviewed, revenue)
- Real-time leaderboards
- Top-N winner model with prizes

**Business Value:**
- Drive specific behaviors (e.g., MLA reviews)
- Increase engagement and competition
- Recognize top performers
- Flexible incentive programs

---

## USER ROLES & DASHBOARDS

### Role Hierarchy

| Role | Access Level | Primary Dashboard |
|------|--------------|-------------------|
| Admin | Full system access | Analytics + Admin Ops |
| Customer Admin | Own company data | VP/Business Dashboard |
| Manager | Team oversight | Manager Dashboard |
| Rep | Individual tasks | Rep Dashboard |
| Viewer | Read-only access | Rep Dashboard (view) |
| Demo (Business) | View-only demo | VP Dashboard |
| Demo (Viewer) | View-only demo | All dashboards |

### Dashboard Descriptions

**Rep Dashboard:**
- Personal MLA review queue
- Assigned opportunities
- Commission tracking
- Personal statistics
- Activity history

**Manager Dashboard:**
- Team performance metrics
- SKU opportunity recommendations
- Rep activity monitoring
- Sales pipeline overview
- Real-time analytics

**VP/Business Dashboard:**
- Executive revenue metrics
- Top customer analysis
- Financial forecasting
- Commission summaries
- Business insights

**Analytics Dashboard (Admin):**
- User management
- Access request approvals
- API endpoint monitoring
- System health metrics
- Error tracking
- Database statistics

---

## TECHNICAL ARCHITECTURE

### Stack Overview

| Component | Technology |
|-----------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Auth | JWT + Refresh Tokens |
| Email | Resend API + SMTP/Nodemailer |
| IMAP | node-imap + mailparser |
| AI | Anthropic Claude API |
| Frontend | Vanilla JS + HTML dashboards |
| Hosting | DigitalOcean App Platform |

### Database Schema (Key Tables)

```
users            - User accounts, roles, auth, trial status
teams            - User groupings for managers
ingestion_runs   - Invoice processing jobs
invoice_items    - Extracted invoice line items
mlas             - Master Level Agreements
mla_products     - Products within MLAs with pricing
mla_reviews      - Rep review activity tracking
opportunities    - Sales opportunities (detected, in_progress, won/lost)
opportunity_rules - Rules engine definitions
commissions      - Commission calculations and payments
spifs            - Sales contests
spif_standings   - Leaderboard positions
email_monitors   - IMAP email configurations
signup_requests  - Access request queue
sessions         - Active user sessions
audit_logs       - Security audit trail
```

### API Structure

```
/auth/*              - Authentication (login, register, password reset)
/signup/*            - Self-service signup + access requests
/api/user-management - Admin user CRUD
/api/admin/*         - Analytics, health, metrics
/api/email-monitors  - IMAP configuration
/api/opportunities   - Opportunity management
/api/commissions     - Commission tracking
/api/mlas            - MLA management
/api/rules           - Rules engine
/api/spifs           - SPIF contests
/api/dashboard/*     - Dashboard data aggregation
/ingest              - Invoice processing
/health              - System health checks
/backups             - Database backup management
```

---

## CURRENT FEATURE SET

### Completed Features ✅

1. **User Authentication System**
   - JWT-based auth with refresh tokens
   - Password strength validation
   - Account lockout protection
   - Session management
   - Email verification
   - Password reset flow

2. **Self-Service Signup**
   - 30-day free trial
   - 20 invoice processing limit
   - Email verification required
   - Automatic trial warnings

3. **Access Request System**
   - Public request form
   - Admin email notifications
   - One-click approve/deny from email
   - Dashboard approval queue

4. **Invoice Processing**
   - PDF, Excel, CSV support
   - AI-powered extraction
   - Lead discovery
   - Opportunity detection

5. **Email Autopilot**
   - Multi-provider IMAP support
   - Auto-detection of settings
   - Scheduled monitoring
   - Activity logging

6. **Opportunity Management**
   - Multiple opportunity types
   - Status workflow
   - Rep assignment
   - Commission calculation

7. **Rules Engine**
   - SKU-based triggers
   - Conditional logic
   - Auto-opportunity creation
   - Performance tracking

8. **Commission System**
   - Multiple structures
   - Automatic calculation
   - Approval workflow
   - Payment tracking

9. **SPIF Contests**
   - Multiple metric types
   - Real-time leaderboards
   - Prize tracking

10. **Admin Analytics**
    - Real-time user activity
    - API endpoint monitoring
    - System health dashboard
    - Error tracking

11. **Demo Accounts**
    - Business Demo (VP view only)
    - Universal Demo (all views, read-only)
    - Safe for public sharing

---

## BUSINESS METRICS TO TRACK

### Key Performance Indicators

**User Engagement:**
- Daily/Weekly/Monthly Active Users
- Invoices processed per user
- MLA reviews per rep
- Opportunity conversion rates

**Revenue Impact:**
- Total savings detected
- Opportunities created
- Opportunities won (value)
- Commission payouts

**System Health:**
- API response times
- Error rates
- Email autopilot success rate
- Signup conversion rate

**Trial Metrics:**
- Trial signups
- Trial → Paid conversion
- Trial engagement (invoices used)
- Churn at trial end

---

## DEPLOYMENT & OPERATIONS

### Production Environment

- **Hosting:** DigitalOcean App Platform
- **URL:** https://revenueradar.io (or current domain)
- **Database:** Persistent SQLite on attached volume
- **Auto-deploy:** GitHub push to main branch

### Key Operational Tasks

1. **User Management**
   - Approve access requests
   - Reset passwords
   - Manage roles

2. **System Monitoring**
   - Check error logs
   - Monitor API performance
   - Review email autopilot status

3. **Data Management**
   - Database backups (automatic)
   - Backup restoration (if needed)
   - Data cleanup (expired sessions, old logs)

4. **Trial Management**
   - Monitor trial expirations
   - Convert trials to paid
   - Handle trial extensions

---

## SECURITY FEATURES

### Authentication Security
- Bcrypt password hashing (10 rounds)
- JWT with short expiration (24h)
- Refresh token rotation (30 days)
- Password history (can't reuse last 5)
- Account lockout after 5 failed attempts

### Data Protection
- HTTPS in production
- Encrypted IMAP passwords
- Session management with IP tracking
- Audit logging of all actions
- Input sanitization (XSS/injection prevention)

### Access Control
- Role-based access (RBAC)
- Resource ownership checks
- Account-level data isolation
- Rate limiting on all endpoints

---

## INTEGRATION CAPABILITIES

### Current Integrations
- **Email:** Gmail, Outlook, Yahoo, AOL, iCloud, Zoho, any IMAP server
- **AI:** Anthropic Claude for invoice analysis
- **Geocoding:** OpenStreetMap for lead enrichment
- **Email API:** Resend for transactional emails

### Future Integration Opportunities
- CRM systems (Salesforce, HubSpot)
- Accounting software (QuickBooks, Xero)
- E-signature (DocuSign, Adobe Sign)
- Payment processing (Stripe)
- Slack/Teams notifications

---

## COMPETITIVE ADVANTAGES

1. **Email Autopilot** - Competitors require manual upload; we auto-capture from email
2. **AI-Powered Analysis** - Claude integration for intelligent opportunity detection
3. **Rules Engine** - Codify institutional knowledge, not just data display
4. **Commission Transparency** - Real-time commission tracking for reps
5. **SPIF Gamification** - Built-in sales contest functionality
6. **Self-Service Trial** - Users can start immediately without sales call
7. **Demo Accounts** - Safe public sharing for prospects

---

## KNOWN LIMITATIONS & ROADMAP

### Current Limitations
- SQLite database (single-server, not horizontally scalable)
- No mobile app (responsive web only)
- No offline mode
- Limited third-party integrations
- No multi-tenancy (each customer needs separate instance)

### Potential Roadmap Items
1. PostgreSQL migration for scalability
2. Mobile app (React Native)
3. CRM integrations
4. Advanced reporting/BI
5. Multi-tenant architecture
6. API keys for external access
7. Webhook notifications
8. White-labeling

---

## FOUNDER ACCOUNTS

These accounts are permanently seeded on every deployment:

| Email | Password | Role | Purpose |
|-------|----------|------|---------|
| admin@revenueradar.com | Admin123! | Admin | System admin |
| taylor@revenueradar.com | Taylor123! | Admin | Founder |
| victorianj23@gmail.com | Victoria123! | Admin | Founder |

### Demo Accounts (Safe to Share)

| Email | Password | Access |
|-------|----------|--------|
| business@demo.revenueradar.com | DemoShop2026! | VP Dashboard only |
| demo@revenueradar.com | Demo2026! | All dashboards (read-only) |

---

## SUPPORT & DOCUMENTATION

- **GitHub Issues:** https://github.com/OpportunityEngine/signallayer-site/issues
- **Admin Dashboard:** /dashboard/admin-ops.html
- **Health Check:** /health

---

*Last Updated: January 2026*
*Platform Version: Production (main branch)*
