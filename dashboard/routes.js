const express = require("express");
const demo = require("./demoData");
const { getDashboard } = require("./fromRuns");

const router = express.Router();

function pickSource(req) {
  // If any canonical runs exist, use real computed data. Otherwise fall back to demo.
  // You can force demo with ?mode=demo, or force runs with ?mode=runs.
  const mode = String(req.query.mode || "").toLowerCase();
  if (mode === "demo") return { mode: "demo" };
  if (mode === "runs") return { mode: "runs" };
  return { mode: "auto" };
}

function getFilters(req) {
  return {
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

  if (pick.mode === "demo") return res.json({ ok: true, metrics: demo.metrics });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, metrics: d.metrics });
  }

  return res.json({ ok: true, metrics: demo.metrics });
});

router.get("/breakdown/vendors", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.vendorRows });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.vendorRows });
  }

  return res.json({ ok: true, rows: demo.vendorRows });
});

router.get("/breakdown/locations", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.locationRows });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.locationRows });
  }

  return res.json({ ok: true, rows: demo.locationRows });
});

router.get("/issues", (req, res) => {
  const pick = pickSource(req);
  const filters = getFilters(req);

  if (pick.mode === "demo") return res.json({ ok: true, rows: demo.issues });

  const d = getDashboard(filters);
  if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
    return res.json({ ok: true, rows: d.issues });
  }

  return res.json({ ok: true, rows: demo.issues });
});

router.get("/issues/:issueId/proof", (req, res) => {
  const { issueId } = req.params;
  const pick = pickSource(req);
  const filters = getFilters(req);

  if (pick.mode !== "demo") {
    const d = getDashboard(filters);
    if (pick.mode === "runs" || (pick.mode === "auto" && d.canonicalsCount > 0)) {
      const proof = d.proofByIssueId[issueId];
      if (proof) return res.json({ ok: true, proof });
    }
  }

  const proof = demo.proofByIssueId[issueId];
  if (!proof) return res.status(404).json({ ok: false, error: "Unknown issueId", issueId });
  return res.json({ ok: true, proof });
});

module.exports = router;
