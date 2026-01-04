# Integration Guide - Adding Infrastructure to server.js

This guide shows how to integrate all the new infrastructure components into your existing [server.js](server.js).

---

## Required Additions to server.js

### 1. Import New Modules

Add these imports at the top of server.js:

```javascript
// Existing imports...
const express = require('express');
const cors = require('cors');

// ADD THESE NEW IMPORTS:
const config = require('./config');  // Centralized configuration
const backupService = require('./backup-service');  // Database backups
const healthRoutes = require('./health-routes');  // Health monitoring
const backupRoutes = require('./backup-routes');  // Backup management
```

### 2. Replace Environment Variables with Config

**OLD:**
```javascript
const PORT = process.env.PORT || 5050;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
```

**NEW:**
```javascript
// Use centralized config instead of direct process.env access
const PORT = config.port;
const ANTHROPIC_API_KEY = config.anthropicApiKey;
```

### 3. Update CORS Configuration

**OLD:**
```javascript
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
```

**NEW:**
```javascript
app.use(cors({
  origin: config.allowedOrigins,  // From .env ALLOWED_ORIGINS
  credentials: true
}));
```

### 4. Register New Routes

Add these routes BEFORE your existing routes:

```javascript
// Health check routes (public)
app.use('/health', healthRoutes);

// Backup management routes (admin only)
app.use('/backups', backupRoutes);

// Your existing routes...
app.use('/auth', authRoutes);
app.use('/api', apiRoutes);
// etc...
```

### 5. Start Backup Service

Add this AFTER database initialization but BEFORE starting the server:

```javascript
// Initialize database
db.initializeDatabase();

// ADD THIS - Start backup service
backupService.start();

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

### 6. Add Graceful Shutdown

Add this at the end of server.js:

```javascript
// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');

  backupService.stop();  // Stop backup service

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');

  backupService.stop();

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});
```

### 7. Add HTTPS Support (Optional)

If you want Node.js to handle HTTPS directly (instead of Nginx):

```javascript
const https = require('https');
const http = require('http');
const fs = require('fs');

// ... rest of app setup ...

// Start server
if (config.httpsEnabled) {
  // HTTPS server
  const httpsOptions = {
    key: fs.readFileSync(config.sslConfig.keyPath),
    cert: fs.readFileSync(config.sslConfig.certPath)
  };

  // Add CA bundle if provided
  if (config.sslConfig.caPath && fs.existsSync(config.sslConfig.caPath)) {
    httpsOptions.ca = fs.readFileSync(config.sslConfig.caPath);
  }

  const server = https.createServer(httpsOptions, app).listen(443, () => {
    console.log('✅ HTTPS server running on port 443');
  });

  // HTTP to HTTPS redirect
  if (config.forceHttps) {
    http.createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, () => {
      console.log('✅ HTTP redirect server running on port 80');
    });
  }

} else {
  // HTTP only (development)
  const server = app.listen(config.port, () => {
    console.log(`✅ HTTP server running on port ${config.port}`);
  });
}
```

---

## Complete Example server.js Structure

Here's what your server.js should look like after integration:

```javascript
// =====================================================
// REVENUE RADAR - MAIN SERVER
// =====================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

// New infrastructure imports
const config = require('./config');
const db = require('./database');
const backupService = require('./backup-service');
const healthRoutes = require('./health-routes');
const backupRoutes = require('./backup-routes');

// Existing route imports
const authRoutes = require('./auth-routes');
const emailRoutes = require('./email-routes');
const dashboardRoutes = require('./dashboard-routes');
// ... other routes ...

// Initialize Express
const app = express();

// =====================================================
// MIDDLEWARE
// =====================================================

// CORS
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// Trust proxy (if using Nginx)
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// =====================================================
// ROUTES
// =====================================================

// Health check routes (public)
app.use('/health', healthRoutes);

// Backup management routes (admin only)
app.use('/backups', backupRoutes);

// Authentication routes
app.use('/auth', authRoutes);

// Email processing routes
app.use('/email', emailRoutes);

// Dashboard routes
app.use('/api/dashboard', dashboardRoutes);

// ... other routes ...

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Revenue Radar API',
    version: '1.0.0',
    status: 'running'
  });
});

// =====================================================
// DATABASE & SERVICES
// =====================================================

// Initialize database
db.initializeDatabase();

// Start backup service
backupService.start();

// =====================================================
// START SERVER
// =====================================================

let server;

if (config.httpsEnabled) {
  // HTTPS server
  const httpsOptions = {
    key: fs.readFileSync(config.sslConfig.keyPath),
    cert: fs.readFileSync(config.sslConfig.certPath)
  };

  if (config.sslConfig.caPath && fs.existsSync(config.sslConfig.caPath)) {
    httpsOptions.ca = fs.readFileSync(config.sslConfig.caPath);
  }

  server = https.createServer(httpsOptions, app).listen(443, () => {
    console.log('✅ HTTPS server running on port 443');
  });

  // HTTP to HTTPS redirect
  if (config.forceHttps) {
    http.createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, () => {
      console.log('✅ HTTP redirect server running on port 80');
    });
  }

} else {
  // HTTP only (development)
  server = app.listen(config.port, () => {
    console.log(`✅ Server running on port ${config.port}`);
    console.log(`   Environment: ${config.isProduction() ? 'production' : 'development'}`);
    console.log(`   Database: ${config.databasePath}`);
    console.log(`   Backups: ${config.databaseBackupEnabled ? 'enabled' : 'disabled'}`);
  });
}

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Stop backup service
  backupService.stop();

  // Close server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// =====================================================
// ERROR HANDLING
// =====================================================

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // In production, you might want to log this to your error tracking service
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // In production, gracefully shutdown and restart
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

module.exports = app;
```

---

## Testing the Integration

### 1. Test Health Endpoints

```bash
# Start server
npm start

# Test public health check
curl http://localhost:5050/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2024-01-03T12:00:00.000Z",
  "uptime": 123.45
}
```

### 2. Test Backup Service

```bash
# Check if backup service started
# Look for in console:
[BACKUP] Starting automated backup service (every 24h)
[BACKUP] ✓ Backup created: revenue-radar-2024-01-03T12-00-00-000Z.db (2.45 MB)
[BACKUP] ✓ Backup service started

# Verify backup was created
ls -lh backups/
```

### 3. Test Configuration

```bash
# Run health check script
node scripts/check-health.js

# Should show:
✅ DATABASE - Healthy
✅ MEMORY - Normal usage
✅ CPU - Normal load
✅ BACKUPS - Up to date
✅ CONFIGURATION - All set
```

### 4. Test User Management

```bash
# Create admin user
node scripts/create-admin.js

# Login and access user management
# Navigate to: http://localhost:5050/dashboard/user-management.html
```

### 5. Test Backup API (Requires Admin Token)

```bash
# Get admin token by logging in
TOKEN="your-admin-token-here"

# List backups
curl http://localhost:5050/backups \
  -H "Authorization: Bearer $TOKEN"

# Create manual backup
curl -X POST http://localhost:5050/backups \
  -H "Authorization: Bearer $TOKEN"

# Get backup stats
curl http://localhost:5050/backups/stats \
  -H "Authorization: Bearer $TOKEN"
```

---

## Environment Setup

### 1. Create .env File

```bash
cp .env.example .env
```

### 2. Generate JWT Secret

```bash
node scripts/generate-jwt-secret.js
```

Copy the output to `.env`:
```env
JWT_SECRET=<generated-secret-here>
```

### 3. Configure Required Variables

Edit `.env` and set:
```env
NODE_ENV=development  # or production
ANTHROPIC_API_KEY=your-api-key
DATABASE_PATH=./revenue-radar.db
DATABASE_BACKUP_ENABLED=true
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5050
```

### 4. Initialize Database

```bash
node database.js
```

### 5. Create Admin User

```bash
node scripts/create-admin.js
```

---

## Troubleshooting Integration

### "Cannot find module './config'"

```bash
# Make sure config.js exists
ls -la config.js

# If not, copy from the implementation
```

### "Backup service failed to start"

```bash
# Check backups directory exists
mkdir -p backups
chmod 700 backups

# Check .env configuration
cat .env | grep BACKUP
```

### "Health routes not found"

```bash
# Verify health-routes.js exists
ls -la health-routes.js

# Check route registration in server.js
grep "health-routes" server.js
```

### "CORS errors after integration"

```bash
# Verify ALLOWED_ORIGINS in .env
cat .env | grep ALLOWED_ORIGINS

# Should include your frontend URL
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5050
```

---

## Migration Checklist

Before deploying the integrated version:

- [ ] Backup current database
- [ ] Create .env from .env.example
- [ ] Generate and set JWT_SECRET
- [ ] Test health endpoints
- [ ] Verify backup service starts
- [ ] Test admin user creation
- [ ] Test user management UI
- [ ] Verify all existing routes still work
- [ ] Test authentication flow
- [ ] Check console for errors
- [ ] Run: `node scripts/check-health.js`
- [ ] Verify backups are created automatically
- [ ] Test graceful shutdown (Ctrl+C)

---

## Deployment Considerations

### Development Environment

```env
NODE_ENV=development
HTTPS_ENABLED=false
DATABASE_BACKUP_ENABLED=true
DATABASE_BACKUP_INTERVAL_HOURS=24
```

### Production Environment

```env
NODE_ENV=production
HTTPS_ENABLED=true  # or use Nginx
SSL_CERT_PATH=/etc/letsencrypt/live/domain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/domain.com/privkey.pem
FORCE_HTTPS=true
DATABASE_BACKUP_ENABLED=true
DATABASE_BACKUP_INTERVAL_HOURS=12
TRUST_PROXY=true  # if using Nginx
```

---

## Next Steps After Integration

1. **Test in Development**
   - Run full test suite
   - Verify all features work
   - Check for console errors

2. **Deploy to Staging**
   - Test in staging environment
   - Verify SSL works
   - Test backup restoration

3. **Production Deployment**
   - Follow DEPLOYMENT_CHECKLIST.md
   - Set up monitoring
   - Configure alerts

4. **Monitor and Maintain**
   - Check health daily
   - Verify backups weekly
   - Review logs regularly

---

## Support

If you encounter issues during integration:

1. Check the error logs
2. Run `node scripts/check-health.js`
3. Review this integration guide
4. Check DEPLOYMENT_CHECKLIST.md
5. Verify .env configuration

---

**Ready to integrate!** 🚀

Follow this guide step-by-step to add all the new infrastructure components to your existing server.

---

**Last Updated:** 2024-01-03
