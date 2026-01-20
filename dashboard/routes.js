const express = require("express");
const demo = require("./demoData");
const { getDashboard } = require("./fromRuns");

const router = express.Router();

// Demo user detection
const DEMO_ROLES = ['demo_viewer', 'demo_business'];
const DEMO_EMAILS = ['demo@revenueradar.com', 'business@demo.revenueradar.com'];

function isDemoUser(req) {
  const user = req.user || {};
  if (DEMO_ROLES.includes(user.role)) return true;
  if (DEMO_EMAILS.includes((user.email || '').toLowerCase())) return true;
  return false;
}

function pickSource(req) {
  // Check if user is a demo user - always use demo data for them
  if (isDemoUser(req)) {
    return { mode: "demo" };
  }

  // For real users, check mode parameter
  const mode = String(req.query.mode || "").toLowerCase();
  if (mode === "demo") return { mode: "demo" };
  if (mode === "runs") return { mode: "runs" };
  return { mode: "auto" };
}

function getFilters(req) {
  // Extract userId from JWT auth for filtering real data
  const userId = req.user?.id || null;

  return {
    userId: userId,  // Pass userId for filtering
    companyId: String(req.query.companyId || "demo-company"),
    dateFrom: String(req.query.dateFrom || ""),
    dateTo: String(req.query.dateTo || ""),
    impactPeriod: String((req.query.impactPeriod || req.query.impact || "weekly")).toLowerCase(),
    impact: String((req.query.impact || req.query.impactPeriod || "weekly")).toLowerCase(),
    vendorId: req.query.vendorId ? String(req.query.vendorId) : undefined,
    locationId: req.query.locationId ? String(req.query.locationId) : undefined,
    minConfidence: req.query.minConfidence ? String(req.query.minConfidence) : "HIGH",
  };
}



function confidenceRank(c) {
  return c === "HIGH" ? 2 : 1;
}

router.get("/metrics", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  // Demo users always get demo data
  if (pick.mode === "demo") return res.json({ ok: true, metrics: demo.metrics });

  // Real users get their own data
  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, metrics: d.metrics });
  }

  // Fallback: if real user has no data, show empty state (not demo data)
  return res.json({
    ok: true,
    metrics: {
      totalPotentialOverbillingCents: 0,
      vendorsImpactedCount: 0,
      invoicesAnalyzedCount: 0,
      locationsCount: 0,
      flaggedIssuesCount: 0,
      avgMonthlyImpactCents: 0,
    }
  });
});

router.get("/breakdown/vendors", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  // Demo users always get demo data
  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.vendorRows });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.vendorRows });
  }

  // Real user with no data gets empty array
  return res.json({ ok: true, rows: [] });
});

router.get("/breakdown/locations", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  // Demo users always get demo data
  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.locationRows });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.locationRows });
  }

  // Real user with no data gets empty array
  return res.json({ ok: true, rows: [] });
});

router.get("/issues", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  // Demo users always get demo data
  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.issues });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.issues });
  }

  // Real user with no data gets empty array
  return res.json({ ok: true, rows: [] });
});

router.get("/issues/:issueId/proof", (req, res) => {
  const { issueId } = req.params;
  const pick = pickSource(req);
  const filters = getFilters(req);

  // For demo users, use demo proof data
  if (pick.mode === "demo") {
    const proof = demo.proofByIssueId[issueId];
    if (!proof) return res.status(404).json({ ok: false, error: "Unknown issueId", issueId });
    return res.json({ ok: true, proof });
  }

  // For real users, get their own proof data
  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    const proof = d.proofByIssueId[issueId];
    if (proof) return res.json({ ok: true, proof });
  }

  return res.status(404).json({ ok: false, error: "Proof not found", issueId });
});

module.exports = router;
