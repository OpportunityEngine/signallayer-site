// background.js (MV3 service worker)
// QuietSignal Chrome Extension - capture DOM + send to backend /ingest + telemetry
//
// Requires manifest.json to include:
// - permissions: ["activeTab", "scripting", "storage"]
// - host_permissions: ["http://localhost:5050/*", "http://127.0.0.1:5050/*"]
// - background.service_worker: "background.js"

const BACKEND_BASE = "http://localhost:5050";

// -------------------- Telemetry (non-blocking) --------------------

async function qsSendTelemetryBg(action, meta = {}) {
  try {
    const getOrCreate = async (key, makeFn) => {
      const obj = await chrome.storage.local.get([key]);
      if (obj && obj[key]) return obj[key];
      const v = makeFn();
      await chrome.storage.local.set({ [key]: v });
      return v;
    };

    const session_id = await getOrCreate(
      "qs_session_id",
      () => `sess_${Math.random().toString(16).slice(2)}_${Date.now()}`
    );
    const user_id = await getOrCreate("qs_user_id", () => "rep-unknown");

    await fetch(`${BACKEND_BASE}/telemetry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        source: "chrome_extension",
        action: String(action || "unknown"),
        user_id,
        session_id,
        meta: meta && typeof meta === "object" ? meta : {}
      })
    });
  } catch (_) {
    // never block UX
  }
}

// Startup beacon (proves this service worker is running)
qsSendTelemetryBg("bg_loaded", { note: "background.js loaded" });

// -------------------- Capture utilities (runs in page) --------------------

// This function is injected into the page via chrome.scripting.executeScript.
// It must be self-contained (no external variables).
function _quietSignalCaptureInPage() {
  function normalizeWhitespace(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  // Visible text (best-effort)
  const rawText = normalizeWhitespace(document.body ? document.body.innerText : "");

  // Table HTML extraction
  const tables = Array.from(document.querySelectorAll("table"));
  const tableHtml = tables
    .slice(0, 20) // cap to avoid huge payloads
    .map((t) => t && t.outerHTML ? t.outerHTML : "")
    .filter(Boolean);

  // Address extraction (structured)
  function extractAddresses() {
    const result = { billTo: null, shipTo: null, serviceAddress: null };

    // Look for "Bill To:" or "Ship To:" or "Service Address:" labels
    const allText = document.body ? document.body.innerText : "";
    const lines = allText.split(/\r?\n/).map(l => normalizeWhitespace(l)).filter(Boolean);

    for (let i = 0; i < lines.length - 3; i++) {
      const line = lines[i].toLowerCase();

      // Bill To pattern
      if (line.includes("bill to") && line.length < 30) {
        const addrLines = [lines[i+1], lines[i+2], lines[i+3]].filter(l => l && l.length > 0 && l.length < 100);
        if (addrLines.length >= 2) {
          result.billTo = {
            line1: addrLines[0] || "",
            line2: addrLines[1] || "",
            city_state_zip: addrLines[2] || ""
          };
        }
      }

      // Ship To pattern
      if (line.includes("ship to") && line.length < 30) {
        const addrLines = [lines[i+1], lines[i+2], lines[i+3]].filter(l => l && l.length > 0 && l.length < 100);
        if (addrLines.length >= 2) {
          result.shipTo = {
            line1: addrLines[0] || "",
            line2: addrLines[1] || "",
            city_state_zip: addrLines[2] || ""
          };
        }
      }

      // Service Address pattern
      if ((line.includes("service address") || line.includes("service location")) && line.length < 50) {
        const addrLines = [lines[i+1], lines[i+2], lines[i+3]].filter(l => l && l.length > 0 && l.length < 100);
        if (addrLines.length >= 2) {
          result.serviceAddress = {
            line1: addrLines[0] || "",
            line2: addrLines[1] || "",
            city_state_zip: addrLines[2] || ""
          };
        }
      }
    }

    return result;
  }

  const addresses = extractAddresses();

  // Heuristic line-item extraction from text lines
  // We are NOT fabricating; this is best-effort signal for /ingest.
  const lines = String(document.body ? document.body.innerText : "")
    .split(/\r?\n/)
    .map((l) => normalizeWhitespace(l))
    .filter(Boolean)
    .slice(0, 5000);

  const items = [];

  // Price patterns like $12.34 or 12.34
  const moneyRe = /(?:\$)?(\d{1,7}\.\d{2})\b/;
  const qtyRe = /\bqty\b|\bquantity\b/i;

  for (const line of lines) {
    // Skip very short lines
    if (line.length < 6) continue;

    const m = line.match(moneyRe);
    if (!m) continue;

    // Try to infer qty
    let quantity = 1;
    // Examples: "2 x Item Name $10.00", "Item Name Qty 2 $10.00"
    const mult = line.match(/\b(\d+)\s*[xX]\b/);
    if (mult) quantity = parseInt(mult[1], 10) || 1;

    if (!mult && qtyRe.test(line)) {
      const q = line.match(/\bqty[:\s]*([0-9]+)\b/i) || line.match(/\bquantity[:\s]*([0-9]+)\b/i);
      if (q) quantity = parseInt(q[1], 10) || 1;
    }

    const unitPrice = Number(m[1]);
    if (!Number.isFinite(unitPrice)) continue;

    // Description: remove money token + common qty tokens
    let desc = line
      .replace(moneyRe, "")
      .replace(/\b(\d+)\s*[xX]\b/, "")
      .replace(/\bqty[:\s]*([0-9]+)\b/i, "")
      .replace(/\bquantity[:\s]*([0-9]+)\b/i, "")
      .trim();

    desc = normalizeWhitespace(desc);

    if (!desc) continue;

    items.push({
      raw_description: desc,
      quantity: quantity > 0 ? quantity : 1,
      unit_price: unitPrice
    });

    if (items.length >= 200) break;
  }

  return {
    raw_text: rawText,
    tableHtml,
    items,
    addresses,
    url: location.href,
    title: document.title || ""
  };
}

// -------------------- Capture from tab --------------------

async function captureFromTab(tabId, accountName) {
  if (!tabId && tabId !== 0) throw new Error("tabId missing");

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: _quietSignalCaptureInPage
  });

  const cap = results && results[0] ? results[0].result : null;
  if (!cap) throw new Error("capture returned null");

  return {
    accountName: accountName || "",
    url: cap.url || "",
    title: cap.title || "",
    raw_text: cap.raw_text || "",
    tableHtml: Array.isArray(cap.tableHtml) ? cap.tableHtml : [],
    items: Array.isArray(cap.items) ? cap.items : [],
    addresses: cap.addresses || {}
  };
}

// -------------------- Ingest to backend --------------------

async function postToIngest(captured) {
  // Your backend /ingest supports either {source_type, payload} or direct fields.
  // We send in the safer explicit shape:
  const body = {
    source_type: "chrome",
    payload: {
      accountName: captured.accountName || "",
      sourceUrl: captured.url || "",
      docTitle: captured.title || "",
      raw_text: captured.raw_text || "",
      tableHtml: captured.tableHtml || [],
      items: captured.items || [],
      billTo: captured.addresses?.billTo || null,
      shipTo: captured.addresses?.shipTo || null,
      serviceAddress: captured.addresses?.serviceAddress || null
    },
    source_ref: { kind: "url", value: captured.url || "", mime_type: "text/html" }
  };

  const res = await fetch(`${BACKEND_BASE}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  // Your /ingest returns JSON (always 200 in your unified envelope version).
  // Still handle non-JSON safely.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return { ok: false, status: "non_json_response", raw: text.slice(0, 2000) };
  }
}

// -------------------- Message handler --------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // IMPORTANT: return true to keep sendResponse alive for async.
  (async () => {
    try {
      if (!msg || !msg.type) {
        sendResponse({ ok: false, message: "Missing msg.type" });
        return;
      }

      if (msg.type !== "CAPTURE_AND_INGEST") {
        sendResponse({ ok: false, message: `Unknown msg.type: ${msg.type}` });
        return;
      }

      const tabId = msg.tabId;
      const accountName = msg.accountName || "";

      // Capture
      const captured = await captureFromTab(tabId, accountName);

      await qsSendTelemetryBg("ingest_request_sent", {
        url: captured.url,
        title: captured.title,
        itemsCount: captured.items?.length || 0,
        rawTextLength: (captured.raw_text || "").length,
        tableCount: Array.isArray(captured.tableHtml) ? captured.tableHtml.length : 0
      });

      // Ingest
      const json = await postToIngest(captured);

      // Compute weekly opportunity from your legacy output (if present)
      let weeklyOpportunity = 0;
      try {
        const opp = json?.legacy?.opportunity || null;
        weeklyOpportunity =
          (Number(opp?.linerAddOn?.potentialWeeklyRevenue) || 0) +
          (Number(opp?.jacketConversion?.potentialWeeklyRevenue) || 0);
      } catch (_) {}

      await qsSendTelemetryBg("ingest_response_received", {
        ok: !!json?.ok,
        status: json?.status || (json?.ok ? "ok" : "unknown"),
        weeklyOpportunity,
        canonicalLineItems: Array.isArray(json?.canonical?.line_items) ? json.canonical.line_items.length : null,
        extractedItems: Array.isArray(json?.extracted?.items) ? json.extracted.items.length : null
      });

      // Respond back to popup.js
      sendResponse(json);
    } catch (err) {
      await qsSendTelemetryBg("ingest_failed", {
        error: String(err && (err.stack || err)),
        note: "CAPTURE_AND_INGEST failed"
      });

      sendResponse({
        ok: false,
        status: "extension_error",
        message: "CAPTURE_AND_INGEST failed",
        error: String(err && (err.stack || err))
      });
    }
  })();

  return true;
});
