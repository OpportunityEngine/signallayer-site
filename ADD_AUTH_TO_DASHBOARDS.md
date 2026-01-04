# Adding Authentication to Existing Dashboards

Quick guide to protect your dashboards with authentication.

---

## 🔐 Step 1: Add Auth Check Script

Add this script to the `<head>` section of each dashboard HTML file:

```html
<script>
// Authentication check - place in <head> before other scripts
(function() {
  const accessToken = localStorage.getItem('accessToken');
  const userStr = localStorage.getItem('user');
  
  if (!accessToken || !userStr) {
    window.location.href = '/dashboard/login.html';
    return;
  }

  // Parse user data
  window.currentUser = JSON.parse(userStr);

  // Role-based access control (customize per page)
  const requiredRole = 'admin'; // Change to 'rep', 'viewer', etc.
  if (window.currentUser.role !== requiredRole && requiredRole !== 'any') {
    alert('Access denied. Required role: ' + requiredRole);
    window.location.href = '/dashboard/login.html';
  }
})();
</script>
```

---

## 📊 Step 2: Add Authenticated API Helper

Add this helper function for making authenticated API calls:

```javascript
async function authenticatedFetch(url, options = {}) {
  let token = localStorage.getItem('accessToken');
  
  const makeRequest = async (authToken) => {
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
  };

  let response = await makeRequest(token);

  // If unauthorized, try to refresh token
  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken');
    
    if (!refreshToken) {
      window.location.href = '/dashboard/login.html';
      return;
    }

    try {
      const refreshResponse = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        localStorage.setItem('accessToken', data.accessToken);
        token = data.accessToken;
        
        // Retry original request with new token
        response = await makeRequest(token);
      } else {
        // Refresh failed - logout
        localStorage.clear();
        window.location.href = '/dashboard/login.html';
        return;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      localStorage.clear();
      window.location.href = '/dashboard/login.html';
      return;
    }
  }

  return response;
}
```

---

## 🚪 Step 3: Add Logout Button

Add this to your dashboard navigation:

```html
<!-- In your navigation bar -->
<div style="display: flex; align-items: center; gap: 12px;">
  <span id="userDisplayName" style="color: #94a3b8; font-size: 14px;"></span>
  <button onclick="logout()" style="background: #4b5563; color: white; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
    Logout
  </button>
</div>

<script>
// Display current user
document.getElementById('userDisplayName').textContent = 
  window.currentUser ? window.currentUser.fullName : '';

async function logout() {
  const refreshToken = localStorage.getItem('refreshToken');
  const accessToken = localStorage.getItem('accessToken');
  
  try {
    await fetch('/auth/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken })
    });
  } catch (error) {
    console.error('Logout error:', error);
  }

  // Clear local storage
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  
  // Redirect to login
  window.location.href = '/dashboard/login.html';
}
</script>
```

---

## 🔄 Step 4: Update API Calls

Replace existing fetch calls with the authenticated version:

**Before:**
```javascript
const response = await fetch('/api/dashboard/rep-summary');
const data = await response.json();
```

**After:**
```javascript
const response = await authenticatedFetch('/api/dashboard/rep-summary');
const data = await response.json();
```

---

## 📝 Complete Example

Here's a complete example for a protected dashboard:

```html
<!doctype html>
<html>
<head>
  <title>Protected Dashboard</title>
  
  <!-- Auth Check - MUST BE FIRST -->
  <script>
  (function() {
    const accessToken = localStorage.getItem('accessToken');
    const userStr = localStorage.getItem('user');
    
    if (!accessToken || !userStr) {
      window.location.href = '/dashboard/login.html';
      return;
    }

    window.currentUser = JSON.parse(userStr);

    // Admin-only page
    if (window.currentUser.role !== 'admin') {
      alert('Admin access required');
      window.location.href = '/dashboard/login.html';
    }
  })();
  </script>

  <!-- Authenticated Fetch Helper -->
  <script>
  async function authenticatedFetch(url, options = {}) {
    let token = localStorage.getItem('accessToken');
    
    const makeRequest = async (authToken) => {
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
    };

    let response = await makeRequest(token);

    if (response.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      
      if (!refreshToken) {
        window.location.href = '/dashboard/login.html';
        return;
      }

      const refreshResponse = await fetch('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      if (refreshResponse.ok) {
        const data = await refreshResponse.json();
        localStorage.setItem('accessToken', data.accessToken);
        response = await makeRequest(data.accessToken);
      } else {
        localStorage.clear();
        window.location.href = '/dashboard/login.html';
        return;
      }
    }

    return response;
  }

  async function logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    const accessToken = localStorage.getItem('accessToken');
    
    await fetch('/auth/logout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken })
    }).catch(() => {});

    localStorage.clear();
    window.location.href = '/dashboard/login.html';
  }
  </script>
</head>
<body>
  <header>
    <h1>My Dashboard</h1>
    <div>
      <span id="userName"></span>
      <button onclick="logout()">Logout</button>
    </div>
  </header>

  <main>
    <!-- Your dashboard content -->
  </main>

  <script>
  // Display user name
  document.getElementById('userName').textContent = window.currentUser.fullName;

  // Load dashboard data with authentication
  async function loadDashboard() {
    const response = await authenticatedFetch('/api/dashboard/rep-summary');
    const data = await response.json();
    // Use data...
  }

  loadDashboard();
  </script>
</body>
</html>
```

---

## 🎯 Quick Checklist for Each Dashboard

- [ ] Add auth check script to `<head>`
- [ ] Add `authenticatedFetch` helper function
- [ ] Add logout button to navigation
- [ ] Display current user name
- [ ] Replace all `fetch()` calls with `authenticatedFetch()`
- [ ] Test login redirect (try accessing without login)
- [ ] Test role-based access (try with different user roles)
- [ ] Test logout button

---

## 🔑 Role Permissions Reference

### admin
- Full access to all dashboards
- Can access `/dashboard/manager-view.html`
- Can access `/dashboard/user-management.html`
- Can access `/dashboard/admin-operations.html`

### rep
- Access to sales dashboards
- Can access `/dashboard/revenue-dashboard.html`
- Cannot access admin pages

### viewer
- Read-only access
- Can access `/dashboard/revenue-dashboard.html`
- Cannot modify data

### customer_admin
- Customer portal access
- Custom permissions (define as needed)

---

## ⚡ Quick Commands

```bash
# Test if auth is working
curl http://localhost:5050/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create test users
node scripts/create-admin.js
```

---

**Tip:** Start with one dashboard (like manager-view.html), add auth protection, test thoroughly, then apply to others!
