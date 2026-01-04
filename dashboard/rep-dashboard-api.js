// Rep Dashboard API Integration
// This file handles fetching data from the backend API
// Supports both demo mode (hardcoded) and production mode (live data)

const API_BASE = window.location.origin;

// Demo mode state
let DEMO_MODE = true;
let currentUser = { email: 'you@demo.com', name: 'You' };

// Check if we should use demo or production data
async function checkDemoMode() {
  try {
    const response = await fetch(`${API_BASE}/api/demo/status`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const result = await response.json();

    if (result.success) {
      DEMO_MODE = result.data.demo_mode;
      console.log(`🎯 Dashboard Mode: ${DEMO_MODE ? 'DEMO' : 'PRODUCTION'}`);
      console.log(`📊 Real data entries: ${result.data.real_data_count}`);
      return DEMO_MODE;
    }
  } catch (error) {
    console.error('Error checking demo mode:', error);
    DEMO_MODE = true; // Default to demo on error
  }

  return DEMO_MODE;
}

// ===== SPIF Data =====

async function getSPIFLeaderboard() {
  if (DEMO_MODE) {
    return {
      spif_name: 'ACTIVE SPIF - MOST MLAs REVIEWED THIS WEEK',
      end_date: 'Friday 11:59 PM',
      prize_amount: 10000, // cents
      leaderboard: [
        { rank: 1, user_name: 'John', current_value: 34 },
        { rank: 2, user_name: 'Sarah', current_value: 31 },
        { rank: 3, user_name: 'You', current_value: 28 }
      ]
    };
  }

  try {
    // Get active SPIFs
    const spifResponse = await fetch(`${API_BASE}/api/spifs/active`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const spifResult = await spifResponse.json();

    if (!spifResult.success || !spifResult.data.length) {
      return null;
    }

    const activeSPIF = spifResult.data[0]; // Get first active SPIF

    // Get leaderboard
    const leaderboardResponse = await fetch(`${API_BASE}/api/spifs/${activeSPIF.id}/leaderboard`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const leaderboardResult = await leaderboardResponse.json();

    if (!leaderboardResult.success) {
      return null;
    }

    const endDate = new Date(activeSPIF.end_date);
    const endDateStr = endDate.toLocaleString('en-US', {
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    return {
      spif_name: activeSPIF.name.toUpperCase(),
      end_date: endDateStr,
      prize_amount: activeSPIF.prize_amount_cents,
      leaderboard: leaderboardResult.data.map(item => ({
        rank: item.rank,
        user_name: item.user_name,
        current_value: item.current_value
      }))
    };
  } catch (error) {
    console.error('Error fetching SPIF data:', error);
    return null;
  }
}

// ===== Opportunities Data =====

async function getOpportunities() {
  if (DEMO_MODE) {
    return [
      {
        id: 1,
        account_name: "Bella's Italian Kitchen",
        opportunity_type: 'Equipment Upgrade',
        status: 'Not Contacted',
        urgency: 'critical',
        likelihood_pct: 92,
        estimated_value_cents: 3250000,
        estimated_commission_cents: 162500,
        detected_at: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'MLA expires in 45 days • High likelihood to renew with equipment upgrade'
      },
      {
        id: 2,
        account_name: 'Sunset Bistro',
        opportunity_type: 'MLA Renewal + Service Package',
        status: 'Follow-Up Due',
        urgency: 'high',
        likelihood_pct: 88,
        estimated_value_cents: 2800000,
        estimated_commission_cents: 140000,
        detected_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'Strong payment history • Last contact: 8 days ago • Requested pricing info'
      },
      {
        id: 3,
        account_name: 'Downtown Diner',
        opportunity_type: 'Aging Oven Replacement',
        status: 'Active',
        urgency: 'medium',
        likelihood_pct: 85,
        estimated_value_cents: 1850000,
        estimated_commission_cents: 92500,
        detected_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        notes: 'Equipment analysis flagged 8-year-old oven • Contacted 2 days ago • Meeting scheduled'
      }
    ];
  }

  try {
    const response = await fetch(`${API_BASE}/api/opportunities`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const result = await response.json();

    if (result.success) {
      return result.data;
    }

    return [];
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    return [];
  }
}

// ===== Commission Data =====

async function getCommissionSummary() {
  if (DEMO_MODE) {
    return {
      this_month: { total_cents: 842000, count: 12 },
      spif_bonuses: 75000,
      ready_to_earn: 417500
    };
  }

  try {
    const response = await fetch(`${API_BASE}/api/commissions/summary`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const result = await response.json();

    if (result.success) {
      return {
        this_month: result.data.this_month,
        spif_bonuses: 0, // Calculate from SPIF data
        ready_to_earn: result.data.pending_cents
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching commission data:', error);
    return null;
  }
}

// ===== Dashboard Summary =====

async function getDashboardSummary() {
  if (DEMO_MODE) {
    return {
      mlas_reviewed: 28,
      opportunities_found: 18,
      tool_activity: 65,
      conversion_rate: 38
    };
  }

  try {
    const response = await fetch(`${API_BASE}/api/dashboard/rep-summary`, {
      headers: { 'x-user-email': currentUser.email }
    });
    const result = await response.json();

    if (result.success) {
      return {
        mlas_reviewed: result.data.spifs.user_stats.mlas_reviewed_this_week,
        opportunities_found: result.data.opportunities.total,
        tool_activity: 0, // From telemetry
        conversion_rate: Math.round(
          (result.data.opportunities.by_status.won / result.data.opportunities.total) * 100
        )
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching dashboard summary:', error);
    return null;
  }
}

// ===== Record MLA Review (triggers SPIF update) =====

async function recordMLAReview(mlaId, action = 'viewed', notes = null) {
  try {
    const response = await fetch(`${API_BASE}/api/mlas/${mlaId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': currentUser.email
      },
      body: JSON.stringify({ action, notes })
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ MLA review recorded. MLAs this week: ${result.data.mlas_reviewed_this_week}`);
      return result.data;
    }

    return null;
  } catch (error) {
    console.error('Error recording MLA review:', error);
    return null;
  }
}

// ===== Track Telemetry Event =====

async function trackEvent(eventType, eventData = {}) {
  try {
    const response = await fetch(`${API_BASE}/api/telemetry/track`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': currentUser.email
      },
      body: JSON.stringify({
        event_type: eventType,
        event_data: eventData,
        page_url: window.location.href,
        session_id: sessionStorage.getItem('session_id') || generateSessionId()
      })
    });

    return await response.json();
  } catch (error) {
    console.error('Error tracking event:', error);
    return null;
  }
}

function generateSessionId() {
  const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  sessionStorage.setItem('session_id', sessionId);
  return sessionId;
}

// ===== Update Opportunity Status =====

async function updateOpportunityStatus(oppId, status, notes = null) {
  try {
    const response = await fetch(`${API_BASE}/api/opportunities/${oppId}/update-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-email': currentUser.email
      },
      body: JSON.stringify({ status, notes })
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Opportunity ${oppId} status updated to ${status}`);
      // Track event
      await trackEvent('opportunity_status_changed', { opportunity_id: oppId, new_status: status });
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error updating opportunity status:', error);
    return false;
  }
}

// ===== Utility Functions =====

function formatCurrency(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ===== Demo Mode Toggle =====

function toggleDemoMode(forceDemoMode = null) {
  if (forceDemoMode !== null) {
    DEMO_MODE = forceDemoMode;
  } else {
    DEMO_MODE = !DEMO_MODE;
  }

  localStorage.setItem('revenue_radar_demo_mode', DEMO_MODE ? '1' : '0');
  console.log(`🎯 Demo mode ${DEMO_MODE ? 'ENABLED' : 'DISABLED'}`);

  // Reload dashboard data
  if (typeof refreshDashboard === 'function') {
    refreshDashboard();
  }

  return DEMO_MODE;
}

// Load demo mode preference from localStorage
const savedDemoMode = localStorage.getItem('revenue_radar_demo_mode');
if (savedDemoMode !== null) {
  DEMO_MODE = savedDemoMode === '1';
}

// Export for use in dashboard
window.RevenueRadarAPI = {
  checkDemoMode,
  getSPIFLeaderboard,
  getOpportunities,
  getCommissionSummary,
  getDashboardSummary,
  recordMLAReview,
  trackEvent,
  updateOpportunityStatus,
  toggleDemoMode,
  formatCurrency,
  formatDate,
  get demoMode() { return DEMO_MODE; },
  get currentUser() { return currentUser; },
  setUser(email, name) {
    currentUser = { email, name };
  }
};

console.log('✅ Revenue Radar API Client loaded');
