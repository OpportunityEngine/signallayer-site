const crypto = require("crypto");

function normalizeCompanyName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(s) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function stableHash(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  normalizeCompanyName,
  normalizeText,
  stableHash,
  clamp01,
  nowIso
};
