// Load environment variables from .env file
require('dotenv').config();

// -------------------- OSM fallback (no key; best-effort) --------------------
// Notes:
// - Uses public OpenStreetMap endpoints (Nominatim/Overpass).
// - Phone availability depends on OSM tags; may be blank.
// - Keep it conservative and cached to avoid hammering endpoints.
// -------------------- Leads cache + unified lead lookup (global) --------------------
// Ensures /find-leads can cache results and /ingest can persist leads per run.
// Cache key: normalized accountName + postalCode (ZIP).

const LEADS_CACHE_TTL_MS = Number(process.env.LEADS_CACHE_TTL_MS || 1000 * 60 * 60 * 24); // 24h
const leadsCache = new Map(); // key -> { ts, value }

function _leadsCacheKey(accountName, postalCode) {
  const a = String(accountName || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  const z = String(postalCode || "").trim();
  return `${a}|${z}`;
}

function _leadsCacheGet(key) {
  const v = leadsCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > LEADS_CACHE_TTL_MS) {
    leadsCache.delete(key);
    return null;
  }
  return v.value;
}

function _leadsCacheSet(key, value) {
  leadsCache.set(key, { ts: Date.now(), value });
}

// Best-effort ZIP extraction (used if invoice doesn't provide postalCode)
function extractZipAny(obj) {
  const txt = JSON.stringify(obj || "");
  const m = String(txt).match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

function bestAddressString(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj.trim();
  if (typeof obj !== "object") return "";
  const parts = [];
  const keys = ["line1","line2","street","address1","address2","city","state","postalCode","zip"];
  for (const k of keys) {
    const v = obj[k];
    if (v && String(v).trim()) parts.push(String(v).trim());
  }
  if (parts.length) return parts.join(", ");
  return "";
}

function extractRunAccountAndLocation(canonical, fallbackAccountName = "", fallbackZip = "", fallbackAddressHint = "") {
  const accountName =
    (canonical && canonical.parties && canonical.parties.customer && (canonical.parties.customer.name || canonical.parties.customer.normalized_name)) ||
    (canonical && (canonical.account_name || canonical.accountName)) ||
    fallbackAccountName ||
    "";

  // NEW: canonical now has structured addresses with postal already extracted
  // ship_to and bill_to are party objects (with addresses array), not direct addresses
  const custAddr = (canonical && canonical.parties && canonical.parties.customer && Array.isArray(canonical.parties.customer.addresses) && canonical.parties.customer.addresses.length) ? canonical.parties.customer.addresses[0] : null;

  const shipToParty = canonical && canonical.parties && canonical.parties.ship_to ? canonical.parties.ship_to : null;
  const shipToAddr = (shipToParty && Array.isArray(shipToParty.addresses) && shipToParty.addresses.length) ? shipToParty.addresses[0] : null;

  const billToParty = canonical && canonical.parties && canonical.parties.bill_to ? canonical.parties.bill_to : null;
  const billToAddr = (billToParty && Array.isArray(billToParty.addresses) && billToParty.addresses.length) ? billToParty.addresses[0] : null;

  // Try to get postal code directly from parsed address objects first
  // Canonical schema uses "postal" not "postalCode"
  const zip =
    (shipToAddr && (shipToAddr.postal || shipToAddr.postalCode)) ||
    (custAddr && (custAddr.postal || custAddr.postalCode)) ||
    (billToAddr && (billToAddr.postal || billToAddr.postalCode)) ||
    extractZipAny(shipToAddr) ||
    extractZipAny(custAddr) ||
    extractZipAny(billToAddr) ||
    String(fallbackZip || "").trim() ||
    "";

  // Build address hint from structured address
  function addrToString(addr) {
    if (!addr) return "";
    if (addr.raw) return addr.raw;  // Canonical schema has "raw" field
    if (addr.full) return addr.full;
    const parts = [addr.street, addr.city, addr.state, (addr.postal || addr.postalCode)].filter(Boolean);
    return parts.join(", ");
  }

  const addrHint =
    addrToString(shipToAddr) ||
    addrToString(custAddr) ||
    addrToString(billToAddr) ||
    bestAddressString(shipToAddr) ||
    bestAddressString(custAddr) ||
    bestAddressString(billToAddr) ||
    fallbackAddressHint ||
    "";

  return { accountName: String(accountName || "").trim(), postalCode: String(zip || "").trim(), addressHint: String(addrHint || "").trim() };
}

function extractZipFromText(s) {
  const m = String(s || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}



const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const XLSX = require("xlsx");

// -------------------- New Infrastructure Imports --------------------
const config = require('./config');  // Centralized configuration
const backupService = require('./backup-service');  // Database backups
const healthRoutes = require('./health-routes');  // Health monitoring
const backupRoutes = require('./backup-routes');  // Backup management
const authRoutes = require('./auth-routes');  // Authentication routes
const { requireAuth, requireRole, enforceDemoRestrictions, optionalAuth, addDemoHeaders } = require('./auth-middleware');  // Auth middleware
const userManagementRoutes = require('./user-management-routes');  // User management
const emailMonitorRoutes = require('./email-monitor-routes');  // Email monitoring
const emailOAuthRoutes = require('./email-oauth-routes');  // Email OAuth (Google/Microsoft)
const adminAnalyticsRoutes = require('./admin-analytics-routes');  // Admin analytics
const signupRoutes = require('./signup-routes');  // Public self-service signup
const stripeRoutes = require('./stripe-routes');  // Stripe payment integration
const businessIntelRoutes = require('./business-intel-routes');  // Business Intelligence (opportunities, inventory, payroll)
const eventCateringRoutes = require('./event-catering-routes');  // Private Events & Catering
const { checkTrialAccess, incrementInvoiceUsage } = require('./trial-middleware');  // Trial enforcement
const InventoryIntelligence = require('./inventory-intelligence');  // Inventory tracking & price intelligence
const universalInvoiceProcessor = require('./universal-invoice-processor');  // Universal invoice processing (PDF, images, OCR)
const invoiceImagePipeline = require('./services/invoice_image_pipeline');  // v2 phone photo OCR pipeline
const jobProcessor = require('./services/job-processor');  // Background job processor for PDF/OCR
const jobQueue = require('./services/job-queue');  // Job queue management
const reviewService = require('./services/review-service');  // Human correction workflow

// Initialize inventory intelligence for auto-processing
const inventoryIntelligence = new InventoryIntelligence();
// --------------------------------------------------------------------

// -------------------- Core app bootstrap --------------------
const PORT = config.port;  // Use config instead of direct env access
const VERSION = process.env.VERSION || "v2025-12-18cintas-parser-1";
// ----------------------------------------------------------


const OSM_ENABLE = (process.env.OSM_ENABLE || "1").trim() === "1";
const OSM_USER_AGENT = process.env.OSM_USER_AGENT || "QuietSignalDemo/1.0 (contact: local)";
const OSM_CACHE_TTL_MS = Number(process.env.OSM_CACHE_TTL_MS || 1000 * 60 * 60 * 24); // 24h

const osmCache = new Map(); // key -> {ts, value}

function _osmCacheGet(key) {
  const v = osmCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > OSM_CACHE_TTL_MS) { osmCache.delete(key); return null; }
  return v.value;
}
function _osmCacheSet(key, value) {
  osmCache.set(key, { ts: Date.now(), value });
}

// -------------------- OSM ZIP-anchored helper (no API key; best-effort) --------------------
// Notes:
// - Overpass 'addr:postcode' coverage varies. This is best-effort, but it prevents obvious wrong-city hits.
// - We only run this when both accountName and a 5-digit ZIP are present.

function _normZip(z) {
  const m = String(z || "").match(/\b(\d{5})\b/);
  return m ? m[1] : "";
}

async function _overpassZipPhoneLookup({ accountName, postalCode }) {
  const zip = _normZip(postalCode);
  const name = String(accountName || "").trim();
  if (!zip || !name) return null;

  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const timeout = Number(process.env.OSM_OVERPASS_TIMEOUT_S || 20);

  // Match by name (case-insensitive regex) and exact ZIP via addr:postcode
  const query = `
[out:json][timeout:${timeout}];
(
  nwr["addr:postcode"="${zip}"]["name"~"${name}", i]["phone"];
  nwr["addr:postcode"="${zip}"]["name"~"${name}", i]["contact:phone"];
);
out tags center 3;
`;

  try {
    const opRes = await fetch(overpassUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "User-Agent": OSM_USER_AGENT
      },
      body: query
    });

    const opJson = await opRes.json();
    const el = (opJson && Array.isArray(opJson.elements) && opJson.elements.length) ? opJson.elements[0] : null;
    if (!el || !el.tags) return null;

    const phone = el.tags["contact:phone"] || el.tags["phone"] || "";
    const outName = el.tags["name"] || "";
    if (!phone && !outName) return null;

    return { name: outName, phone: phone, via: "overpass_zip" };
  } catch (_) {
    return null;
  }
}


async function findOsmPhoneAndName({ accountName, postalCode, addressHint }) {
  if (!OSM_ENABLE) return null;

  const key = `${String(accountName || "").toLowerCase().trim()}|${String(postalCode || "").trim()}|${String(addressHint || "").toLowerCase().trim()}`;
  const hit = _osmCacheGet(key);
  if (hit) return hit;

  // 0) Prefer ZIP-anchored Overpass lookup (reduces wrong-city matches)
  try {
    const ZIPFIRST_MS = Number(process.env.OSM_ZIPFIRST_TIMEOUT_MS || 4000);
    const zipFirst = await Promise.race([
      (async () => await _overpassZipPhoneLookup({ accountName, postalCode }))(),
      new Promise((resolve) => setTimeout(() => resolve({ __zipFirstTimeout: true }), ZIPFIRST_MS))
    ]);
    if (zipFirst && zipFirst.__zipFirstTimeout) {
      // treat as no result; continue to Nominatim path
    }
    if (zipFirst && (zipFirst.phone || zipFirst.name)) {
      _osmCacheSet(key, zipFirst);
      return zipFirst;
    }
  } catch (_) {}

  const q = [accountName, addressHint, postalCode].filter(Boolean).join(" ").trim();
  if (!q) return null;

  const nomUrl =
    "https://nominatim.openstreetmap.org/search" +
    `?format=json&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(q)}`;

  let lat = null, lon = null, displayName = null;

  try {
    const nomRes = await fetchWithTimeout(
      nomUrl,
      { headers: { "User-Agent": OSM_USER_AGENT } },
      Number(process.env.OSM_NOMINATIM_TIMEOUT_MS || 6000)
    );
    const nomJson = await nomRes.json();

    if (Array.isArray(nomJson) && nomJson.length) {
      const first = nomJson[0] || {};
      displayName = first.display_name || null;

      // ZIP hard-gate (only if caller provided a ZIP)
      const wantZip = String(postalCode || "").trim();
      if (wantZip) {
        const addrZip = String((first.address && first.address.postcode) || "");
        const dn = String(displayName || "");
        const okZip = (addrZip.includes(wantZip) || dn.includes(wantZip));
        if (!okZip) {
          _osmCacheSet(key, null);
          return null;
        }
      }

      lat = first.lat || null;
      lon = first.lon || null;
    }
  } catch (_) {}

  if (!lat || !lon) {
    _osmCacheSet(key, null);
    return null;
  }

  // 2) Overpass around lat/lon to find a nearby POI with phone/contact tags
  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const radius = Number(process.env.OSM_OVERPASS_RADIUS_M || 120);

  const query = `
[out:json][timeout:20];
(
  nwr(around:${radius},${lat},${lon})["phone"];
  nwr(around:${radius},${lat},${lon})["contact:phone"];
);
out tags center 5;
`;

  try {
    const opRes = await fetchWithTimeout(
      overpassUrl,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": OSM_USER_AGENT },
        body: query
      },
      Number(process.env.OSM_OVERPASS_TIMEOUT_MS || 7000)
    );

    const opJson = await opRes.json();
    const el = (opJson && Array.isArray(opJson.elements) && opJson.elements.length) ? opJson.elements[0] : null;

    if (!el || !el.tags) {
      const out = { name: displayName || "", phone: "" };
      _osmCacheSet(key, out);
      return out;
    }

    const phone = el.tags["contact:phone"] || el.tags["phone"] || "";
    const name = el.tags["name"] || displayName || "";
    const out = { name, phone };
    _osmCacheSet(key, out);
    return out;
  } catch (_) {
    const out = { name: displayName || "", phone: "" };
    _osmCacheSet(key, out);
    return out;
  }
}

if (typeof global.fetch !== "function") {
  try {
    global.fetch = require("node-fetch");
  } catch (_) {
    console.warn("[WARN] global.fetch missing and node-fetch not installed. Public lead lookup may fail.");
  }
}


function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  const opts = { ...options, signal: ctrl.signal };
  return fetch(url, opts).finally(() => clearTimeout(id));
}



// -------------------- Optional/defensive requires --------------------
function optionalRequire(p, fallback = null) {
  try {
    return require(p);
  } catch (_) {
    return fallback;
  }
}

const canonicalBuildMod = optionalRequire("./canonical/buildCanonicalInvoice");
const canonicalValidateMod = optionalRequire("./canonical/validate");
const ocrMod = optionalRequire("./ocr/ocrPdfToText");
const telemetryMod = optionalRequire("./telemetry/telemetryStore");
const dashboardRoutes = optionalRequire("./dashboard/routes");

const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || "YOUR_GOOGLE_PLACES_API_KEY_HERE";

const mlaStore = {};
let contacts = [];

const DASHBOARD_DIR = path.join(__dirname, "dashboard");
const RUNS_DIR = path.join(__dirname, "storage", "runs");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isSafeSegment(s) {
  if (!s) return false;
  if (s.includes("..")) return false;
  if (s.includes("/") || s.includes("\\")) return false;
  return true;
}

function nowRunId() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const ts =
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  const rand = Math.random().toString(16).slice(2, 8);
  return `${ts}-${rand}`;
}

function writeRunJson(runId, fileName, obj) {
  ensureDir(RUNS_DIR);
  const runPath = path.join(RUNS_DIR, runId);
  ensureDir(runPath);
  const fp = path.join(runPath, fileName);
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), "utf8");
  return fp;
}

function normalizeCompanyName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAddressHintFromRawText(rawText) {
  const raw = String(rawText || "");
  if (!raw) return "";

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cityStateZip = /([A-Za-z.\-'\s]{2,40}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/;
  const streetLike = /\d{1,6}\s+[A-Za-z0-9.\-'\s]{3,80}/;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(cityStateZip);
    if (!m) continue;

    const prev = i > 0 ? lines[i - 1] : "";
    const street = streetLike.test(prev) ? prev : "";
    const city = (m[1] || "").trim();
    const state = (m[2] || "").trim();
    const zip = (m[3] || "").trim();

    const parts = [street, `${city}, ${state} ${zip}`].filter(Boolean);
    return parts.join(", ");
  }

  return "";
}

function extractZipFromText(s) {
  const m = String(s || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

// =====================================================
// COGS CODING - Auto-categorize invoice items
// =====================================================

/**
 * Process invoice line items for COGS coding
 * - Matches SKUs to categories based on user's mappings
 * - Stores coded items in cogs_coded_items table
 * - Updates price history for price tracking
 * - Queues unmatched items for manual categorization
 */
async function processInvoiceForCOGS(userId, runId, lineItems) {
  if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) return;

  const database = db.getDatabase();

  // Get user's SKU mappings
  const mappings = database.prepare(`
    SELECT m.*, c.category_code, c.category_name
    FROM cogs_sku_mappings m
    JOIN cogs_categories c ON m.category_id = c.id
    WHERE m.user_id = ? AND m.is_active = 1
    ORDER BY m.match_type ASC
  `).all(userId);

  if (mappings.length === 0) {
    // No mappings configured, queue items for learning
    const learningStmt = database.prepare(`
      INSERT OR IGNORE INTO cogs_learning_queue (user_id, sku, product_name, unit_price_cents, occurrence_count, total_spend_cents)
      VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(user_id, sku) DO UPDATE SET
        occurrence_count = occurrence_count + 1,
        total_spend_cents = total_spend_cents + excluded.total_spend_cents,
        last_seen_at = datetime('now')
    `);

    for (const item of lineItems) {
      const sku = item.sku || item.item_code || '';
      const productName = item.raw_description || item.description || '';
      const unitPrice = item.unit_price?.amount || 0;
      const totalPrice = item.total_price?.amount || 0;

      if (sku || productName) {
        try {
          learningStmt.run(userId, sku || productName.substring(0, 50), productName, unitPrice, totalPrice);
        } catch (e) {
          // Ignore learning queue errors
        }
      }
    }
    return;
  }

  // Build regex cache for pattern matching
  const regexMappings = mappings.filter(m => m.match_type === 'regex').map(m => {
    try {
      return { ...m, regex: new RegExp(m.sku_pattern, 'i') };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);

  // Prepare statements
  const insertCodedItem = database.prepare(`
    INSERT INTO cogs_coded_items (user_id, category_id, run_id, sku, product_name, quantity, unit_price_cents, total_price_cents, matched_by_mapping_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updatePriceHistory = database.prepare(`
    INSERT INTO cogs_price_history (user_id, sku, product_name, unit_price_cents, source_run_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const updateMappingPrice = database.prepare(`
    UPDATE cogs_sku_mappings SET last_price_cents = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const learningStmt = database.prepare(`
    INSERT OR IGNORE INTO cogs_learning_queue (user_id, sku, product_name, unit_price_cents, occurrence_count, total_spend_cents)
    VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(user_id, sku) DO UPDATE SET
      occurrence_count = occurrence_count + 1,
      total_spend_cents = total_spend_cents + excluded.total_spend_cents,
      last_seen_at = datetime('now')
  `);

  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const item of lineItems) {
    const sku = item.sku || item.item_code || '';
    const productName = item.raw_description || item.description || '';
    const quantity = item.quantity || 1;
    const unitPrice = item.unit_price?.amount || 0;
    const totalPrice = item.total_price?.amount || (unitPrice * quantity);

    const searchKey = sku || productName;
    if (!searchKey) continue;

    // Find matching mapping
    let matchedMapping = null;

    // 1. Try exact match first
    matchedMapping = mappings.find(m =>
      m.match_type === 'exact' &&
      m.sku_pattern.toLowerCase() === searchKey.toLowerCase()
    );

    // 2. Try starts_with match
    if (!matchedMapping) {
      matchedMapping = mappings.find(m =>
        m.match_type === 'starts_with' &&
        searchKey.toLowerCase().startsWith(m.sku_pattern.toLowerCase())
      );
    }

    // 3. Try contains match
    if (!matchedMapping) {
      matchedMapping = mappings.find(m =>
        m.match_type === 'contains' &&
        searchKey.toLowerCase().includes(m.sku_pattern.toLowerCase())
      );
    }

    // 4. Try regex match
    if (!matchedMapping) {
      for (const rm of regexMappings) {
        if (rm.regex.test(searchKey)) {
          matchedMapping = rm;
          break;
        }
      }
    }

    if (matchedMapping) {
      // Store coded item
      try {
        insertCodedItem.run(
          userId,
          matchedMapping.category_id,
          runId,
          sku,
          productName,
          quantity,
          unitPrice,
          totalPrice,
          matchedMapping.id
        );

        // Update price history if we have a unit price
        if (unitPrice > 0) {
          updatePriceHistory.run(userId, sku || productName.substring(0, 100), productName, unitPrice, runId);
          updateMappingPrice.run(unitPrice, matchedMapping.id);
        }

        matchedCount++;
      } catch (e) {
        console.warn('[COGS] Failed to store coded item:', e.message);
      }
    } else {
      // Queue for manual categorization
      try {
        learningStmt.run(userId, sku || productName.substring(0, 50), productName, unitPrice, totalPrice);
        unmatchedCount++;
      } catch (e) {
        // Ignore learning queue errors
      }
    }
  }

  if (matchedCount > 0 || unmatchedCount > 0) {
    console.log(`[COGS CODING] Processed invoice: ${matchedCount} items coded, ${unmatchedCount} queued for review`);
  }
}

let intel = {
  addDetection: () => {},
  listDetections: () => [],
  listMatches: () => [],
  recomputeMatches: () => ({ scanned: 0, matchesCreated: 0 })
};

try {
  const intelEngine = require("./src/intel/engine");
  if (intelEngine && typeof intelEngine.createIntelEngine === "function") {
    intel = intelEngine.createIntelEngine("intel.sqlite");
    console.log("[INTEL] Enabled");
  } else {
    console.warn("[INTEL] Engine module loaded but createIntelEngine not found");
  }
} catch (e) {
  console.warn("[INTEL] Disabled (missing or failed to load):", String(e && (e.message || e)));
}

function safeIntelAddDetection(d) {
  try {
    if (!d || !d.rawName) return;
    if (typeof intel.addDetection === "function") intel.addDetection(d);
  } catch (e) {
    console.warn("[INTEL] addDetection failed:", String(e && (e.stack || e.message || e)));
  }
}

function safeIntelSeedFromContacts(list) {
  const enabled = String(process.env.INTEL_SEED_ON_START || "").trim() === "1";
  if (!enabled) return;
  try {
    let count = 0;
    for (const c of list || []) {
      if (!c || !c.company) continue;
      const addr = [c.city, c.state, c.postalCode].filter(Boolean).join(", ");
      safeIntelAddDetection({
        sourceType: "lead_seed",
        sourceId: c.email || c.directPhone || c.corpPhone || `${c.company}-${c.postalCode || ""}`,
        rawName: c.company,
        rawAddress: addr
      });
      count += 1;
    }
    console.log(`[INTEL] Seeded detections from contacts: ${count}`);
  } catch (e) {
    console.warn("[INTEL] Seeding failed:", String(e && (e.stack || e.message || e)));
  }
}

function loadContactsFromCsv() {
  const csvPath = path.join(__dirname, "zoominfo-contacts.csv");
  if (!fs.existsSync(csvPath)) {
    console.log("[LEADS] zoominfo-contacts.csv not found. Lead sourcing limited to public fallback.");
    return;
  }

  try {
    const raw = fs.readFileSync(csvPath, "utf8");
    const records = parse(raw, { skip_empty_lines: true });

    if (!records.length) {
      console.log("[LEADS] zoominfo-contacts.csv is empty.");
      return;
    }

    const header = records[0].map((v) => (v ? String(v) : ""));
    const rows = records.slice(1);

    // DETECT MALFORMED CSV: Check if first data row has empty leading columns with tab-separated data in one field
    const firstRow = rows[0];
    let isMalformed = false;
    let tabDataColumn = -1;

    if (firstRow) {
      // Count empty leading columns
      let emptyCount = 0;
      for (let i = 0; i < firstRow.length && (firstRow[i] === "" || firstRow[i] === null || firstRow[i] === undefined); i++) {
        emptyCount++;
      }

      // If we have many empty leading columns, check if remaining column has tab-separated data
      if (emptyCount >= 5) {
        for (let i = emptyCount; i < firstRow.length; i++) {
          if (firstRow[i] && String(firstRow[i]).includes('\t')) {
            isMalformed = true;
            tabDataColumn = i;
            console.log(`[LEADS] Detected malformed CSV: ${emptyCount} empty columns, tab-separated data in column ${tabDataColumn}`);
            break;
          }
        }
      }
    }

    // Parse tab-separated data if malformed
    if (isMalformed && tabDataColumn !== -1) {
      console.log("[LEADS] Parsing tab-separated data from malformed CSV...");
      contacts = rows
        .map((row) => {
          const tabData = row[tabDataColumn];
          if (!tabData) return null;

          // Split by tab to get: Company, Address, City, State, ZIP, Phone, ...
          const parts = String(tabData).split('\t').map(p => p.trim()).filter(p => p.length > 0);

          if (parts.length < 5) return null; // Need at least company, address, city, state, zip

          let company = parts[0] || "";
          const address = parts[1] || "";
          const city = parts[2] || "";
          const state = parts[3] || "";
          const postalCode = parts[4] || "";

          // Extract email from ENTIRE row (not just company name)
          // Look for patterns like: first.last@domain, flast@domain, firstlast@domain
          // Also match incomplete emails like mike.moye@pilgrims (without .com)
          let email = "";

          // More lenient regex that matches emails even without proper TLD
          const emailRegex = /([a-z0-9._-]+@[a-z0-9.-]+)/gi;
          const allEmailMatches = tabData.match(emailRegex);

          if (allEmailMatches && allEmailMatches.length > 0) {
            // Take the first valid email found
            email = allEmailMatches[0].toLowerCase();

            // Remove trailing dots (e.g., "mike.moye@pilgrims." -> "mike.moye@pilgrims")
            email = email.replace(/\.+$/, '');

            // Clean up email prefix - remove facility words that got concatenated
            // (e.g., "plantmike.moye@" -> "mike.moye@")
            email = email.replace(/^(plant|facility|mill|hatchery|shop|hall|live|fresh|debone|feed|truck)([a-z])/i, '$2');

            // Fix incomplete domains (e.g., "mike.moye@pilgrims" -> "mike.moye@pilgrims.com")
            if (!email.match(/\.(com|org|net|gov|edu|io|co|us|biz|info)$/i)) {
              email = email + '.com';
            }
          }

          // Clean company name - remove embedded emails, extra descriptors, etc.
          company = company
            .replace(/[a-z0-9._-]+@[a-z0-9.-]+/gi, '') // Remove any embedded emails
            .replace(/\s+(plant|facility|mill|hatchery|shop|hall|live|fresh|debone|feed|truck)\s*$/gi, '') // Remove facility type suffixes
            .replace(/\s+(llc|inc|corp|corporation|company|co|ltd)\.?$/gi, '') // Remove legal suffixes
            .trim();

          // Extract phone number - match formats like (912) 384-4185, 912-384-4185, 9123844185
          let corpPhone = "";
          const phoneMatch = tabData.match(/\([0-9]{3}\)\s?[0-9]{3}-[0-9]{4}/) ||
                             tabData.match(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/) ||
                             tabData.match(/\d{10}/);
          if (phoneMatch && Array.isArray(phoneMatch)) {
            corpPhone = phoneMatch[0];
          } else if (phoneMatch) {
            corpPhone = String(phoneMatch);
          }

          // Extract contact name from end of tab data (multiple patterns to try)
          // Pattern 1: "Yes No No Name Number" or "Yes No Yes Name Number"
          let nameMatch = tabData.match(/(?:Yes|No)\s+(?:Yes|No)\s+(?:Yes|No)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+?)\s+\d+/);
          let contactName = nameMatch ? nameMatch[1].trim() : "";

          // Pattern 2: Just "Name Number" at the end
          if (!contactName) {
            nameMatch = tabData.match(/\s([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+?)\s+\d{2,4}$/);
            contactName = nameMatch ? nameMatch[1].trim() : "";
          }

          // Pattern 3: Look for name after employee count numbers like "100 to 249" or "50 to 99"
          if (!contactName) {
            nameMatch = tabData.match(/\d+\s+to\s+\d+.*?(?:Yes|No)\s+(?:Yes|No)\s+(?:Yes|No)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
            contactName = nameMatch ? nameMatch[1].trim() : "";
          }

          // Deduce title from context or facility type
          let title = "";
          let department = "";

          // Check for facility-specific keywords to assign likely titles
          const companyLower = company.toLowerCase();
          const tabDataLower = tabData.toLowerCase();

          if (companyLower.includes("feed mill") || tabDataLower.includes("feed")) {
            title = "Feed Mill Manager";
            department = "Operations";
          } else if (companyLower.includes("hatchery")) {
            title = "Hatchery Manager";
            department = "Operations";
          } else if (companyLower.includes("debone") || companyLower.includes("processing")) {
            title = "Plant Manager";
            department = "Operations";
          } else if (companyLower.includes("live haul") || companyLower.includes("truck")) {
            title = "Fleet Manager";
            department = "Logistics";
          } else if (tabDataLower.includes("safety") || tabDataLower.includes("ehs")) {
            title = "EHS Manager";
            department = "Safety";
          } else {
            // Default title for industrial facility
            title = "Facility Manager";
            department = "Operations";
          }

          if (!company) return null;

          return {
            company,
            normalizedCompany: normalizeCompanyName(company),
            contactName,
            title,
            department,
            directPhone: "",
            mobilePhone: "",
            corpPhone,
            email,
            city,
            state,
            postalCode
          };
        })
        .filter(Boolean);

      console.log(`[LEADS] Parsed ${contacts.length} contacts from malformed CSV`);

    } else {
      // Normal CSV parsing (original code)
      function findColumnIndex(candidates) {
        const lower = header.map((h) => (h ? String(h).toLowerCase().trim() : ""));
        for (const name of candidates) {
          const target = name.toLowerCase();
          const idx = lower.findIndex((h) => h === target || (h && h.includes(target)));
          if (idx !== -1) return idx;
        }
        return -1;
      }

      const idxCompany = findColumnIndex(["company", "account name"]);
      const idxName = findColumnIndex(["contact name", "name", "full name"]);
      const idxTitle = findColumnIndex(["title", "job title"]);
      const idxDept = findColumnIndex(["department", "dept"]);
      const idxDirectPhone = findColumnIndex(["direct phone", "direct dial", "direct line"]);
      const idxMobilePhone = findColumnIndex(["mobile phone", "cell", "mobile"]);
      const idxCorpPhone = findColumnIndex(["corporate phone", "hq phone", "main phone", "company phone"]);
      const idxEmail = findColumnIndex(["email", "business email", "work email"]);
      const idxCity = findColumnIndex(["city"]);
      const idxState = findColumnIndex(["state", "region"]);
      const idxPostal = findColumnIndex(["postalcode", "zip", "zip code"]);

      console.log("[LEADS] CSV column mapping:");
      console.log("  Company:", idxCompany);
      console.log("  Contact Name:", idxName);
      console.log("  Title:", idxTitle);
      console.log("  Department:", idxDept);
      console.log("  Direct Phone:", idxDirectPhone);
      console.log("  Mobile Phone:", idxMobilePhone);
      console.log("  Corporate Phone:", idxCorpPhone);
      console.log("  Email:", idxEmail);
      console.log("  City:", idxCity);
      console.log("  State:", idxState);
      console.log("  PostalCode:", idxPostal);

      contacts = rows
        .map((row) => {
          function get(idx) {
            if (idx === -1) return "";
            const v = row[idx];
            return v === undefined || v === null ? "" : String(v).trim();
          }

          const company = get(idxCompany);
          const contactName = get(idxName);
          const title = get(idxTitle);
          const department = get(idxDept);
          const directPhone = get(idxDirectPhone);
          const mobilePhone = get(idxMobilePhone);
          const corpPhone = get(idxCorpPhone);
          const email = get(idxEmail);
          const city = get(idxCity);
          const state = get(idxState);
          const postalCode = get(idxPostal);

          if (!company && !contactName && !corpPhone && !directPhone) return null;

          return {
            company,
            normalizedCompany: normalizeCompanyName(company),
            contactName,
            title,
            department,
            directPhone,
            mobilePhone,
            corpPhone,
            email,
            city,
            state,
            postalCode
          };
        })
        .filter(Boolean);
    }

    console.log(`[LEADS] Loaded ${contacts.length} contacts from zoominfo-contacts.csv`);

    safeIntelSeedFromContacts(contacts);
  } catch (err) {
    console.error("[LEADS] Error reading zoominfo-contacts.csv:", err);
  }
}

loadContactsFromCsv();

// IMPROVEMENT 10: Enhanced role-based prioritization scoring
function scoreContact(contact) {
  let score = 0;

  // Phone number quality (0-40 points)
  if (contact.directPhone) score += 40;
  else if (contact.mobilePhone) score += 35;
  else if (contact.corpPhone) score += 25;

  const dept = (contact.department || "").toLowerCase();
  const title = (contact.title || "").toLowerCase();

  // IMPROVEMENT 10: Sophisticated role prioritization for industrial laundry sales
  // Tier 1: Decision Makers (Safety/EHS) - HIGHEST VALUE (35-40 points)
  if (title.includes("safety") || title.includes("ehs") || title.includes("environmental health")) {
    if (title.includes("manager") || title.includes("director") || title.includes("coordinator")) {
      score += 40; // Safety Manager/Director = PRIMARY BUYER
    } else {
      score += 35; // Safety roles = HIGH VALUE
    }
  }

  // Tier 2: Facility Management (30-35 points)
  else if (title.includes("plant manager") || title.includes("facility manager") ||
           title.includes("site manager") || title.includes("general manager")) {
    score += 35; // Facility decision makers
  }
  else if (title.includes("operations manager") || title.includes("production manager")) {
    score += 32; // Operations leadership
  }

  // Tier 3: Maintenance & Purchasing (25-30 points)
  else if (title.includes("maintenance") && (title.includes("manager") || title.includes("director"))) {
    score += 30; // Maintenance decision makers
  }
  else if (title.includes("purchasing") || title.includes("procurement") || title.includes("buyer")) {
    score += 28; // Purchasing contacts
  }

  // Tier 4: Administrative Gatekeepers (20-25 points)
  else if (dept.includes("reception") || dept.includes("front desk") || title.includes("receptionist")) {
    score += 25; // Receptionists can direct you to decision makers
  }
  else if (dept.includes("hr") || dept.includes("human resources") || title.includes("hr")) {
    score += 20; // HR may know who manages safety equipment
  }

  // Tier 5: Maintenance Staff (15-20 points)
  else if (title.includes("maintenance") || title.includes("mechanic") || title.includes("technician")) {
    score += 18; // Maintenance staff use the equipment
  }

  // Tier 6: Other roles (10-15 points)
  else if (title.includes("supervisor") || title.includes("lead")) {
    score += 15;
  }
  else if (title) {
    score += 10; // Has a title, but not priority
  }

  // IMPROVEMENT 10: Bonus scoring factors
  if (contact.email) {
    score += 15; // Email contact is valuable
  }

  if (contact.verified === true) {
    score += 10; // Verified contacts get bonus
  }

  if (contact.verificationLevel === 'high') {
    score += 15; // Highly verified = extra confidence
  } else if (contact.verificationLevel === 'medium') {
    score += 10;
  } else if (contact.verificationLevel === 'low') {
    score += 5;
  }

  if (contact.isLocalFacility === true) {
    score += 10; // Local facility contact preferred over HQ
  }

  if (contact.crossLocationVerified === true) {
    score += 10; // Cross-location verified = high confidence
  }

  if (score > 100) score = 100;
  return score;
}


function leadsCacheKey(accountName, postalCode) {
  const a = normalizeCompanyName(accountName || "");
  const p = String(postalCode || "").replace(/\s+/g, "").trim();
  return `${a}|${p}`;
}

function getCachedLeads(accountName, postalCode) {
  const key = leadsCacheKey(accountName, postalCode);
  const v = leadsCache.get(key);
  if (!v) return null;
  if (Date.now() - v.cachedAt > LEADS_CACHE_TTL_MS) {
    leadsCache.delete(key);
    return null;
  }
  return { key, ...v };
}

function setCachedLeads(accountName, postalCode, payload) {
  const key = leadsCacheKey(accountName, postalCode);
  leadsCache.set(key, { ...payload, cachedAt: Date.now() });
  return key;
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || "operation"} timed out after ${ms}ms`)), ms))
  ]);
}

async function findPublicLeads(accountName, postalCode, addressHint = "") {
  if (!GOOGLE_PLACES_API_KEY || GOOGLE_PLACES_API_KEY.startsWith("YOUR_GOOGLE_PLACES_API_KEY")) {
    return [];
  }

  // Use full address if available for better accuracy, otherwise fall back to name + ZIP
  const query = addressHint ? `${accountName} ${addressHint}` : (postalCode ? `${accountName} ${postalCode}` : accountName);

  const searchUrl =
    "https://maps.googleapis.com/maps/api/place/textsearch/json" +
    `?query=${encodeURIComponent(query)}` +
    `&key=${GOOGLE_PLACES_API_KEY}`;

  try {
    const searchRes = await fetch(searchUrl);
    const searchJson = await searchRes.json();

    if (!searchJson.results || !searchJson.results.length) return [];

    const top = searchJson.results[0];
    const placeId = top.place_id;
    const businessName = top.name || accountName;
    let formattedAddress = top.formatted_address || "";

    let phone = "";
    let city = "";
    let state = "";
    let postal = postalCode || "";

    if (placeId) {
      const detailsUrl =
        "https://maps.googleapis.com/maps/api/place/details/json" +
        `?place_id=${encodeURIComponent(placeId)}` +
        "&fields=name,formatted_phone_number,formatted_address" +
        `&key=${GOOGLE_PLACES_API_KEY}`;

      const detailsRes = await fetch(detailsUrl);
      const detailsJson = await detailsRes.json();
      if (detailsJson.result) {
        phone = detailsJson.result.formatted_phone_number || "";
        if (detailsJson.result.formatted_address) formattedAddress = detailsJson.result.formatted_address;
      }
    }

    const addrParts = formattedAddress.split(",");
    if (addrParts.length >= 3) {
      const cityPart = addrParts[addrParts.length - 3].trim();
      const stateZipPart = addrParts[addrParts.length - 2].trim();
      city = cityPart;

      const m = stateZipPart.match(/([A-Z]{2})\s+(\d{5})/);
      if (m) {
        state = m[1];
        if (!postal) postal = m[2];
      }
    }

    return [
      {
        contactName: businessName + " (Main Line)",
        title: "",
        department: "Front Desk",
        directPhone: "",
        mobilePhone: "",
        corpPhone: phone,
        email: "",
        city,
        state,
        postalCode: postal,
        score: 60
      }
    ];
  } catch (_) {
    return [];
  }
}

async function findLeadsForAccount({ accountName, postalCode, allowPublic = true, publicTimeoutMs = 2500 }) {
  const normalizedAccount = normalizeCompanyName(accountName);
  const zip = String(postalCode || "").trim();

  let candidates = [];

  if (contacts.length) {
    candidates = contacts.filter((c) => {
      if (!c.normalizedCompany) return false;

      const nameMatch = c.normalizedCompany.includes(normalizedAccount) || normalizedAccount.includes(c.normalizedCompany);
      if (!nameMatch) return false;

      if (zip) {
        if (!c.postalCode) return false;
        return c.postalCode.replace(/\s+/g, "") === zip.replace(/\s+/g, "");
      }

      return true;
    });
  }

  if (candidates.length > 0) {
    const leads = candidates
      .map((c) => ({ ...c, score: scoreContact(c) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { ok: true, source: "zoominfo", leads };
  }

  if (!allowPublic) {
    return { ok: false, source: "none", leads: [], message: "No ZoomInfo leads found and public lookup disabled." };
  }

  const publicLeads = await withTimeout(findPublicLeads(accountName, zip), publicTimeoutMs, "public lead lookup");
  if (publicLeads && publicLeads.length > 0) {
    // Google Places found results - return them
    return { ok: true, source: "public_web", leads: publicLeads };
  }

  // Google fallback failed/unavailable, try OSM (no key) for best-effort phone/name
  try {
    const OSM_MS = Number(process.env.OSM_LEADS_TIMEOUT_MS || 3500);
    const osm = await Promise.race([
      (async () => await findOsmPhoneAndName({ accountName, postalCode: zip, addressHint: "" }))(),
      new Promise((resolve) => setTimeout(() => resolve({ __osmTimeout: true }), OSM_MS))
    ]);
    const osmOut = (osm && osm.__osmTimeout) ? null : osm;
    if (osmOut && (osmOut.phone || osmOut.name)) {
      const leads = [{
        contactName: (osmOut.name || accountName) + " (Main Line)",
        title: "",
        department: "Front Desk",
        directPhone: "",
        mobilePhone: "",
        corpPhone: osmOut.phone || "",
        email: "",
        city: "",
        state: "",
        postalCode: zip || "",
        score: osmOut.phone ? 62 : 50
      }];
      return { ok: true, source: "osm_public", leads };
    }
  } catch (_) {}

  // Tier 4: Web Scraping (comprehensive public sources)
  if (process.env.WEB_SCRAPER_ENABLE === "1") {
    try {
      const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');
      const { prioritizeLocalContacts } = require('./leads/localBusinessIntel');

      // Extract city/state from postalCode lookup or use empty strings
      // In a production system, you'd have a ZIP->city/state lookup table
      let city = "";
      let state = "";

      // For now, attempt basic extraction if we have address info in the system
      // This is a simplified approach - enhance as needed
      console.log(`[LEADS] Tier 4: Attempting web scraping for ${accountName} in ZIP ${zip}`);

      const webResult = await withTimeout(
        findContactsViaWebScraping({
          companyName: accountName,
          city: city,
          state: state,
          postalCode: zip,
          addressHint: ""
        }),
        Number(process.env.WEB_SCRAPER_TIMEOUT_MS || 30000),
        "web scraper"
      );

      if (webResult.ok && webResult.contacts.length > 0) {
        console.log(`[LEADS] Tier 4: Found ${webResult.contacts.length} contacts from web scraping (${webResult.scrapedPages} pages)`);

        // Classify and prioritize local contacts
        const prioritized = prioritizeLocalContacts(webResult.contacts, {
          postalCode: zip,
          city: city,
          state: state
        });

        // Convert to standard lead format
        const leads = prioritized.slice(0, 5).map(c => ({
          contactName: c.contactName,
          title: c.title || "",
          department: c.department || "",
          directPhone: c.directPhone || "",
          mobilePhone: c.mobilePhone || "",
          corpPhone: c.corpPhone || "",
          email: c.email || "",
          city: c.city || city,
          state: c.state || state,
          postalCode: c.postalCode || zip,
          score: scoreContact(c),
          source: c.source,
          isLocalFacility: c.location?.isLocalFacility || false,
          locationConfidence: c.location?.confidence || 0
        }));

        return { ok: true, source: "web_scraper", leads };
      }
    } catch (err) {
      console.warn("[LEADS] Tier 4 web scraping failed:", err.message);
    }
  }

  return { ok: false, source: "public_web", leads: [], message: "No public fallback leads found." };
}
const app = express();

// HTTPS enforcement in production
if (process.env.NODE_ENV === 'production' && process.env.FORCE_HTTPS !== 'false') {
  app.use((req, res, next) => {
    // Check for forwarded protocol (behind load balancer/proxy)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;

    if (protocol !== 'https') {
      // Redirect to HTTPS
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }

    // Set security headers
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    next();
  });
  console.log('✅ HTTPS enforcement enabled for production');
}

// CORS configuration - flexible for development and production
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);

    // In production, auto-allow DigitalOcean app domains
    if (process.env.NODE_ENV === 'production' && origin.includes('.ondigitalocean.app')) {
      return callback(null, true);
    }

    // Check against configured allowed origins
    if (config.allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }

    // Default deny with helpful message
    callback(new Error('CORS policy: Origin not allowed'));
  },
  credentials: true
}));

app.use(express.json({ limit: "25mb" }));

// Trust proxy if configured (for Nginx reverse proxy)
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// ===== Serve Static Dashboard Files =====
// Serve dashboard HTML files and assets from /dashboard directory
app.use("/dashboard", express.static(DASHBOARD_DIR));
app.use(express.static(DASHBOARD_DIR)); // Also serve at root for backward compatibility
console.log('✅ Static dashboard files served from /dashboard and root');

// ===== Revenue Radar Database & API Integration =====
const db = require('./database');
const apiRoutes = require('./api-routes');
const ErrorHandler = require('./error-handler');

// Initialize database on startup
try {
  db.initDatabase();
  console.log('✅ Revenue Radar database initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Revenue Radar database:', error);
  // Don't exit - allow server to run without Revenue Radar features
}

// ===== Demo User Restriction Middleware =====
// Apply demo restrictions to all authenticated API routes
// This must come AFTER auth routes parse the token but BEFORE protected routes
app.use((req, res, next) => {
  // Skip for non-authenticated routes
  if (!req.headers.authorization) {
    return next();
  }

  // Use optional auth to parse user without requiring it
  optionalAuth(req, res, () => {
    // Apply demo restrictions if user is authenticated
    if (req.user) {
      enforceDemoRestrictions(req, res, () => {
        addDemoHeaders(req, res, next);
      });
    } else {
      next();
    }
  });
});
console.log('✅ Demo user restrictions middleware initialized');

// ===== New Infrastructure Routes =====
// Public Signup routes (no authentication - self-service trial signups)
app.use('/signup', signupRoutes);
console.log('✅ Public signup routes registered at /signup');

// Authentication routes (login, register, password reset, etc.)
app.use('/auth', authRoutes);
console.log('✅ Authentication routes registered at /auth');

// User Management routes (admin only - full CRUD)
app.use('/api/user-management', userManagementRoutes);
console.log('✅ User management routes registered at /api/user-management');

// Email Monitor routes (authenticated users - email invoice autopilot)
app.use('/api/email-monitors', emailMonitorRoutes);
console.log('✅ Email monitor routes registered at /api/email-monitors');

// Email OAuth routes (Google/Microsoft OAuth for email monitoring)
app.use('/api/email-oauth', emailOAuthRoutes);
console.log('✅ Email OAuth routes registered at /api/email-oauth');

// Admin Analytics routes (admin only - real-time metrics)
app.use('/api/admin', adminAnalyticsRoutes);
console.log('✅ Admin analytics routes registered at /api/admin');

// Health check routes (public - for load balancers)
app.use('/health', healthRoutes);
console.log('✅ Health monitoring routes registered at /health');

// ===== TEMPORARY PUBLIC DEBUG ENDPOINT =====
// TODO: Remove after debugging production invoice visibility issue
app.get('/debug-invoice-status', (req, res) => {
  try {
    const database = db.getDatabase();

    // Use centralized DB identity helper
    const dbIdentity = db.getDbIdentity();

    const totalInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs`).get();
    const completedInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE status = 'completed'`).get();
    const failedInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE status = 'failed'`).get();
    const processingInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE status = 'processing'`).get();
    const nullUserInvoices = database.prepare(`SELECT COUNT(*) as count FROM ingestion_runs WHERE user_id IS NULL`).get();

    const monitors = database.prepare(`
      SELECT id, email_address, user_id, is_active, invoices_created_count, emails_processed_count,
             last_checked_at, last_error,
             oauth_access_token IS NOT NULL as has_access_token,
             oauth_refresh_token IS NOT NULL as has_refresh_token
      FROM email_monitors
    `).all();

    // Get column info for email_processing_log to handle schema differences
    let recentProcessing = [];
    try {
      const columns = database.prepare(`PRAGMA table_info(email_processing_log)`).all();
      const hasCreatedAt = columns.some(c => c.name === 'created_at');
      const orderBy = hasCreatedAt ? 'created_at DESC' : 'id DESC';
      recentProcessing = database.prepare(`
        SELECT monitor_id, status, skip_reason, invoices_created, error_message
        FROM email_processing_log
        ORDER BY ${orderBy}
        LIMIT 20
      `).all();
    } catch (e) {
      recentProcessing = [{ error: e.message }];
    }

    const recentInvoices = database.prepare(`
      SELECT id, run_id, user_id, vendor_name, file_name, status, invoice_total_cents, created_at
      FROM ingestion_runs
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    // Count processing log entries by status
    let processingLogStats = {};
    try {
      const logStats = database.prepare(`
        SELECT status, COUNT(*) as count FROM email_processing_log GROUP BY status
      `).all();
      processingLogStats = logStats.reduce((acc, row) => {
        acc[row.status || 'unknown'] = row.count;
        return acc;
      }, {});
    } catch (e) {
      processingLogStats = { error: e.message };
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      dbIdentity: {
        path: dbIdentity.dbPathResolved,
        pathHash: dbIdentity.pathHash,
        pathSource: dbIdentity.dbPathSource,
        exists: dbIdentity.fileExists,
        sizeBytes: dbIdentity.fileSizeBytes,
        sizeHuman: dbIdentity.fileSizeHuman,
        modifiedAt: dbIdentity.fileModified,
        journalMode: dbIdentity.journalMode,
        processId: dbIdentity.processId,
        nodeEnv: dbIdentity.nodeEnv,
        cwd: dbIdentity.cwd
      },
      database: {
        totalInvoices: totalInvoices.count,
        completedInvoices: completedInvoices.count,
        failedInvoices: failedInvoices.count,
        processingInvoices: processingInvoices.count,
        nullUserIdInvoices: nullUserInvoices.count
      },
      monitors: monitors.map(m => ({
        id: m.id,
        email: m.email_address,
        userId: m.user_id,
        isActive: m.is_active,
        hasAccessToken: m.has_access_token,
        hasRefreshToken: m.has_refresh_token,
        invoicesCreatedCount: m.invoices_created_count,
        emailsProcessedCount: m.emails_processed_count,
        lastChecked: m.last_checked_at,
        lastError: m.last_error
      })),
      processingLogStats,
      recentProcessing,
      recentInvoices
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});
console.log('✅ Temporary debug endpoint at /debug-invoice-status');

// ===== ADMIN DEBUG ENDPOINTS =====
// These require admin authentication and provide detailed DB diagnostics

// GET /api/admin/db-identity - Returns database identity for debugging path mismatches
app.get('/api/admin/db-identity', requireAuth, (req, res) => {
  try {
    // Only admin/manager can access
    if (!['admin', 'manager'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const dbIdentity = db.getDbIdentity();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      requestedBy: { id: req.user.id, email: req.user.email, role: req.user.role },
      dbIdentity
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
console.log('✅ Admin endpoint at /api/admin/db-identity');

// GET /api/admin/db-state - Returns full database state for debugging
app.get('/api/admin/db-state', requireAuth, (req, res) => {
  try {
    // Only admin/manager can access
    if (!['admin', 'manager'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const dbState = db.getDbState();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      requestedBy: { id: req.user.id, email: req.user.email, role: req.user.role },
      ...dbState
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
console.log('✅ Admin endpoint at /api/admin/db-state');

// GET /api/admin/email-monitors/raw - Returns raw email monitor data from DB
app.get('/api/admin/email-monitors/raw', requireAuth, (req, res) => {
  try {
    // Only admin/manager can access
    if (!['admin', 'manager'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const database = db.getDatabase();

    // Get all monitors with full details
    const monitors = database.prepare(`
      SELECT id, user_id, created_by_user_id, email_address, account_name,
             is_active, invoices_created_count, emails_processed_count,
             last_checked_at, last_success_at, last_error,
             oauth_provider, oauth_access_token IS NOT NULL as has_access_token,
             oauth_refresh_token IS NOT NULL as has_refresh_token,
             check_frequency_minutes, folder_name, require_invoice_keywords
      FROM email_monitors
      ORDER BY id DESC
      LIMIT 50
    `).all();

    // Get count
    const countResult = database.prepare('SELECT COUNT(*) as count FROM email_monitors').get();

    // Get DB identity for verification
    const dbIdentity = db.getDbIdentity();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      requestedBy: { id: req.user.id, email: req.user.email, role: req.user.role },
      dbIdentity: {
        path: dbIdentity.dbPathResolved,
        pathHash: dbIdentity.pathHash,
        fileExists: dbIdentity.fileExists,
        fileSizeHuman: dbIdentity.fileSizeHuman
      },
      monitorCount: countResult.count,
      monitors: monitors.map(m => ({
        id: m.id,
        userId: m.user_id,
        createdByUserId: m.created_by_user_id,
        email: m.email_address,
        accountName: m.account_name,
        isActive: m.is_active === 1,
        invoicesCreatedCount: m.invoices_created_count,
        emailsProcessedCount: m.emails_processed_count,
        lastCheckedAt: m.last_checked_at,
        lastSuccessAt: m.last_success_at,
        lastError: m.last_error,
        oauthProvider: m.oauth_provider,
        hasAccessToken: m.has_access_token === 1,
        hasRefreshToken: m.has_refresh_token === 1,
        checkFrequencyMinutes: m.check_frequency_minutes,
        folderName: m.folder_name,
        requireInvoiceKeywords: m.require_invoice_keywords === 1
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});
console.log('✅ Admin endpoint at /api/admin/email-monitors/raw');

// GET /api/admin/invoice-pipeline-status - Comprehensive diagnostic for invoice persistence
// Returns: db identity, monitors, ingestion_runs, processing_logs for a specific user
app.get('/api/admin/invoice-pipeline-status', requireAuth, (req, res) => {
  try {
    // Only admin can access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const userId = req.query.user_id ? parseInt(req.query.user_id) : null;
    const database = db.getDatabase();

    // 1. Get DB identity
    const dbIdentity = db.getDbIdentity();

    // 2. Get email_monitors for user (or all if no user_id)
    let monitors;
    if (userId) {
      monitors = database.prepare(`
        SELECT id, user_id, email_address, account_name, is_active,
               invoices_created_count, emails_processed_count,
               last_checked_at, last_success_at, last_error,
               oauth_provider, created_at
        FROM email_monitors
        WHERE user_id = ?
        ORDER BY id DESC
      `).all(userId);
    } else {
      monitors = database.prepare(`
        SELECT id, user_id, email_address, account_name, is_active,
               invoices_created_count, emails_processed_count,
               last_checked_at, last_success_at, last_error,
               oauth_provider, created_at
        FROM email_monitors
        ORDER BY id DESC
        LIMIT 50
      `).all();
    }

    // 3. Get ingestion_runs for user (last 20)
    let ingestionRuns;
    if (userId) {
      ingestionRuns = database.prepare(`
        SELECT id, run_id, user_id, vendor_name, file_name, status,
               invoice_total_cents, created_at, completed_at, error_message
        FROM ingestion_runs
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 20
      `).all(userId);
    } else {
      ingestionRuns = database.prepare(`
        SELECT id, run_id, user_id, vendor_name, file_name, status,
               invoice_total_cents, created_at, completed_at, error_message
        FROM ingestion_runs
        ORDER BY id DESC
        LIMIT 20
      `).all();
    }

    // 4. Get email_processing_log for monitors (last 50)
    const monitorIds = monitors.map(m => m.id);
    let processingLogs = [];
    if (monitorIds.length > 0) {
      const placeholders = monitorIds.map(() => '?').join(',');
      processingLogs = database.prepare(`
        SELECT id, monitor_id, email_uid, status, skip_reason,
               invoices_created, error_message, processed_at
        FROM email_processing_log
        WHERE monitor_id IN (${placeholders})
        ORDER BY id DESC
        LIMIT 50
      `).all(...monitorIds);
    }

    // 5. Summary counts
    const summary = {
      monitorsCount: monitors.length,
      activeMonitorsCount: monitors.filter(m => m.is_active).length,
      totalInvoicesCreatedByMonitors: monitors.reduce((sum, m) => sum + (m.invoices_created_count || 0), 0),
      ingestionRunsCount: ingestionRuns.length,
      completedRunsCount: ingestionRuns.filter(r => r.status === 'completed').length,
      failedRunsCount: ingestionRuns.filter(r => r.status === 'failed').length,
      processingLogsCount: processingLogs.length,
      successfulProcessingCount: processingLogs.filter(l => l.status === 'success' || l.status === 'db_ok').length,
      skippedProcessingCount: processingLogs.filter(l => l.status === 'skipped').length,
      errorProcessingCount: processingLogs.filter(l => l.status === 'error').length
    };

    // 6. Mismatch detection - key diagnostic
    const mismatch = {
      monitorsShowInvoices: summary.totalInvoicesCreatedByMonitors > 0,
      ingestionRunsExist: summary.ingestionRunsCount > 0,
      possibleDataLoss: summary.totalInvoicesCreatedByMonitors > 0 && summary.ingestionRunsCount === 0,
      diagnosis: ''
    };

    if (mismatch.possibleDataLoss) {
      mismatch.diagnosis = 'CRITICAL: Monitors show invoices but no ingestion_runs found! Possible causes: ' +
        '(1) DB path mismatch - counters in one DB, runs in another; ' +
        '(2) Counter incremented before verified insert; ' +
        '(3) Database was reset/recreated';
    } else if (!mismatch.monitorsShowInvoices && !mismatch.ingestionRunsExist) {
      mismatch.diagnosis = 'No invoices created yet - this is expected for new monitors';
    } else if (mismatch.monitorsShowInvoices && mismatch.ingestionRunsExist) {
      mismatch.diagnosis = 'OK: Monitor counts match ingestion_runs existence';
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      requestedBy: { id: req.user.id, email: req.user.email, role: req.user.role },
      queryUserId: userId,
      dbIdentity: {
        path: dbIdentity.dbPathResolved,
        fileExists: dbIdentity.fileExists,
        fileSizeHuman: dbIdentity.fileSizeHuman,
        dataDirectoryExists: dbIdentity.dataDirectoryExists,
        isPersistentStorage: dbIdentity.isPersistentStorage,
        journalMode: dbIdentity.journalMode
      },
      summary,
      mismatch,
      monitors,
      ingestionRuns,
      processingLogs
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, stack: error.stack });
  }
});
console.log('✅ Admin endpoint at /api/admin/invoice-pipeline-status');

// Backup management routes (admin only)
app.use('/backups', backupRoutes);
console.log('✅ Backup management routes registered at /backups');

// Stripe payment routes (public + authenticated)
app.use('/stripe', stripeRoutes);
console.log('✅ Stripe payment routes registered at /stripe');

// Business Intelligence routes (opportunities, inventory, payroll, analytics)
// Protected by auth middleware to ensure req.user is populated
app.use('/api/bi', requireAuth, businessIntelRoutes);
console.log('✅ Business Intelligence routes registered at /api/bi (auth required)');

// Private Events & Catering routes (event planning, recommendations, catering orders)
// Protected by auth middleware to ensure req.user is populated
app.use('/api', requireAuth, eventCateringRoutes);
console.log('✅ Private Events & Catering routes registered at /api (auth required)');

// Intent Signals routes (buyer intent monitoring)
// Protected by auth middleware to ensure req.user is populated
const intentSignalRoutes = require('./intent-signal-routes');
app.use('/api/intent-signals', requireAuth, intentSignalRoutes);
console.log('✅ Intent Signal routes registered at /api/intent-signals (auth required)');

// Intent Signal Background Service - monitors configs and generates signals
const IntentSignalService = require('./intent-signal-service');
const intentSignalService = new IntentSignalService(db);
// Start the service after a short delay to ensure DB is ready
setTimeout(() => {
  intentSignalService.startAll().catch(err => {
    console.error('Failed to start Intent Signal Service:', err);
  });
}, 3000);
console.log('✅ Intent Signal Service initialized (starting in 3s)');

// COGS Coding routes (invoice expense categorization)
// Protected by auth middleware to ensure req.user is populated
const cogsRoutes = require('./cogs-coding-routes');
app.use('/api/cogs', requireAuth, cogsRoutes);
console.log('✅ COGS Coding routes registered at /api/cogs (auth required)');

// Job Queue API routes (background PDF/OCR processing)
// Protected by auth middleware

// Get job status
app.get('/api/jobs/:jobId', requireAuth, (req, res) => {
  try {
    const job = jobQueue.getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    // Only allow users to see their own jobs (unless admin)
    if (job.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(job);
  } catch (error) {
    console.error('[JOBS API] Error getting job:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// List user's jobs
app.get('/api/jobs', requireAuth, (req, res) => {
  try {
    const status = req.query.status;
    const limit = parseInt(req.query.limit) || 50;
    const jobs = jobQueue.getJobsByUser(req.user.id, { status, limit });
    res.json({ jobs });
  } catch (error) {
    console.error('[JOBS API] Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

// Get queue statistics (admin only)
app.get('/api/jobs/stats', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const stats = jobQueue.getQueueStats();
    const processorStatus = jobProcessor.getStatus();
    res.json({ stats, processor: processorStatus });
  } catch (error) {
    console.error('[JOBS API] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

console.log('✅ Job Queue routes registered at /api/jobs (auth required)');

// Human Correction Workflow API routes
// For reviewing and correcting low-confidence invoice parses

// Get pending reviews
app.get('/api/reviews/pending', requireAuth, (req, res) => {
  try {
    const severity = req.query.severity;
    const limit = parseInt(req.query.limit) || 50;
    // Managers/admins see all, others see only their own
    const userId = ['admin', 'manager'].includes(req.user.role) ? null : req.user.id;
    const reviews = reviewService.getPendingReviews({ severity, limit, userId });
    res.json({ reviews });
  } catch (error) {
    console.error('[REVIEWS API] Error getting pending reviews:', error);
    res.status(500).json({ error: 'Failed to get pending reviews' });
  }
});

// Get review statistics (admin/manager only)
app.get('/api/reviews/stats', requireAuth, (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or manager access required' });
  }
  try {
    const stats = reviewService.getReviewStats();
    res.json(stats);
  } catch (error) {
    console.error('[REVIEWS API] Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get a specific review
app.get('/api/reviews/:reviewId', requireAuth, (req, res) => {
  try {
    const review = reviewService.getReview(parseInt(req.params.reviewId));
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    // Check access
    if (!['admin', 'manager'].includes(req.user.role) && review.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json(review);
  } catch (error) {
    console.error('[REVIEWS API] Error getting review:', error);
    res.status(500).json({ error: 'Failed to get review' });
  }
});

// Get review by run ID
app.get('/api/reviews/run/:runId', requireAuth, (req, res) => {
  try {
    const review = reviewService.getReviewByRunId(parseInt(req.params.runId));
    if (!review) {
      return res.status(404).json({ error: 'Review not found for this run' });
    }
    res.json(review);
  } catch (error) {
    console.error('[REVIEWS API] Error getting review by run:', error);
    res.status(500).json({ error: 'Failed to get review' });
  }
});

// Approve a review as-is
app.post('/api/reviews/:reviewId/approve', requireAuth, (req, res) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const notes = req.body.notes || null;
    const updated = reviewService.approveReview(reviewId, req.user.id, notes);
    res.json({ success: true, review: updated });
  } catch (error) {
    console.error('[REVIEWS API] Error approving review:', error);
    res.status(500).json({ error: 'Failed to approve review' });
  }
});

// Submit corrections for a review
app.post('/api/reviews/:reviewId/correct', requireAuth, (req, res) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const corrections = req.body.corrections;
    const notes = req.body.notes || null;

    if (!corrections) {
      return res.status(400).json({ error: 'Corrections required' });
    }

    const updated = reviewService.submitCorrections(reviewId, req.user.id, corrections, notes);
    res.json({ success: true, review: updated });
  } catch (error) {
    console.error('[REVIEWS API] Error submitting corrections:', error);
    res.status(500).json({ error: 'Failed to submit corrections' });
  }
});

// Dismiss a review
app.post('/api/reviews/:reviewId/dismiss', requireAuth, (req, res) => {
  try {
    const reviewId = parseInt(req.params.reviewId);
    const notes = req.body.notes || 'Dismissed without correction';
    const updated = reviewService.dismissReview(reviewId, req.user.id, notes);
    res.json({ success: true, review: updated });
  } catch (error) {
    console.error('[REVIEWS API] Error dismissing review:', error);
    res.status(500).json({ error: 'Failed to dismiss review' });
  }
});

// Get correction patterns for a vendor (admin/manager only)
app.get('/api/reviews/patterns/:vendorName', requireAuth, (req, res) => {
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Admin or manager access required' });
  }
  try {
    const patterns = reviewService.getCorrectionPatterns(req.params.vendorName);
    res.json({ patterns });
  } catch (error) {
    console.error('[REVIEWS API] Error getting patterns:', error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

console.log('✅ Review Workflow routes registered at /api/reviews (auth required)');

// Request logging middleware for better monitoring and real-time analytics
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log(`[SLOW REQUEST] ${req.method} ${req.path} - ${duration}ms - ${res.statusCode}`);
    }

    // Log API requests to database for analytics (skip static files and frequent endpoints)
    const path = req.path;
    if (path.startsWith('/api/') || path === '/ingest' || path.startsWith('/auth/') || path.startsWith('/signup/')) {
      // Skip high-frequency polling endpoints to avoid bloat
      if (path === '/health' || path === '/api/admin/recent-activity') {
        return;
      }

      try {
        const userId = req.user?.id || null;
        const ip = req.ip || req.connection?.remoteAddress || '';
        const userAgent = req.get('user-agent')?.substring(0, 255) || '';
        const errorMsg = res.statusCode >= 400 ? (res.locals?.errorMessage || null) : null;

        db.prepare(`
          INSERT INTO api_request_log (endpoint, method, status_code, response_time_ms, user_id, ip_address, user_agent, error_message)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(path, req.method, res.statusCode, duration, userId, ip, userAgent, errorMsg);
      } catch (logError) {
        // Don't let logging errors break the app
        console.error('[API-LOG] Failed to log request:', logError.message);
      }
    }
  });
  next();
});

app.post("/api/osm/clear-cache", (req, res) => { try { osmCache.clear(); } catch (_) {} return res.json({ ok: true }); });
app.post("/api/leads/clear-cache", (req, res) => { try { leadsCache.clear(); } catch (_) {} return res.json({ ok: true, message: "Leads cache cleared" }); });

// ===== DEBUG ENDPOINT: PDF TEXT INSPECTION =====
// GET /api/debug/pdf-text/:runId - Inspect raw text and totals signals for a specific run
app.get("/api/debug/pdf-text/:runId", (req, res) => {
  try {
    const { runId } = req.params;

    // Validate runId format (timestamp-hex pattern)
    if (!runId || !/^[\w\-]+$/.test(runId)) {
      return res.status(400).json({ ok: false, message: "Invalid runId format" });
    }

    // Check if run directory exists
    const runPath = path.join(RUNS_DIR, runId);
    if (!fs.existsSync(runPath)) {
      return res.status(404).json({ ok: false, message: "Run not found", runId });
    }

    // Try to read raw text from multiple possible sources
    let rawText = '';
    let filePath = null;
    let source = null;

    // Priority 1: extracted.json (contains raw_text)
    const extractedPath = path.join(runPath, "extracted.json");
    if (fs.existsSync(extractedPath)) {
      try {
        const extracted = JSON.parse(fs.readFileSync(extractedPath, "utf8"));
        if (extracted.raw_text) {
          rawText = extracted.raw_text;
          filePath = extractedPath;
          source = 'extracted.json';
        }
      } catch (e) {
        console.warn(`[DEBUG PDF-TEXT] Failed to read extracted.json: ${e.message}`);
      }
    }

    // Priority 2: raw_capture.json (may contain payload with raw_text)
    if (!rawText) {
      const rawCapturePath = path.join(runPath, "raw_capture.json");
      if (fs.existsSync(rawCapturePath)) {
        try {
          const rawCapture = JSON.parse(fs.readFileSync(rawCapturePath, "utf8"));
          const payloadText = rawCapture?.payload?.raw_text || rawCapture?.raw_text;
          if (payloadText) {
            rawText = payloadText;
            filePath = rawCapturePath;
            source = 'raw_capture.json';
          }
        } catch (e) {
          console.warn(`[DEBUG PDF-TEXT] Failed to read raw_capture.json: ${e.message}`);
        }
      }
    }

    // Priority 3: ingest_response.json
    if (!rawText) {
      const ingestPath = path.join(runPath, "ingest_response.json");
      if (fs.existsSync(ingestPath)) {
        try {
          const ingest = JSON.parse(fs.readFileSync(ingestPath, "utf8"));
          if (ingest?.extracted?.raw_text_preview) {
            rawText = ingest.extracted.raw_text_preview;
            filePath = ingestPath;
            source = 'ingest_response.json (preview only)';
          }
        } catch (e) {
          console.warn(`[DEBUG PDF-TEXT] Failed to read ingest_response.json: ${e.message}`);
        }
      }
    }

    if (!rawText) {
      return res.json({
        ok: false,
        message: "No raw text found for this run",
        runId,
        searchedFiles: ['extracted.json', 'raw_capture.json', 'ingest_response.json']
      });
    }

    // Import totals extractor for analysis
    const { extractTotalsByLineScan, extractInterestingLines } = require('./services/invoice_parsing_v2/totals');

    // Extract totals and interesting lines
    const totalsResult = extractTotalsByLineScan(rawText);
    const interestingLines = extractInterestingLines(rawText);

    // Build signals summary
    const signals = {
      hasInvoice: /invoice/i.test(rawText),
      hasTotal: /\btotal\b/i.test(rawText),
      hasSubtotal: /\bsubtotal\b/i.test(rawText),
      hasTax: /\btax\b/i.test(rawText),
      hasAmountDue: /amount\s*due/i.test(rawText),
      invoiceTotalMatches: (rawText.match(/invoice\s+total/gi) || []).length,
      totalMatches: (rawText.match(/\btotal\b/gi) || []).length
    };

    // Return comprehensive debug info
    return res.json({
      ok: true,
      runId,
      filePath,
      source,
      textLength: rawText.length,
      head: rawText.slice(0, 2000),
      tail: rawText.slice(-2000),
      signals,
      extractedTotals: {
        totalCents: totalsResult.totalCents,
        subtotalCents: totalsResult.subtotalCents,
        taxCents: totalsResult.taxCents,
        feesCents: totalsResult.feesCents,
        discountCents: totalsResult.discountCents,
        totalFormatted: `$${(totalsResult.totalCents / 100).toFixed(2)}`,
        subtotalFormatted: `$${(totalsResult.subtotalCents / 100).toFixed(2)}`,
        taxFormatted: `$${(totalsResult.taxCents / 100).toFixed(2)}`
      },
      evidence: totalsResult.evidence,
      interestingLines: interestingLines.slice(0, 50)  // Limit to 50 lines
    });

  } catch (err) {
    console.error('[DEBUG PDF-TEXT] Error:', err);
    return res.status(500).json({
      ok: false,
      message: "Error processing request",
      error: err.message
    });
  }
});

app.post("/api/osm/debug", async (req, res) => {
  const HARD_MS = Number(process.env.OSM_DEBUG_TIMEOUT_MS || 8000);
  const hardTimeout = new Promise((resolve) => setTimeout(() => resolve({ __hardTimeout: true }), HARD_MS));

  try {
    const body = req.body || {};
    const accountName = String(body.accountName || "").trim();
    const postalCode = String(body.postalCode || "").trim();
    const addressHint = String(body.addressHint || "").trim();

    const zipFirst = await Promise.race([
        (async () => await _overpassZipPhoneLookup({ accountName, postalCode }))(),
        hardTimeout
      ]);
      const zipFirstOut = (zipFirst && zipFirst.__hardTimeout) ? null : zipFirst;

    const full = await Promise.race([
        (async () => await findOsmPhoneAndName({ accountName, postalCode, addressHint }))(),
        hardTimeout
      ]);
      if (full && full.__hardTimeout) {
        return res.json({ ok: false, message: "OSM debug timed out", input: req.body || {}, zipFirst: zipFirstOut, full: null });
      }


    return res.json({
      ok: true,
      input: { accountName, postalCode, addressHint },
      zipFirst: zipFirstOut,
      full
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && (e.stack || e.message || e)) });
  }
});
// Old health endpoint - replaced by comprehensive health-routes.js
// app.get("/health", (req, res) => {
//   res.json({
//     ok: true,
//     service: "ai-sales-backend",
//     version: VERSION,
//     port: PORT,
//     time: new Date().toISOString()
//   });
// });

app.get("/api/intel/status", (req, res) => {
  res.json({
    ok: true,
    hasIntel: !!intel,
    intelMethods: {
      addDetection: typeof intel.addDetection === "function",
      listDetections: typeof intel.listDetections === "function",
      listMatches: typeof intel.listMatches === "function",
      recomputeMatches: typeof intel.recomputeMatches === "function"
    }
  });
});

app.post("/api/intel/recompute", (req, res) => {
  try {
    const out = typeof intel.recomputeMatches === "function" ? intel.recomputeMatches(500) : { scanned: 0, matchesCreated: 0 };
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(200).json({ ok: false, message: "intel recompute failed", error: String(e && (e.stack || e.message || e)) });
  }
});

app.get("/api/intel/matches", (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const matches = typeof intel.listMatches === "function" ? intel.listMatches(limit) : [];
    res.json({ ok: true, matches });
  } catch (e) {
    res.status(200).json({ ok: false, message: "intel matches failed", error: String(e && (e.stack || e.message || e)) });
  }
});

app.get("/api/intel/detections", (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const detections = typeof intel.listDetections === "function" ? intel.listDetections(limit) : [];
    res.json({ ok: true, detections });
  } catch (e) {
    res.status(200).json({ ok: false, message: "intel detections failed", error: String(e && (e.stack || e.message || e)) });
  }
});

app.post("/api/intel/test-detection", (req, res) => {
  try {
    const body = req.body || {};
    const d = {
      sourceType: body.sourceType || "test",
      sourceId: body.sourceId || `test:${Date.now()}`,
      rawName: body.rawName || "Test Company LLC",
      rawAddress: body.rawAddress || "123 Test St, Testville, MO 63101"
    };
    safeIntelAddDetection(d);
    res.json({ ok: true, added: d });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e && (e.stack || e.message || e)) });
  }
});

// ===== Mount Revenue Radar API Routes =====
// These routes handle SPIFs, opportunities, commissions, and dashboard data
app.use('/api', apiRoutes);
console.log('✅ Revenue Radar API routes mounted at /api');

if (telemetryMod && typeof telemetryMod.appendEvent === "function") {
  const { appendEvent, readEvents, summarizeEvents } = telemetryMod;

  app.post("/telemetry", (req, res) => {
    try {
      const body = req.body || {};
      const evt = {
        ts: body.ts || new Date().toISOString(),
        user_id: body.user_id ?? null,
        session_id: body.session_id ?? null,
        source: body.source || "unknown",
        action: body.action || "unknown",
        meta: body.meta && typeof body.meta === "object" ? body.meta : {}
      };
      const saved = appendEvent(evt);

      // ===== Revenue Radar Telemetry Integration =====
      try {
        // Extract user information
        const userEmail = body.user_email || req.headers['x-user-email'] || req.headers['user-email'] || 'anonymous@revenueradar.com';
        const userName = userEmail.split('@')[0];
        const userId = db.createOrUpdateUser(userEmail, userName, 'rep');

        // Extract event data
        const eventType = body.event_type || body.action || 'unknown';
        const eventData = body.event_data || body.meta || {};
        const pageUrl = body.page_url || body.sourceUrl || '';
        const sessionId = body.session_id || `session_${Date.now()}`;

        // Log telemetry event to Revenue Radar database
        db.logTelemetryEvent(userId, eventType, eventData, pageUrl, sessionId);

        // Special handling for MLA review events
        if (eventType === 'mla_reviewed' && eventData && eventData.mla_id) {
          try {
            const reviewResult = db.recordMLAReview(
              eventData.mla_id,
              userId,
              eventData.action || 'analyzed',
              eventData.notes || null
            );
            console.log(`[REVENUE RADAR] ✅ MLA review recorded: MLA #${eventData.mla_id}, User: ${userEmail}`);

            // Include SPIF update info in response
            evt.revenueRadar = {
              mla_review_recorded: true,
              review_id: reviewResult
            };
          } catch (mlaError) {
            console.error('[REVENUE RADAR] Failed to record MLA review:', mlaError);
          }
        }

        console.log(`[REVENUE RADAR] ✅ Telemetry logged: ${eventType} from ${userEmail}`);
      } catch (revenueRadarError) {
        console.error('[REVENUE RADAR] Telemetry integration error:', revenueRadarError);
        // Continue with normal telemetry flow
      }
      // ===== End Revenue Radar Integration =====

      return res.status(200).json({ ok: true, event: saved });
    } catch (err) {
      return res.status(500).json({ ok: false, message: "telemetry failed", error: String(err && (err.stack || err)) });
    }
  });

  app.get("/api/telemetry/events", (req, res) => {
    try {
      const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 200)));
      const events = readEvents({ limit });
      return res.json({ ok: true, limit, events });
    } catch (err) {
      return res.status(500).json({ ok: false, message: "telemetry read failed", error: String(err && (err.stack || err)) });
    }
  });

  app.get("/api/telemetry/summary", (req, res) => {
    try {
      const windowHours = Math.max(1, Math.min(24 * 30, Number(req.query.windowHours || 24)));
      const events = readEvents({ limit: 5000 });

      const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
      const inWindow = events.filter((e) => {
        const t = Date.parse(e.ts || "");
        return Number.isFinite(t) && t >= cutoff;
      });

      const summary = summarizeEvents(inWindow) || {};
      const byAction = summary.byAction || {};
      const adoption = {
        analyze_invoice_clicked: byAction["analyze_invoice_clicked"] || 0,
        opportunity_clicked: byAction["opportunity_clicked"] || 0,
        find_leads_clicked: byAction["find_leads_clicked"] || 0,
        analyze_mla_clicked: byAction["analyze_mla_clicked"] || 0
      };

      return res.json({
        ok: true,
        windowHours,
        totals: {
          events: inWindow.length,
          uniqueUsers: Object.keys(summary.byUser || {}).length
        },
        adoption,
        breakdown: summary
      });
    } catch (err) {
      return res.status(500).json({ ok: false, message: "telemetry summary failed", error: String(err && (err.stack || err)) });
    }
  });
}

if (dashboardRoutes) {
  // Dashboard routes need auth to properly filter data by user
  app.use("/api/dashboard", optionalAuth, dashboardRoutes);
}

// Dashboard static files are served earlier in the middleware chain (line ~1096)
// Removed duplicate static middleware to avoid conflicts

app.get("/api/runs", (req, res) => {
  try {
    if (!fs.existsSync(RUNS_DIR)) return res.json({ ok: true, runs: [] });

    const entries = fs
      .readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => (a < b ? 1 : -1));

    const runs = entries.map((runId) => {
      const runPath = path.join(RUNS_DIR, runId);
      const summaryPath = path.join(runPath, "_SUMMARY.json");
      let summaryCounts = null;
      let createdAt = null;

      try {
        const stat = fs.statSync(runPath);
        createdAt = stat.mtime ? stat.mtime.toISOString() : null;
      } catch (_) {}

      if (fs.existsSync(summaryPath)) {
        try {
          const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
          summaryCounts = summary && summary.counts ? summary.counts : summary;
        } catch (_) {
          summaryCounts = null;
        }
      }

      return { runId, createdAt, summaryCounts };
    });

    return res.json({ ok: true, runs });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to list runs", error: String(err) });
  }
});

app.get("/api/runs/:runId", (req, res) => {
  try {
    const runId = req.params.runId;
    if (!isSafeSegment(runId)) return res.status(400).json({ ok: false, message: "Invalid runId" });

    const runPath = path.join(RUNS_DIR, runId);
    if (!fs.existsSync(runPath)) return res.status(404).json({ ok: false, message: "Run not found" });

    const summaryPath = path.join(runPath, "_SUMMARY.json");
    let summary = null;
    if (fs.existsSync(summaryPath)) {
      try {
        summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      } catch (_) {
        summary = null;
      }
    }

    const files = fs
      .readdirSync(runPath)
      .filter((f) => f.endsWith(".json") && f !== "_SUMMARY.json")
      .sort();

    return res.json({ ok: true, runId, summary, files });
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to load run", error: String(err) });
  }
});

app.get("/api/runs/:runId/file/:fileName", (req, res) => {
  try {
    const { runId, fileName } = req.params;
    if (!isSafeSegment(runId) || !isSafeSegment(fileName)) {
      return res.status(400).json({ ok: false, message: "Invalid path segment" });
    }
    if (!fileName.endsWith(".json")) {
      return res.status(400).json({ ok: false, message: "fileName must end with .json" });
    }

    const fp = path.join(RUNS_DIR, runId, fileName);
    if (!fs.existsSync(fp)) return res.status(404).json({ ok: false, message: "File not found" });

    const obj = JSON.parse(fs.readFileSync(fp, "utf8"));
    return res.json(obj);
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to load file", error: String(err) });
  }
});

app.get("/api/runs/:runId/leads", async (req, res) => {
  try {
    const runId = req.params.runId;

    // Canonical-aware context (raw text may be empty)
    let canonical = null;
    try {
      const cfp = path.join(RUNS_DIR, runId, "canonical.json");
      if (fs.existsSync(cfp)) canonical = JSON.parse(fs.readFileSync(cfp, "utf8"));
    } catch (_) {}

    // Use canonical first, then fall back to query/body fields
    const ctx = extractRunAccountAndLocation(
      canonical,
      String((req.body && req.body.accountName) || req.query.accountName || "").trim(),
      String((req.body && req.body.postalCode) || req.query.postalCode || "").trim(),
      String((req.body && req.body.addressHint) || req.query.addressHint || "").trim()
    );

    const accountName = ctx.accountName;
    const postalCode = ctx.postalCode;
    const addressHint = ctx.addressHint;

    if (!isSafeSegment(runId)) return res.status(400).json({ ok: false, message: "Invalid runId" });

    const runPath = path.join(RUNS_DIR, runId);
    if (!fs.existsSync(runPath)) return res.status(404).json({ ok: false, message: "Run not found" });

    const leadsPath = path.join(runPath, "leads.json");
    if (fs.existsSync(leadsPath)) {
      const obj = JSON.parse(fs.readFileSync(leadsPath, "utf8"));
      return res.json(obj);
    }

    // Backfill on-demand: read raw_capture.json and compute leads, then persist leads.json
    const rawPath = path.join(runPath, "raw_capture.json");
    if (!fs.existsSync(rawPath)) {
      return res.status(404).json({ ok: false, message: "Leads not found for run (no leads.json and no raw_capture.json)" });
    }

    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(rawPath, "utf8")); } catch (_) { raw = null; }
    const body = raw && typeof raw === "object" ? raw : {};

    // Use canonical-derived ctx (already computed above)
    const postal = String(postalCode || "").trim();
    // addressHint is already defined above
    // accountName is already defined above
    if (!accountName) {
      const out = { ok: false, message: "Run has no accountName to compute leads", source: "none", leads: [] };
      fs.writeFileSync(leadsPath, JSON.stringify(out, null, 2), "utf8");
      return res.json(out);
    }

    const leadsOut = await computeLeadsForAccount({
      accountName: String(accountName),
      postalCode: postal,
      addressHint: addressHint,
      runId: String(runId)
    });

    fs.writeFileSync(leadsPath, JSON.stringify(leadsOut, null, 2), "utf8");
    return res.json(leadsOut);
  } catch (err) {
    return res.status(500).json({ ok: false, message: "Failed to load/backfill leads", error: String(err && (err.stack || err)) });
  }
});
function processInvoice(payload, items) {
  const parseQty = (q) => {
    const n = parseInt(q, 10);
    return isNaN(n) ? 0 : n;
  };

  const totalItems = items.length;

  let frItemsCount = 0;

  let frShirtQty = 0;
  let frPantQty = 0;
  let frJacketQty = 0;

  let nonFrShirtQty = 0;
  let nonFrPantQty = 0;
  let nonFrJacketQty = 0;

  const linerSku = "64356";
  let linerQty = 0;

  for (const it of items) {
    const desc = String(it.description || "");
    const descLower = desc.toLowerCase();
    const qty = parseQty(it.quantity);
    const sku = String(it.sku || "");

    const isFR = descLower.includes("fr");
    const isShirt = descLower.includes("shirt");
    const isPant = descLower.includes("pant");
    const isJacket = descLower.includes("jacket") || descLower.includes("coat");

    if (isFR) {
      frItemsCount += 1;
      if (isShirt) frShirtQty += qty;
      else if (isPant) frPantQty += qty;
      else if (isJacket) frJacketQty += qty;
    } else {
      if (isShirt) nonFrShirtQty += qty;
      else if (isPant) nonFrPantQty += qty;
      else if (isJacket) nonFrJacketQty += qty;
    }

    if (sku === linerSku) linerQty += qty;
  }

  const frWearerCount = items.reduce((sum, it) => {
    const descLower = String(it.description || "").toLowerCase();
    if (!descLower.includes("fr")) return sum;
    return sum + parseQty(it.quantity);
  }, 0);

  const totalShirtQty = frShirtQty + nonFrShirtQty;
  const totalPantQty = frPantQty + nonFrPantQty;

  const frUniformQty = Math.min(frShirtQty, frPantQty);
  const totalUniformQty = Math.min(totalShirtQty, totalPantQty);
  const nonFrUniformQty = Math.max(totalUniformQty - frUniformQty, 0);

  const estimatedFrEmployees = Math.max(Math.ceil(frUniformQty / 11), 0);
  const estimatedNonFrEmployees = Math.max(Math.ceil(nonFrUniformQty / 11), 0);

  const frCoreEmployees = estimatedFrEmployees;
  const frWearersWithNonFrJacket = Math.min(nonFrJacketQty, frCoreEmployees);

  const missingLiners = Math.max(frWearerCount - linerQty, 0);
  const linerPricePerWeek = 2.5;
  const potentialWeeklyRevenue_Liners = missingLiners * linerPricePerWeek;

  const commissionMultiplier = 3;
  const estimatedCommissionPayout_Liners = potentialWeeklyRevenue_Liners * commissionMultiplier;

  const jacketPricePerWeek = 3.0;
  const potentialWeeklyRevenue_JacketConversion = frWearersWithNonFrJacket * jacketPricePerWeek;
  const estimatedCommissionPayout_JacketConversion = potentialWeeklyRevenue_JacketConversion * commissionMultiplier;

  const mlaSummary = {
    mlaId: "MLA-GEN-DEFAULT",
    mlaName: "Standard FR Program",
    liner: {
      presentOnFormulary: true,
      sku: linerSku,
      description: "FR Insulated Liner",
      pricePerWeek: linerPricePerWeek,
      allowedAtLocalLevel: false,
      formularyTier: "Extended",
      notes: "Extended formulary item; may require approval depending on region."
    }
  };

  const opportunity = {
    linerAddOn: {
      sku: linerSku,
      description: "FR Insulated Liner add-on",
      frWearerCount,
      currentLinerWearers: linerQty,
      missingLiners,
      potentialWeeklyRevenue: potentialWeeklyRevenue_Liners,
      commissionEstimate: { multiplier: commissionMultiplier, estimatedPayout: estimatedCommissionPayout_Liners }
    },
    jacketConversion: {
      description: "Convert non-FR jackets to FR jackets",
      frUniformQty,
      estimatedFrEmployees,
      nonFrJacketQty,
      frWearersWithNonFrJacket,
      exampleJacketPricePerWeek: jacketPricePerWeek,
      potentialWeeklyRevenue: potentialWeeklyRevenue_JacketConversion,
      commissionEstimate: { multiplier: commissionMultiplier, estimatedPayout: estimatedCommissionPayout_JacketConversion }
    },
    uniformMix: {
      frUniformQty,
      nonFrUniformQty,
      estimatedFrEmployees,
      estimatedNonFrEmployees,
      conversionRule: "11 uniforms ≈ 1 employee",
      notes: "Uniform quantities are derived from shirt + pant pairs. Employee estimates are based on 11 uniforms per employee."
    }
  };

  return {
    ok: true,
    message: "Backend processed invoice and MLA/opportunity logic.",
    account: {
      accountNumber: payload.accountNumber || "",
      accountName: payload.accountName || ""
    },
    stats: { totalItems, frItemsCount, frWearerCount },
    mlaSummary,
    opportunity
  };
}

app.post("/capture", (req, res) => {
  const payload = req.body || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  return res.json(processInvoice(payload, items));
});

// ===== Revenue Radar Opportunity Detection =====
/**
 * Detects sales opportunities from invoice data using intelligent heuristics.
 * In production, this would be enhanced with ML/AI models.
 *
 * @param {Object} canonical - Canonical invoice data
 * @param {number} userId - User ID from Revenue Radar database
 * @param {number} runId - Ingestion run ID from Revenue Radar database
 * @returns {Object|null} - Opportunity data or null if none detected
 */
function detectOpportunityFromInvoice(canonical, userId, runId) {
  if (!canonical) return null;

  try {
    const total = canonical.total_amount_cents || 0;

    // High-value invoice threshold: $5,000+
    // These invoices indicate significant equipment/service relationships
    if (total > 500000) {
      const accountName = (canonical.parties && canonical.parties.customer && canonical.parties.customer.name) || 'Unknown Account';

      // Check if we have an existing MLA for this account
      const existingMLA = db.getDatabase().prepare(`
        SELECT * FROM mlas WHERE account_name LIKE ? LIMIT 1
      `).get(`%${accountName}%`);

      if (existingMLA) {
        // Check if MLA is expiring soon (within 90 days)
        const endDate = new Date(existingMLA.end_date);
        const now = new Date();
        const daysUntilExpiry = Math.floor((endDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntilExpiry > 0 && daysUntilExpiry <= 90) {
          console.log(`[OPPORTUNITY] Detected MLA renewal opportunity for ${accountName} (expires in ${daysUntilExpiry} days)`);
          return {
            account_name: accountName,
            opportunity_type: 'mla_renewal',
            assigned_to: userId,
            likelihood_pct: Math.max(70, Math.min(95, 95 - Math.floor(daysUntilExpiry / 3))), // Higher likelihood closer to expiration
            estimated_value_cents: existingMLA.contract_value_cents,
            estimated_commission_cents: Math.floor(existingMLA.contract_value_cents * 0.05), // 5% commission
            source_run_id: runId,
            mla_id: existingMLA.id,
            urgency: daysUntilExpiry <= 30 ? 'critical' : (daysUntilExpiry <= 60 ? 'high' : 'medium'),
            notes: `MLA expires in ${daysUntilExpiry} days. High-value invoice detected ($${(total / 100).toLocaleString()}). System auto-detected via invoice analysis.`
          };
        }
      } else {
        // No existing MLA - potential new contract opportunity
        // Estimate annual value based on invoice (assuming quarterly billing)
        const estimatedAnnualValue = total * 4;
        console.log(`[OPPORTUNITY] Detected new service opportunity for ${accountName} (high-value invoice: $${(total / 100).toLocaleString()})`);

        return {
          account_name: accountName,
          opportunity_type: 'new_service',
          assigned_to: userId,
          likelihood_pct: 65, // Moderate likelihood for new opportunities
          estimated_value_cents: estimatedAnnualValue,
          estimated_commission_cents: Math.floor(estimatedAnnualValue * 0.03), // 3% commission for new business
          source_run_id: runId,
          mla_id: null,
          urgency: 'medium',
          notes: `High-value invoice detected ($${(total / 100).toLocaleString()}). Potential for new MLA or service agreement. Estimated annual value: $${(estimatedAnnualValue / 100).toLocaleString()}.`
        };
      }
    }
  } catch (error) {
    console.error('[OPPORTUNITY] Detection error:', error);
  }

  return null;
}

app.post("/ingest", requireAuth, checkTrialAccess, async (req, res) => {
  const run_id = nowRunId();
  const safeArray = (x) => (Array.isArray(x) ? x : []);
  const truncate = (str, n) => {
    const s = String(str ?? "");
    return s.length <= n ? s : s.slice(0, n) + "…";
  };

  function buildUnified({ ok, status, message, extracted, canonical, validation, legacy, debug, error, source_type }) {
    const rawText = extracted?.raw_text ?? "";
    const items = safeArray(extracted?.items);
    const tableHtml = safeArray(extracted?.tableHtml);

    return {
      ok: !!ok,
      run_id,
      source_type,
      status,
      message: message || null,
      canonical: status === "canonical_valid" ? canonical : null,
      extracted: {
        items,
        tableHtml,
        raw_text_length: rawText.length,
        raw_text_preview: truncate(rawText, 2000),
        meta: extracted?.meta || {}
      },
      validation: validation || { attempted: false, ok: false, errors: [] },
      legacy: status === "canonical_valid" ? legacy ?? null : null,
      debug: { version: VERSION, ...(debug || {}) },
      error: error ? { message: String(error?.message || error), stack: String(error?.stack || "") } : null
    };
  }

  try {
    const body = req.body || {};
    const source_type = body.source_type || "unknown";
    const payload = body.payload || body;

    let raw_text = payload?.raw_text || "";

    // ===== UNIVERSAL INVOICE PROCESSOR =====
    // Handles ALL formats: PDF (digital & scanned), images (phone photos, screenshots), text
    // Includes OCR for scanned documents and mobile photo optimization
    let processorResult = null;
    let parsedInvoice = null;

    // Determine input type and process accordingly
    if (raw_text.startsWith("PDF_FILE_BASE64:")) {
      // Base64-encoded PDF
      console.log("[INGEST] Processing base64 PDF with universal processor...");
      const base64Data = raw_text.substring("PDF_FILE_BASE64:".length);
      processorResult = await universalInvoiceProcessor.processInvoice(
        { base64: base64Data, mimeType: 'application/pdf', filename: body.fileName },
        { source: source_type, includeRawText: true }
      );
    } else if (raw_text.startsWith("IMAGE_FILE_BASE64:")) {
      // Base64-encoded image (phone photo, screenshot, scan)
      const base64Data = raw_text.substring("IMAGE_FILE_BASE64:".length);

      // Try v2 pipeline first if enabled
      if (invoiceImagePipeline.PIPELINE_V2_ENABLED) {
        console.log("[INGEST] Processing base64 image with v2 pipeline (enhanced OCR)...");
        try {
          const pipelineResult = await invoiceImagePipeline.processInvoiceImageUpload({
            userId: req.user?.id || null,
            file: base64Data,
            metadata: {
              filename: body.fileName,
              mimeType: body.mimeType || 'image/jpeg',
              fileSize: base64Data.length
            }
          });

          // Convert pipeline result to processor result format
          if (pipelineResult.ok || pipelineResult.confidence?.overallScore >= 0.3) {
            console.log(`[INGEST] v2 pipeline: confidence=${(pipelineResult.confidence?.overallScore * 100).toFixed(1)}%, ok=${pipelineResult.ok}`);
            processorResult = {
              ok: pipelineResult.ok,
              fileType: 'image',
              extractionMethod: 'pipeline_v2_ocr',
              extractionConfidence: pipelineResult.confidence?.overallScore || 0,
              rawText: '', // v2 pipeline doesn't expose raw text directly
              items: pipelineResult.extracted?.lineItems?.map(item => ({
                description: item.description || '',
                quantity: item.quantity || 1,
                unitPriceCents: item.unitCents || 0,
                totalCents: item.totalCents || 0,
                sku: item.sku || ''
              })) || [],
              totals: pipelineResult.extracted?.totals || {},
              vendor: pipelineResult.extracted?.vendor ? { name: pipelineResult.extracted.vendor } : null,
              metadata: {
                invoiceNumber: pipelineResult.extracted?.invoiceNumber,
                invoiceDate: pipelineResult.extracted?.date,
                currency: pipelineResult.extracted?.currency
              },
              confidence: {
                overall: pipelineResult.confidence?.overallScore || 0,
                ocr: pipelineResult.confidence?.ocrAvgConfidence || 0,
                fields: pipelineResult.confidence?.fields || {}
              },
              warnings: pipelineResult.failureReasons || [],
              pipelineV2: {
                pipelineId: pipelineResult.pipelineId,
                quality: pipelineResult.quality,
                attempts: pipelineResult.attempts,
                processingTimeMs: pipelineResult.processingTimeMs
              },
              processingTimeMs: pipelineResult.processingTimeMs
            };
          } else {
            // v2 pipeline failed or very low confidence - fall back to universal processor
            console.log(`[INGEST] v2 pipeline low confidence (${(pipelineResult.confidence?.overallScore * 100).toFixed(1)}%), falling back to universal processor`);
            console.log(`[INGEST] v2 failure reasons: ${pipelineResult.failureReasons?.join(', ') || 'none'}`);
            processorResult = await universalInvoiceProcessor.processInvoice(
              { base64: base64Data, mimeType: body.mimeType || 'image/jpeg', filename: body.fileName },
              { source: source_type, includeRawText: true, preprocessImages: true }
            );
            // Add v2 diagnostic info to the fallback result
            if (processorResult) {
              processorResult.pipelineV2Fallback = {
                reason: 'low_confidence',
                v2Score: pipelineResult.confidence?.overallScore || 0,
                v2FailureReasons: pipelineResult.failureReasons || [],
                v2PipelineId: pipelineResult.pipelineId
              };
            }
          }
        } catch (v2Error) {
          console.error(`[INGEST] v2 pipeline error, falling back:`, v2Error.message);
          processorResult = await universalInvoiceProcessor.processInvoice(
            { base64: base64Data, mimeType: body.mimeType || 'image/jpeg', filename: body.fileName },
            { source: source_type, includeRawText: true, preprocessImages: true }
          );
          if (processorResult) {
            processorResult.pipelineV2Fallback = { reason: 'error', error: v2Error.message };
          }
        }
      } else {
        // v2 pipeline disabled - use universal processor
        console.log("[INGEST] Processing base64 image with universal processor (OCR)...");
        processorResult = await universalInvoiceProcessor.processInvoice(
          { base64: base64Data, mimeType: body.mimeType || 'image/jpeg', filename: body.fileName },
          { source: source_type, includeRawText: true, preprocessImages: true }
        );
      }
    } else if (raw_text.startsWith("FILE_BASE64:")) {
      // Generic base64 file - let universal processor auto-detect type
      console.log("[INGEST] Processing base64 file with universal processor (auto-detect)...");
      const base64Data = raw_text.substring("FILE_BASE64:".length);
      processorResult = await universalInvoiceProcessor.processInvoice(
        { base64: base64Data, mimeType: body.mimeType, filename: body.fileName },
        { source: source_type, includeRawText: true, preprocessImages: true }
      );
    } else if (raw_text && raw_text.length > 0) {
      // Direct text input - process as text
      console.log("[INGEST] Processing direct text with universal processor...");
      processorResult = await universalInvoiceProcessor.processInvoice(
        { text: raw_text },
        { source: source_type, includeRawText: true }
      );
    } else {
      // No input provided
      console.log("[INGEST] No valid input provided");
      processorResult = { ok: false, warnings: ['No invoice data provided'], items: [], rawText: '' };
    }

    // Extract results from universal processor
    if (processorResult) {
      raw_text = processorResult.rawText || '';
      parsedInvoice = processorResult.parsed || {
        ok: processorResult.ok,
        items: processorResult.items || [],
        totals: processorResult.totals,
        vendor: processorResult.vendor,
        // CRITICAL: Include vendorName in fallback (from universal processor)
        vendorName: processorResult.vendorName || null,
        vendorKey: processorResult.vendorKey || null,
        vendorDetection: processorResult.vendorDetection || null,
        customer: processorResult.customer,
        metadata: processorResult.metadata,
        confidence: processorResult.confidence,
        opportunities: processorResult.opportunities || [],
        validation: { warnings: processorResult.warnings || [] }
      };

      console.log(`[INGEST] Universal processor: ${processorResult.fileType} file, ${processorResult.extractionMethod} extraction, ${processorResult.items.length} items, confidence: ${((processorResult.confidence?.overall || 0) * 100).toFixed(1)}%, time: ${processorResult.processingTimeMs}ms`);

      // Log warnings if extraction had issues
      if (processorResult.warnings && processorResult.warnings.length > 0) {
        console.log(`[INGEST] Processor warnings: ${processorResult.warnings.join(', ')}`);
      }

      // Log raw text sample for debugging (first 200 chars)
      if (processorResult.rawText && processorResult.rawText.length > 0) {
        console.log(`[INGEST] Raw text sample: ${processorResult.rawText.substring(0, 200).replace(/\n/g, ' ')}...`);
      } else {
        console.log(`[INGEST] WARNING: No raw text extracted from file!`);
      }
    } else {
      // Fallback to basic parser if processor fails
      // CRITICAL: Use V2 parser with coreExtractor for correct totals
      const invoiceParser = require('./invoice-parser');
      parsedInvoice = invoiceParser.parseInvoice(raw_text, { useV2: true, debug: true });
      console.log(`[INGEST] Fallback parser (V2): ${parsedInvoice.items.length} items`);
    }

    // Build extracted object - prefer parsed items over payload items
    const extracted = {
      items: parsedInvoice.items.length > 0 ? parsedInvoice.items.map(item => ({
        sku: item.sku || '',
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPriceCents / 100),
        totalPrice: String(item.totalCents / 100),
        category: item.category
      })) : safeArray(payload?.items),
      raw_text: raw_text,
      tableHtml: safeArray(payload?.tableHtml),
      meta: { source_ref: body.source_ref || null },
      // Include unified parser results
      parsedInvoice: {
        totals: parsedInvoice.totals,
        vendor: parsedInvoice.vendor,
        customer: parsedInvoice.customer,
        metadata: parsedInvoice.metadata,
        confidence: parsedInvoice.confidence,
        opportunities: parsedInvoice.opportunities,
        validation: parsedInvoice.validation,
        parseTimeMs: parsedInvoice.parseTimeMs
      },
      // Include universal processor metadata
      processorMeta: processorResult ? {
        fileType: processorResult.fileType,
        extractionMethod: processorResult.extractionMethod,
        extractionConfidence: processorResult.extractionConfidence,
        processingTimeMs: processorResult.processingTimeMs,
        warnings: processorResult.warnings
      } : null
    };

    writeRunJson(run_id, "raw_capture.json", body);
    writeRunJson(run_id, "parsed_invoice.json", parsedInvoice);

    // Use parsed customer name if available, otherwise fall back to payload
    let accountName = parsedInvoice.customer?.name || payload.accountName || body.accountName || "";

    // If accountName is empty, try to extract from raw_text (legacy fallback)
    if (!accountName && raw_text) {
      // Look for customer name in SHIP TO or BILL TO sections (not the vendor)
      // Priority: SHIP TO > BILL TO > SOLD TO
      const shipToMatch = raw_text.match(/SHIP\s+TO[:\s]+\n?([A-Z][A-Z\s&,\.\-']{3,50}?)(?:\n|$)/i);
      if (shipToMatch && shipToMatch[1]) {
        accountName = shipToMatch[1].trim();
        console.log(`[INGEST] Inferred accountName from SHIP TO: "${accountName}"`);
      } else {
        const billToMatch = raw_text.match(/BILL\s+TO[:\s]+\n?([A-Z][A-Z\s&,\.\-']{3,50}?)(?:\n|$)/i);
        if (billToMatch && billToMatch[1]) {
          accountName = billToMatch[1].trim();
          console.log(`[INGEST] Inferred accountName from BILL TO: "${accountName}"`);
        } else {
          // Fallback: look for any all-caps company name
          const allCapsMatch = raw_text.match(/^([A-Z][A-Z\s&,\.\-']{5,40})$/m);
          if (allCapsMatch && allCapsMatch[1]) {
            accountName = allCapsMatch[1].trim();
            console.log(`[INGEST] Inferred accountName from all-caps pattern: "${accountName}"`);
          }
        }
      }
    }

    // Helper: extract ZIP from structured addresses (billTo/shipTo/serviceAddress)
    function extractZipFromPayloadAddresses(payload) {
      const addrs = [payload?.shipTo, payload?.billTo, payload?.serviceAddress].filter(Boolean);
      for (const addr of addrs) {
        if (addr && addr.city_state_zip) {
          const m = String(addr.city_state_zip).match(/\b(\d{5})(?:-\d{4})?\b/);
          if (m) return m[1];
        }
      }
      return "";
    }

    // -------------------- AUTO_LEADS_ON_INGEST --------------------
    // Automatically compute leads for this run and persist to storage/runs/<run_id>/leads.json.
    // CHANGED: Now awaits so we can return leads in the response for Chrome extension
    let precomputedLeads = null;
    try {
      const rawText = String(extracted?.raw_text || "");

      // For sales purposes, we want the customer's location (SHIP TO address)
      let inferredZipPrecompute = "";
      let addressHint = "";

      // Extract full SHIP TO section
      const shipToSection = rawText.match(/SHIP\s+TO[:\s]*\n?([\s\S]{0,300}?)(?=\n\n|BILL\s+TO|DEPT|$)/i);
      if (shipToSection && shipToSection[1]) {
        const shipToText = shipToSection[1];
        const lines = shipToText.split('\n').map(l => l.trim()).filter(Boolean);

        // Extract ZIP from SHIP TO
        const zipMatch = shipToText.match(/\b(\d{5})(?:-\d{4})?\b/);
        if (zipMatch) {
          inferredZipPrecompute = zipMatch[1];
        }

        // Extract street address (usually second line after company name)
        // Format: "OWENS CORNING\n1901 49TH AVE N\nMINNEAPOLIS, MN 55430"
        let streetAddress = "";
        if (lines.length >= 2) {
          // Look for line with numbers/street indicators (not the company name line)
          for (let i = 1; i < lines.length && i < 3; i++) {
            if (/\d+\s+[A-Z0-9]/.test(lines[i])) {
              streetAddress = lines[i];
              break;
            }
          }
        }

        // Extract city/state for addressHint
        // Match format: "MINNEAPOLIS, MN 55430" (city, state zip)
        const cityStateMatch = shipToText.match(/\n([A-Z][A-Za-z\s]+?),\s*([A-Z]{2})\s+\d{5}/);
        if (cityStateMatch) {
          const city = cityStateMatch[1].trim();
          const state = cityStateMatch[2];

          // Build complete address hint with street address
          if (streetAddress) {
            addressHint = `${streetAddress}, ${city}, ${state} ${inferredZipPrecompute || ''}`.trim();
          } else {
            addressHint = `${city}, ${state} ${inferredZipPrecompute || ''}`.trim();
          }
        }

        console.log(`[INGEST] Extracted from SHIP TO - ZIP: ${inferredZipPrecompute}, Address: "${addressHint}"`);
      }

      // Fallback for ZIP if not found in SHIP TO
      if (!inferredZipPrecompute) {
        const billToMatch = rawText.match(/BILL\s+TO[\s\S]{0,200}?\b(\d{5})(?:-\d{4})?\b/i);
        if (billToMatch && billToMatch[1]) {
          inferredZipPrecompute = billToMatch[1];
          console.log(`[INGEST] Using ZIP from BILL TO section: ${inferredZipPrecompute}`);
        } else {
          inferredZipPrecompute =
            extractZipFromPayloadAddresses(payload) ||
            extractZipFromText(rawText) ||
            String(payload?.postalCode || body?.postalCode || "").trim();
          console.log(`[INGEST] Using fallback ZIP: ${inferredZipPrecompute}`);
        }
      }

      // Fallback for addressHint from payload
      if (!addressHint) {
        addressHint = (payload?.shipTo?.city_state_zip || payload?.billTo?.city_state_zip || "");
      }

      const postal = inferredZipPrecompute;

      console.log("[AUTO_LEADS] Starting lead discovery for:", {
        accountName,
        postal,
        addressHint,
        rawTextLength: rawText.length
      });

      const key = _leadsCacheKey(accountName, postal);
      let out = _leadsCacheGet(key);

      if (!out) {
        console.log("[AUTO_LEADS] Cache miss, running computeLeadsForAccount with 10s timeout...");

        // Add timeout wrapper to prevent hanging
        const computeWithTimeout = async (timeoutMs) => {
          return Promise.race([
            computeLeadsForAccount({
              accountName,
              postalCode: postal,
              addressHint,
              run_id: run_id
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Lead computation timed out')), timeoutMs)
            )
          ]);
        };

        let computed;
        try {
          computed = await computeWithTimeout(10000); // 10 second timeout
        } catch (timeoutErr) {
          console.log("[AUTO_LEADS] Timed out, returning empty leads");
          computed = { ok: false, source: 'timeout', leads: [], message: 'Timed out' };
        }

        console.log("[AUTO_LEADS] Compute result:", {
          ok: computed.ok,
          source: computed.source,
          leadCount: computed.leads?.length || 0
        });

        out = {
          ok: !!computed.ok,
          source: computed.source || "none",
          leads: Array.isArray(computed.leads) ? computed.leads : [],
          message: computed.message || undefined
        };
        _leadsCacheSet(key, out);
      }

      precomputedLeads = out;

      // Persist to the run folder
      writeRunJson(run_id, "leads.json", {
        ok: out.ok,
        source: out.source,
        leads: out.leads,
        cache: { key, hit: !!_leadsCacheGet(key) },
        accountName: accountName,
        postalCode: postal,
        addressHint: addressHint,
        run_id: run_id,
        storedAt: new Date().toISOString()
      });
    } catch (e) {
      try {
        writeRunJson(run_id, "leads.json", {
          ok: false,
          source: "error",
          leads: [],
          message: "auto leads lookup failed",
          error: String(e && (e.stack || e.message || e)),
          run_id: run_id,
          storedAt: new Date().toISOString()
        });
      } catch (_) {}
    }
    // --------------------------------------------------------------

    const addressHint = extractAddressHintFromRawText(extracted.raw_text) || (payload?.shipTo?.city_state_zip || payload?.billTo?.city_state_zip || "");
    // Use the ZIP from precomputed leads if available (it was extracted from SHIP TO section)
    const inferredZip = (precomputedLeads && precomputedLeads.leads && precomputedLeads.leads[0]?.postalCode) ||
      extractZipFromPayloadAddresses(payload) ||
      extractZipFromText(addressHint) ||
      extractZipFromText(extracted.raw_text) ||
      String(payload.postalCode || body.postalCode || "").trim();

    if (accountName) {
      safeIntelAddDetection({
        sourceType: "invoice",
        sourceId: String(run_id),
        rawName: String(accountName).trim(),
        rawAddress: addressHint
      });
    }

    // Use precomputed leads from above (which includes all 4 tiers with full timeout)
    let autoLeads = { attempted: false, ok: false, source: "none", leads: [], cacheKey: "", error: "" };

    if (accountName && precomputedLeads) {
      try {
        autoLeads.attempted = true;
        autoLeads.ok = !!precomputedLeads.ok;
        autoLeads.source = precomputedLeads.source || "none";
        autoLeads.leads = Array.isArray(precomputedLeads.leads) ? precomputedLeads.leads : [];
        autoLeads.cacheKey = _leadsCacheKey(accountName, inferredZip);

        for (const l of autoLeads.leads) {
          const addr = [l.city, l.state, l.postalCode].filter(Boolean).join(", ");
          safeIntelAddDetection({
            sourceType: "lead_result_auto",
            sourceId: l.email || l.directPhone || l.corpPhone || `auto:${run_id}:${l.contactName || ""}`,
            rawName: l.company || accountName,
            rawAddress: addr || inferredZip || ""
          });
        }
      } catch (e) {
        autoLeads.ok = false;
        autoLeads.error = String(e && (e.stack || e.message || e));
      }
    }

    const hasCanonical =
      canonicalBuildMod &&
      canonicalValidateMod &&
      typeof canonicalBuildMod.buildCanonicalInvoiceV1 === "function" &&
      typeof canonicalValidateMod.validateCanonicalInvoice === "function";

    if (!hasCanonical) {
      const unified = buildUnified({
        ok: true,
        status: extracted.items.length ? "extracted_only" : "no_items",
        message: "Ingest stored artifacts (canonical pipeline not available in this build).",
        extracted,
        canonical: null,
        validation: { attempted: false, ok: false, errors: [] },
        legacy: null,
        debug: {
          source_ref: body.source_ref || null,
          extractedItemsCount: extracted.items.length,
          autoLeads: {
            attempted: autoLeads.attempted,
            ok: autoLeads.ok,
            source: autoLeads.source,
            leadCount: autoLeads.leads.length,
            leads: autoLeads.leads,
            cacheKey: autoLeads.cacheKey,
            inferredZip
          }
        },
        error: null,
        source_type
      });

      writeRunJson(run_id, "ingest_response.json", unified);
      writeRunJson(run_id, "_SUMMARY.json", {
        run_id,
        source_type,
        status: unified.status,
        counts: {
          extractedItemsCount: extracted.items.length,
          tableCount: extracted.tableHtml.length,
          rawTextLength: extracted.raw_text.length,
          autoLeadCount: autoLeads.leads.length
        }
      });

      // Increment trial invoice counter for trial users
      if (req.user && req.user.is_trial) {
        incrementInvoiceUsage(req.user.id);
      }

      return res.status(200).json(unified);
    }

    const { buildCanonicalInvoiceV1 } = canonicalBuildMod;
    const { validateCanonicalInvoice } = canonicalValidateMod;

    // CRITICAL: Use parsed items from the parser, not original payload items
    // The parser extracts correct quantity, SKU, etc. from the invoice text
    // The original payload may have different/incorrect data
    const payloadForCanonical = {
      ...payload,
      // Prefer parsed items over original payload items
      items: parsedInvoice.items.length > 0 ? parsedInvoice.items : payload.items,
      // Include parsed totals
      totals: parsedInvoice.totals || payload.totals,
      // Include parsed vendor
      vendor: parsedInvoice.vendor || payload.vendor,
      // Include parsed customer
      customer: parsedInvoice.customer || payload.customer
    };

    const canonical = buildCanonicalInvoiceV1({
      source_type,
      payload: payloadForCanonical,
      parserName: `ingest.${source_type}`,
      parserVersion: "1.0.0",
      source_ref: body.source_ref || { kind: "unknown", value: null, mime_type: null }
    });

    writeRunJson(run_id, "canonical.json", canonical);
    writeRunJson(run_id, "extracted.json", extracted);

    const validation = validateCanonicalInvoice(canonical);
    writeRunJson(run_id, "validation.json", validation);

    if (!validation.ok) {
      const unified = buildUnified({
        ok: true,
        status: extracted.items.length ? "extracted_only" : "no_items",
        message: "Ingest successful (canonical validation failed)",
        extracted,
        canonical: null,
        validation: { attempted: true, ok: false, errors: validation.errors || [] },
        legacy: null,
        debug: {
          source_ref: body.source_ref || null,
          extractedItemsCount: extracted.items.length,
          canonicalLineItemsCount: safeArray(canonical?.line_items).length,
          autoLeads: {
            attempted: autoLeads.attempted,
            ok: autoLeads.ok,
            source: autoLeads.source,
            leadCount: autoLeads.leads.length,
            leads: autoLeads.leads,
            cacheKey: autoLeads.cacheKey,
            inferredZip
          }
        },
        error: null,
        source_type
      });

      unified.canonical_preview = canonical;

      writeRunJson(run_id, "ingest_response.json", unified);
      writeRunJson(run_id, "_SUMMARY.json", {
        run_id,
        source_type,
        status: unified.status,
        counts: {
          extractedItemsCount: extracted.items.length,
          canonicalLineItemsCount: safeArray(canonical?.line_items).length,
          rawTextLength: extracted.raw_text.length,
          autoLeadCount: autoLeads.leads.length
        },
        validation: unified.validation
      });

      // Increment trial invoice counter for trial users
      if (req.user && req.user.is_trial) {
        incrementInvoiceUsage(req.user.id);
      }

      return res.status(200).json(unified);
    }

    const itemsForExistingEngine = (canonical.line_items || []).map((li) => ({
      sku: li.sku || "",
      description: li.raw_description,
      quantity: String(li.quantity),
      unitPrice: li.unit_price ? String(li.unit_price.amount) : ""
    }));

    const legacy = processInvoice(payload, itemsForExistingEngine);

    // ===== Revenue Radar Database Integration =====
    let revenueRadarData = { ingestion_run_id: null, opportunity_id: null, opportunity_detected: false };
    try {
      // Get user from JWT authentication (requireAuth middleware already validated this)
      // Fallback to headers only for backwards compatibility with legacy extension
      let userId, userEmail;

      if (req.user && req.user.id) {
        // Use authenticated user from JWT
        userId = req.user.id;
        userEmail = req.user.email;
        console.log(`[INGEST] Using authenticated user: ${userEmail} (ID: ${userId})`);
        console.log(`[USER_ID_TRACE] source=manual_upload userId=${userId} email=${userEmail} authMethod=jwt`);
      } else {
        // Fallback to header-based (legacy support)
        userEmail = req.headers['x-user-email'] || req.headers['user-email'] || 'demo@revenueradar.com';
        const userName = userEmail.split('@')[0];
        userId = db.createOrUpdateUser(userEmail, userName, 'rep');
        console.log(`[INGEST] Using legacy header auth: ${userEmail} (ID: ${userId})`);
        console.log(`[USER_ID_TRACE] source=manual_upload userId=${userId} email=${userEmail} authMethod=header`);
      }

      // ===== BULLETPROOF VENDOR NAME EXTRACTION =====
      // PRIORITY ORDER (highest to lowest):
      // 1. parsedInvoice.vendorName (V2 parser top-level field - FIXED in Patch 1)
      // 2. parsedInvoice.vendor.name (V2 vendor object)
      // 3. parsedInvoice.vendorDetection.vendorName (raw detection result, confidence >= 50)
      // 4. canonical.parties.vendor.name (V1/canonical format)
      // 5. canonical.parties.supplier.name (fallback)
      // 6. 'Unknown Vendor' (last resort - AVOID THIS)
      let vendorName = 'Unknown Vendor';
      let vendorSource = 'none';

      // 1) Top-level vendorName (FIXED by Patch 1 - should always work now)
      if (parsedInvoice?.vendorName && parsedInvoice.vendorName !== 'Unknown Vendor') {
        vendorName = parsedInvoice.vendorName;
        vendorSource = 'parsedInvoice.vendorName';
      }
      // 2) Vendor object from parser
      else if (parsedInvoice?.vendor?.name && parsedInvoice.vendor.name !== 'Unknown Vendor') {
        vendorName = parsedInvoice.vendor.name;
        vendorSource = 'parsedInvoice.vendor.name';
      }
      // 3) Vendor detection result (raw from vendorDetector.js)
      else if (parsedInvoice?.vendorDetection?.vendorName &&
               parsedInvoice.vendorDetection.vendorName !== 'Unknown Vendor' &&
               (parsedInvoice.vendorDetection.confidence || 0) >= 50) {
        vendorName = parsedInvoice.vendorDetection.vendorName;
        vendorSource = 'parsedInvoice.vendorDetection';
      }
      // 4) Canonical vendor parties
      else if (canonical?.parties?.vendor?.name && canonical.parties.vendor.name !== 'Unknown Vendor') {
        vendorName = canonical.parties.vendor.name;
        vendorSource = 'canonical.parties.vendor';
      }
      // 5) Canonical supplier fallback
      else if (canonical?.parties?.supplier?.name && canonical.parties.supplier.name !== 'Unknown Vendor') {
        vendorName = canonical.parties.supplier.name;
        vendorSource = 'canonical.parties.supplier';
      }
      // 6) Last resort - log warning
      else {
        vendorSource = 'FALLBACK_UNKNOWN';
        console.warn(`[INGEST] WARNING: No vendor found! All sources returned Unknown Vendor.`);
      }

      // PROOF LOG - shows exactly where vendor came from
      console.log(`[INGEST] vendorName chosen="${vendorName}" source=${vendorSource}`);
      console.log(`[INGEST] vendorName debug:`, {
        'parsedInvoice.vendorName': parsedInvoice?.vendorName,
        'parsedInvoice.vendor.name': parsedInvoice?.vendor?.name,
        'parsedInvoice.vendorDetection': parsedInvoice?.vendorDetection ? {
          vendorName: parsedInvoice.vendorDetection.vendorName,
          confidence: parsedInvoice.vendorDetection.confidence
        } : null,
        'canonical.parties.vendor.name': canonical?.parties?.vendor?.name
      });

      // Store ingestion run in database
      const fileName = body.fileName || body.file_name || body.source_ref?.value || 'upload';

      // ===== ROBUST TOTALS EXTRACTION =====
      // Priority chain: lineScanTotal > parserTotal > canonicalTotal > computedTotal > sumOfItems
      // This ensures the printed invoice total takes precedence over computed values
      let invoiceTotalCents = 0;
      let totalSource = 'none';
      let reconciliation = null;

      try {
        const { extractTotalsByLineScan, computeInvoiceMath, reconcileTotals, selectBestTotal } = require('./services/invoice_parsing_v2/totals');

        // Extract totals directly from raw text using line scan
        const rawText = extracted?.raw_text || '';
        const lineScanTotals = rawText ? extractTotalsByLineScan(rawText) : null;

        // Get parser and canonical totals
        const parserTotalCents = parsedInvoice?.totals?.totalCents || 0;
        const canonicalTotalCents = canonical?.total_amount_cents || 0;

        // Compute total from line items
        const lineItems = canonical?.line_items || [];
        const computed = computeInvoiceMath(
          lineItems.map(item => ({ totalCents: item.total_price?.amount || 0 })),
          lineScanTotals
        );

        // CRITICAL FIX: If parser was corrected by coreExtractor (found TOTAL USD or INVOICE TOTAL),
        // prioritize the parser's total over line scan results.
        // The coreExtractor specifically handles Cintas TOTAL USD and Sysco INVOICE TOTAL.
        const parserWasCorrected = parsedInvoice?.totals?.coreExtractorCorrected ||
                                   parsedInvoice?.totals?.coreOverrideApplied ||
                                   parsedInvoice?.totals?.sanityCheckCorrected;

        if (parserWasCorrected && parserTotalCents > 0) {
          // Trust the parser's corrected total - it found TOTAL USD or INVOICE TOTAL
          invoiceTotalCents = parserTotalCents;
          totalSource = `parser-coreExtractor (${parsedInvoice?.totals?.coreExtractorSource || 'corrected'})`;
          console.log(`[INGEST TOTALS] Using parser's coreExtractor-corrected total: $${(parserTotalCents/100).toFixed(2)}`);
        } else {
          // Select best total using priority chain
          const bestTotal = selectBestTotal(lineScanTotals, computed, parserTotalCents);
          invoiceTotalCents = bestTotal.totalCents;
          totalSource = bestTotal.source;
        }

        // Reconcile extracted vs computed for logging
        if (lineScanTotals?.totalCents > 0 && computed?.computedTotalCents > 0) {
          reconciliation = reconcileTotals(lineScanTotals.totalCents, computed.computedTotalCents);
        }

        // Log totals selection for debugging
        console.log(`[INGEST TOTALS] Selected: $${(invoiceTotalCents/100).toFixed(2)} (source: ${totalSource})`);
        console.log(`[INGEST TOTALS] LineScan: $${((lineScanTotals?.totalCents || 0)/100).toFixed(2)}, Parser: $${(parserTotalCents/100).toFixed(2)}, Canonical: $${(canonicalTotalCents/100).toFixed(2)}, Computed: $${((computed?.computedTotalCents || 0)/100).toFixed(2)}`);

        if (reconciliation && !reconciliation.toleranceOk) {
          console.warn(`[INGEST TOTALS] WARNING: ${reconciliation.reason}`);
        }

      } catch (totalsError) {
        // Fallback to original logic if totals extraction fails
        console.warn('[INGEST TOTALS] Extraction failed, using fallback:', totalsError.message);
        invoiceTotalCents = parsedInvoice?.totals?.totalCents ||
                           canonical?.total_amount_cents ||
                           (canonical?.line_items || []).reduce((sum, item) => sum + (item.total_price?.amount || 0), 0);
        totalSource = 'fallback';
      }

      console.log(`[INGEST] Invoice total: $${(invoiceTotalCents/100).toFixed(2)} (source: ${totalSource})`);

      // ===== DB WRITE LOGGING =====
      // Log exactly what we're about to write to help debug issues
      console.log(`[INGEST DB WRITE] ===== WRITING TO DATABASE =====`);
      console.log(`[INGEST DB WRITE] run_id: ${run_id}`);
      console.log(`[INGEST DB WRITE] user_id: ${userId}`);
      console.log(`[INGEST DB WRITE] account_name: "${accountName || 'Unknown'}"`);
      console.log(`[INGEST DB WRITE] vendor_name: "${vendorName}"`);
      console.log(`[INGEST DB WRITE] invoice_total_cents: ${invoiceTotalCents} ($${(invoiceTotalCents/100).toFixed(2)})`);
      console.log(`[INGEST DB WRITE] fileName: "${fileName}"`);

      // Log parser result for debugging vendor detection
      if (parsedInvoice) {
        console.log(`[INGEST DB WRITE] Parser result: vendorName="${parsedInvoice.vendorName}", vendorKey="${parsedInvoice.vendorKey || 'N/A'}"`);
        if (parsedInvoice.totals) {
          console.log(`[INGEST DB WRITE] Parser totals: totalCents=${parsedInvoice.totals.totalCents || 0}, printedTotalCents=${parsedInvoice.totals.printedTotalCents || 'N/A'}`);
        }
      }
      console.log(`[INGEST DB WRITE] =================================`);

      console.log(`[USER_ID_TRACE] source=manual_upload action=insert_ingestion_run runId=${run_id} userId=${userId} email=${userEmail}`);

      const runRecord = db.getDatabase().prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, file_size, status, completed_at, invoice_total_cents
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', datetime('now'), ?)
      `).run(
        run_id,
        userId,
        accountName || 'Unknown',
        vendorName,
        fileName,
        JSON.stringify(body).length,
        invoiceTotalCents
      );

      console.log(`[INGEST DB WRITE] SUCCESS: Inserted row ${runRecord.lastInsertRowid}`);

      const internalRunId = runRecord.lastInsertRowid;
      revenueRadarData.ingestion_run_id = internalRunId;

      // Store invoice items in database for analytics
      if (canonical && canonical.line_items && Array.isArray(canonical.line_items)) {
        const itemStmt = db.getDatabase().prepare(`
          INSERT INTO invoice_items (run_id, sku, description, quantity, unit_price_cents, total_cents, category)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of canonical.line_items) {
          try {
            itemStmt.run(
              internalRunId,
              item.sku || null,
              item.raw_description || item.description || '',
              item.quantity || 0,
              item.unit_price?.amount || 0,
              item.total_price?.amount || 0,
              item.category || null
            );
          } catch (itemError) {
            console.warn('[REVENUE RADAR] Failed to store invoice item:', itemError.message);
          }
        }

        // ===== COGS CODING INTEGRATION =====
        // Auto-categorize invoice items based on SKU mappings and track price history
        try {
          await processInvoiceForCOGS(userId, internalRunId, canonical.line_items);
        } catch (cogsError) {
          console.warn('[COGS CODING] Failed to process invoice items:', cogsError.message);
        }
      }

      // ===== HUMAN REVIEW INTEGRATION =====
      // Flag low-confidence parses for human review
      if (parsedInvoice && reviewService.needsReview(parsedInvoice)) {
        try {
          const review = reviewService.createReview(internalRunId, parsedInvoice);
          console.log(`[REVIEW] Created review #${review.id} for run ${run_id} (confidence: ${review.confidenceScore}%, severity: ${review.reviewSeverity})`);
          revenueRadarData.needs_review = true;
          revenueRadarData.review_id = review.id;
        } catch (reviewError) {
          console.warn('[REVIEW] Failed to create review:', reviewError.message);
        }
      }

      // Detect opportunities from invoice data
      const opportunityData = detectOpportunityFromInvoice(canonical, userId, internalRunId);

      if (opportunityData) {
        try {
          const opportunityId = db.createOpportunity(opportunityData);
          revenueRadarData.opportunity_id = opportunityId;
          revenueRadarData.opportunity_detected = true;
          console.log(`[REVENUE RADAR] ✅ Created opportunity #${opportunityId} for ${opportunityData.account_name}`);
        } catch (oppError) {
          console.error('[REVENUE RADAR] Failed to create opportunity:', oppError);
        }
      }

      // ===== RULES ENGINE EVALUATION =====
      try {
        // Build qtyBySku map from canonical line items
        const qtyBySku = {};
        if (canonical && canonical.line_items) {
          for (const item of canonical.line_items) {
            const sku = item.sku || item.raw_description;
            const qty = item.quantity || 0;
            if (sku) {
              qtyBySku[sku] = (qtyBySku[sku] || 0) + qty;
            }
          }
        }

        const invoiceTotal = canonical?.total_amount_cents || 0;

        // Evaluate all active rules for this account
        const firedRules = db.evaluateRulesForInvoice({
          accountName,
          qtyBySku,
          invoiceTotal,
          runId: internalRunId
        });

        // Create contract-approved opportunities from fired rules
        const contractApprovedOpportunities = [];
        for (const fire of firedRules) {
          const action = fire.action;

          // Get contract price if available
          let contractPrice = null;
          if (action.recommended_sku) {
            try {
              const pricing = db.getMLAProductPrice({
                accountName,
                sku: action.recommended_sku
              });
              contractPrice = pricing?.price_cents || null;
            } catch (priceError) {
              console.log(`[RULES ENGINE] No pricing found for ${action.recommended_sku}: ${priceError.message}`);
            }
          }

          // Calculate estimated value (contract price * qty gap)
          const currentQty = qtyBySku[action.recommended_sku] || 0;
          const targetQty = action.recommended_qty_target || (currentQty + 1);
          const qtyGap = Math.max(1, targetQty - currentQty);
          const estimatedValue = contractPrice ? contractPrice * qtyGap : null;

          // Create opportunity from rule
          try {
            const oppId = db.createOpportunityFromRule({
              ruleId: fire.ruleId,
              ruleName: fire.ruleName,
              accountName,
              recommendedSku: action.recommended_sku,
              triggerSku: fire.triggerValues ? Object.keys(fire.triggerValues)[0] : null,
              triggerValues: fire.triggerValues,
              contractPriceCents: contractPrice,
              estimatedValueCents: estimatedValue,
              commissionRate: 0.05, // Default 5%
              assignedUserId: userId,
              runId: internalRunId,
              talkTrack: action.notes_talk_track
            });

            if (oppId) {
              contractApprovedOpportunities.push({
                opportunity_id: oppId,
                rule_name: fire.ruleName,
                trigger_sku: fire.triggerValues ? Object.keys(fire.triggerValues)[0] : null,
                recommended_sku: action.recommended_sku,
                contract_price_cents: contractPrice,
                estimated_value_cents: estimatedValue,
                estimated_commission_cents: estimatedValue ? Math.floor(estimatedValue * 0.05) : null,
                reason: `Rule "${fire.ruleName}" fired`,
                talk_track: action.notes_talk_track
              });
            }
          } catch (ruleOppError) {
            console.error(`[RULES ENGINE] Failed to create opportunity from rule ${fire.ruleId}:`, ruleOppError);
          }
        }

        // Add to response
        revenueRadarData.rulesEngine = {
          rules_evaluated: firedRules.length,
          opportunities_created: contractApprovedOpportunities.length,
          contract_approved_opportunities: contractApprovedOpportunities
        };

        console.log(`[RULES ENGINE] ✅ Evaluated rules: ${firedRules.length} fired, ${contractApprovedOpportunities.length} opportunities created`);
      } catch (rulesError) {
        console.error('[RULES ENGINE] Error:', rulesError);
        revenueRadarData.rulesEngine = {
          error: rulesError.message,
          rules_evaluated: 0,
          opportunities_created: 0
        };
      }
      // ===== END RULES ENGINE =====

      // ===== INVENTORY INTELLIGENCE INTEGRATION =====
      let inventoryIntelData = { processed: 0, pricesRecorded: 0, priceAlerts: [] };
      try {
        if (canonical && canonical.line_items && canonical.line_items.length > 0) {
          inventoryIntelData = inventoryIntelligence.processInvoiceForInventory(
            userId,
            vendorName,
            canonical.line_items,
            canonical.invoice_date || null
          );
          console.log(`[INVENTORY INTEL] ✅ Processed ${inventoryIntelData.processed} items, ${inventoryIntelData.pricesRecorded} prices tracked`);
        }
      } catch (inventoryError) {
        console.error('[INVENTORY INTEL] Processing error:', inventoryError.message);
        inventoryIntelData.error = inventoryError.message;
      }
      revenueRadarData.inventoryIntelligence = inventoryIntelData;
      // ===== END INVENTORY INTELLIGENCE =====

      console.log(`[REVENUE RADAR] ✅ Ingestion tracked: run_id=${run_id}, internal_id=${internalRunId}, user=${userEmail}`);
    } catch (revenueRadarError) {
      console.error('[REVENUE RADAR] Database integration error:', revenueRadarError);
      // Continue with normal flow even if Revenue Radar fails
    }
    // ===== End Revenue Radar Integration =====

    const unified = buildUnified({
      ok: true,
      status: "canonical_valid",
      message: "Canonical invoice valid. Opportunity/legacy engine ran.",
      extracted,
      canonical,
      validation: { attempted: true, ok: true, errors: [] },
      legacy,
      debug: {
        source_ref: body.source_ref || null,
        extractedItemsCount: extracted.items.length,
        canonicalLineItemsCount: (canonical.line_items || []).length,
        autoLeads: {
          attempted: autoLeads.attempted,
          ok: autoLeads.ok,
          source: autoLeads.source,
          leadCount: autoLeads.leads.length,
          leads: autoLeads.leads,
          cacheKey: autoLeads.cacheKey,
          inferredZip
        },
        revenueRadar: revenueRadarData
      },
      error: null,
      source_type
    });

    writeRunJson(run_id, "ingest_response.json", unified);
    writeRunJson(run_id, "_SUMMARY.json", {
      run_id,
      source_type,
      status: unified.status,
      counts: {
        extractedItemsCount: extracted.items.length,
        canonicalLineItemsCount: (canonical.line_items || []).length,
        rawTextLength: extracted.raw_text.length,
        autoLeadCount: autoLeads.leads.length
      }
    });

    // Increment trial invoice counter for trial users
    if (req.user && req.user.is_trial) {
      incrementInvoiceUsage(req.user.id);
    }

    return res.status(200).json(unified);
  } catch (err) {
    const errorMessage = String(err?.message || err);

    const unified = {
      ok: false,
      run_id,
      source_type: "unknown",
      status: "parse_error",
      message: "ingest failed",
      canonical: null,
      extracted: { items: [], tableHtml: [], raw_text_length: 0, raw_text_preview: "", meta: {} },
      validation: { attempted: false, ok: false, errors: [] },
      legacy: null,
      debug: { version: VERSION },
      error: { message: errorMessage, stack: String(err?.stack || "") }
    };

    // Store failed ingestion in database for tracking
    try {
      const userId = req.user?.id || null;
      const userEmail = req.user?.email || req.headers['x-user-email'] || 'unknown';
      const fileName = req.body?.fileName || req.body?.file_name || 'Unknown';
      const vendorName = req.body?.vendor?.name || req.body?.vendorName || 'Unknown';
      const accountName = req.body?.accountName || req.body?.customer?.name || null;

      console.log(`[USER_ID_TRACE] source=manual_upload action=insert_failed_ingestion_run runId=${run_id} userId=${userId} email=${userEmail}`);

      db.getDatabase().prepare(`
        INSERT INTO ingestion_runs (
          run_id, user_id, account_name, vendor_name,
          file_name, status, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, 'failed', ?, datetime('now'))
      `).run(
        run_id,
        userId,
        accountName,
        vendorName,
        fileName,
        errorMessage
      );
      console.log(`[INGEST] ❌ Stored failed ingestion: ${run_id} - ${errorMessage.slice(0, 100)}`);
    } catch (dbErr) {
      console.error('[INGEST] Failed to store failed ingestion:', dbErr.message);
    }

    try {
      writeRunJson(run_id, "ingest_error.json", unified);
      writeRunJson(run_id, "_SUMMARY.json", { run_id, source_type: "unknown", status: "parse_error" });
    } catch (_) {}

    return res.status(200).json(unified);
  }
});

// ===== EXCEL MLA PARSER ENDPOINT =====
// Handles large Excel MLA contracts (100MB+, 10,000+ rows)
// Auto-detects SKU and Price columns, batch uploads to database
app.post("/upload-mla-excel", async (req, res) => {
  try {
    const { excelBase64, contractNumber, accountName, vendorName } = req.body;

    if (!excelBase64 || !contractNumber || !accountName) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: excelBase64, contractNumber, accountName"
      });
    }

    console.log(`[EXCEL MLA] Processing contract ${contractNumber} for ${accountName}`);

    // Decode base64 Excel file
    const buffer = Buffer.from(excelBase64, 'base64');

    // Parse Excel file (supports both .xls and .xlsx)
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    // Get first sheet (or specified sheet)
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with header row
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    if (rawData.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Excel file is empty"
      });
    }

    console.log(`[EXCEL MLA] Parsed ${rawData.length} rows from sheet "${sheetName}"`);

    // Smart column detection - find SKU and Price columns
    const headers = rawData[0];
    let skuColIndex = -1;
    let priceColIndex = -1;
    let descColIndex = -1;
    let uomColIndex = -1;

    // Look for common column names
    const skuPatterns = /^sku$|item.*code|part.*num|product.*code|item.*num/i;
    const pricePatterns = /price|cost|rate/i;
    const descPatterns = /desc|product.*name|item.*desc/i;
    const uomPatterns = /^uom$|^u\/m$|^unit$/i; // Exact match for UOM to avoid matching "Unit Price"

    headers.forEach((header, idx) => {
      const h = String(header).toLowerCase().trim();
      if (skuPatterns.test(h) && skuColIndex === -1) skuColIndex = idx;
      if (pricePatterns.test(h) && priceColIndex === -1) priceColIndex = idx;
      if (descPatterns.test(h) && descColIndex === -1) descColIndex = idx;
      if (uomPatterns.test(h) && uomColIndex === -1) uomColIndex = idx;
    });

    if (skuColIndex === -1 || priceColIndex === -1) {
      return res.status(400).json({
        ok: false,
        error: `Could not auto-detect columns. Found headers: ${headers.join(', ')}. Please ensure you have SKU and Price columns.`,
        headers: headers
      });
    }

    console.log(`[EXCEL MLA] Detected columns - SKU: ${headers[skuColIndex]}, Price: ${headers[priceColIndex]}`);

    // Extract products (skip header row)
    const products = [];
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];

      const sku = String(row[skuColIndex] || '').trim();
      const priceStr = String(row[priceColIndex] || '').trim();

      if (!sku || !priceStr) continue; // Skip empty rows

      // Parse price (handle $, commas, etc.)
      const priceFloat = parseFloat(priceStr.replace(/[$,]/g, ''));
      if (isNaN(priceFloat)) continue;

      const priceCents = Math.round(priceFloat * 100);

      products.push({
        sku: sku,
        description: descColIndex !== -1 ? String(row[descColIndex] || '').trim() : null,
        priceCents: priceCents,
        uom: uomColIndex !== -1 ? String(row[uomColIndex] || '').trim() : 'EA'
      });
    }

    console.log(`[EXCEL MLA] Extracted ${products.length} valid products`);

    if (products.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid products found in Excel file"
      });
    }

    // Get user context
    const userEmail = req.headers['x-user-email'] || 'system@demo.com';
    let user = db.getUserByEmail(userEmail);
    if (!user) {
      const userId = db.createOrUpdateUser(userEmail, userEmail.split('@')[0], 'manager');
      user = db.getUserById(userId);
    }

    // Create MLA contract in database
    const mlaId = db.createMLAContract({
      contractNumber,
      accountName,
      vendorName: vendorName || null,
      createdByUserId: user.id
    });

    // Batch upload products
    db.upsertMLAProducts(mlaId, products);

    console.log(`[EXCEL MLA] ✅ Successfully uploaded ${products.length} products to contract ${contractNumber}`);

    return res.json({
      ok: true,
      message: `MLA contract uploaded successfully`,
      data: {
        mla_id: mlaId,
        contract_number: contractNumber,
        account_name: accountName,
        products_loaded: products.length,
        detected_columns: {
          sku: headers[skuColIndex],
          price: headers[priceColIndex],
          description: descColIndex !== -1 ? headers[descColIndex] : null,
          uom: uomColIndex !== -1 ? headers[uomColIndex] : null
        },
        sample_products: products.slice(0, 3) // Show first 3 for verification
      }
    });

  } catch (error) {
    console.error('[EXCEL MLA] Error:', error);
    return res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack
    });
  }
});

app.post("/analyze-mla", (req, res) => {
  const body = req.body || {};
  const mlaId = body.mlaId || body.title || `MLA-${Date.now()}`;

  const textLength = (body.text || "").length;
  const hasTableHtml = !!body.tableHtml;

  mlaStore[mlaId] = {
    mlaId,
    sourceUrl: body.sourceUrl || "",
    textLength,
    hasTableHtml,
    storedAt: new Date().toISOString()
  };

  return res.json({ ok: true, message: `Stored MLA ${mlaId}`, mlaId, textLength, hasTableHtml });
});
// -------------------- Leads compute helper (cache + multi-source) --------------------

// Note: relies on existing helpers/vars already in this file:
// - contacts (ZoomInfo contacts)
// - scoreContact(contact)
// - normalizeCompanyName(name)
// - findPublicLeads(accountName, postalCode)  (Google Places if key configured)
// - findOsmPhoneAndName({ accountName, postalCode, addressHint }) (OSM best-effort; may be null)
// - _leadsCacheKey(accountName, postalCode)
// - _leadsCacheGet(key) / _leadsCacheSet(key, value)
// - safeIntelAddDetection(d)

/**
 * Merge and cross-validate contact data from multiple sources
 * Returns enriched, validated contacts with confidence scores
 */
function mergeAndValidateContacts(allSources, targetInfo) {
  const contactsMap = new Map();

  // Collect all contacts with source tracking
  for (const sourceData of allSources) {
    if (!sourceData || !Array.isArray(sourceData.contacts)) continue;

    for (const contact of sourceData.contacts) {
      // Create a unique key based on name, phone, or email
      const nameKey = (contact.contactName || "").toLowerCase().trim();
      const phoneKey = (contact.corpPhone || contact.directPhone || "").replace(/\D/g, "");
      const emailKey = (contact.email || "").toLowerCase().trim();

      // Generate composite key
      const key = `${nameKey}|${phoneKey}|${emailKey}`;

      if (!contactsMap.has(key)) {
        contactsMap.set(key, {
          contact: { ...contact },
          sources: [sourceData.source],
          validation: { count: 1, sources: [sourceData.source] }
        });
      } else {
        // Contact found in multiple sources - MERGE and ENRICH
        const existing = contactsMap.get(key);
        existing.sources.push(sourceData.source);
        existing.validation.count++;
        existing.validation.sources.push(sourceData.source);

        // Merge data - prefer more complete fields
        if (!existing.contact.email && contact.email) existing.contact.email = contact.email;
        if (!existing.contact.directPhone && contact.directPhone) existing.contact.directPhone = contact.directPhone;
        if (!existing.contact.mobilePhone && contact.mobilePhone) existing.contact.mobilePhone = contact.mobilePhone;
        if (!existing.contact.title && contact.title) existing.contact.title = contact.title;
        if (!existing.contact.department && contact.department) existing.contact.department = contact.department;
        if (!existing.contact.city && contact.city) existing.contact.city = contact.city;
        if (!existing.contact.state && contact.state) existing.contact.state = contact.state;
      }
    }
  }

  // Score and rank contacts based on cross-validation
  const scoredContacts = Array.from(contactsMap.values()).map(entry => {
    const { contact, validation } = entry;

    // Base score from contact quality
    let score = scoreContact(contact);

    // BOOST score for cross-validation (found in multiple sources)
    if (validation.count > 1) {
      score += 15 * (validation.count - 1); // +15 for each additional source
      console.log(`[LEADS] ✓ Cross-validated: ${contact.contactName} found in ${validation.count} sources: ${validation.sources.join(', ')}`);
    }

    // BOOST for having email + phone
    if (contact.email && (contact.directPhone || contact.corpPhone)) {
      score += 10;
    }

    return {
      ...contact,
      score,
      validation: {
        crossValidated: validation.count > 1,
        sourceCount: validation.count,
        sources: validation.sources
      }
    };
  });

  // Sort by score (highest first)
  return scoredContacts.sort((a, b) => b.score - a.score);
}

async function computeLeadsForAccount({ accountName, postalCode, addressHint, limit = 5 }) {
  const name = String(accountName || "").trim();
  const postal = String(postalCode || "").trim();
  const lim = Math.max(1, Math.min(20, Number(limit || 5)));

  const key = _leadsCacheKey(name, postal);
  const cached = _leadsCacheGet(key);
  if (cached) {
    return { ...cached, cache: { hit: true, key } };
  }

  // 1) ZoomInfo (local CSV) - Enhanced with flexible geographic matching
  console.log(`[LEADS] Tier 1: ZoomInfo CSV search for ${name} in ZIP ${postal}`);
  let candidates = [];
  if (Array.isArray(contacts) && contacts.length) {
    const normalizedAccount = normalizeCompanyName(name);

    // Extract city and state from addressHint for fallback matching
    let targetCity = "";
    let targetState = "";
    if (addressHint) {
      const cityMatch = addressHint.match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{5}/);
      if (cityMatch) {
        targetCity = cityMatch[1].trim().toLowerCase();
        targetState = cityMatch[2].trim().toUpperCase();
      }
    }

    candidates = contacts.filter((c) => {
      if (!c || !c.normalizedCompany) return false;

      // Enhanced matching: check full match, partial match, and keyword overlap
      const nameMatch =
        c.normalizedCompany.includes(normalizedAccount) ||
        normalizedAccount.includes(c.normalizedCompany);

      // If no direct match, try matching on shared keywords (ignore common words)
      let keywordMatch = false;
      if (!nameMatch) {
        const ignoreWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'at', 'by', 'for', 'llc', 'inc', 'corp', 'co', 'ltd', 'company', 'corporation']);
        const accountWords = normalizedAccount.split(' ').filter(w => w.length > 2 && !ignoreWords.has(w));
        const companyWords = c.normalizedCompany.split(' ').filter(w => w.length > 2 && !ignoreWords.has(w));

        // If at least 50% of significant words match, consider it a match
        if (accountWords.length > 0 && companyWords.length > 0) {
          const matchingWords = accountWords.filter(aw => companyWords.some(cw => cw.includes(aw) || aw.includes(cw)));
          const matchRatio = matchingWords.length / Math.min(accountWords.length, companyWords.length);
          keywordMatch = matchRatio >= 0.5;
        }
      }

      if (!nameMatch && !keywordMatch) return false;

      // If we have a postal code, try multiple matching strategies
      if (postal) {
        const normalizedPostal = String(postal).replace(/\s+/g, "").replace(/-.*$/, ""); // Strip -XXXX suffix
        const contactPostal = String(c.postalCode || "").replace(/\s+/g, "").replace(/-.*$/, "");

        // Strategy 1: Exact ZIP match
        if (contactPostal && contactPostal === normalizedPostal) {
          return true;
        }

        // Strategy 2: Same city and state (geographic proximity)
        const contactCity = (c.city || "").toLowerCase().trim();
        const contactState = (c.state || "").toUpperCase().trim();

        if (targetCity && targetState && contactCity && contactState) {
          if (contactCity === targetCity && contactState === targetState) {
            console.log(`[LEADS] City/State match: ${c.company} (${contactCity}, ${contactState})`);
            return true;
          }
        }

        // Strategy 3: Same state only (broader match)
        if (targetState && contactState && contactState === targetState) {
          console.log(`[LEADS] State-only match: ${c.company} (${contactState})`);
          return true;
        }

        return false;
      }
      return true;
    });
  }

  if (candidates.length) {
    // Deduplicate and intelligently label contacts
    // If same contact name appears with different phone numbers, label them appropriately
    const namePhoneMap = new Map();
    const nameOccurrences = new Map(); // Track how many times each name appears
    const nameLocationMap = new Map(); // Track locations for each contact name
    const deduped = [];

    // First pass: count occurrences of each name and track their locations
    for (const c of candidates) {
      const count = nameOccurrences.get(c.contactName) || 0;
      nameOccurrences.set(c.contactName, count + 1);

      // Track unique postal codes/cities for each contact name
      if (!nameLocationMap.has(c.contactName)) {
        nameLocationMap.set(c.contactName, new Set());
      }
      const locationKey = `${c.postalCode || ''}|${c.city || ''}`;
      nameLocationMap.get(c.contactName).add(locationKey);
    }

    for (const c of candidates) {
      const phone = c.directPhone || c.corpPhone || c.mobilePhone || "";
      const key = `${c.contactName}|${phone}`;

      if (namePhoneMap.has(key)) continue; // Skip exact duplicates
      namePhoneMap.set(key, true);

      // If this name appears multiple times, we need to label each occurrence
      const occurrences = nameOccurrences.get(c.contactName) || 1;
      const uniqueLocations = nameLocationMap.get(c.contactName)?.size || 1;

      // Flag if contact appears at multiple locations (regional manager)
      const isRegionalContact = uniqueLocations > 1;

      if (occurrences > 1 && phone) {
        // Same contact name, multiple entries - these are likely different facility lines
        const modifiedContact = { ...c };

        // Add regional flag if applicable
        if (isRegionalContact) {
          modifiedContact.regionalFlag = `Contact listed on ${uniqueLocations} postal addresses - likely regional manager`;
          modifiedContact.isRegional = true;
        }

        // If we have an actual person's name, keep it and add location context in company field
        // Otherwise, use location-based naming
        if (c.contactName && c.contactName.length > 0 && !c.contactName.toLowerCase().includes(c.city?.toLowerCase() || '')) {
          // We have a real person's name - keep it
          modifiedContact.contactName = c.contactName;
          // Add location clarity to company if needed
          if (c.city && !c.company.toLowerCase().includes(c.city.toLowerCase())) {
            modifiedContact.company = `${c.company} - ${c.city}`;
          }
        } else {
          // No person name - create location-based identifier
          const companyLower = (c.company || "").toLowerCase();

          if (companyLower.includes("feed mill")) {
            modifiedContact.contactName = `${c.city || c.company} Feed Mill`;
          } else if (companyLower.includes("hatchery")) {
            modifiedContact.contactName = `${c.city || c.company} Hatchery`;
          } else if (companyLower.includes("debone")) {
            modifiedContact.contactName = `${c.city || c.company} Processing Plant`;
          } else if (c.city && c.company) {
            // Use city + facility type from company name
            const facilityType = c.company.replace(/.*\s(feed mill|hatchery|plant|facility|complex).*/i, '$1') || 'Facility';
            modifiedContact.contactName = `${c.city} ${facilityType}`;
          } else {
            // Fallback: use department or title
            modifiedContact.contactName = c.department || c.title || `${c.company} Main Line`;
          }
        }

        deduped.push(modifiedContact);
      } else {
        // Unique contact name, but still check if they appear at multiple locations
        const modifiedContact = { ...c };
        if (isRegionalContact) {
          modifiedContact.regionalFlag = `Contact listed on ${uniqueLocations} postal addresses - likely regional manager`;
          modifiedContact.isRegional = true;
        }

        // If no contact name, generate one from city + company
        if (!modifiedContact.contactName || modifiedContact.contactName.trim() === "") {
          const companyLower = (c.company || "").toLowerCase();
          if (c.city && c.company) {
            if (companyLower.includes("feed mill")) {
              modifiedContact.contactName = `${c.city} Feed Mill`;
            } else if (companyLower.includes("hatchery")) {
              modifiedContact.contactName = `${c.city} Hatchery`;
            } else if (companyLower.includes("debone") || companyLower.includes("processing")) {
              modifiedContact.contactName = `${c.city} Processing Plant`;
            } else {
              modifiedContact.contactName = `${c.city} ${c.company}`;
            }
          } else {
            modifiedContact.contactName = c.company || "Unknown Contact";
          }
        }

        deduped.push(modifiedContact);
      }
    }

    // VERIFICATION LAYER: Cross-verify ZoomInfo contacts using FREE methods (no APIs required)
    // Multi-method verification for maximum accuracy without API costs
    let verified = deduped;

    if (process.env.WEB_SCRAPER_ENABLE === '1') {
      console.log(`[LEADS] Verification Layer: Cross-checking ${deduped.length} ZoomInfo contacts using free methods...`);

      try {
        const { findContactsViaWebScraping } = require("./leads/webScraperEnhanced");

        // Group contacts by company/location to batch verify
        const verificationMap = new Map();
        for (const contact of deduped) {
          const key = `${contact.company}|${contact.city}|${contact.state}`;
          if (!verificationMap.has(key)) {
            verificationMap.set(key, []);
          }
          verificationMap.get(key).push(contact);
        }

        // Verify each unique company/location (limit to 3 to avoid delays)
        const verificationsNeeded = Array.from(verificationMap.entries()).slice(0, 3);
        const verifiedContacts = [];

        for (const [key, contacts] of verificationsNeeded) {
          const [company, city, state] = key.split('|');
          const postalCode = contacts[0]?.postalCode || '';

          console.log(`[LEADS] Verifying ${contacts.length} contacts at ${company} in ${city}, ${state}`);

          // FREE VERIFICATION METHOD 1: Web scraping (LinkedIn public profiles, business directories)
          // This works WITHOUT any API keys - 100% free
          const webVerification = await findContactsViaWebScraping({
            companyName: company,
            city,
            state,
            postalCode,
            addressHint: `${city}, ${state} ${postalCode}`
          });

          const webContacts = webVerification.ok ? webVerification.contacts : [];

          // FREE VERIFICATION METHOD 2: Enhanced phone number validation
          // Check if phone numbers are valid format, not disconnected, and have area code matching location
          const validPhoneNumbers = new Map(); // phone -> {score: number, reason: string}
          for (const contact of contacts) {
            const phone = contact.directPhone || contact.corpPhone || contact.mobilePhone || '';
            if (phone) {
              // Validate phone format (US numbers)
              const cleanPhone = phone.replace(/\D/g, '');
              const isValid = cleanPhone.length === 10 || cleanPhone.length === 11;

              // Check if phone is not a known invalid pattern
              const isNotInvalid = !cleanPhone.match(/^(000|111|222|333|444|555|666|777|888|999)/) &&
                                  !cleanPhone.match(/0000000$/) &&
                                  !cleanPhone.match(/^1234567/) &&
                                  !cleanPhone.match(/^5555555/);

              if (isValid && isNotInvalid) {
                let phoneScore = 20; // Base score for valid format
                let reason = 'Valid format';

                // IMPROVEMENT 1: Check if area code matches location (higher confidence)
                const areaCode = cleanPhone.slice(cleanPhone.length === 11 ? 1 : 0, cleanPhone.length === 11 ? 4 : 3);

                // Georgia area codes: 229, 404, 470, 478, 678, 706, 762, 770, 912
                const georgiaAreaCodes = ['229', '404', '470', '478', '678', '706', '762', '770', '912'];
                if (state === 'GA' && georgiaAreaCodes.includes(areaCode)) {
                  phoneScore += 10; // Bonus for matching state
                  reason = 'Valid format, area code matches state';
                }

                validPhoneNumbers.set(phone, { score: phoneScore, reason });
              }
            }
          }

          // FREE VERIFICATION METHOD 3: Enhanced email domain verification
          // Check if email domains are active, not disposable, and match company
          const validEmails = new Map(); // email -> {valid: boolean, domainMatch: boolean, score: number, reason: string}
          for (const contact of contacts) {
            if (contact.email) {
              const domain = contact.email.split('@')[1];
              if (domain) {
                // IMPROVEMENT 4: Expanded disposable email detection
                const isDisposable = [
                  'tempmail', 'guerrillamail', 'mailinator', '10minutemail', 'throwaway',
                  'fakeinbox', 'trash-mail', 'yopmail', 'getnada', 'dispostable'
                ].some(d => domain.includes(d));

                // Check if domain matches company name (high confidence)
                const companyDomain = company.toLowerCase().replace(/[^a-z0-9]/g, '');
                const emailDomain = domain.toLowerCase().replace(/[^a-z0-9]/g, '');

                let domainMatchesCompany = false;
                let domainScore = 15; // Base score for valid email

                // IMPROVEMENT 5: Multi-level domain matching
                // Level 1: Exact company name in domain (pilgrimspride.com for "Pilgrim's Pride")
                if (emailDomain.includes(companyDomain)) {
                  domainMatchesCompany = true;
                  domainScore = 40; // High confidence
                }
                // Level 2: Company name contains domain (pilgrims.com for "Pilgrim's Pride")
                else if (companyDomain.includes(emailDomain.split('.')[0]) && emailDomain.split('.')[0].length >= 4) {
                  domainMatchesCompany = true;
                  domainScore = 35; // Good confidence
                }
                // Level 3: Abbreviation match (pp.com for "Pilgrim's Pride")
                else {
                  const companyWords = company.toLowerCase().split(/\s+/).filter(w => w.length > 2);
                  const abbreviation = companyWords.map(w => w[0]).join('');
                  if (abbreviation.length >= 2 && emailDomain.startsWith(abbreviation)) {
                    domainMatchesCompany = true;
                    domainScore = 25; // Moderate confidence
                  }
                }

                validEmails.set(contact.email, {
                  valid: !isDisposable,
                  domainMatch: domainMatchesCompany,
                  score: isDisposable ? 0 : domainScore,
                  reason: isDisposable ? 'Disposable email' :
                         domainMatchesCompany ? 'Domain matches company' : 'Valid format'
                });
              }
            }
          }

          // FREE VERIFICATION METHOD 4: Cross-reference with web scraping results
          console.log(`[LEADS] Cross-referencing ${contacts.length} ZoomInfo contacts with ${webContacts.length} web-scraped contacts...`);

          for (const zoomContact of contacts) {
            let verificationScore = 0;
            let verificationMethods = [];

            // Method 1: Enhanced name match with fuzzy matching and title verification
            const webMatch = webContacts.find(web => {
              const zoomName = (zoomContact.contactName || '').toLowerCase().trim();
              const webName = (web.contactName || '').toLowerCase().trim();

              // Exact match (highest confidence)
              if (zoomName === webName) return true;

              // IMPROVEMENT 2: Fuzzy matching for nicknames and abbreviations
              // Handle common nickname variations (e.g., "Bob" vs "Robert", "Bill" vs "William")
              const nicknameMap = {
                'bob': 'robert', 'bobby': 'robert',
                'bill': 'william', 'billy': 'william', 'will': 'william',
                'mike': 'michael', 'mikey': 'michael',
                'jim': 'james', 'jimmy': 'james',
                'joe': 'joseph', 'joey': 'joseph',
                'dan': 'daniel', 'danny': 'daniel',
                'dave': 'david', 'davey': 'david',
                'tom': 'thomas', 'tommy': 'thomas',
                'chris': 'christopher',
                'matt': 'matthew',
                'tony': 'anthony',
                'steve': 'steven', 'stevie': 'steven'
              };

              const zoomParts = zoomName.split(' ');
              const webParts = webName.split(' ');

              if (zoomParts.length >= 2 && webParts.length >= 2) {
                const zoomFirst = zoomParts[0];
                const webFirst = webParts[0];
                const zoomLast = zoomParts[zoomParts.length - 1];
                const webLast = webParts[webParts.length - 1];

                // Last name must match
                if (zoomLast === webLast) {
                  // First name exact match
                  if (zoomFirst === webFirst) return true;

                  // First name nickname match
                  const zoomNormalized = nicknameMap[zoomFirst] || zoomFirst;
                  const webNormalized = nicknameMap[webFirst] || webFirst;
                  if (zoomNormalized === webNormalized) return true;

                  // First initial match (e.g., "J. Smith" vs "John Smith")
                  if (zoomFirst.length === 1 && webFirst.startsWith(zoomFirst)) return true;
                  if (webFirst.length === 1 && zoomFirst.startsWith(webFirst)) return true;
                }
              }

              return false;
            });

            if (webMatch) {
              verificationScore += 40;
              verificationMethods.push(`Name found in ${webMatch.source}`);

              // IMPROVEMENT 3: Add title verification bonus
              if (webMatch.title && zoomContact.title) {
                const webTitle = webMatch.title.toLowerCase();
                const zoomTitle = zoomContact.title.toLowerCase();

                // Exact title match (very high confidence)
                if (webTitle === zoomTitle) {
                  verificationScore += 15;
                  verificationMethods.push('Title matches web');
                }
                // Similar title (contains same key words)
                else {
                  const titleKeywords = ['manager', 'director', 'president', 'vp', 'vice president', 'supervisor', 'lead', 'coordinator', 'specialist'];
                  const webKeywords = titleKeywords.filter(kw => webTitle.includes(kw));
                  const zoomKeywords = titleKeywords.filter(kw => zoomTitle.includes(kw));

                  if (webKeywords.length > 0 && zoomKeywords.length > 0 &&
                      webKeywords.some(kw => zoomKeywords.includes(kw))) {
                    verificationScore += 8;
                    verificationMethods.push('Similar title on web');
                  }
                }
              }

              // Enhance with web data
              if (webMatch.email && !zoomContact.email) {
                zoomContact.email = webMatch.email;
                verificationMethods.push('Email added from web');
              }
              if (webMatch.linkedin && !zoomContact.linkedin) {
                zoomContact.linkedin = webMatch.linkedin;
                verificationMethods.push('LinkedIn added from web');
              }
            }

            // Method 2: Enhanced phone number validation with area code matching
            const phone = zoomContact.directPhone || zoomContact.corpPhone || zoomContact.mobilePhone;
            if (phone && validPhoneNumbers.has(phone)) {
              const phoneInfo = validPhoneNumbers.get(phone);
              verificationScore += phoneInfo.score;
              verificationMethods.push(phoneInfo.reason);
            }

            // Method 3: Enhanced email validation with multi-level domain matching
            if (zoomContact.email && validEmails.has(zoomContact.email)) {
              const emailInfo = validEmails.get(zoomContact.email);
              if (emailInfo.valid && emailInfo.score > 0) {
                verificationScore += emailInfo.score;
                verificationMethods.push(emailInfo.reason);
              }
            }

            // Method 4: Data freshness check (ZoomInfo LastVerifiedDate)
            const lastVerified = zoomContact.lastVerifiedDate;
            if (lastVerified) {
              const verifiedDate = new Date(lastVerified);
              const now = new Date();
              const daysSinceVerification = Math.floor((now - verifiedDate) / (1000 * 60 * 60 * 24));

              if (daysSinceVerification < 90) {
                verificationScore += 20;
                verificationMethods.push(`Recently verified (${daysSinceVerification} days ago)`);
              } else if (daysSinceVerification < 180) {
                verificationScore += 10;
                verificationMethods.push(`Moderately recent (${daysSinceVerification} days ago)`);
              } else {
                verificationMethods.push(`⚠ Stale data (${daysSinceVerification} days old)`);
              }
            }

            // Determine verification status based on score
            const isVerified = verificationScore >= 50;
            const verificationLevel = verificationScore >= 80 ? 'high' :
                                     verificationScore >= 50 ? 'medium' :
                                     verificationScore >= 30 ? 'low' : 'none';

            const enhancedContact = {
              ...zoomContact,
              verified: isVerified,
              verificationScore,
              verificationLevel,
              verificationMethods: verificationMethods.join(', '),
              verifiedBy: verificationMethods.length > 0 ? 'multi-method' : 'none',
              verifiedDate: new Date().toISOString(),
              confidenceScore: Math.min(100, (zoomContact.score || 50) + (verificationScore > 50 ? 20 : verificationScore > 30 ? 0 : -10))
            };

            if (isVerified) {
              console.log(`[LEADS] ✓ VERIFIED (${verificationScore}%): ${zoomContact.contactName} - ${verificationMethods.slice(0, 2).join(', ')}`);
            } else {
              console.log(`[LEADS] ⚠ UNVERIFIED (${verificationScore}%): ${zoomContact.contactName} - ${verificationMethods.length > 0 ? verificationMethods[0] : 'No verification data'}`);
            }

            verifiedContacts.push(enhancedContact);
          }

          // Add new contacts found in web scraping that weren't in ZoomInfo
          for (const webContact of webContacts) {
            const alreadyHave = verifiedContacts.some(v => {
              const vName = (v.contactName || '').toLowerCase();
              const wName = (webContact.contactName || '').toLowerCase();
              return vName === wName;
            });

            if (!alreadyHave) {
              console.log(`[LEADS] ✓ NEW CONTACT from ${webContact.source}: ${webContact.contactName}`);
              verifiedContacts.push({
                ...webContact,
                verified: true,
                verificationScore: 70,
                verificationLevel: 'medium',
                verificationMethods: `Found via ${webContact.source}`,
                verifiedBy: webContact.source,
                verifiedDate: new Date().toISOString(),
                source: `verified_${webContact.source}`,
                confidenceScore: webContact.confidenceScore || 75
              });
            }
          }
        }

        // Use verified contacts if we got results, otherwise use original
        if (verifiedContacts.length > 0) {
          // IMPROVEMENT 8: Phone number normalization helper
          const normalizePhoneNumber = (phone) => {
            if (!phone) return '';
            return phone.replace(/\D/g, '').slice(-10); // Get last 10 digits
          };

          // IMPROVEMENT 7: Add unverified contacts from locations we didn't verify (marked as "verification not attempted")
          for (const contact of deduped) {
            const alreadyVerified = verifiedContacts.some(v => {
              const vName = (v.contactName || '').toLowerCase();
              const cName = (contact.contactName || '').toLowerCase();

              // IMPROVEMENT 8: Also check for phone number match (normalized)
              const vPhone = normalizePhoneNumber(v.directPhone || v.corpPhone || v.mobilePhone || '');
              const cPhone = normalizePhoneNumber(contact.directPhone || contact.corpPhone || contact.mobilePhone || '');

              return vName === cName || (vPhone && cPhone && vPhone === cPhone);
            });

            if (!alreadyVerified) {
              verifiedContacts.push({
                ...contact,
                verified: false,
                verificationScore: 0,
                verificationLevel: 'none',
                verificationMethods: 'Location not verified (verification limited to 3 locations)',
                verifiedBy: 'none',
                verificationAttempted: false
              });
            }
          }

          // IMPROVEMENT 9: Cross-location contact matching and merging
          // If same person appears at multiple locations with SAME contact info, merge them
          const contactMap = new Map();
          for (const contact of verifiedContacts) {
            const phone = normalizePhoneNumber(contact.directPhone || contact.corpPhone || contact.mobilePhone || '');
            const email = (contact.email || '').toLowerCase().trim();
            const name = (contact.contactName || '').toLowerCase().trim();

            // Create unique key from phone OR email (if person has both, they'll match on either)
            const phoneKey = phone ? `phone:${phone}` : null;
            const emailKey = email ? `email:${email}` : null;
            const nameKey = name ? `name:${name}` : null;

            let merged = false;

            // Check if we've seen this phone number before
            if (phoneKey && contactMap.has(phoneKey)) {
              const existing = contactMap.get(phoneKey);
              // Merge: take higher verification score, combine verification methods
              if (contact.verificationScore > existing.verificationScore) {
                existing.verificationScore = contact.verificationScore;
                existing.verificationLevel = contact.verificationLevel;
              }
              existing.verificationMethods = `${existing.verificationMethods}; Cross-verified at multiple locations`;
              existing.crossLocationVerified = true;
              existing.verificationScore = Math.min(100, existing.verificationScore + 10); // Bonus for cross-location match
              merged = true;
            }
            // Check if we've seen this email before
            else if (emailKey && contactMap.has(emailKey)) {
              const existing = contactMap.get(emailKey);
              if (contact.verificationScore > existing.verificationScore) {
                existing.verificationScore = contact.verificationScore;
                existing.verificationLevel = contact.verificationLevel;
              }
              existing.verificationMethods = `${existing.verificationMethods}; Cross-verified at multiple locations`;
              existing.crossLocationVerified = true;
              existing.verificationScore = Math.min(100, existing.verificationScore + 10);
              merged = true;
            }

            // If not merged, add as new contact
            if (!merged) {
              if (phoneKey) contactMap.set(phoneKey, contact);
              if (emailKey) contactMap.set(emailKey, contact);
              if (!phoneKey && !emailKey && nameKey) contactMap.set(nameKey, contact);
            }
          }

          // Extract unique contacts from map
          const uniqueContacts = Array.from(new Set(contactMap.values()));

          // IMPROVEMENT 11: Add role priority labels for UI display
          const getRolePriorityLabel = (title) => {
            if (!title) return { label: 'Contact', priority: 6, color: 'gray' };
            const t = title.toLowerCase();

            if (t.includes("safety") || t.includes("ehs")) {
              return { label: '🎯 PRIMARY BUYER', priority: 1, color: 'red' };
            }
            if (t.includes("plant manager") || t.includes("facility manager") || t.includes("site manager")) {
              return { label: '⭐ DECISION MAKER', priority: 2, color: 'orange' };
            }
            if (t.includes("purchasing") || t.includes("procurement") || t.includes("buyer")) {
              return { label: '💰 PURCHASING', priority: 3, color: 'green' };
            }
            if (t.includes("maintenance") && (t.includes("manager") || t.includes("director"))) {
              return { label: '🔧 MAINTENANCE LEAD', priority: 4, color: 'blue' };
            }
            if (t.includes("reception") || t.includes("front desk")) {
              return { label: '📞 GATEKEEPER', priority: 5, color: 'purple' };
            }
            return { label: 'Contact', priority: 6, color: 'gray' };
          };

          uniqueContacts.forEach(contact => {
            const roleInfo = getRolePriorityLabel(contact.title);
            contact.roleLabel = roleInfo.label;
            contact.rolePriority = roleInfo.priority;
            contact.roleColor = roleInfo.color;
          });

          // IMPROVEMENT 6: Sort contacts by verification score (highest first)
          verified = uniqueContacts.sort((a, b) => {
            // First sort by verification level
            const levelPriority = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
            const levelDiff = (levelPriority[b.verificationLevel] || 0) - (levelPriority[a.verificationLevel] || 0);
            if (levelDiff !== 0) return levelDiff;

            // Then by verification score
            return (b.verificationScore || 0) - (a.verificationScore || 0);
          });

          const highlyVerified = verifiedContacts.filter(c => c.verificationLevel === 'high').length;
          const mediumVerified = verifiedContacts.filter(c => c.verificationLevel === 'medium').length;
          const lowVerified = verifiedContacts.filter(c => c.verificationLevel === 'low').length;
          const unverified = verifiedContacts.filter(c => c.verificationLevel === 'none').length;
          console.log(`[LEADS] Verification complete: ${highlyVerified} high, ${mediumVerified} medium, ${lowVerified} low, ${unverified} unverified (${verifiedContacts.length} total)`);
        }
      } catch (err) {
        console.warn(`[LEADS] Verification failed:`, err.message);
        // Continue with original contacts if verification fails
      }
    }

    const scored = verified
      .map((c) => ({ ...c, score: c.confidenceScore || scoreContact(c) }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, lim);

    // Feed Intel with the leads we found (safe)
    for (const l of scored) {
      const addr = [l.city, l.state, l.postalCode].filter(Boolean).join(", ");
      safeIntelAddDetection({
        sourceType: "lead",
        sourceId: l.email || l.directPhone || l.corpPhone || `${l.company}-${l.postalCode || ""}`,
        rawName: l.company || name,
        rawAddress: addr
      });
    }

    const out = { ok: true, source: "zoominfo", leads: scored };
    _leadsCacheSet(key, out);
    return { ...out, cache: { hit: false, key } };
  }

  // 2) Google Places (if configured in findPublicLeads)
  try {
    console.log(`[LEADS] Tier 2: Google Places search for ${name} with address: "${addressHint || postal}"`);
    const fallback = await findPublicLeads(name, postal, addressHint);
    if (Array.isArray(fallback) && fallback.length) {
      for (const l of fallback) {
        const addr = [l.city, l.state, l.postalCode].filter(Boolean).join(", ");
        safeIntelAddDetection({
          sourceType: "lead",
          sourceId: `public:${l.corpPhone || l.contactName || Date.now()}`,
          rawName: name,
          rawAddress: addr || (postal ? postal : "")
        });
      }

      const out = { ok: true, source: "public_web", leads: fallback.slice(0, lim) };
      _leadsCacheSet(key, out);
      return { ...out, cache: { hit: false, key } };
    }
  } catch (_) {}

  // 3) OSM best-effort fallback (no API key required; phone depends on OSM tags)
  try {
    console.log(`[LEADS] Tier 3: OpenStreetMap search for ${name} with address: "${addressHint || postal}"`);
    if (typeof findOsmPhoneAndName === "function") {
      let osm = await findOsmPhoneAndName({ accountName: name, postalCode: postal, addressHint: addressHint || "" });
      if (osm && (osm.phone || osm.name)) {
        // OSM ZIP validation (hard gate)
        // If caller provided a ZIP, refuse OSM hits that do not contain that ZIP.
        const wantZip = String(postal || "").trim();
        if (wantZip) {
          const nameStr = String((osm && (osm.name || osm.displayName)) || "");
          const addrStr = String((osm && osm.displayName) || "");
          if (!nameStr.includes(wantZip) && !addrStr.includes(wantZip)) {
            // Treat as no OSM result, allow other fallbacks or "none"
            osm = null;
          }
        }

        if (osm) {
          const lead = {
            contactName: (osm.name || name) + " (Main Line)",
            title: "",
            department: "Front Desk",
            directPhone: "",
            mobilePhone: "",
            corpPhone: osm.phone || "",
            email: "",
            city: "",
            state: "",
            postalCode: postal,
            score: 55
          };

          safeIntelAddDetection({
            sourceType: "lead",
            sourceId: `osm:${lead.corpPhone || Date.now()}`,
            rawName: name,
            rawAddress: postal || (addressHint || "")
          });

          const out = { ok: true, source: "osm", leads: [lead] };
          _leadsCacheSet(key, out);
          return { ...out, cache: { hit: false, key } };
        }
      }
    }
  } catch (_) {}

  // 4) Web Scraping (comprehensive public sources)
  if (process.env.WEB_SCRAPER_ENABLE === "1") {
    try {
      const { findContactsViaWebScraping } = require('./leads/webScraperEnhanced');
      const { prioritizeLocalContacts } = require('./leads/localBusinessIntel');

      // Extract city/state from addressHint if available
      let city = "";
      let state = "";

      if (addressHint) {
        // Try to parse "Street, City, State ZIP" format
        const parts = addressHint.split(",").map(p => p.trim());
        if (parts.length >= 2) {
          city = parts[parts.length - 2] || "";
          const lastPart = parts[parts.length - 1] || "";
          const stateMatch = lastPart.match(/\b([A-Z]{2})\b/);
          state = stateMatch ? stateMatch[1] : "";
        }
      }

      console.log(`[LEADS] Tier 4: Web scraping for ${name} in ${city}, ${state} ${postal}`);

      const webResult = await findContactsViaWebScraping({
        companyName: name,
        city: city,
        state: state,
        postalCode: postal,
        addressHint: addressHint || ""
      });

      if (webResult.ok && webResult.contacts.length > 0) {
        console.log(`[LEADS] Tier 4: Found ${webResult.contacts.length} contacts from web scraping`);

        // Classify and prioritize local contacts
        const prioritized = prioritizeLocalContacts(webResult.contacts, {
          postalCode: postal,
          city: city,
          state: state
        });

        // Convert to standard lead format
        const leads = prioritized.slice(0, lim).map(c => ({
          contactName: c.contactName,
          title: c.title || "",
          department: c.department || "",
          directPhone: c.directPhone || "",
          mobilePhone: c.mobilePhone || "",
          corpPhone: c.corpPhone || "",
          email: c.email || "",
          city: c.city || city,
          state: c.state || state,
          postalCode: c.postalCode || postal,
          score: scoreContact(c),
          source: c.source,
          isLocalFacility: c.location?.isLocalFacility || false,
          locationConfidence: c.location?.confidence || 0
        }));

        // Feed Intel
        for (const l of leads) {
          const addr = [l.city, l.state, l.postalCode].filter(Boolean).join(", ");
          safeIntelAddDetection({
            sourceType: "lead",
            sourceId: `web:${l.email || l.directPhone || l.corpPhone || Date.now()}`,
            rawName: name,
            rawAddress: addr
          });
        }

        const out = { ok: true, source: "web_scraper", leads };
        _leadsCacheSet(key, out);
        return { ...out, cache: { hit: false, key } };
      }
    } catch (err) {
      console.warn("[LEADS] Tier 4 web scraping failed:", err.message);
    }
  }

  // If we got here, no sources produced leads.
  const out = { ok: false, message: "No leads found (ZoomInfo, public, OSM, and web scraping).", source: "none", leads: [] };
  _leadsCacheSet(key, out);
  return { ...out, cache: { hit: false, key } };
}


app.post("/find-leads", async (req, res) => {
  console.log("=== /find-leads was hit ===");
  const body = req.body || {};
  const accountName = body.accountName || "";
  const postalCode = String(body.postalCode || "").trim();
  const addressHint = String(body.addressHint || "").trim();

  if (!accountName) return res.json({ ok: false, message: "accountName required" });

  const key = _leadsCacheKey(accountName, postalCode);
  const hit = _leadsCacheGet(key);
  if (hit) {
    return res.json({ ...hit, cache: { hit: true, key } });
  }

  // Intel detection for "lead search intent"
  safeIntelAddDetection({
    sourceType: "lead",
    sourceId: `find-leads:${Date.now()}`,
    rawName: String(accountName).trim(),
    rawAddress: postalCode || addressHint || ""
  });

  const computed = await computeLeadsForAccount({ accountName, postalCode, addressHint, run_id: body.run_id || "" });

  const payload = {
    ok: !!computed.ok,
    source: computed.source || "none",
    leads: Array.isArray(computed.leads) ? computed.leads : [],
    message: computed.message || undefined
  };

  _leadsCacheSet(key, payload);

  return res.json({ ...payload, cache: { hit: false, key } });
});

// ===== Professional Error Handling & Monitoring =====

// 404 Handler - Must come after all route definitions
app.use((req, res) => {
  console.log(`[404] ${req.method} ${req.path}`);

  // For browser requests (HTML), serve a nice 404 page
  const acceptsHtml = req.accepts('html');
  if (acceptsHtml && !req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) {
    const notFoundPage = path.join(__dirname, 'dashboard', '404.html');
    if (fs.existsSync(notFoundPage)) {
      return res.status(404).sendFile(notFoundPage);
    }
  }

  // For API requests, return JSON
  res.status(404).json({
    ok: false,
    error: 'Not Found',
    message: `The endpoint ${req.method} ${req.path} does not exist`,
    availableEndpoints: {
      health: 'GET /health',
      ingest: 'POST /ingest',
      telemetry: 'POST /telemetry',
      leads: 'POST /find-leads',
      revenueRadar: {
        spifs: 'GET /api/spifs/active',
        leaderboard: 'GET /api/spifs/:id/leaderboard',
        opportunities: 'GET /api/opportunities',
        dashboard: 'GET /api/dashboard/rep-summary'
      }
    }
  });
});

// Global Error Handler - Must be last middleware
app.use(async (err, req, res, next) => {
  console.error('[ERROR]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Log to error tracking system
  await ErrorHandler.logError(err, {
    endpoint: req.path,
    method: req.method,
    isUserFacing: true,
    userAgent: req.get('user-agent'),
    ipAddress: req.ip
  });

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV !== 'production';

  res.status(err.status || 500).json({
    ok: false,
    error: err.name || 'Internal Server Error',
    message: isDevelopment ? err.message : 'An unexpected error occurred',
    ...(isDevelopment && { stack: err.stack })
  });
});

// Graceful shutdown handler
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server gracefully...');

  // Stop email monitoring service
  try {
    const emailService = require('./email-monitor-service');
    emailService.stopAll();
    console.log('Email autopilot stopped');
  } catch (err) {
    console.error('Error stopping email service:', err);
  }

  server.close(() => {
    console.log('Server closed');
    // Close database connections
    try {
      if (db && db.close) {
        db.close();
        console.log('Database connections closed');
      }
    } catch (err) {
      console.error('Error closing database:', err);
    }
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
  console.error(err.stack);
  // In production, you might want to restart the process
  // For now, log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
  // In production, you might want to restart the process
});

// Root endpoint - helpful for verifying deployment
app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'Revenue Radar',
    version: VERSION,
    environment: config.isProduction() ? 'production' : 'development',
    endpoints: {
      login: '/dashboard/login.html',
      health: '/health',
      api: '/api'
    },
    message: 'Server is running! Visit /dashboard/login.html to get started.'
  });
});

const server = app.listen(PORT, async () => {
  console.log('='.repeat(60));
  console.log(`🚀 AI Sales Backend Server Started`);
  console.log('='.repeat(60));
  console.log(`📡 Server URL: http://localhost:${PORT}`);
  console.log(`📦 Version: ${VERSION}`);
  console.log(`🌍 Environment: ${config.isProduction() ? 'production' : 'development'}`);
  console.log(`💾 Revenue Radar: ${db ? '✅ Active' : '❌ Disabled'}`);
  console.log(`💿 Database Backups: ${config.databaseBackupEnabled ? '✅ Enabled' : '⚠️  Disabled'}`);
  console.log(`🔒 HTTPS: ${config.httpsEnabled ? '✅ Enabled' : '⚠️  Disabled'}`);
  console.log('='.repeat(60));

  // Ensure default admin user exists on startup
  const ensureAdmin = require('./scripts/ensure-admin');
  await ensureAdmin();

  // Initialize background job processor
  try {
    const database = db.getDatabase();
    jobQueue.init(database);
    jobProcessor.init({
      db: database,
      processor: universalInvoiceProcessor,
      pollInterval: 2000
    });
    // Start the job processor in background mode
    jobProcessor.start();
    console.log('✅ Background job processor started');
  } catch (jobErr) {
    console.error('⚠️  Failed to start job processor:', jobErr.message);
  }

  // Initialize review service for human correction workflow
  try {
    const database = db.getDatabase();
    reviewService.init(database);
    console.log('✅ Review service initialized');
  } catch (reviewErr) {
    console.error('⚠️  Failed to initialize review service:', reviewErr.message);
  }

  console.log('='.repeat(60));
  console.log('Available Endpoints:');
  console.log(`  🔐 Authentication:`);
  console.log(`    POST /auth/login - User login`);
  console.log(`    POST /auth/logout - User logout`);
  console.log(`    POST /auth/register - Create user (admin only)`);
  console.log(`    POST /auth/refresh - Refresh access token`);
  console.log(`    GET  /auth/me - Get current user`);
  console.log(`  📧 Email Invoice Autopilot:`);
  console.log(`    GET  /api/email-monitors - List email monitors`);
  console.log(`    POST /api/email-monitors - Create email monitor`);
  console.log(`    PUT  /api/email-monitors/:id - Update monitor`);
  console.log(`    DELETE /api/email-monitors/:id - Delete monitor`);
  console.log(`    POST /api/email-monitors/detect-settings - Auto-detect IMAP`);
  console.log(`    POST /api/email-monitors/test-connection - Test IMAP connection`);
  console.log(`  🏥 Health & Monitoring:`);
  console.log(`    GET  /health - Health check`);
  console.log(`    GET  /health/detailed - Detailed health (admin)`);
  console.log(`    GET  /health/metrics - Prometheus metrics (admin)`);
  console.log(`  💿 Backups:`);
  console.log(`    GET  /backups - List backups (admin)`);
  console.log(`    POST /backups - Create backup (admin)`);
  console.log(`  📊 Business Operations:`);
  console.log(`    POST /ingest - Invoice ingestion`);
  console.log(`    POST /telemetry - Event tracking`);
  console.log(`    POST /find-leads - Lead discovery`);
  console.log(`    GET  /api/spifs/active - Active SPIFs`);
  console.log(`    GET  /api/dashboard/rep-summary - Dashboard data`);
  console.log('='.repeat(60));

  // Start Database Backup Service
  try {
    backupService.start();
    const stats = backupService.getStats();
    console.log(`💿 Backup Service: ${stats.isRunning ? '✅ Started' : '⚠️  Not running'} (${stats.totalBackups} existing backups)`);
  } catch (error) {
    console.error('💿 Backup Service failed to start:', error.message);
  }

  // Start Email Invoice Autopilot Service
  try {
    const emailService = require('./email-imap-service');
    setTimeout(async () => {
      console.log('📧 Starting Email Invoice Autopilot...');
      await emailService.startAll();
      const status = emailService.getStatus();
      console.log(`📧 Email Autopilot: ${status.isRunning ? '✅ Active' : '⚠️  Inactive'} (${status.activeMonitors} monitors)`);
    }, 2000); // Wait 2 seconds for server to fully initialize
  } catch (error) {
    console.error('📧 Email Autopilot failed to start:', error.message);
  }
});

// =====================================================
// GRACEFUL SHUTDOWN
// =====================================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Stop backup service
  try {
    backupService.stop();
    console.log('💿 Backup service stopped');
  } catch (error) {
    console.error('Error stopping backup service:', error.message);
  }

  // Close server
  server.close(() => {
    console.log('✅ Server closed successfully');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export app for testing and COGS processing for email autopilot
module.exports = app;
module.exports.processInvoiceForCOGS = processInvoiceForCOGS;
