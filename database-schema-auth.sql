-- =====================================================
-- AUTHENTICATION & SECURITY SCHEMA
-- =====================================================
-- Production-grade user authentication system
-- Role-based access control (RBAC)
-- Session management with JWT tokens
-- API key management for integrations
-- Password reset with secure tokens
-- =====================================================

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Identity
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,

    -- Role-based access control
    role TEXT NOT NULL CHECK(role IN ('admin', 'rep', 'viewer', 'customer_admin')) DEFAULT 'rep',

    -- Account association (multi-tenant support)
    account_name TEXT,  -- Which customer account they belong to

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_email_verified BOOLEAN DEFAULT FALSE,
    email_verified_at DATETIME,

    -- Security
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,  -- Account lockout for security
    last_login_at DATETIME,
    last_login_ip TEXT,

    -- Password management
    password_reset_token TEXT,
    password_reset_expires DATETIME,
    password_changed_at DATETIME,
    force_password_change BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,

    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- =====================================================
-- SESSIONS TABLE (JWT token tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,

    -- Token information
    token_jti TEXT UNIQUE NOT NULL,  -- JWT ID for token revocation
    refresh_token_hash TEXT,         -- Hashed refresh token

    -- Session metadata
    ip_address TEXT,
    user_agent TEXT,
    device_info TEXT,

    -- Expiration
    expires_at DATETIME NOT NULL,
    refresh_expires_at DATETIME,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at DATETIME,
    revoked_reason TEXT,

    -- Tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- API KEYS TABLE (for external integrations)
-- =====================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Owner
    user_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,

    -- Key information
    key_name TEXT NOT NULL,  -- Friendly name: "Zapier Integration", "Mobile App"
    key_prefix TEXT NOT NULL UNIQUE,  -- First 8 chars for identification: "sk_live_12345678"
    key_hash TEXT NOT NULL,  -- Hashed full key

    -- Permissions (JSON array of allowed scopes)
    scopes TEXT DEFAULT '["read"]',  -- e.g., ["read", "write", "admin"]

    -- Rate limiting
    rate_limit_per_hour INTEGER DEFAULT 1000,
    requests_count INTEGER DEFAULT 0,
    last_request_at DATETIME,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    expires_at DATETIME,

    -- Security
    last_used_at DATETIME,
    last_used_ip TEXT,

    -- Tracking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL,
    revoked_at DATETIME,
    revoked_by INTEGER,
    revoked_reason TEXT,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (revoked_by) REFERENCES users(id)
);

-- =====================================================
-- ROLES & PERMISSIONS (for fine-grained access control)
-- =====================================================
CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    permission_name TEXT UNIQUE NOT NULL,  -- e.g., "invoices.read", "users.create"
    description TEXT,
    category TEXT,  -- "invoices", "users", "settings", etc.

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    role TEXT NOT NULL,  -- 'admin', 'rep', 'viewer', etc.
    permission_id INTEGER NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role, permission_id)
);

-- =====================================================
-- AUDIT LOG (track all security-sensitive actions)
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Actor
    user_id INTEGER,
    user_email TEXT,

    -- Action
    action TEXT NOT NULL,  -- "login", "logout", "password_reset", "user_created", etc.
    resource_type TEXT,    -- "user", "api_key", "session"
    resource_id INTEGER,

    -- Details
    description TEXT,
    metadata TEXT,  -- JSON with additional context

    -- Request context
    ip_address TEXT,
    user_agent TEXT,

    -- Status
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,

    -- Timestamp
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- =====================================================
-- PASSWORD HISTORY (prevent password reuse)
-- =====================================================
CREATE TABLE IF NOT EXISTS password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,
    password_hash TEXT NOT NULL,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- EMAIL VERIFICATION TOKENS
-- =====================================================
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at DATETIME NOT NULL,

    used_at DATETIME,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_name);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active, expires_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- =====================================================
-- SEED DEFAULT PERMISSIONS
-- =====================================================
INSERT OR IGNORE INTO permissions (permission_name, description, category) VALUES
-- Invoice permissions
('invoices.read', 'View invoices and savings', 'invoices'),
('invoices.create', 'Upload and process invoices', 'invoices'),
('invoices.delete', 'Delete invoices', 'invoices'),

-- User management
('users.read', 'View users in account', 'users'),
('users.create', 'Create new users', 'users'),
('users.update', 'Update user information', 'users'),
('users.delete', 'Delete users', 'users'),

-- Settings
('settings.read', 'View account settings', 'settings'),
('settings.update', 'Update account settings', 'settings'),

-- Email monitors
('email_monitors.read', 'View email monitors', 'email_monitors'),
('email_monitors.create', 'Create email monitors', 'email_monitors'),
('email_monitors.update', 'Update email monitors', 'email_monitors'),
('email_monitors.delete', 'Delete email monitors', 'email_monitors'),

-- API keys
('api_keys.read', 'View API keys', 'api_keys'),
('api_keys.create', 'Create API keys', 'api_keys'),
('api_keys.revoke', 'Revoke API keys', 'api_keys'),

-- Admin functions
('admin.errors', 'View error logs and system health', 'admin'),
('admin.analytics', 'View admin analytics dashboard', 'admin'),
('admin.audit_log', 'View audit logs', 'admin');

-- =====================================================
-- ASSIGN PERMISSIONS TO ROLES
-- =====================================================

-- ADMIN: Full access to everything
INSERT OR IGNORE INTO role_permissions (role, permission_id)
SELECT 'admin', id FROM permissions;

-- REP: Can manage invoices and view data
INSERT OR IGNORE INTO role_permissions (role, permission_id)
SELECT 'rep', id FROM permissions WHERE permission_name IN (
    'invoices.read',
    'invoices.create',
    'email_monitors.read',
    'settings.read'
);

-- VIEWER: Read-only access
INSERT OR IGNORE INTO role_permissions (role, permission_id)
SELECT 'viewer', id FROM permissions WHERE permission_name IN (
    'invoices.read',
    'email_monitors.read',
    'settings.read'
);

-- CUSTOMER_ADMIN: Admin for their account only
INSERT OR IGNORE INTO role_permissions (role, permission_id)
SELECT 'customer_admin', id FROM permissions WHERE permission_name NOT LIKE 'admin.%';

-- =====================================================
-- CREATE DEFAULT ADMIN USER (password: Admin123!)
-- =====================================================
-- Password hash for "Admin123!" using bcrypt
-- You should change this immediately after first login
INSERT OR IGNORE INTO users (
    email,
    password_hash,
    full_name,
    role,
    is_active,
    is_email_verified,
    email_verified_at
) VALUES (
    'admin@revenueradar.com',
    '$2b$10$rXqEhXzVQd5H1N2z8OhZKOVFjJGZ9Nxz7vQKmYwJmKkVzXQYZmE0u',  -- Admin123!
    'System Administrator',
    'admin',
    TRUE,
    TRUE,
    CURRENT_TIMESTAMP
);
