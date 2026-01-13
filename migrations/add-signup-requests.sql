-- Add signup_requests table for admin approval flow
-- Users can request access, admins approve/deny via email or dashboard

CREATE TABLE IF NOT EXISTS signup_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    company_name TEXT,
    requested_role TEXT DEFAULT 'rep' CHECK(requested_role IN ('rep', 'manager', 'viewer')),
    reason TEXT,                                    -- Why they need access
    linkedin_url TEXT,                              -- Optional verification
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
    admin_notes TEXT,                               -- Admin's notes on the request
    reviewed_by INTEGER,                            -- Admin who reviewed
    reviewed_at DATETIME,
    created_user_id INTEGER,                        -- User created on approval
    approval_token TEXT UNIQUE,                     -- For one-click email approve
    denial_token TEXT UNIQUE,                       -- For one-click email deny
    token_expires_at DATETIME,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reviewed_by) REFERENCES users(id),
    FOREIGN KEY (created_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_signup_requests_status ON signup_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signup_requests_email ON signup_requests(email);
CREATE INDEX IF NOT EXISTS idx_signup_requests_approval_token ON signup_requests(approval_token);
CREATE INDEX IF NOT EXISTS idx_signup_requests_denial_token ON signup_requests(denial_token);
