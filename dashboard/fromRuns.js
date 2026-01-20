const fs = require("fs");
const path = require("path");
const crypto = require("crypto");



function getImpactFactor(impact) {
  const k = String(impact || "weekly").toLowerCase();
  if (k === "weekly") return 1;
  if (k === "monthly") return 4;
  if (k === "quarterly") return 13;
  if (k === "annual" || k === "yearly") return 52;
  return 1;
}

const RUNS_DIR = path.join(__dirname, "..", "storage", "runs");

// cache for demo responsiveness
let CACHE = { ttlMs: 5_000, byKey: new Map() };

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function asString(x) {
  if (x == null) return "";
  return String(x);
}

function parseDateLoose(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function isoDay(dateLike) {
  // Returns YYYY-MM-DD for filtering, avoiding timezone edge cases.
  const d = parseDateLoose(dateLike);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function withinDateRange(dateLike, dateFrom, dateTo) {
  const day = isoDay(dateLike);
  if (!day) return true;

  const from = (dateFrom || "").slice(0, 10);
  const to = (dateTo || "").slice(0, 10);

  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function centsFromAmount(amount) {
  const v = Number(amount);
  if (!isFinite(v)) return 0;
  return Math.round(v * 100);
}

function hashId(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
}

function getLocationFromTags(tags) {
  const arr = Array.isArray(tags) ? tags : [];
  for (const t of arr) {
    if (typeof t === "string" && t.toLowerCase().startsWith("location:")) {
      return t.slice("location:".length).trim() || null;
    }
  }
  return null;
}

function impactFactor(period) {
  const p = String(period || "weekly").toLowerCase();
  if (p === "annual" || p === "yearly") return 52;
  if (p === "quarter" || p === "quarterly") return 13;
  if (p === "month" || p === "monthly") return 52 / 12; // 4.333...
  return 1; // weekly
}

function scaleCents(weeklyCents, period) {
  const f = impactFactor(period);
  return Math.round(Number(weeklyCents || 0) * f);
}



function normalizeKey(desc, sku) {
  const a = (sku ? String(sku).trim() : "");
  const b = (desc ? String(desc).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() : "");
  return (a && b) ? `${a}::${b}` : (a || b || "unknown");
}

// Load database to filter runs by user
let db = null;
try {
  db = require('../database');
} catch (e) {
  console.warn('[fromRuns] Could not load database module:', e.message);
}

function loadCanonicals(userId = null) {
  if (!fs.existsSync(RUNS_DIR)) return [];

  let allowedRunIds = null;

  // If userId is provided, filter to only runs owned by this user
  if (userId && db) {
    try {
      const database = db.getDatabase();
      const userRuns = database.prepare(`
        SELECT run_id FROM ingestion_runs WHERE user_id = ?
      `).all(userId);
      allowedRunIds = new Set(userRuns.map(r => r.run_id));

      // If user has no runs in the database, also check _SUMMARY.json files
      // for user_id metadata (for runs not yet in DB)
    } catch (e) {
      console.warn('[fromRuns] Database query failed:', e.message);
    }
  }

  const runIds = fs.readdirSync(RUNS_DIR).filter((d) => !d.startsWith(".")).sort();
  const out = [];

  for (const runId of runIds) {
    // If we have a user filter, check if this run belongs to the user
    if (allowedRunIds !== null && !allowedRunIds.has(runId)) {
      // Also check the _SUMMARY.json for user_id in case not in DB yet
      const summaryPath = path.join(RUNS_DIR, runId, "_SUMMARY.json");
      if (fs.existsSync(summaryPath)) {
        try {
          const summary = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
          if (summary.user_id && summary.user_id !== userId) {
            continue; // Skip - belongs to a different user
          }
          // If summary has matching user_id or no user_id, continue
          if (summary.user_id && summary.user_id === userId) {
            // Allow this run
          } else {
            continue; // Skip runs without user ownership
          }
        } catch (_) {
          continue; // Skip if can't read summary
        }
      } else {
        continue; // Skip if not in allowedRunIds and no summary
      }
    }

    const fp = path.join(RUNS_DIR, runId, "canonical.json");
    if (!fs.existsSync(fp)) continue;
    try {
      const c = JSON.parse(fs.readFileSync(fp, "utf-8"));
      out.push({ runId, canonical: c });
    } catch (_) {}
  }
  return out;
}

function getCanonicalBasics(c, runId) {

  const canonical = c;
  // Your schema (invoice.v1):
  const vendorName = asString(c?.parties?.vendor?.name) || "Unknown Vendor";
  const customerName = asString(c?.parties?.customer?.name) || "Unknown Customer";

  const vendorId = hashId(vendorName);
  const locationName = getLocationFromTags(canonical?.doc?.tags) || customerName; // tag-driven location when available
  const locationId = hashId(locationName);

  const invoiceId = asString(c?.doc?.invoice_number) || asString(c?.doc?.doc_id) || runId;
  const invoiceDate = asString(c?.doc?.issued_at) || asString(c?.provenance?.captured_at) || "";

  return { vendorName, vendorId, locationName, locationId, invoiceId, invoiceDate };
}

function extractLineItems(c) {
  const items = safeArray(c?.line_items);
  return items.map((it, idx) => {
    const description = asString(it?.raw_description) || asString(it?.normalized_description) || `Item ${idx + 1}`;
    const sku = asString(it?.sku);
    const qty = Number(it?.quantity ?? 1) || 1;
    const unit = (it?.unit_price && it.unit_price.amount != null) ? Number(it.unit_price.amount) : null;

    const amountCents = (unit != null && isFinite(unit)) ? centsFromAmount(unit * qty) : 0;
    const key = normalizeKey(description, sku);

    return {
      description,
      sku,
      qty,
      unitPrice: unit != null && isFinite(unit) ? unit : null,
      amountCents,
      key,
    };
  });
}

function computeDashboard(filters) {
  const impactPeriod = String((filters && (filters.impactPeriod || filters.impact)) || "weekly").toLowerCase();
  // normalize common aliases
  const impactPeriodNorm = (impactPeriod === "yearly") ? "annual" : impactPeriod;
  const impactFactor = getImpactFactor(impactPeriodNorm);
  const companyId = filters?.companyId || "demo-company";
  const dateFrom = filters?.dateFrom || "";
  const dateTo = filters?.dateTo || "";
  const vendorIdFilter = filters?.vendorId || "";
  const locationIdFilter = filters?.locationId || "";
  const userId = filters?.userId || null;

  // Load canonicals - filtered by userId if provided
  const canonicals = loadCanonicals(userId);

  const invoices = canonicals
    .map(({ runId, canonical }) => {
      const b = getCanonicalBasics(canonical, runId);
      const lineItems = extractLineItems(canonical);
      return { runId, companyId, ...b, lineItems };
    })
    .filter((inv) => withinDateRange(inv.invoiceDate, dateFrom, dateTo));

const filtered = invoices.filter((inv) => {
    if (vendorIdFilter && inv.vendorId !== vendorIdFilter) return false;
    if (locationIdFilter && inv.locationId !== locationIdFilter) return false;
    return true;
  });

  

  
  // Productivity model (tunable heuristics)
  const minutesManualPerInvoice = 12;   // baseline: manual review
  const minutesWithToolPerInvoice = 3;  // with dashboard + auto flags
  const minutesSavedPerInvoice = Math.max(0, minutesManualPerInvoice - minutesWithToolPerInvoice);

  const invoicesCount = (typeof filtered !== "undefined" && Array.isArray(filtered)) ? filtered.length : 0;
  const hoursSaved = (invoicesCount * minutesSavedPerInvoice) / 60;

  // Simple “activity lift” projection: 1 hour saved => X touches (calls+emails)
  const touchesPerHour = 18;
  const activityIncrease = Math.round(hoursSaved * touchesPerHour);
// Sort newest first by invoiceDate
  filtered.sort((a, b) => {
    const da = parseDateLoose(a.invoiceDate)?.getTime() || 0;
    const db = parseDateLoose(b.invoiceDate)?.getTime() || 0;
    return db - da;
  });

  // Pairwise comparison engine (works with only 2 invoices):
  // Compare latest invoice to the most recent prior invoice for same vendor+location.
  const issues = [];

  const proofByIssueId = {};



  // Within-invoice inconsistency: same SKU+description key appears multiple times with different unit prices.
  for (const inv of filtered) {
    const byKey = new Map();
    for (const li of inv.lineItems) {
      const arr = byKey.get(li.key) || [];
      arr.push(li);
      byKey.set(li.key, arr);
    }

    for (const [key, arr] of byKey.entries()) {
      if (arr.length < 2) continue;
      const prices = arr.map(x => x.unitPrice).filter(x => x != null);
      if (prices.length < 2) continue;

      const minP = Math.min(...prices);
      const maxP = Math.max(...prices);
      if (!(maxP > minP)) continue;

      const deltaPerUnitCents = Math.round((maxP - minP) * 100);
      if (deltaPerUnitCents < 1) continue;

      // Estimate impact as (max-min) * sum(qty on the higher-priced lines)
      const highLines = arr.filter(x => x.unitPrice === maxP);
      const impactCents = highLines.reduce((sum, x) => sum + Math.round((maxP - minP) * 100 * (x.qty || 0)), 0);
      if (impactCents <= 0) continue;

      const li0 = arr[0];
      const issueId = `iss-${hashId(`${inv.runId}|INVOICE_INTERNAL_PRICE|${key}|${maxP}|${minP}`)}`;

      issues.push({
        issueId,
        vendorId: inv.vendorId,
        vendorName: inv.vendorName,
        locationId: inv.locationId,
        locationName: inv.locationName,
        issueType: "INVOICE_INTERNAL_PRICE_INCONSISTENCY",
        currentChargeCents: impactCents,
        expectedChargeCents: 0,
        deltaCents: impactCents,
        confidence: "HIGH",
        invoiceId: inv.invoiceId,
        invoiceDate: inv.invoiceDate,
      });

      proofByIssueId[issueId] = {
        issueId,
        summary: {
          headline: "Same item billed at multiple unit prices on one invoice",
          details: `Observed unit prices ${(minP).toFixed(2)} and ${(maxP).toFixed(2)} for ${li0.sku ? li0.sku + " — " : ""}${li0.description}.`,
          confidence: "HIGH",
        },
        financial: {
          currentChargeCents: impactCents,
          expectedChargeCents: 0,
          deltaCents: impactCents,
          calculation: `(${(maxP).toFixed(2)} - ${(minP).toFixed(2)}) × qty(on higher-priced lines)`,
        },
        evidence: {
          currentInvoice: {
            invoiceId: inv.invoiceId,
            invoiceDate: inv.invoiceDate,
            snippetText: arr.map(x => `${x.sku ? x.sku + " — " : ""}${x.description} | qty ${x.qty} | unit ${x.unitPrice}`).join(" ; "),
          },
        },
        suggestedAction: "Ask vendor to re-rate all lines to the contracted/unit-consistent price and issue a credit.",
      };
    }
  }
  // Thresholds (tune later)
  const PRICE_UP_PCT = 0.05;     // 5%
  const PRICE_UP_CENTS = 200;    // $2
  const NEW_LINE_MIN_CENTS = 500; // $5

  // Build map of previous invoice per vendor+location
  const latestByVL = new Map();
  const prevByVL = new Map();

  for (const inv of filtered) {
    const k = `${inv.vendorId}::${inv.locationId}`;
    if (!latestByVL.has(k)) {
      latestByVL.set(k, inv);
    } else if (!prevByVL.has(k)) {
      prevByVL.set(k, inv);
    }
  }

  for (const [vl, latest] of latestByVL.entries()) {
    const prev = prevByVL.get(vl);
    if (!prev) continue;

    const prevByKey = new Map();
    for (const li of prev.lineItems) prevByKey.set(li.key, li);

    for (const li of latest.lineItems) {
      const prior = prevByKey.get(li.key);

      // New line item (not present in prior invoice) with meaningful amount
      if (!prior && li.amountCents >= NEW_LINE_MIN_CENTS) {
        const issueId = `iss-${hashId(`${latest.runId}|NEW_LINE|${vl}|${li.key}|${li.amountCents}`)}`;
        const expected = 0;
        const delta = li.amountCents;

        issues.push({
          issueId,
          vendorId: latest.vendorId,
          vendorName: latest.vendorName,
          locationId: latest.locationId,
          locationName: latest.locationName,
          issueType: "NEW_FEE",
          currentChargeCents: li.amountCents,
          expectedChargeCents: expected,
          deltaCents: delta,
          confidence: "HIGH",
          invoiceId: latest.invoiceId,
          invoiceDate: latest.invoiceDate,
        });

        proofByIssueId[issueId] = {
          issueId,
          summary: {
            headline: `New line item detected: “${li.description}”`,
            details: "Present on latest invoice but not on prior invoice for same vendor/location.",
            confidence: "HIGH",
          },
          financial: {
            currentChargeCents: li.amountCents,
            expectedChargeCents: 0,
            deltaCents: delta,
            calculation: `Expected $0; found ${(li.amountCents / 100).toFixed(2)}`,
          },
          evidence: {
            currentInvoice: {
              invoiceId: latest.invoiceId,
              invoiceDate: latest.invoiceDate,
              snippetText: `${li.sku ? li.sku + " — " : ""}${li.description} | qty ${li.qty} | unit ${li.unitPrice ?? "?"} | ${(li.amountCents / 100).toFixed(2)}`,
            },
            priorInvoice: {
              invoiceId: prev.invoiceId,
              invoiceDate: prev.invoiceDate,
              snippetText: "Line item not present on prior invoice.",
            },
          },
          suggestedAction: "Request vendor justification/credit; verify this charge is contract-approved.",
        };
      }

      // Price increase (unit price compare) when present in both
      if (prior && li.unitPrice != null && prior.unitPrice != null && prior.unitPrice > 0) {
        const pctUp = (li.unitPrice - prior.unitPrice) / prior.unitPrice;
        const unitDeltaCents = centsFromAmount(li.unitPrice - prior.unitPrice);
        const deltaCents = centsFromAmount((li.unitPrice - prior.unitPrice) * li.qty);

        if (pctUp >= PRICE_UP_PCT && unitDeltaCents >= PRICE_UP_CENTS && deltaCents > 0) {
          const issueId = `iss-${hashId(`${latest.runId}|PRICE_UP|${vl}|${li.key}|${li.unitPrice}`)}`;

          issues.push({
            issueId,
            vendorId: latest.vendorId,
            vendorName: latest.vendorName,
            locationId: latest.locationId,
            locationName: latest.locationName,
            issueType: "PRICE_INCREASE",
            currentChargeCents: li.amountCents,
            expectedChargeCents: prior.amountCents ? prior.amountCents : centsFromAmount(prior.unitPrice * li.qty),
            deltaCents,
            confidence: "HIGH",
            invoiceId: latest.invoiceId,
            invoiceDate: latest.invoiceDate,
          });

          proofByIssueId[issueId] = {
            issueId,
            summary: {
              headline: `Unit price increased: ${(prior.unitPrice).toFixed(2)} → ${(li.unitPrice).toFixed(2)}`,
              details: "Comparison uses the immediately prior invoice for the same vendor/location.",
              confidence: "HIGH",
            },
            financial: {
              currentChargeCents: li.amountCents,
              expectedChargeCents: prior.amountCents ? prior.amountCents : centsFromAmount(prior.unitPrice * li.qty),
              deltaCents,
              calculation: `(${li.unitPrice.toFixed(2)} - ${prior.unitPrice.toFixed(2)}) × ${li.qty} = ${(deltaCents / 100).toFixed(2)}`,
            },
            evidence: {
              currentInvoice: {
                invoiceId: latest.invoiceId,
                invoiceDate: latest.invoiceDate,
                snippetText: `${li.sku ? li.sku + " — " : ""}${li.description} | qty ${li.qty} | unit ${li.unitPrice.toFixed(2)} | ${(li.amountCents / 100).toFixed(2)}`,
              },
              priorInvoice: {
                invoiceId: prev.invoiceId,
                invoiceDate: prev.invoiceDate,
                snippetText: `${prior.sku ? prior.sku + " — " : ""}${prior.description} | qty ${prior.qty} | unit ${prior.unitPrice.toFixed(2)} | ${(prior.amountCents / 100).toFixed(2)}`,
              },
            },
            suggestedAction: "Request credit back to prior rate; confirm no amendment was executed.",
          };
        }
      }
    }
  }

  // Aggregations
  const byVendor = new Map();
  const byLocation = new Map();

  for (const iss of issues) {
    const v = byVendor.get(iss.vendorId) || { id: iss.vendorId, name: iss.vendorName, amountCents: 0, issuesCount: 0, invoices: new Set() };
    v.amountCents += (iss.deltaCents || 0);
    v.issuesCount += 1;
    v.invoices.add(iss.invoiceId);
    byVendor.set(iss.vendorId, v);

    const l = byLocation.get(iss.locationId) || { id: iss.locationId, name: iss.locationName, amountCents: 0, issuesCount: 0, invoices: new Set() };
    l.amountCents += (iss.deltaCents || 0);
    l.issuesCount += 1;
    l.invoices.add(iss.invoiceId);
    byLocation.set(iss.locationId, l);
  }

  const vendorRows = Array.from(byVendor.values())
    .map(v => ({ id: v.id, name: v.name, amountCents: v.amountCents, issuesCount: v.issuesCount, invoicesCount: v.invoices.size }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const locationRows = Array.from(byLocation.values())
    .map(l => ({ id: l.id, name: l.name, amountCents: l.amountCents, issuesCount: l.issuesCount, invoicesCount: l.invoices.size }))
    .sort((a, b) => b.amountCents - a.amountCents);

  const totalDeltaCents = issues.reduce((sum, i) => sum + (i.deltaCents || 0), 0);

  const metrics = {
    impactPeriod: impactPeriodNorm,

    productivity: {
      hoursSavedEstimate: Number(hoursSaved.toFixed(2)),
      activityIncreaseEstimate: activityIncrease,
      assumptions: {
        minutesManualPerInvoice,
        minutesWithToolPerInvoice,
        touchesPerHour
      }
    },

    totalPotentialOverbillingWeeklyCents: totalDeltaCents,
    totalPotentialOverbillingCents: scaleCents(totalDeltaCents, impactPeriodNorm),
    vendorsImpactedCount: vendorRows.length,
    invoicesAnalyzedCount: filtered.length,
    locationsCount: new Set(filtered.map(i => i.locationId)).size,
    flaggedIssuesCount: issues.length,
    avgMonthlyImpactWeeklyCents: totalDeltaCents,
    avgMonthlyImpactCents: scaleCents(totalDeltaCents, impactPeriodNorm), // placeholder until month bucketing
  };
  // Apply impact scaling to issues (weekly is base)
  for (const iss of issues) {
    iss.deltaWeeklyCents = iss.deltaWeeklyCents ?? iss.deltaCents;
    iss.currentWeeklyCents = iss.currentWeeklyCents ?? iss.currentChargeCents;
    iss.expectedWeeklyCents = iss.expectedWeeklyCents ?? iss.expectedChargeCents;

    iss.deltaCents = scaleCents(iss.deltaWeeklyCents, impactPeriodNorm || impactPeriod);
    iss.currentChargeCents = scaleCents(iss.currentWeeklyCents, impactPeriodNorm || impactPeriod);
    iss.expectedChargeCents = scaleCents(iss.expectedWeeklyCents, impactPeriodNorm || impactPeriod);
    iss.impactPeriod = (impactPeriodNorm || impactPeriod);
  }

  // Normalize proof packets so UI always has proof.history (prevents crashes)
  for (const [issueId, proof] of Object.entries(proofByIssueId)) {
    if (!proof) continue;
    if (!proof.history) proof.history = { stableInvoicesCount: 0 };
    if (proof.history.stableInvoicesCount == null) proof.history.stableInvoicesCount = 0;
    if (proof.history.stableSinceDate == null) proof.history.stableSinceDate = "";
    if (proof.history.notes == null) proof.history.notes = "";
  }





  return {
    ok: true,
    computedAt: new Date().toISOString(),
    metrics,
    vendorRows,
    locationRows,
    issues,
    proofByIssueId,
    canonicalsCount: canonicals.length,
    invoicesCount: filtered.length,
  };
}

function cacheKey(filters) {
  const f = filters || {};
  return JSON.stringify({
    userId: f.userId || "",  // Include userId in cache key for user-specific data
    companyId: f.companyId || "",
    dateFrom: f.dateFrom || "",
    dateTo: f.dateTo || "",
    vendorId: f.vendorId || "",
    locationId: f.locationId || "",
    minConfidence: f.minConfidence || "",
  });
}

function getDashboard(filters) {
  const key = cacheKey(filters);
  const now = Date.now();
  const hit = CACHE.byKey.get(key);
  if (hit && (now - hit.at) < CACHE.ttlMs) return hit.data;

  const data = computeDashboard(filters);
  CACHE.byKey.set(key, { at: now, data });
  return data;
}

module.exports = { getDashboard };
