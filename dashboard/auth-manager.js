// =====================================================
// AUTHENTICATION MANAGER - Singleton Pattern
// Centralized auth state management for Revenue Radar
// =====================================================
// Prevents race conditions and ensures single source of truth
// for authentication state across all dashboards
// =====================================================

(function() {
  'use strict';

  class AuthManager {
    constructor() {
      this._user = null;
      this._token = null;
      this._initPromise = null;
      this._initialized = false;
    }

    /**
     * Initialize authentication state
     * Returns same promise for all callers (prevents race conditions)
     * @returns {Promise<Object|null>} User object or null
     */
    async initialize() {
      // Return cached promise if already initializing
      if (this._initPromise) {
        return this._initPromise;
      }

      // Return cached result if already initialized
      if (this._initialized) {
        return this._user;
      }

      // Create new initialization promise
      this._initPromise = this._performInitialization();

      try {
        const user = await this._initPromise;
        this._initialized = true;
        return user;
      } catch (error) {
        // Reset on error so retry is possible
        this._initPromise = null;
        throw error;
      }
    }

    /**
     * Perform actual initialization logic
     * @private
     */
    async _performInitialization() {
      // Check for retry loop prevention
      const retryCount = parseInt(sessionStorage.getItem('auth_init_retry') || '0');
      if (retryCount > 2) {
        sessionStorage.removeItem('auth_init_retry');
        this._clearAuthAndRedirect('Too many authentication attempts');
        throw new Error('Max auth retries exceeded');
      }

      try {
        // Step 1: Read from localStorage
        this._token = localStorage.getItem('accessToken');
        const userJson = localStorage.getItem('user');

        // Step 2: Validate token exists
        if (!this._token) {
          this._clearAuthAndRedirect('No access token found');
          return null;
        }

        // Step 3: Parse user object
        let user = null;
        try {
          user = userJson ? JSON.parse(userJson) : null;
        } catch (e) {
          console.error('Failed to parse user object:', e);
          user = null;
        }

        // Step 4: If user object is valid and has role, we're done
        if (user && user.role && user.id) {
          this._user = user;
          sessionStorage.removeItem('auth_init_retry');
          return user;
        }

        // Step 5: User object invalid - fetch from backend
        sessionStorage.setItem('auth_init_retry', String(retryCount + 1));

        const response = await fetch('/auth/me', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this._token}`,
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          if (response.status === 401) {
            this._clearAuthAndRedirect('Session expired');
          } else {
            throw new Error(`Auth check failed: ${response.status}`);
          }
          return null;
        }

        const data = await response.json();

        if (!data.success || !data.data) {
          this._clearAuthAndRedirect('Invalid auth response');
          return null;
        }

        // Step 6: Store fetched user data
        this._user = data.data;
        localStorage.setItem('user', JSON.stringify(data.data));
        sessionStorage.removeItem('auth_init_retry');

        return this._user;

      } catch (error) {
        console.error('Auth initialization error:', error);

        // Don't redirect on network errors - let user retry
        if (error.message.includes('fetch') || error.message.includes('network')) {
          throw new Error('Network error during authentication. Please check your connection.');
        }

        this._clearAuthAndRedirect('Authentication failed');
        throw error;
      }
    }

    /**
     * Get current user (null if not initialized)
     */
    getUser() {
      return this._user;
    }

    /**
     * Get access token (null if not authenticated)
     */
    getToken() {
      return this._token;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
      return !!(this._user && this._token);
    }

    /**
     * Require specific role(s) - redirects if not authorized
     * @param {string|string[]} allowedRoles - Single role or array of roles
     * @param {string} redirectUrl - Where to redirect if unauthorized
     */
    requireRole(allowedRoles, redirectUrl = null) {
      if (!this._user || !this._user.role) {
        this._clearAuthAndRedirect('No user role found');
        throw new Error('User not authenticated');
      }

      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      if (!roles.includes(this._user.role)) {
        const defaultDashboard = this._getDefaultDashboard(this._user.role);
        const targetUrl = redirectUrl || defaultDashboard;

        // Show brief message before redirect
        if (targetUrl !== window.location.pathname) {
          alert(`Access denied. Redirecting to your dashboard.`);
          window.location.href = targetUrl;
        }

        throw new Error(`Insufficient permissions. Required: ${roles.join(', ')}, Got: ${this._user.role}`);
      }

      return true;
    }

    /**
     * Get default dashboard for a role
     * @private
     */
    _getDefaultDashboard(role) {
      const dashboards = {
        'admin': '/dashboard/manager-view.html',
        'customer_admin': '/dashboard/manager-view.html',
        'manager': '/dashboard/manager-view.html',
        'rep': '/dashboard/rep-view.html',
        'viewer': '/dashboard/rep-view.html'
      };
      return dashboards[role] || '/dashboard/login.html';
    }

    /**
     * Logout user
     */
    logout() {
      this._clearStorage();
      window.location.href = '/dashboard/login.html';
    }

    /**
     * Clear auth state and redirect to login
     * @private
     */
    _clearAuthAndRedirect(reason = '') {
      this._clearStorage();

      // Only redirect if not already on login page
      if (!window.location.pathname.includes('login.html')) {
        window.location.href = '/dashboard/login.html';
      }
    }

    /**
     * Clear all auth-related storage
     * @private
     */
    _clearStorage() {
      this._user = null;
      this._token = null;
      this._initialized = false;
      this._initPromise = null;

      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      sessionStorage.removeItem('auth_init_retry');
    }
  }

  // Create singleton instance
  window.AuthManager = new AuthManager();

  // Expose logout function globally for nav bar
  window.handleLogout = function() {
    if (confirm('Are you sure you want to logout?')) {
      window.AuthManager.logout();
    }
  };

})();
