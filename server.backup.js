// server.js - stable version with:
// - Invoice analyzer (/capture) with multi-opportunity logic
// - MLA analyzer (/analyze-mla)
// - Lead sourcing (/find-leads) with ZoomInfo + public fallback hook

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const app = express();
const PORT = 5050;

app.use(cors());
app.use(express.json());

// For public web fallback (Google Places style). Leave as-is for now.
// When you get a real key you can replace this string.
const GOOGLE_PLACES_API_KEY = "YOUR_GOOGLE_PLACES_API_KEY_HERE";

// Simple in-memory MLA store
const mlaStore = {};

// Contacts loaded from zoominfo-contacts.csv
let contacts = [];

/**
 * Normalize a company name for fuzzy matching.
 */
function normalizeCompanyName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Load ZoomInfo contacts from zoominfo-contacts.csv (already cleaned by your converter).
 */
function loadContactsFromCsv() {
  const csvPath = path.join(__dirname, "zoominfo-contacts.csv");
  if (!fs.existsSync(csvPath)) {
    console.log(
      "[LEADS] zoominfo-contacts.csv not found in backend folder. Lead sourcing limited to public fallback."
    );
    return;
  }

  try {
    const raw = fs.readFileSync(csvPath, "utf8");
    const records = parse(raw, {
      skip_empty_lines: true
    });

    if (!records.length) {
      console.log("[LEADS] zoominfo-contacts.csv is empty.");
      return;
    }

    const header = records[0].map((v) => (v ? String(v) : ""));
    const rows = records.slice(1);

    function findColumnIndex(candidates) {
      const lower = header.map((h) =>
        h ? String(h).toLowerCase().trim() : ""
      );
      for (const name of candidates) {
        const target = name.toLowerCase();
        const idx = lower.findIndex(
          (h) => h === target || (h && h.includes(target))
        );
        if (idx !== -1) return idx;
      }
      return -1;
    }

    const idxCompany = findColumnIndex(["company", "account name"]);
    const idxName = findColumnIndex(["contact name", "name", "full name"]);
    const idxTitle = findColumnIndex(["title", "job title"]);
    const idxDept = findColumnIndex(["department", "dept"]);
    const idxDirectPhone = findColumnIndex([
      "direct phone",
      "direct dial",
      "direct line"
    ]);
    const idxMobilePhone = findColumnIndex([
      "mobile phone",
      "cell",
      "mobile"
    ]);
    const idxCorpPhone = findColumnIndex([
      "corporate phone",
      "hq phone",
      "main phone",
      "company phone"
    ]);
    const idxEmail = findColumnIndex([
      "email",
      "business email",
      "work email"
    ]);
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

        if (!company && !contactName && !corpPhone && !directPhone) {
          return null;
        }

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

    console.log(
      `[LEADS] Loaded ${contacts.length} contacts from zoominfo-contacts.csv`
    );
  } catch (err) {
    console.error("[LEADS] Error reading zoominfo-contacts.csv:", err);
  }
}

// Load contacts at startup
loadContactsFromCsv();

/**
 * Score a contact for "reachability".
 */
function scoreContact(contact) {
  let score = 0;

  if (contact.directPhone) score += 40;
  else if (contact.mobilePhone) score += 35;
  else if (contact.corpPhone) score += 25;

  const dept = (contact.department || "").toLowerCase();
  const title = (contact.title || "").toLowerCase();

  if (
    dept.includes("reception") ||
    dept.includes("front desk") ||
    title.includes("receptionist")
  ) {
    score += 15;
  } else if (
    dept.includes("hr") ||
    dept.includes("human resources") ||
    title.includes("hr")
  ) {
    score += 10;
  } else if (
    dept.includes("maintenance") ||
    title.includes("maintenance")
  ) {
    score += 8;
  } else if (
    dept.includes("safety") ||
    dept.includes("ehs") ||
    title.includes("safety")
  ) {
    score += 8;
  }

  if (score > 100) score = 100;
  return score;
}

/**
 * Invoice capture with multi-opportunity logic.
 */
app.post("/capture", (req, res) => {
  console.log("=== /capture was hit ===");
  const payload = req.body || {};
  console.log("Received payload:");
  console.dir(payload, { depth: 5 });

  const items = Array.isArray(payload.items) ? payload.items : [];

  const parseQty = (q) => {
    const n = parseInt(q, 10);
    return isNaN(n) ? 0 : n;
  };

  const totalItems = items.length;

  // Classification counters
  let frItemsCount = 0;

  let frShirtQty = 0;
  let frPantQty = 0;
  let frJacketQty = 0;

  let nonFrShirtQty = 0;
  let nonFrPantQty = 0;
  let nonFrJacketQty = 0;

  // Liner logic
  const linerSku = "64356";
  let linerQty = 0;

  // Walk lines and classify
  for (const it of items) {
    const desc = String(it.description || "");
    const descLower = desc.toLowerCase();
    const qty = parseQty(it.quantity);
    const sku = String(it.sku || "");

    const isFR = descLower.includes("fr");
    const isShirt = descLower.includes("shirt");
    const isPant = descLower.includes("pant");
    const isJacket =
      descLower.includes("jacket") || descLower.includes("coat");

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

    if (sku === linerSku) {
      linerQty += qty;
    }
  }

  // FR wearer estimate: sum of FR quantities
  const frWearerCount = items.reduce((sum, it) => {
    const descLower = String(it.description || "").toLowerCase();
    if (!descLower.includes("fr")) return sum;
    return sum + parseQty(it.quantity);
  }, 0);

  // Uniform logic
  const totalShirtQty = frShirtQty + nonFrShirtQty;
  const totalPantQty = frPantQty + nonFrPantQty;

  const frUniformQty = Math.min(frShirtQty, frPantQty); // FR shirt + pant
  const totalUniformQty = Math.min(totalShirtQty, totalPantQty);
  const nonFrUniformQty = Math.max(totalUniformQty - frUniformQty, 0);

  // Employee estimates: 11 uniforms ≈ 1 employee
  const estimatedFrEmployees = Math.max(Math.ceil(frUniformQty / 11), 0);
  const estimatedNonFrEmployees = Math.max(
    Math.ceil(nonFrUniformQty / 11),
    0
  );

  // FR core employees (FR shirt + pant)
  const frCoreEmployees = estimatedFrEmployees;

  // Employees likely with FR shirt + pant but non-FR jacket
  const frWearersWithNonFrJacket = Math.min(
    nonFrJacketQty,
    frCoreEmployees
  );

  // Liner opportunity
  const missingLiners = Math.max(frWearerCount - linerQty, 0);
  const linerPricePerWeek = 2.5; // example from your comp explanation
  const potentialWeeklyRevenue_Liners = missingLiners * linerPricePerWeek;

  const commissionMultiplier = 3; // rough demo from your "36 months => 3x" note
  const estimatedCommissionPayout_Liners =
    potentialWeeklyRevenue_Liners * commissionMultiplier;

  // Jacket conversion opportunity
  const jacketPricePerWeek = 3.0; // placeholder price per week
  const potentialWeeklyRevenue_JacketConversion =
    frWearersWithNonFrJacket * jacketPricePerWeek;
  const estimatedCommissionPayout_JacketConversion =
    potentialWeeklyRevenue_JacketConversion * commissionMultiplier;

  // MLA summary (still stubbed)
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
      notes:
        "Extended formulary item; may require approval depending on region."
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
      commissionEstimate: {
        multiplier: commissionMultiplier,
        estimatedPayout: estimatedCommissionPayout_Liners
      }
    },
    jacketConversion: {
      description: "Convert non-FR jackets to FR jackets",
      frUniformQty,
      estimatedFrEmployees,
      nonFrJacketQty,
      frWearersWithNonFrJacket,
      exampleJacketPricePerWeek: jacketPricePerWeek,
      potentialWeeklyRevenue: potentialWeeklyRevenue_JacketConversion,
      commissionEstimate: {
        multiplier: commissionMultiplier,
        estimatedPayout: estimatedCommissionPayout_JacketConversion
      }
    },
    uniformMix: {
      frUniformQty,
      nonFrUniformQty,
      estimatedFrEmployees,
      estimatedNonFrEmployees,
      conversionRule: "11 uniforms ≈ 1 employee",
      notes:
        "Uniform quantities are derived from shirt + pant pairs. Employee estimates are based on 11 uniforms per employee."
    }
  };

  const response = {
    ok: true,
    message: "Backend processed invoice and MLA/opportunity logic.",
    account: {
      accountNumber: payload.accountNumber || "",
      accountName: payload.accountName || ""
    },
    stats: {
      totalItems,
      frItemsCount,
      frWearerCount
    },
    mlaSummary,
    opportunity
  };

  res.json(response);
});

/**
 * MLA analyze/store endpoint.
 */
app.post("/analyze-mla", (req, res) => {
  console.log("=== /analyze-mla was hit ===");
  const body = req.body || {};

  const mlaId =
    body.mlaId ||
    body.title ||
    `MLA-${Date.now()}`;

  const textLength = (body.text || "").length;
  const hasTableHtml = !!body.tableHtml;

  mlaStore[mlaId] = {
    mlaId,
    sourceUrl: body.sourceUrl || "",
    textLength,
    hasTableHtml,
    storedAt: new Date().toISOString()
  };

  console.log(
    `Stored MLA ${mlaId} with textLength=${textLength}, hasTableHtml=${hasTableHtml}`
  );
  res.json({
    ok: true,
    message: `Stored MLA ${mlaId}`,
    mlaId,
    textLength,
    hasTableHtml
  });
});

/**
 * Public web fallback: Google Places-style lookup for main business line.
 */
async function findPublicLeads(accountName, postalCode) {
  if (
    !GOOGLE_PLACES_API_KEY ||
    GOOGLE_PLACES_API_KEY.startsWith("YOUR_GOOGLE_PLACES_API_KEY")
  ) {
    console.log(
      "[PUBLIC_LEADS] No Google Places API key configured; skipping public lookup."
    );
    return [];
  }

  const query = postalCode ? `${accountName} ${postalCode}` : accountName;
  console.log("[PUBLIC_LEADS] Searching Google Places for:", query);

  const searchUrl =
    "https://maps.googleapis.com/maps/api/place/textsearch/json" +
    `?query=${encodeURIComponent(query)}` +
    `&key=${GOOGLE_PLACES_API_KEY}`;

  try {
    const searchRes = await fetch(searchUrl);
    const searchJson = await searchRes.json();

    if (!searchJson.results || !searchJson.results.length) {
      console.log("[PUBLIC_LEADS] No results from Places textsearch.");
      return [];
    }

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
        if (detailsJson.result.formatted_address) {
          formattedAddress = detailsJson.result.formatted_address;
        }
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

    const lead = {
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
    };

    console.log("[PUBLIC_LEADS] Returning public lead:", lead);
    return [lead];
  } catch (err) {
    console.error("[PUBLIC_LEADS] Error calling Google Places:", err);
    return [];
  }
}

/**
 * Find leads for an account: ZoomInfo first, then public fallback.
 */
app.post("/find-leads", async (req, res) => {
  console.log("=== /find-leads was hit ===");
  const body = req.body || {};
  const accountName = body.accountName || "";
  const postalCode = (body.postalCode || "").trim();

  if (!accountName) {
    return res.json({ ok: false, message: "accountName required" });
  }

  let candidates = [];

  if (contacts.length) {
    const normalizedAccount = normalizeCompanyName(accountName);

    candidates = contacts.filter((c) => {
      if (!c.normalizedCompany) return false;

      const nameMatch =
        c.normalizedCompany.includes(normalizedAccount) ||
        normalizedAccount.includes(c.normalizedCompany);

      if (!nameMatch) return false;

      if (postalCode) {
        if (!c.postalCode) return false;
        return (
          c.postalCode.replace(/\s+/g, "") ===
          postalCode.replace(/\s+/g, "")
        );
      }

      return true;
    });
  }

  console.log(
    `[LEADS] Found ${candidates.length} candidate contacts for`,
    accountName,
    postalCode
  );

  if (candidates.length > 0) {
    const scored = candidates
      .map((c) => ({ ...c, score: scoreContact(c) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return res.json({
      ok: true,
      source: "zoominfo",
      leads: scored
    });
  }

  console.log("[LEADS] No ZoomInfo leads found, using public fallback...");
  const fallbackLeads = await findPublicLeads(accountName, postalCode);

  if (!fallbackLeads.length) {
    return res.json({ ok: false, message: "No public fallback leads found." });
  }

  return res.json({
    ok: true,
    source: "public_web",
    leads: fallbackLeads
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`AI backend listening at http://localhost:${PORT}`);
});
