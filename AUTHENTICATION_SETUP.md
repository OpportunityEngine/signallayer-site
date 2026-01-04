# 🔐 Authentication & Security System - Setup Guide

## ✅ What We Built

A **production-grade, enterprise-level authentication system** with:

### Core Features:
- ✅ **JWT Token Authentication** - Secure access tokens with refresh tokens
- ✅ **Role-Based Access Control (RBAC)** - Admin, Rep, Viewer, Customer Admin roles
- ✅ **Session Management** - Track and revoke active sessions
- ✅ **Password Security** - bcrypt hashing, strength validation, history tracking
- ✅ **Account Lockout** - Automatic lockout after 5 failed attempts (15min)
- ✅ **Password Reset** - Secure token-based reset flow
- ✅ **Email Verification** - Verify user emails with tokens
- ✅ **API Key Management** - Generate and manage API keys for integrations
- ✅ **Input Sanitization** - SQL injection and XSS protection
- ✅ **Rate Limiting** - Prevent brute force attacks
- ✅ **CORS Configuration** - Secure cross-origin requests
- ✅ **Security Headers** - XSS, clickjacking, MIME type protection
- ✅ **Audit Logging** - Track all security-sensitive actions
- ✅ **Permission System** - Fine-grained permission control

---

## 📦 Installation

### 1. Install Required npm Packages

```bash
npm install bcryptjs jsonwebtoken
```

### 2. Initialize Auth Database Schema

```bash
# In your server.js or a setup script:
node -e "
const db = require('./database');
const fs = require('fs');

// Run auth schema
const authSchema = fs.readFileSync('./database-schema-auth.sql', 'utf8');
const database = db.getDatabase();

// Execute schema
const statements = authSchema.split(';').filter(s => s.trim());
statements.forEach(statement => {
  if (statement.trim()) {
    try {
      database.exec(statement);
    } catch (err) {
      console.error('Error executing statement:', err.message);
    }
  }
});

console.log('✅ Auth database initialized!');
"
```

### 3. Set Environment Variables

Create a `.env` file in your project root:

```env
# JWT Secret (CHANGE THIS IN PRODUCTION!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# CORS Allowed Origins (comma-separated)
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5050,https://yourdomain.com

# Node Environment
NODE_ENV=development

# Email Configuration (for password reset emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### 4. Integrate into Express App

Update your `server.js` or main Express file:

```javascript
const express = require('express');
const app = express();

// Import auth components
const authRoutes = require('./auth-routes');
const apiKeyRoutes = require('./api-key-routes');
const {
  corsMiddleware,
  securityHeaders,
  requestLogger,
  requireAuth,
  requireRole
} = require('./auth-middleware');

// Apply security middleware FIRST
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(requestLogger);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Auth routes (public)
app.use('/auth', authRoutes);

// API key management (protected)
app.use('/api-keys', apiKeyRoutes);

// Protect your existing routes
app.get('/api/detected-savings',
  requireAuth,  // Require authentication
  async (req, res) => {
    // Your existing code
    // req.user is now available with user info
  }
);

// Admin-only routes
app.get('/api/admin/errors',
  requireAuth,
  requireRole('admin'),  // Only admins can access
  async (req, res) => {
    // Your existing admin code
  }
);

// Serve login page
app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/dashboard/login.html');
});

// Start server
app.listen(5050, () => {
  console.log('✅ Server running on http://localhost:5050');
  console.log('🔐 Auth system enabled');
  console.log('📧 Default admin: admin@revenueradar.com / Admin123!');
});
```

---

## 🚀 Usage Examples

### Frontend - Login and Store Tokens

```javascript
// Login
async function login(email, password) {
  const response = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();

  if (data.success) {
    // Store tokens
    localStorage.setItem('accessToken', data.data.accessToken);
    localStorage.setItem('refreshToken', data.data.refreshToken);
    localStorage.setItem('sessionId', data.data.sessionId);
    localStorage.setItem('user', JSON.stringify(data.data.user));

    // Redirect to dashboard
    window.location.href = '/dashboard';
  }
}

// Make authenticated requests
async function fetchProtectedData() {
  const token = localStorage.getItem('accessToken');

  const response = await fetch('/api/detected-savings', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    // Token expired, try to refresh
    await refreshToken();
    // Retry request
  }

  return await response.json();
}

// Refresh token
async function refreshToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  const sessionId = localStorage.getItem('sessionId');

  const response = await fetch('/auth/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, sessionId })
  });

  const data = await response.json();

  if (data.success) {
    localStorage.setItem('accessToken', data.data.accessToken);
  } else {
    // Refresh failed, logout
    localStorage.clear();
    window.location.href = '/login';
  }
}
```

### Backend - Protect Routes

```javascript
// Require authentication
app.get('/api/invoices', requireAuth, (req, res) => {
  // req.user contains: { id, email, role, accountName }
  console.log('User:', req.user.email);

  // Your code here
});

// Require specific role
app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  // Only admins can access this
});

// Require specific permission
const { requirePermission } = require('./auth-middleware');

app.post('/api/invoices', requireAuth, requirePermission('invoices.create'), (req, res) => {
  // Only users with 'invoices.create' permission
});

// Multi-tenant isolation
const { requireSameAccount } = require('./auth-middleware');

app.get('/api/invoices', requireAuth, requireSameAccount, (req, res) => {
  const db = require('./database').getDatabase();

  // req.accountFilter contains the user's account
  const invoices = db.prepare(`
    SELECT * FROM invoices
    WHERE account_name = ?
  `).all(req.user.accountName);

  res.json({ success: true, data: invoices });
});
```

### API Key Authentication (for external integrations)

```javascript
const { authenticateAPIKey } = require('./api-key-routes');

// Use API key instead of JWT
app.post('/api/webhooks/invoice',
  authenticateAPIKey,  // Authenticate with API key
  (req, res) => {
    // req.user contains user info
    // req.apiKey contains API key info (id, name, scopes)

    console.log('API Key:', req.apiKey.name);
    console.log('User:', req.user.email);

    // Your webhook code
  }
);
```

---

## 🔑 Default Credentials

**Admin Account:**
- **Email:** `admin@revenueradar.com`
- **Password:** `Admin123!`

⚠️ **IMPORTANT:** Change this password immediately after first login!

---

## 📋 API Endpoints

### Public Endpoints (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Login with email/password |
| POST | `/auth/register` | Create new user account |
| POST | `/auth/forgot-password` | Request password reset |
| POST | `/auth/reset-password` | Reset password with token |
| GET | `/auth/verify-email/:token` | Verify email address |
| POST | `/auth/refresh-token` | Refresh access token |

### Protected Endpoints (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/logout` | Logout and revoke session |
| GET | `/auth/me` | Get current user profile |
| PUT | `/auth/change-password` | Change password |
| GET | `/auth/sessions` | List active sessions |
| DELETE | `/auth/sessions/:id` | Revoke specific session |

### Admin Endpoints (Admin Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/users` | Create new user |
| GET | `/auth/users` | List all users |
| PUT | `/auth/users/:id` | Update user |
| DELETE | `/auth/users/:id` | Delete user |

### API Key Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api-keys` | List API keys |
| POST | `/api-keys` | Create new API key |
| PUT | `/api-keys/:id` | Update API key |
| DELETE | `/api-keys/:id` | Revoke API key |

---

## 👥 User Roles & Permissions

### Roles:

1. **admin** - Full system access
2. **rep** - Sales rep (can manage invoices, view data)
3. **viewer** - Read-only access
4. **customer_admin** - Admin for their account only (customer-facing)

### Permission Categories:

- `invoices.*` - Invoice management
- `users.*` - User management
- `settings.*` - Settings management
- `email_monitors.*` - Email monitor management
- `api_keys.*` - API key management
- `admin.*` - Admin functions

### Example Permission Checks:

```javascript
// Check if user has permission
const { checkUserPermission } = require('./auth-middleware');

if (checkUserPermission(req.user.role, 'invoices.delete')) {
  // User can delete invoices
}
```

---

## 🛡️ Security Features

### 1. Password Security
- **Min 8 characters**
- **Requires:** uppercase, lowercase, number, special char
- **bcrypt hashing** with 10 rounds
- **Password history** - prevents reusing last 5 passwords

### 2. Account Lockout
- **5 failed attempts** → 15-minute lockout
- Automatic unlock after timeout
- Resets on successful login

### 3. Session Management
- **JWT tokens** with JTI for revocation
- **Refresh tokens** for long-lived sessions
- **24-hour access token** expiry
- **30-day refresh token** expiry
- Track IP, user agent, device info

### 4. Rate Limiting
- **Login:** 5 attempts per 15 minutes
- **Registration:** 3 attempts per hour
- **Password reset:** 3 requests per 15 minutes
- **API calls:** 100 requests per minute (configurable)

### 5. Input Sanitization
- **SQL injection protection** - removes SQL patterns
- **XSS prevention** - escapes HTML
- **Null byte removal**
- Applied to all inputs automatically

### 6. Security Headers
- `X-Frame-Options: DENY` - Prevent clickjacking
- `X-Content-Type-Options: nosniff` - Prevent MIME sniffing
- `X-XSS-Protection: 1; mode=block` - Enable XSS filter
- `Strict-Transport-Security` - HTTPS only (production)
- `Content-Security-Policy` - Prevent code injection

---

## 📊 Audit Logging

All security-sensitive actions are logged:

```sql
SELECT * FROM audit_log
WHERE action = 'login_success'
ORDER BY created_at DESC
LIMIT 10;
```

**Logged actions:**
- `login_success`, `login_failed`
- `user_registered`, `user_updated`, `user_deleted`
- `password_changed`, `password_reset`
- `email_verified`
- `account_locked`
- `api_key_created`, `api_key_revoked`
- `session_revoked`

---

## 🧪 Testing

### Test Login Flow

```bash
# Login
curl -X POST http://localhost:5050/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@revenueradar.com","password":"Admin123!"}'

# Use token
curl http://localhost:5050/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Create API key
curl -X POST http://localhost:5050/api-keys \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Key","scopes":["read","write"]}'

# Use API key
curl http://localhost:5050/api/invoices \
  -H "X-API-Key: sk_live_..."
```

---

## 🚨 Common Issues & Solutions

### Issue: "Invalid or expired token"
**Solution:** Token expired. Use refresh token or log in again.

### Issue: "Account locked"
**Solution:** Wait 15 minutes or have admin unlock via database:
```sql
UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE email = 'user@example.com';
```

### Issue: "CORS error"
**Solution:** Add your frontend URL to `ALLOWED_ORIGINS` in `.env`

### Issue: "Rate limit exceeded"
**Solution:** Wait for rate limit window to reset (shown in error response)

---

## 🔄 Next Steps

1. **Change default admin password**
2. **Set up email service** for password reset
3. **Configure ALLOWED_ORIGINS** for your domains
4. **Generate strong JWT_SECRET** for production
5. **Set up HTTPS** for production deployment
6. **Enable database backups**
7. **Set up monitoring** (e.g., Sentry for errors)

---

## 📚 Additional Resources

- **JWT:** https://jwt.io/
- **bcrypt:** https://github.com/kelektiv/node.bcrypt.js
- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **Express Security Best Practices:** https://expressjs.com/en/advanced/best-practice-security.html

---

## 💡 Pro Tips

1. **Use HTTPS in production** - Never send tokens over HTTP
2. **Rotate JWT secrets** periodically
3. **Monitor audit logs** for suspicious activity
4. **Implement 2FA** for admin accounts (future enhancement)
5. **Use API keys** for server-to-server integrations
6. **Regular security audits** and penetration testing

---

🎉 **Your authentication system is now production-ready!**

For support or questions, check the audit logs or error tracking system.
