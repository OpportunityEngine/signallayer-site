// ./canonical/buildCanonicalInvoice.js
// Production-oriented canonical builder (invoice.v1)
// - Strict schema remains enforced by validateCanonicalInvoice elsewhere
// - This builder focuses on robust mapping from heterogeneous payloads to canonical shape
// - Does NOT fabricate line items; if no items are found, line_items will be empty (and validation can fail)

const crypto = require("crypto");

// ---------- small utils ----------
function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

function normalizeStr(s) {
  return String(s ?? "").trim();
}

function normalizeLower(s) {
  return normalizeStr(s).toLowerCase();
}

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function toNumberOrNull(x) {
  if (x === null || x === undefined || x === "") return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;

  const s = String(x).trim();
  if (!s) return null;

  // Remove currency symbols and commas; keep digits, dot, minus
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseMoney(input, currencyFallback = "USD") {
  // Accept:
  // - number: 10
  // - string: "$10.00"
  // - object: { amount: 10, currency: "USD" }
  // - object: { value: 10 } (or similar)
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return { amount: input, currency: currencyFallback };
  }

  if (typeof input === "string") {
    const n = toNumberOrNull(input);
    if (n === null) return null;
    return { amount: n, currency: currencyFallback };
  }

  if (isObj(input)) {
    const amount =
      toNumberOrNull(input.amount) ??
      toNumberOrNull(input.value) ??
      toNumberOrNull(input.price) ??
      null;
    const currency = normalizeStr(input.currency || currencyFallback) || currencyFallback;
    if (amount === null) return null;
    return { amount, currency };
  }

  return null;
}

function computeDocId(rawText) {
  // Stable-ish ID; if no text, random-ish
  const base = normalizeStr(rawText);
  if (base) return "DOC-" + sha256(base).slice(0, 12);
  return "DOC-" + crypto.randomBytes(6).toString("hex");
}

// ---------- universal item coercion (key feature) ----------
function coerceItems(payload) {
  if (!payload) return [];

  // Most common keys across pipelines/parsers
  const candidates = [
    payload.items,
    payload.line_items,
    payload.lineItems,
    payload.parsedItems,
    payload.parsed_items,
    payload.parsedLineItems,
    payload.parsed_line_items,
    payload.parsed?.items,
    payload.parsed?.line_items,
    payload.result?.items,
    payload.result?.line_items,
    payload.data?.items,
    payload.data?.line_items
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }
  return Array.isArray(payload.items) ? payload.items : [];
}

function coerceRawText(payload) {
  return (
    payload?.raw_text ||
    payload?.rawText ||
    payload?.text ||
    payload?.full_text ||
    payload?.parsed?.raw_text ||
    ""
  );
}

function coerceCurrency(payload) {
  const c =
    payload?.currency ||
    payload?.doc?.currency ||
    payload?.totals?.currency ||
    payload?.parsed?.currency ||
    "USD";
  return normalizeStr(c) || "USD";
}

function guessFrequency(item) {
  // Keep conservative; do not over-infer
  const f =
    item?.frequency ||
    item?.freq ||
    item?.billing_frequency ||
    item?.period ||
    item?.interval ||
    "unknown";

  const s = normalizeLower(f);
  if (!s) return "unknown";
  if (["weekly", "week", "wk"].includes(s)) return "weekly";
  if (["monthly", "month", "mo"].includes(s)) return "monthly";
  if (["daily", "day"].includes(s)) return "daily";
  if (["annual", "yearly", "year"].includes(s)) return "annual";
  return "unknown";
}

function computeLineConfidence(li, warnings) {
  // Simple, explainable scoring; non-breaking
  let score = 0.5;
  const notes = [];

  if (normalizeStr(li.raw_description).length >= 3) {
    score += 0.2;
    notes.push("HAS_DESCRIPTION");
  } else {
    warnings.push("Line item missing/short description.");
    notes.push("MISSING_DESCRIPTION");
  }

  if (li.quantity !== null && li.quantity !== undefined) {
    score += 0.1;
    notes.push("HAS_QUANTITY");
  } else {
    notes.push("MISSING_QUANTITY");
  }

  if (li.unit_price && typeof li.unit_price.amount === "number") {
    score += 0.15;
    notes.push("HAS_UNIT_PRICE");
  } else {
    notes.push("MISSING_UNIT_PRICE");
  }

  // Clamp
  if (score < 0) score = 0;
  if (score > 0.95) score = 0.95;

  return { overall: Number(score.toFixed(2)), notes };
}

// ---------- main builder ----------
function buildCanonicalInvoiceV1({
  source_type,
  payload,
  parserName = "unknown",
  parserVersion = "0.0.0",
  source_ref = { kind: "unknown", value: null, mime_type: null }
}) {
  const warnings = [];

  const raw_text = coerceRawText(payload);
  const currency = coerceCurrency(payload);

  const items = coerceItems(payload);

  if (!Array.isArray(items) || items.length === 0) {
    warnings.push("No line items found in payload (checked multiple candidate keys).");
    // Non-breaking: print keys to help you debug mapping issues quickly
    // eslint-disable-next-line no-console
    console.log("[CANONICAL] No items found. payload keys:", Object.keys(payload || {}));
  }

  const docId = computeDocId(raw_text);

  // If upstream provides these, use them; otherwise null (strict schema allows nulls)
  const invoice_number =
    payload?.invoice_number ||
    payload?.invoiceNumber ||
    payload?.doc?.invoice_number ||
    payload?.doc?.invoiceNumber ||
    null;

  const purchase_order =
    payload?.purchase_order ||
    payload?.po_number ||
    payload?.poNumber ||
    payload?.doc?.purchase_order ||
    null;

  // Issued at: prefer explicit; else now
  const issued_at =
    payload?.issued_at ||
    payload?.issuedAt ||
    payload?.doc?.issued_at ||
    new Date().toISOString();

  // Parties: keep safe defaults as you already have
  const vendorName =
    payload?.vendor?.name ||
    payload?.parties?.vendor?.name ||
    payload?.doc?.vendor_name ||
    "Unknown Vendor";

  // CRITICAL FIX: Chrome extension sends accountName at top level, not nested
  const customerName =
    payload?.accountName ||           // Chrome extension (top-level)
    payload?.customer?.name ||
    payload?.parties?.customer?.name ||
    payload?.doc?.customer_name ||
    "Unknown Customer";

  // Address extraction (Chrome extension provides billTo, shipTo, serviceAddress)
  function parseAddressObject(addrObj) {
    if (!addrObj) return null;

    // Chrome extension format: { line1, line2, city_state_zip }
    if (addrObj.line1 || addrObj.city_state_zip) {
      const street = addrObj.line1 || "";
      const cityStateZip = addrObj.city_state_zip || "";

      // Extract ZIP from city_state_zip like "Minneapolis, MN 55430"
      const zipMatch = cityStateZip.match(/\b(\d{5})(?:-\d{4})?\b/);
      const postalCode = zipMatch ? zipMatch[1] : "";

      // Extract state
      const stateMatch = cityStateZip.match(/\b([A-Z]{2})\s+\d{5}/);
      const state = stateMatch ? stateMatch[1] : "";

      // Extract city (before state)
      const cityMatch = cityStateZip.match(/^([^,]+),\s*[A-Z]{2}/);
      const city = cityMatch ? cityMatch[1].trim() : "";

      // Schema requires: raw, street, city, state, postal (NOT postalCode), country, confidence
      return {
        raw: [street, cityStateZip].filter(Boolean).join(", "),
        street: street || null,
        city: city || null,
        state: state || null,
        postal: postalCode || null,  // Schema uses "postal" not "postalCode"
        country: "US",
        confidence: postalCode ? 0.85 : 0.5
      };
    }

    // Standard nested format
    if (typeof addrObj === 'object') {
      const parts = [
        addrObj.street || addrObj.line1 || addrObj.address1,
        addrObj.city,
        addrObj.state,
        addrObj.postalCode || addrObj.postal || addrObj.zip
      ].filter(Boolean);

      return {
        raw: parts.join(", "),
        street: addrObj.street || addrObj.line1 || addrObj.address1 || null,
        city: addrObj.city || null,
        state: addrObj.state || null,
        postal: addrObj.postalCode || addrObj.postal || addrObj.zip || null,
        country: addrObj.country || "US",
        confidence: 0.5
      };
    }

    return null;
  }

  const billToAddr = parseAddressObject(payload?.billTo || payload?.bill_to || payload?.parties?.bill_to);
  const shipToAddr = parseAddressObject(payload?.shipTo || payload?.ship_to || payload?.parties?.ship_to);
  const serviceAddr = parseAddressObject(payload?.serviceAddress || payload?.service_address || payload?.parties?.service_address);

  // Customer addresses array (prefer shipTo, then billTo, then serviceAddr)
  const customerAddresses = [];
  if (shipToAddr) customerAddresses.push(shipToAddr);
  else if (billToAddr) customerAddresses.push(billToAddr);
  else if (serviceAddr) customerAddresses.push(serviceAddr);

  // bill_to and ship_to need to be parties (with name), not just addresses
  // Convert address objects to party format if needed
  function addrToParty(addr, fallbackName) {
    if (!addr) return null;
    return {
      name: fallbackName || "Unknown",
      normalized_name: fallbackName ? normalizeLower(fallbackName) : null,
      addresses: [addr]
    };
  }

  const billToParty = billToAddr ? addrToParty(billToAddr, customerName) : null;
  const shipToParty = shipToAddr ? addrToParty(shipToAddr, customerName) : null;

  // Build line items with tolerant field mapping
  const line_items = (Array.isArray(items) ? items : []).map((it, idx) => {
    const rawDesc =
      normalizeStr(it?.raw_description) ||
      normalizeStr(it?.description) ||
      normalizeStr(it?.desc) ||
      normalizeStr(it?.name) ||
      "";

    const normalizedDesc = rawDesc ? normalizeLower(rawDesc) : "";

    const sku =
      normalizeStr(it?.sku) ||
      normalizeStr(it?.item_code) ||
      normalizeStr(it?.code) ||
      null;

    // Quantity: accept number/string; default to 1 if description exists but qty absent?
    // IMPORTANT: avoid fabrication. We only default to 1 if the upstream explicitly indicates a line item exists.
    // If you want stricter behavior, set defaultQty to null.
    const qtyRaw = it?.quantity ?? it?.qty ?? it?.count ?? null;
    const qtyNum = toNumberOrNull(qtyRaw);
    const quantity = qtyNum !== null ? qtyNum : 1; // matches your current behavior (chrome example)

    // Unit price: accept unit_price, unitPrice, price, rate
    // Also handle cents fields from Sysco/Cintas parsers
    let unitPriceInput =
      it?.unit_price ??
      it?.unitPrice ??
      it?.price ??
      it?.rate ??
      it?.unit_cost ??
      null;

    // If we have unitPriceCents or unitPriceDollars from parser, use those
    if (unitPriceInput === null && it?.unitPriceDollars != null) {
      unitPriceInput = it.unitPriceDollars;
    } else if (unitPriceInput === null && it?.unitPriceCents != null) {
      unitPriceInput = it.unitPriceCents / 100;
    }

    const unit_price = parseMoney(unitPriceInput, currency);

    // Total price: accept total_price, totalPrice, total, line_total
    // Also handle cents fields from Sysco/Cintas parsers
    let totalPriceInput =
      it?.total_price ??
      it?.totalPrice ??
      it?.total ??
      it?.line_total ??
      null;

    // If we have lineTotalCents from parser, use that
    if (totalPriceInput === null && it?.lineTotalCents != null) {
      totalPriceInput = it.lineTotalCents / 100;
    }

    const total_price = parseMoney(totalPriceInput, currency);

    const frequency = guessFrequency(it);

    const li = {
      line_id: `L${idx + 1}`,
      raw_description: rawDesc,
      normalized_description: normalizedDesc || null,
      sku: sku || null,
      quantity,
      unit_price: unit_price || null,
      total_price: total_price || null,
      frequency,
      attributes: isObj(it?.attributes) ? it.attributes : {}
    };

    li.confidence = computeLineConfidence(li, warnings);
    return li;
  });

  // Totals: keep null unless you have reliable extraction
  const invoiceTotal =
    parseMoney(payload?.totals?.invoice_total, currency) ||
    parseMoney(payload?.invoice_total, currency) ||
    parseMoney(payload?.total, currency) ||
    null;

  // Overall confidence: simple heuristic (non-breaking)
  let overallConfidence = 0.5;
  if (line_items.length > 0) overallConfidence += 0.25;
  if (normalizeStr(vendorName) !== "Unknown Vendor") overallConfidence += 0.1;
  if (normalizeStr(customerName) !== "Unknown Customer") overallConfidence += 0.1;
  if (invoiceTotal) overallConfidence += 0.05;
  if (overallConfidence > 0.9) overallConfidence = 0.9;

  const canonical = {
    schema_version: "invoice.v1",

    doc: {
      doc_id: docId,
      doc_type: "invoice",
      invoice_number: invoice_number ? String(invoice_number) : null,
      purchase_order: purchase_order ? String(purchase_order) : null,
      issued_at: String(issued_at),
      service_period: payload?.service_period || payload?.servicePeriod || null,
      currency,
      raw_text_hash: raw_text ? sha256(raw_text) : null,
      tags: safeArray(payload?.tags)
    },

    parties: {
      vendor: {
        name: String(vendorName),
        normalized_name: normalizeLower(vendorName),
        addresses: safeArray(payload?.parties?.vendor?.addresses)
      },
      customer: {
        name: String(customerName),
        normalized_name: normalizeLower(customerName),
        addresses: customerAddresses.length > 0 ? customerAddresses : safeArray(payload?.parties?.customer?.addresses)
      },
      bill_to: billToParty,
      ship_to: shipToParty
    },

    line_items,

    totals: {
      invoice_total: invoiceTotal,
      weekly_equivalent_total: null,
      notes: safeArray(payload?.totals?.notes)
    },

    signals: safeArray(payload?.signals),
    opportunities: safeArray(payload?.opportunities),

    provenance: {
      source_type: source_type || "unknown",
      captured_at: new Date().toISOString(),
      parser: {
        name: String(parserName || "unknown"),
        version: String(parserVersion || "0.0.0"),
        warnings
      },
      source_ref: source_ref || { kind: "unknown", value: null, mime_type: null }
    },

    confidence: {
      overall: Number(overallConfidence.toFixed(2)),
      fields: [
        { path: "parties.customer.name", score: customerName ? 0.3 : 0.1, method: "unknown", evidence: [] },
        { path: "line_items", score: line_items.length > 0 ? 0.9 : 0.1, method: "parsed", evidence: [] }
      ]
    }
  };

  return canonical;
}

// Local helper used above
function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

module.exports = { buildCanonicalInvoiceV1 };
