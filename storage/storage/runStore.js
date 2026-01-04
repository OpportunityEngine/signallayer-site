// storage/runStore.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RUNS_DIR = path.join(__dirname, "runs");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function newRunId() {
  // sortable + unique enough for local dev
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex"); // 6 chars
  return `${ts}-${rand}`;
}

function runDir(runId) {
  return path.join(RUNS_DIR, runId);
}

function writeJson(runId, name, obj) {
  ensureDir(RUNS_DIR);
  ensureDir(runDir(runId));
  const filePath = path.join(runDir(runId), name);
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
  return filePath;
}

function writeText(runId, name, text) {
  ensureDir(RUNS_DIR);
  ensureDir(runDir(runId));
  const filePath = path.join(runDir(runId), name);
  fs.writeFileSync(filePath, String(text ?? ""), "utf8");
  return filePath;
}

function buildArtifacts(runId, files) {
  // Normalize to relative paths for the dashboard
  const base = runDir(runId);
  const rel = {};
  for (const [k, abs] of Object.entries(files)) {
    rel[k] = abs ? path.relative(base, abs) : null;
  }
  return rel;
}

module.exports = {
  newRunId,
  runDir,
  writeJson,
  writeText,
  buildArtifacts,
};
