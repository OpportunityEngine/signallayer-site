// storage/invoiceStore.js
// Simple persistence for canonical invoices (JSONL).
// Writes to ./data/canonical-invoices.jsonl
// Later you can swap this module to SQLite/Postgres without changing callers.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const INVOICE_LOG_PATH = path.join(DATA_DIR, "canonical-invoices.jsonl");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendCanonicalInvoice(canonicalInvoice) {
  ensureDataDir();
  fs.appendFileSync(INVOICE_LOG_PATH, JSON.stringify(canonicalInvoice) + "\n", "utf8");
}

function readAllCanonicalInvoices({ limit = 2000 } = {}) {
  ensureDataDir();
  if (!fs.existsSync(INVOICE_LOG_PATH)) return [];
  const raw = fs.readFileSync(INVOICE_LOG_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(Math.max(0, lines.length - limit));
  const out = [];
  for (const ln of slice) {
    try {
      out.push(JSON.parse(ln));
    } catch (e) {
      // ignore malformed lines
    }
  }
  return out;
}

function findInvoicesByCustomerName(normalizedCustomerName, { limit = 500 } = {}) {
  const all = readAllCanonicalInvoices({ limit: 5000 });
  const filtered = all.filter((inv) => {
    const n = inv?.parties?.customer?.normalized_name || "";
    return n && n === normalizedCustomerName;
  });
  return filtered.slice(-limit);
}

module.exports = {
  appendCanonicalInvoice,
  readAllCanonicalInvoices,
  findInvoicesByCustomerName
};
