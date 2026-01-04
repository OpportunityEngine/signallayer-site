// =====================================================
// SHARED NAVIGATION COMPONENT
// Role-based tab navigation for all dashboards
// =====================================================

function initializeNavigation() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const accessToken = localStorage.getItem('accessToken');

  if (!accessToken || !user.role) {
    window.location.href = '/dashboard/login.html';
    return;
  }

  // Define dashboard configurations
  const dashboards = {
    admin: {
      name: 'Admin',
      url: '/dashboard/user-management.html',
      icon: '⚙️',
      roles: ['admin']
    },
    manager: {
      name: 'Manager',
      url: '/dashboard/manager-view.html',
      icon: '📊',
      roles: ['admin', 'manager']
    },
    vp: {
      name: 'VP',
      url: 'http://localhost:5173/dashboard',
      icon: '🎯',
      roles: ['admin', 'customer_admin']
    },
    rep: {
      name: 'Rep',
      url: '/dashboard/rep-view.html',
      icon: '💰',
      roles: ['admin', 'manager', 'rep']
    }
  };

  // Filter dashboards based on user role
  const availableDashboards = Object.entries(dashboards)
    .filter(([key, config]) => config.roles.includes(user.role))
    .map(([key, config]) => ({ key, ...config }));

  // Create navigation HTML
  const navHTML = `
    <div class="dashboard-nav">
      <div class="nav-container">
        <div class="nav-left">
          <div class="nav-logo">
            <div class="logo-icon">R</div>
            <span class="logo-text">Revenue Radar</span>
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
            <span class="user-name">${user.name}</span>
            <span class="user-role">${formatRole(user.role)}</span>
            <button class="logout-btn" onclick="handleLogout()">Logout</button>
          </div>
        </div>
      </div>
    </div>

    <style>
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

// Helper: Determine current dashboard
function getCurrentDashboard(key) {
  const path = window.location.pathname;
  const dashboardMap = {
    'admin': 'user-management.html',
    'manager': 'manager-view.html',
    'vp': 'localhost:5173',
    'rep': 'rep-view.html'
  };

  if (key === 'vp' && window.location.href.includes('localhost:5173')) {
    return true;
  }

  return path.includes(dashboardMap[key]);
}

// Helper: Format role for display
function formatRole(role) {
  const roleNames = {
    'admin': 'Administrator',
    'manager': 'Sales Manager',
    'customer_admin': 'VP/Regional',
    'rep': 'Sales Rep',
    'viewer': 'Viewer'
  };
  return roleNames[role] || role;
}

// Handle logout
function handleLogout() {
  if (confirm('Are you sure you want to logout?')) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '/dashboard/login.html';
  }
}

// Auto-initialize when script loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeNavigation);
} else {
  initializeNavigation();
}
