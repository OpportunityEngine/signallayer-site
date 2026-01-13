// =====================================================
// SHARED NAVIGATION COMPONENT
// Role-based tab navigation for all dashboards
// =====================================================
// REQUIRES: auth-manager.js to be loaded first
// =====================================================

/**
 * Initialize navigation component
 * MUST be called after AuthManager.initialize() completes
 * @returns {Promise<void>}
 */
async function initializeNavigation() {
  // Get authenticated user from AuthManager (should already be initialized)
  const user = window.AuthManager.getUser();

  if (!user || !user.role) {
    // AuthManager should have already redirected, but just in case
    console.error('Navigation: No authenticated user found');
    return;
  }

  // Check if this is a demo user
  const isDemoUser = user.role === 'demo_business' || user.role === 'demo_viewer';

  // Define dashboard configurations
  // Demo roles have specific access patterns
  const dashboards = {
    analytics: {
      name: 'Analytics',
      url: '/dashboard/admin-ops.html',
      icon: '',
      roles: ['admin', 'demo_viewer']  // demo_viewer can see analytics (read-only)
    },
    admin: {
      name: 'Admin',
      url: '/dashboard/user-management.html',
      icon: '',
      roles: ['admin']  // Only true admins can manage users
    },
    manager: {
      name: 'Manager',
      url: '/dashboard/manager-view.html',
      icon: '',
      roles: ['admin', 'manager', 'customer_admin', 'demo_viewer']
    },
    vp: {
      name: 'Business',
      url: '/dashboard/vp-view.html',
      icon: '',
      roles: ['admin', 'customer_admin', 'demo_business', 'demo_viewer']
    },
    rep: {
      name: 'Rep',
      url: '/dashboard/rep-view.html',
      icon: '',
      roles: ['admin', 'manager', 'rep', 'demo_viewer']
    }
  };

  // Filter dashboards based on user role
  const availableDashboards = Object.entries(dashboards)
    .filter(([key, config]) => config.roles.includes(user.role))
    .map(([key, config]) => ({ key, ...config }));

  // Demo banner configuration
  const demoBannerHTML = isDemoUser ? `
    <div class="demo-banner">
      <div class="demo-banner-content">
        <span class="demo-badge">DEMO MODE</span>
        <span class="demo-text">
          ${user.role === 'demo_business' ? 'Business Dashboard Preview' : 'Full Platform Preview'} - Read Only
        </span>
        <a href="/dashboard/request-access.html" class="demo-cta">Get Full Access</a>
      </div>
    </div>
  ` : '';

  // Create navigation HTML
  const navHTML = `
    ${demoBannerHTML}
    <div class="dashboard-nav ${isDemoUser ? 'has-demo-banner' : ''}">
      <div class="nav-container">
        <div class="nav-left">
          <div class="nav-logo">
            <div class="logo-icon">$</div>
            <span class="logo-text">Revenue Radar</span>
            ${isDemoUser ? '<span class="demo-tag">DEMO</span>' : ''}
          </div>
          <div class="nav-tabs">
            ${availableDashboards.map(dash => `
              <a href="${dash.url}"
                 class="nav-tab ${getCurrentDashboard(dash.key) ? 'active' : ''}"
                 data-dashboard="${dash.key}">
                <span class="tab-icon">${dash.icon}</span>
                <span class="tab-name">${dash.name}</span>
              </a>
            `).join('')}
          </div>
        </div>
        <div class="nav-right">
          <div class="user-menu">
            <span class="user-name">${user.name || user.email}</span>
            <span class="user-role">${formatRole(user.role)}</span>
            ${isDemoUser ? '' : `
            <button class="settings-btn" onclick="openSettingsModal()" title="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            `}
            <button class="logout-btn" onclick="handleLogout()">Logout</button>
          </div>
        </div>
      </div>
    </div>

    <style>
      /* Demo Banner Styles */
      .demo-banner {
        background: linear-gradient(90deg, #7c3aed 0%, #4f46e5 50%, #7c3aed 100%);
        background-size: 200% 100%;
        animation: shimmer 3s ease-in-out infinite;
        padding: 10px 20px;
        text-align: center;
        position: sticky;
        top: 0;
        z-index: 1001;
        box-shadow: 0 2px 10px rgba(124, 58, 237, 0.4);
      }

      @keyframes shimmer {
        0%, 100% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
      }

      .demo-banner-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        flex-wrap: wrap;
      }

      .demo-badge {
        background: rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        border: 1px solid rgba(255, 255, 255, 0.3);
      }

      .demo-text {
        color: rgba(255, 255, 255, 0.95);
        font-size: 14px;
        font-weight: 500;
      }

      .demo-cta {
        background: #fbbf24;
        color: #1a1a1a;
        padding: 6px 16px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 700;
        text-decoration: none;
        transition: all 0.2s;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }

      .demo-cta:hover {
        background: #f59e0b;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .demo-tag {
        background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
        color: #fff;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.5px;
        margin-left: 8px;
        text-transform: uppercase;
      }

      .has-demo-banner {
        top: 42px;  /* Account for demo banner height */
      }

      .dashboard-nav {
        background: linear-gradient(135deg, rgba(17, 21, 37, 0.95) 0%, rgba(15, 19, 32, 0.98) 100%);
        backdrop-filter: blur(20px);
        border-bottom: 2px solid rgba(251, 191, 36, 0.25);
        padding: 0;
        position: sticky;
        top: 0;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .nav-container {
        max-width: 1600px;
        margin: 0 auto;
        padding: 0 24px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        height: 70px;
      }

      .nav-left {
        display: flex;
        align-items: center;
        gap: 40px;
      }

      .nav-logo {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .logo-icon {
        width: 40px;
        height: 40px;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 50%, #1a1a1a 100%);
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: 900;
        color: #fbbf24;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6),
                    0 2px 8px rgba(251, 191, 36, 0.2),
                    0 0 0 2px rgba(251, 191, 36, 0.3);
        border: 1.5px solid rgba(251, 191, 36, 0.4);
      }

      .logo-text {
        font-family: 'Montserrat', sans-serif;
        font-size: 20px;
        font-weight: 800;
        color: #ffffff;
        letter-spacing: 0.3px;
      }

      .nav-tabs {
        display: flex;
        gap: 4px;
      }

      .nav-tab {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 20px;
        border-radius: 8px;
        text-decoration: none;
        color: #94a3b8;
        font-weight: 600;
        font-size: 14px;
        transition: all 0.2s;
        border: 1px solid transparent;
      }

      .nav-tab:hover {
        background: rgba(251, 191, 36, 0.1);
        color: #fbbf24;
        border-color: rgba(251, 191, 36, 0.2);
      }

      .nav-tab.active {
        background: linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(245, 158, 11, 0.15) 100%);
        color: #fbbf24;
        border-color: rgba(251, 191, 36, 0.4);
        box-shadow: 0 2px 8px rgba(251, 191, 36, 0.15);
      }

      .tab-icon {
        font-size: 18px;
      }

      .user-menu {
        display: flex;
        align-items: center;
        gap: 16px;
      }

      .user-name {
        font-size: 14px;
        font-weight: 600;
        color: #e2e8f0;
      }

      .user-role {
        font-size: 12px;
        color: #94a3b8;
        background: rgba(251, 191, 36, 0.1);
        padding: 4px 10px;
        border-radius: 12px;
        border: 1px solid rgba(251, 191, 36, 0.2);
      }

      .settings-btn {
        width: 36px;
        height: 36px;
        padding: 0;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.3);
        border-radius: 8px;
        color: #fbbf24;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .settings-btn:hover {
        background: rgba(251, 191, 36, 0.2);
        border-color: rgba(251, 191, 36, 0.5);
        transform: rotate(45deg);
      }

      .logout-btn {
        padding: 8px 16px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 6px;
        color: #ef4444;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .logout-btn:hover {
        background: rgba(239, 68, 68, 0.2);
        border-color: rgba(239, 68, 68, 0.5);
      }

      @media (max-width: 1024px) {
        .nav-container {
          flex-direction: column;
          height: auto;
          padding: 16px 20px;
          gap: 16px;
        }

        .nav-left {
          flex-direction: column;
          gap: 16px;
          width: 100%;
        }

        .nav-tabs {
          width: 100%;
          overflow-x: auto;
        }

        .user-name {
          display: none;
        }
      }
    </style>
  `;

  // Insert navigation at the top of the body
  document.body.insertAdjacentHTML('afterbegin', navHTML);
}

/**
 * Determine if current page is the given dashboard
 * @param {string} key - Dashboard key (admin, manager, vp, rep)
 * @returns {boolean}
 */
function getCurrentDashboard(key) {
  const path = window.location.pathname;
  const dashboardMap = {
    'analytics': 'admin-ops.html',
    'admin': 'user-management.html',
    'manager': 'manager-view.html',
    'vp': 'vp-view.html',
    'rep': 'rep-view.html'
  };

  return path.includes(dashboardMap[key]);
}

/**
 * Format role for display
 * @param {string} role - User role
 * @returns {string}
 */
function formatRole(role) {
  const roleNames = {
    'admin': 'Administrator',
    'manager': 'Sales Manager',
    'customer_admin': 'VP/Regional',
    'rep': 'Sales Rep',
    'viewer': 'Viewer',
    'demo_business': 'Business Demo',
    'demo_viewer': 'Demo Viewer'
  };
  return roleNames[role] || role;
}

// =====================================================
// SETTINGS MODAL
// =====================================================

/**
 * Create and inject settings modal HTML
 */
function createSettingsModal() {
  const user = window.AuthManager.getUser();

  const modalHTML = `
    <div id="settingsModal" class="settings-modal-overlay" style="display: none;">
      <div class="settings-modal">
        <div class="settings-header">
          <h2>Settings</h2>
          <button class="settings-close" onclick="closeSettingsModal()">&times;</button>
        </div>

        <div class="settings-content">
          <!-- Profile Section -->
          <div class="settings-section">
            <h3>Profile</h3>
            <div class="profile-info">
              <div class="profile-row">
                <span class="profile-label">Name</span>
                <span class="profile-value">${user.name || 'Not set'}</span>
              </div>
              <div class="profile-row">
                <span class="profile-label">Email</span>
                <span class="profile-value">${user.email}</span>
              </div>
              <div class="profile-row">
                <span class="profile-label">Role</span>
                <span class="profile-value">${formatRole(user.role)}</span>
              </div>
              <div class="profile-row">
                <span class="profile-label">Account</span>
                <span class="profile-value">${user.accountName || 'Default'}</span>
              </div>
            </div>
          </div>

          <!-- Change Password Section -->
          <div class="settings-section">
            <h3>Change Password</h3>
            <form id="changePasswordForm" onsubmit="handleChangePassword(event)">
              <div class="settings-field">
                <label for="currentPassword">Current Password</label>
                <div class="password-field-wrapper">
                  <input type="password" id="currentPassword" required autocomplete="current-password">
                  <button type="button" class="pwd-toggle" onclick="toggleSettingsPassword('currentPassword')">Show</button>
                </div>
              </div>
              <div class="settings-field">
                <label for="newPassword">New Password</label>
                <div class="password-field-wrapper">
                  <input type="password" id="newPassword" required minlength="8" autocomplete="new-password">
                  <button type="button" class="pwd-toggle" onclick="toggleSettingsPassword('newPassword')">Show</button>
                </div>
                <div class="password-reqs">
                  <span id="settings-req-length" class="req-item">8+ chars</span>
                  <span id="settings-req-upper" class="req-item">Uppercase</span>
                  <span id="settings-req-lower" class="req-item">Lowercase</span>
                  <span id="settings-req-number" class="req-item">Number</span>
                </div>
              </div>
              <div class="settings-field">
                <label for="confirmNewPassword">Confirm New Password</label>
                <div class="password-field-wrapper">
                  <input type="password" id="confirmNewPassword" required autocomplete="new-password">
                  <button type="button" class="pwd-toggle" onclick="toggleSettingsPassword('confirmNewPassword')">Show</button>
                </div>
                <span id="settings-match-status" class="match-status"></span>
              </div>
              <div id="passwordChangeError" class="settings-error" style="display: none;"></div>
              <div id="passwordChangeSuccess" class="settings-success" style="display: none;"></div>
              <button type="submit" class="settings-submit" id="changePasswordBtn">Update Password</button>
            </form>
          </div>

          <!-- Session Info -->
          <div class="settings-section">
            <h3>Session</h3>
            <div class="session-info">
              <p>You can manage your active sessions and security settings here.</p>
              <button class="settings-btn-secondary" onclick="handleLogout()">Sign Out of All Devices</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <style>
      .settings-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }

      .settings-modal {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 16px;
        width: 100%;
        max-width: 480px;
        max-height: 90vh;
        overflow-y: auto;
        border: 2px solid rgba(251, 191, 36, 0.3);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      }

      .settings-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(251, 191, 36, 0.2);
      }

      .settings-header h2 {
        margin: 0;
        color: #fbbf24;
        font-size: 20px;
        font-weight: 700;
      }

      .settings-close {
        width: 32px;
        height: 32px;
        border: none;
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border-radius: 8px;
        font-size: 24px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      }

      .settings-close:hover {
        background: rgba(239, 68, 68, 0.2);
      }

      .settings-content {
        padding: 24px;
      }

      .settings-section {
        margin-bottom: 28px;
      }

      .settings-section:last-child {
        margin-bottom: 0;
      }

      .settings-section h3 {
        color: #e2e8f0;
        font-size: 14px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin: 0 0 16px 0;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .profile-info {
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
        padding: 16px;
      }

      .profile-row {
        display: flex;
        justify-content: space-between;
        padding: 10px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .profile-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }

      .profile-row:first-child {
        padding-top: 0;
      }

      .profile-label {
        color: #94a3b8;
        font-size: 13px;
      }

      .profile-value {
        color: #e2e8f0;
        font-size: 13px;
        font-weight: 600;
      }

      .settings-field {
        margin-bottom: 18px;
      }

      .settings-field label {
        display: block;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }

      .password-field-wrapper {
        display: flex;
        gap: 8px;
      }

      .settings-field input {
        flex: 1;
        padding: 12px 14px;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid rgba(251, 191, 36, 0.2);
        border-radius: 8px;
        color: #e2e8f0;
        font-size: 14px;
        transition: all 0.2s;
      }

      .settings-field input:focus {
        outline: none;
        border-color: rgba(251, 191, 36, 0.5);
        background: rgba(0, 0, 0, 0.4);
      }

      .pwd-toggle {
        padding: 0 14px;
        background: rgba(251, 191, 36, 0.1);
        border: 1px solid rgba(251, 191, 36, 0.2);
        border-radius: 8px;
        color: #fbbf24;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .pwd-toggle:hover {
        background: rgba(251, 191, 36, 0.2);
      }

      .password-reqs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .req-item {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 4px;
        background: rgba(100, 116, 139, 0.2);
        color: #64748b;
        transition: all 0.2s;
      }

      .req-item.valid {
        background: rgba(16, 185, 129, 0.2);
        color: #10b981;
      }

      .match-status {
        font-size: 12px;
        margin-top: 8px;
        display: block;
      }

      .match-status.match {
        color: #10b981;
      }

      .match-status.no-match {
        color: #ef4444;
      }

      .settings-error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 8px;
        padding: 12px;
        color: #fca5a5;
        font-size: 13px;
        margin-bottom: 16px;
      }

      .settings-success {
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(16, 185, 129, 0.3);
        border-radius: 8px;
        padding: 12px;
        color: #6ee7b7;
        font-size: 13px;
        margin-bottom: 16px;
      }

      .settings-submit {
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        border: none;
        border-radius: 8px;
        color: #1a1a1a;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      }

      .settings-submit:hover {
        opacity: 0.9;
        transform: translateY(-1px);
      }

      .settings-submit:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }

      .settings-btn-secondary {
        padding: 12px 20px;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 8px;
        color: #ef4444;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }

      .settings-btn-secondary:hover {
        background: rgba(239, 68, 68, 0.2);
      }

      .session-info p {
        color: #94a3b8;
        font-size: 13px;
        margin: 0 0 16px 0;
        line-height: 1.5;
      }
    </style>
  `;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  // Add password validation listeners
  const newPwdInput = document.getElementById('newPassword');
  const confirmPwdInput = document.getElementById('confirmNewPassword');

  if (newPwdInput) {
    newPwdInput.addEventListener('input', validateSettingsPassword);
  }
  if (confirmPwdInput) {
    confirmPwdInput.addEventListener('input', checkSettingsPasswordMatch);
  }
}

/**
 * Open settings modal
 */
function openSettingsModal() {
  // Create modal if it doesn't exist
  if (!document.getElementById('settingsModal')) {
    createSettingsModal();
  }

  document.getElementById('settingsModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Reset form
  const form = document.getElementById('changePasswordForm');
  if (form) form.reset();

  const errorDiv = document.getElementById('passwordChangeError');
  const successDiv = document.getElementById('passwordChangeSuccess');
  if (errorDiv) errorDiv.style.display = 'none';
  if (successDiv) successDiv.style.display = 'none';

  // Reset validation indicators
  ['settings-req-length', 'settings-req-upper', 'settings-req-lower', 'settings-req-number'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('valid');
  });

  const matchStatus = document.getElementById('settings-match-status');
  if (matchStatus) {
    matchStatus.textContent = '';
    matchStatus.className = 'match-status';
  }
}

/**
 * Close settings modal
 */
function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

/**
 * Toggle password visibility
 */
function toggleSettingsPassword(fieldId) {
  const input = document.getElementById(fieldId);
  const btn = input.nextElementSibling;

  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type = 'password';
    btn.textContent = 'Show';
  }
}

/**
 * Validate password requirements
 */
function validateSettingsPassword() {
  const password = document.getElementById('newPassword').value;

  const reqs = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password)
  };

  Object.keys(reqs).forEach(key => {
    const el = document.getElementById('settings-req-' + key);
    if (el) {
      if (reqs[key]) {
        el.classList.add('valid');
      } else {
        el.classList.remove('valid');
      }
    }
  });

  // Also check match if confirm field has value
  if (document.getElementById('confirmNewPassword').value) {
    checkSettingsPasswordMatch();
  }
}

/**
 * Check if passwords match
 */
function checkSettingsPasswordMatch() {
  const newPwd = document.getElementById('newPassword').value;
  const confirmPwd = document.getElementById('confirmNewPassword').value;
  const status = document.getElementById('settings-match-status');

  if (!confirmPwd) {
    status.textContent = '';
    status.className = 'match-status';
    return;
  }

  if (newPwd === confirmPwd) {
    status.textContent = 'Passwords match';
    status.className = 'match-status match';
  } else {
    status.textContent = 'Passwords do not match';
    status.className = 'match-status no-match';
  }
}

/**
 * Handle password change form submission
 */
async function handleChangePassword(event) {
  event.preventDefault();

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmNewPassword').value;
  const btn = document.getElementById('changePasswordBtn');
  const errorDiv = document.getElementById('passwordChangeError');
  const successDiv = document.getElementById('passwordChangeSuccess');

  // Hide previous messages
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';

  // Validate
  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    errorDiv.textContent = 'Password must be at least 8 characters with uppercase, lowercase, and number.';
    errorDiv.style.display = 'block';
    return;
  }

  if (newPassword !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match.';
    errorDiv.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    const token = window.AuthManager.getToken();
    const response = await fetch('/auth/change-password', {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      successDiv.textContent = 'Password changed successfully!';
      successDiv.style.display = 'block';
      document.getElementById('changePasswordForm').reset();

      // Reset validation indicators
      ['settings-req-length', 'settings-req-upper', 'settings-req-lower', 'settings-req-number'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('valid');
      });

      const matchStatus = document.getElementById('settings-match-status');
      if (matchStatus) {
        matchStatus.textContent = '';
        matchStatus.className = 'match-status';
      }
    } else {
      errorDiv.textContent = data.error || 'Failed to change password.';
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('Change password error:', error);
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Password';
  }
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSettingsModal();
  }
});

// Close modal on background click
document.addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') {
    closeSettingsModal();
  }
});

// Export for use in dashboards
window.initializeNavigation = initializeNavigation;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.toggleSettingsPassword = toggleSettingsPassword;
window.handleChangePassword = handleChangePassword;
