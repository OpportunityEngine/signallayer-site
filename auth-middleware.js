// =====================================================
// AUTHENTICATION MIDDLEWARE
// =====================================================
// Express middleware for:
// - JWT token validation
// - Role-based access control (RBAC)
// - Permission checking
// - Rate limiting
// - Input sanitization
// - CORS configuration
// =====================================================

const authService = require('./auth-service');
const db = require('./database');

// =====================================================
// AUTHENTICATION MIDDLEWARE
// =====================================================

/**
 * Require valid JWT token
 * Usage: app.get('/protected', requireAuth, (req, res) => {...})
 */
async function requireAuth(req, res, next) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.substring(7);  // Remove 'Bearer '

    // Verify token
    const verification = await authService.verifyToken(token);

    if (!verification.valid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN',
        details: verification.error
      });
    }

    // Attach user info to request
    req.user = verification.user;
    req.sessionId = verification.sessionId;

    next();
  } catch (error) {
    console.error('[AUTH MIDDLEWARE] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Optional auth - doesn't fail if no token, but validates if present
 * Usage: app.get('/public', optionalAuth, (req, res) => {...})
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const verification = await authService.verifyToken(token);

      if (verification.valid) {
        req.user = verification.user;
        req.sessionId = verification.sessionId;
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth
    next();
  }
}

// =====================================================
// ROLE-BASED ACCESS CONTROL (RBAC)
// =====================================================

/**
 * Require specific role(s)
 * Usage: app.get('/admin', requireAuth, requireRole('admin'), (req, res) => {...})
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
        required: allowedRoles,
        current: req.user.role
      });
    }

    next();
  };
}

/**
 * Require specific permission
 * Usage: app.post('/invoices', requireAuth, requirePermission('invoices.create'), (req, res) => {...})
 */
function requirePermission(permissionName) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    const hasPermission = checkUserPermission(req.user.role, permissionName);

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'FORBIDDEN',
        required: permissionName,
        role: req.user.role
      });
    }

    next();
  };
}

/**
 * Check if user role has permission
 */
function checkUserPermission(role, permissionName) {
  try {
    const database = db.getDatabase();

    const result = database.prepare(`
      SELECT COUNT(*) as count
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role = ? AND p.permission_name = ?
    `).get(role, permissionName);

    return result.count > 0;
  } catch (error) {
    console.error('[AUTH] Error checking permission:', error);
    return false;
  }
}

/**
 * Require user to own the resource (or be admin)
 * Usage: app.get('/users/:id', requireAuth, requireOwnership('userId'), (req, res) => {...})
 */
function requireOwnership(userIdParam = 'userId') {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Admins can access anything
    if (req.user.role === 'admin') {
      return next();
    }

    // Check if user owns the resource
    const resourceUserId = parseInt(req.params[userIdParam] || req.body[userIdParam]);

    if (resourceUserId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'You can only access your own resources',
        code: 'NOT_OWNER'
      });
    }

    next();
  };
}

/**
 * Require same account (multi-tenant isolation)
 * Usage: app.get('/invoices', requireAuth, requireSameAccount, (req, res) => {...})
 */
function requireSameAccount(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  // Admins can see all accounts
  if (req.user.role === 'admin') {
    return next();
  }

  // Attach account filter to request for query
  req.accountFilter = {
    accountName: req.user.accountName
  };

  next();
}

// =====================================================
// INPUT SANITIZATION
// =====================================================

/**
 * Sanitize all string inputs to prevent SQL injection and XSS
 */
function sanitizeInput(req, res, next) {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query params
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL params
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
}

/**
 * Recursively sanitize object
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }

  return sanitized;
}

/**
 * Sanitize string value
 */
function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  // Remove potential SQL injection patterns
  let sanitized = value;

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Escape HTML to prevent XSS (but allow normal special chars)
  sanitized = sanitized
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Remove SQL comment indicators
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');

  return sanitized.trim();
}

// =====================================================
// RATE LIMITING
// =====================================================

const rateLimitStore = new Map();  // In production, use Redis

/**
 * Rate limit requests per IP
 */
function rateLimit({ windowMs = 60000, maxRequests = 100, message = 'Too many requests' }) {
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    // Get request history for this IP
    let requests = rateLimitStore.get(key) || [];

    // Remove old requests outside window
    requests = requests.filter(timestamp => now - timestamp < windowMs);

    // Check if limit exceeded
    if (requests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((requests[0] + windowMs - now) / 1000)
      });
    }

    // Add this request
    requests.push(now);
    rateLimitStore.set(key, requests);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - requests.length);
    res.setHeader('X-RateLimit-Reset', new Date(requests[0] + windowMs).toISOString());

    next();
  };
}

// Cleanup old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, requests] of rateLimitStore.entries()) {
    const validRequests = requests.filter(timestamp => now - timestamp < 3600000);  // Keep 1 hour
    if (validRequests.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, validRequests);
    }
  }
}, 5 * 60 * 1000);

// =====================================================
// DEMO USER RESTRICTIONS
// =====================================================

/**
 * Demo role configuration
 * - demo_business: Only sees Business/VP dashboard (for local shops)
 * - demo_viewer: Sees Manager, Business, Rep, Analytics (read-only, safe to share)
 */
const DEMO_ROLES = {
  demo_business: {
    allowedDashboards: ['/dashboard/vp-view.html'],
    allowedAPIs: [
      '/api/dashboard',
      '/api/opportunities',
      '/api/analytics',
      '/api/commissions',
      '/auth/me',
      '/auth/refresh'
    ],
    blockedActions: ['POST', 'PUT', 'DELETE', 'PATCH'],
    displayName: 'Business Demo',
    description: 'View-only access to Business Dashboard'
  },
  demo_viewer: {
    allowedDashboards: [
      '/dashboard/manager-view.html',
      '/dashboard/vp-view.html',
      '/dashboard/rep-view.html',
      '/dashboard/admin-ops.html'
    ],
    allowedAPIs: [
      '/api/dashboard',
      '/api/opportunities',
      '/api/analytics',
      '/api/commissions',
      '/api/admin/usage-analytics',
      '/api/admin/system-health',
      '/api/admin/financial-metrics',
      '/api/admin/top-customers',
      '/api/admin/error-monitoring',
      '/api/admin/system-alerts',
      '/api/admin/recent-activity',
      '/api/admin/endpoint-stats',
      '/api/admin/live-users',
      '/api/users',
      '/auth/me',
      '/auth/refresh'
    ],
    blockedActions: ['POST', 'PUT', 'DELETE', 'PATCH'],
    displayName: 'Universal Demo',
    description: 'Read-only access to all dashboards'
  }
};

/**
 * Check if user is a demo account
 */
function isDemoUser(user) {
  return user && (user.role === 'demo_business' || user.role === 'demo_viewer');
}

/**
 * Get demo role configuration
 */
function getDemoConfig(role) {
  return DEMO_ROLES[role] || null;
}

/**
 * Middleware to enforce demo user restrictions
 * - Blocks write operations (POST, PUT, DELETE, PATCH)
 * - Only allows access to specific APIs
 * - Returns friendly error messages
 */
function enforceDemoRestrictions(req, res, next) {
  if (!req.user || !isDemoUser(req.user)) {
    return next();
  }

  const demoConfig = getDemoConfig(req.user.role);
  if (!demoConfig) {
    return next();
  }

  // Block all write operations for demo users
  if (demoConfig.blockedActions.includes(req.method)) {
    // Allow password change attempts (they'll fail gracefully with a nice message)
    if (req.path === '/auth/change-password') {
      return res.status(403).json({
        success: false,
        error: 'Demo accounts cannot change passwords. This is a read-only demo.',
        code: 'DEMO_RESTRICTED',
        isDemoAccount: true
      });
    }

    // Allow logout
    if (req.path === '/auth/logout') {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'This is a demo account with read-only access. Sign up for full access!',
      code: 'DEMO_READ_ONLY',
      isDemoAccount: true,
      action: req.method,
      hint: 'Visit /dashboard/request-access.html to request full access'
    });
  }

  // Check if API endpoint is allowed
  const isAllowedAPI = demoConfig.allowedAPIs.some(api => req.path.startsWith(api));

  if (!isAllowedAPI && req.path.startsWith('/api/')) {
    return res.status(403).json({
      success: false,
      error: 'This feature is not available in demo mode.',
      code: 'DEMO_FEATURE_RESTRICTED',
      isDemoAccount: true
    });
  }

  next();
}

/**
 * Middleware to add demo banner info to responses
 * Adds X-Demo-Mode header so frontend can show banner
 */
function addDemoHeaders(req, res, next) {
  if (req.user && isDemoUser(req.user)) {
    const demoConfig = getDemoConfig(req.user.role);
    res.setHeader('X-Demo-Mode', 'true');
    res.setHeader('X-Demo-Role', req.user.role);
    res.setHeader('X-Demo-Name', demoConfig?.displayName || 'Demo');
  }
  next();
}

// =====================================================
// CORS CONFIGURATION
// =====================================================

/**
 * CORS middleware for production
 */
function corsMiddleware(req, res, next) {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [
        'http://localhost:3000',
        'http://localhost:5050',
        'http://127.0.0.1:5050'
      ];

  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');  // 24 hours

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).send();
  }

  next();
}

// =====================================================
// SECURITY HEADERS
// =====================================================

/**
 * Add security headers to all responses
 */
function securityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self'"
  );

  // HTTPS only in production
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// =====================================================
// REQUEST LOGGING
// =====================================================

/**
 * Log all API requests
 */
function requestLogger(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logEntry = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      user: req.user ? req.user.email : 'anonymous'
    };

    console.log(`[API] ${logEntry.method} ${logEntry.path} - ${logEntry.status} - ${logEntry.duration} - ${logEntry.user}`);
  });

  next();
}

// =====================================================
// EXPORTS
// =====================================================

module.exports = {
  // Authentication
  requireAuth,
  optionalAuth,

  // Authorization
  requireRole,
  requirePermission,
  requireOwnership,
  requireSameAccount,
  checkUserPermission,

  // Demo restrictions
  isDemoUser,
  getDemoConfig,
  enforceDemoRestrictions,
  addDemoHeaders,
  DEMO_ROLES,

  // Security
  sanitizeInput,
  rateLimit,
  corsMiddleware,
  securityHeaders,

  // Logging
  requestLogger
};
