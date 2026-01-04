const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TELEMETRY_DIR = path.join(__dirname, "..", "storage", "telemetry");
const EVENTS_PATH = path.join(TELEMETRY_DIR, "events.jsonl");

function ensureDir() {
  if (!fs.existsSync(TELEMETRY_DIR)) fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
}

function safeString(v, maxLen = 5000) {
  const s = v === undefined || v === null ? "" : String(v);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomBytes(8).toString("hex");
}

/**
 * Event shape (recommended):
 * {
 *   ts: ISO string,
 *   event_id: string,
 *   user_id: string|null,       // rep identifier if available
 *   session_id: string|null,    // stable per browser session
 *   source: "chrome_extension"|"web"|"api"|...,
 *   action: string,             // e.g. "analyze_invoice_clicked"
 *   meta: object                // small extra fields
 * }
 */
function appendEvent(evt) {
  ensureDir();
  const event = {
    ts: evt.ts || nowIso(),
    event_id: evt.event_id || newId(),
    user_id: evt.user_id ?? null,
    session_id: evt.session_id ?? null,
    source: safeString(evt.source || "unknown", 80),
    action: safeString(evt.action || "unknown", 120),
    meta: (evt.meta && typeof evt.meta === "object") ? evt.meta : {}
  };
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n", "utf8");
  return event;
}

function readEvents({ limit = 500 } = {}) {
  ensureDir();
  if (!fs.existsSync(EVENTS_PATH)) return [];
  const raw = fs.readFileSync(EVENTS_PATH, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const slice = lines.slice(Math.max(lines.length - limit, 0));
  const events = [];
  for (const ln of slice) {
    try { events.push(JSON.parse(ln)); } catch (_) {}
  }
  return events;
}

function summarizeEvents(events) {
  const byAction = {};
  const byUser = {};
  const byDay = {}; // YYYY-MM-DD
  for (const e of events) {
    const a = e.action || "unknown";
    byAction[a] = (byAction[a] || 0) + 1;

    const u = e.user_id || "unknown";
    byUser[u] = (byUser[u] || 0) + 1;

    const day = (e.ts || "").slice(0, 10) || "unknown";
    byDay[day] = (byDay[day] || 0) + 1;
  }
  return { byAction, byUser, byDay };
}

module.exports = {
  appendEvent,
  readEvents,
  summarizeEvents,
  EVENTS_PATH
};
