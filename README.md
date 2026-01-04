# 💰 Revenue Radar - AI Sales Intelligence Platform

Production-ready sales intelligence platform with AI-powered lead generation, invoice processing, and revenue tracking.

---

## ✨ Features

### Core Features
- **📧 Email Invoice Autopilot** - Automated invoice processing and lead extraction
- **📊 Revenue Dashboard** - Real-time sales metrics and analytics
- **👥 Manager Dashboard** - Team performance and SKU opportunity tracking
- **🎯 SKU Opportunity Rules** - AI-powered upsell recommendations
- **🔐 Authentication System** - Secure user management with JWT
- **👤 User Management** - Admin panel for team administration
- **💾 Automated Backups** - Database backups every 12 hours
- **🏥 Health Monitoring** - System health checks and metrics
- **🌐 Web Scraper** - Business intelligence gathering
- **🗺️ Lead Intelligence** - Location-based lead enrichment

### Technical Features
- Role-based access control (Admin, Rep, Viewer, Customer Admin)
- Rate limiting and account lockout protection
- Audit logging for security compliance
- Session management with refresh tokens
- Production-ready deployment configuration
- Automatic HTTPS via DigitalOcean

---

## 🚀 Quick Start

### Local Development

1. **Install dependencies:**
```bash
npm install
```

2. **Set up environment:**
```bash
cp .env.example .env
# Edit .env with your settings
```

3. **Start server:**
```bash
npm start
```

4. **Create admin user:**
```bash
node scripts/create-admin.js
```

5. **Access dashboard:**
```
http://localhost:5050/dashboard/login.html
```

### Production Deployment

**Deploy in 30 minutes!**

```bash
./scripts/setup-github.sh
```

Then follow: [QUICK_START_DEPLOYMENT.md](QUICK_START_DEPLOYMENT.md)

**Cost**: $12/month + optional $10/year for custom domain

---

## 📚 Documentation

| Guide | Purpose |
|-------|---------|
| [QUICK_START_DEPLOYMENT.md](QUICK_START_DEPLOYMENT.md) | Deploy in 30 minutes |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Complete deployment guide |
| [DOMAIN_SETUP_GUIDE.md](DOMAIN_SETUP_GUIDE.md) | Custom domain setup |
| [AUTHENTICATION_COMPLETE.md](AUTHENTICATION_COMPLETE.md) | Auth system docs |
| [ADD_AUTH_TO_DASHBOARDS.md](ADD_AUTH_TO_DASHBOARDS.md) | Protect dashboards |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Infrastructure integration |

---

## 🏗️ Architecture

```
revenue-radar/
├── server.js                 # Main server
├── database.js               # SQLite database
├── config.js                 # Configuration
│
├── auth-service.js           # Authentication logic
├── auth-routes.js            # Auth API endpoints
├── auth-middleware.js        # Auth middleware
│
├── email-service.js          # Email processing
├── email-routes.js           # Email API endpoints
├── email-workers.js          # Background workers
│
├── backup-service.js         # Automated backups
├── backup-routes.js          # Backup API
├── health-routes.js          # Health monitoring
│
├── dashboard/
│   ├── login.html           # Login page
│   ├── revenue-dashboard.html  # Rep dashboard
│   ├── manager-view.html    # Manager dashboard
│   ├── user-management.html # Admin user management
│   └── admin-operations.html   # Admin operations
│
├── scripts/
│   ├── setup-github.sh      # GitHub setup
│   ├── create-admin.js      # Create admin user
│   ├── check-health.js      # Health check
│   └── backup-now.js        # Manual backup
│
└── .do/
    └── app.yaml             # DigitalOcean config
```

---

## 🔒 Security Features

- ✅ JWT-based authentication with refresh tokens
- ✅ Bcrypt password hashing (12 rounds in production)
- ✅ Account lockout after 5 failed login attempts
- ✅ Rate limiting on all endpoints
- ✅ CORS protection
- ✅ Input sanitization
- ✅ SQL injection protection via prepared statements
- ✅ Audit logging for security events
- ✅ Secure session management
- ✅ HTTPS enforced in production

---

## 🌐 API Endpoints

### Authentication
```
POST   /auth/login           - User login
POST   /auth/logout          - User logout
POST   /auth/register        - Create user (admin only)
POST   /auth/refresh-token   - Refresh access token
GET    /auth/me              - Get current user
PUT    /auth/change-password - Change password
GET    /auth/sessions        - List active sessions
DELETE /auth/sessions/:id    - Revoke session
```

### Email Processing
```
POST   /email/ingest         - Process invoice email
GET    /email/status/:id     - Check processing status
GET    /email/history        - Email processing history
```

### Dashboard
```
GET    /api/dashboard/stats  - Revenue statistics
GET    /api/dashboard/charts - Chart data
GET    /api/dashboard/alerts - Active alerts
```

### Health & Monitoring
```
GET    /health               - Basic health check
GET    /health/detailed      - Detailed system health
GET    /health/metrics       - System metrics
```

### Backups (Admin only)
```
GET    /backups              - List backups
POST   /backups              - Create backup
POST   /backups/:id/restore  - Restore backup
GET    /backups/:id/download - Download backup
```

---

## 🎯 User Roles

| Role | Permissions |
|------|-------------|
| **Admin** | Full access, user management, backups |
| **Rep** | Revenue dashboard, email processing |
| **Viewer** | Read-only dashboard access |
| **Customer Admin** | Customer-specific data access |

---

## 💾 Database Schema

### Users
- Authentication and authorization
- Role-based access control
- Password history for reuse prevention

### Email Invoices
- Invoice processing history
- Lead extraction results
- Status tracking

### SKU Opportunity Rules
- AI-powered upsell rules
- Margin thresholds
- Contract-based logic

### Audit Logs
- Security event tracking
- User action logging
- Compliance reporting

### Sessions
- Active session tracking
- Device fingerprinting
- IP address logging

---

## 🔄 Deployment Workflow

1. **Develop Locally**
   - Edit code on your Mac
   - Test at `localhost:5050`

2. **Commit Changes**
   ```bash
   git add .
   git commit -m "Updated feature"
   ```

3. **Deploy**
   ```bash
   git push
   ```

4. **Auto-Deploy**
   - DigitalOcean detects push
   - Builds and deploys automatically
   - Live in 2-3 minutes!

---

## 📊 Monitoring

### Health Checks
```bash
curl https://your-domain.com/health
```

### Logs
- DigitalOcean → Your App → Runtime Logs
- Real-time server logs
- Error tracking

### Metrics
- DigitalOcean → Your App → Insights
- CPU and memory usage
- Request counts and response times

### Backups
- Automatic every 12 hours
- 30-day retention
- One-click restore

---

## 🛠️ Development

### Environment Variables

See [.env.example](.env.example) for all configuration options.

**Required:**
- `ANTHROPIC_API_KEY` - Claude AI API key
- `JWT_SECRET` - JWT signing secret
- `SESSION_SECRET` - Session encryption secret

**Optional:**
- `ROCKETREACH_API_KEY` - Contact enrichment
- `HUNTER_IO_API_KEY` - Email finder
- `GOOGLE_PLACES_API_KEY` - Location data

### Scripts

```bash
# Development
npm start                     # Start server
node scripts/create-admin.js  # Create admin user
node scripts/check-health.js  # Check system health

# Backups
node scripts/backup-now.js    # Manual backup
node scripts/list-backups.js  # List all backups

# Deployment
./scripts/setup-github.sh     # GitHub setup
```

---

## 🔧 Troubleshooting

### Local Development Issues

**Database errors:**
```bash
# Delete and recreate database
rm revenue-radar.db
node database.js
node scripts/create-admin.js
```

**Port already in use:**
```bash
# Kill process on port 5050
lsof -ti:5050 | xargs kill
```

### Production Issues

**Build failed:**
- Check DigitalOcean → Deployments
- Read build logs
- Fix errors and push again

**App crashing:**
- Check Runtime Logs
- Verify environment variables
- Check database path permissions

**Can't login:**
- Verify ALLOWED_ORIGINS is set
- Check admin user exists
- Clear browser cache

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md#-troubleshooting) for more.

---

## 💰 Pricing

### Infrastructure
| Service | Cost | Notes |
|---------|------|-------|
| DigitalOcean App | $12/month | Includes 512MB RAM, 1 vCPU |
| Domain Name | $10/year | Namecheap, Google, etc. |
| SSL Certificate | FREE | Auto-generated by DigitalOcean |

### Optional Upgrades
| Service | Cost | When Needed |
|---------|------|-------------|
| Managed PostgreSQL | +$15/month | 1000+ users |
| Managed Redis | +$15/month | Session storage |
| Spaces Storage | +$5/month | Offsite backups |

### API Costs (Pay-per-use)
| Service | Cost | What You Get |
|---------|------|--------------|
| Anthropic Claude | ~$3-15/1M tokens | AI processing |
| RocketReach | $39-199/month | Contact enrichment |
| Hunter.io | $49-399/month | Email finding |

---

## 🤝 Contributing

This is a private project. For team members:

1. Clone repository
2. Create feature branch
3. Make changes
4. Test locally
5. Push and create PR
6. After review, merge to main
7. Auto-deploys to production

---

## 📝 License

Proprietary - All Rights Reserved

---

## 🆘 Support

### Documentation
- [Quick Start](QUICK_START_DEPLOYMENT.md)
- [Full Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Domain Setup](DOMAIN_SETUP_GUIDE.md)

### External Resources
- [DigitalOcean Docs](https://docs.digitalocean.com/products/app-platform/)
- [Anthropic API Docs](https://docs.anthropic.com/)

---

## ✅ Production Checklist

Before going live:

- [ ] All environment variables set
- [ ] Admin user created
- [ ] Health check passing
- [ ] Backups enabled and tested
- [ ] HTTPS working
- [ ] CORS configured correctly
- [ ] Custom domain (optional)
- [ ] 2FA enabled on accounts
- [ ] Monitoring configured
- [ ] Team members added

---

## 🎉 You're Ready!

Your Revenue Radar platform is:
- ✅ Production-ready
- ✅ Secure and scalable
- ✅ Easy to deploy
- ✅ Simple to update

**Deploy now**: `./scripts/setup-github.sh`

---

**Built with**:
- Node.js & Express
- SQLite (better-sqlite3)
- Claude AI (Anthropic)
- JWT authentication
- DigitalOcean App Platform

**Last Updated**: January 3, 2026
