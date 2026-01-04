const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function safeRmDir(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
}

function which(cmd) {
  try {
    const out = execSync(`command -v ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

function resolveBin(name, fallbacks = []) {
  const w = which(name);
  if (w) return w;
  for (const p of fallbacks) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

const PDFTOPPM = resolveBin("pdftoppm", [
  "/opt/homebrew/bin/pdftoppm",
  "/usr/local/bin/pdftoppm",
  "/usr/bin/pdftoppm"
]);

const TESSERACT = resolveBin("tesseract", [
  "/opt/homebrew/bin/tesseract",
  "/usr/local/bin/tesseract",
  "/usr/bin/tesseract"
]);

function ocrPdfBufferToText(pdfBuffer, opts = {}) {
  if (!PDFTOPPM) throw new Error('OCR requires "pdftoppm" (Poppler). Install: brew install poppler');
  if (!TESSERACT) throw new Error('OCR requires "tesseract". Install: brew install tesseract');
  if (!Buffer.isBuffer(pdfBuffer)) throw new Error("ocrPdfBufferToText expected a Buffer");

  const maxPages = Number.isFinite(Number(opts.maxPages)) ? Number(opts.maxPages) : 3;
  const lang = opts.lang || "eng";
  const dpi = Number.isFinite(Number(opts.dpi)) ? Number(opts.dpi) : 200;
  const concurrency = Math.max(1, Number.isFinite(Number(opts.concurrency)) ? Number(opts.concurrency) : 2);
  const keepTemp = opts.keepTemp === true;
  const renderMode = (opts.renderMode || "png").toLowerCase(); // "png" or "gray"
  const userTmpDir = opts.tmpDir ? String(opts.tmpDir) : null;

  const tmpDir = userTmpDir
    ? (fs.mkdirSync(userTmpDir, { recursive: true }), userTmpDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));

  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, pdfBuffer);

  const imgPrefix = path.join(tmpDir, "page");

  const renderArgs = ["-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, imgPrefix];
  if (renderMode === "gray") renderArgs.unshift("-gray");
  else renderArgs.unshift("-png");

  const ppm = spawnSync(PDFTOPPM, renderArgs, { encoding: "utf8" });
  if (ppm.status !== 0) {
    const err = (ppm.stderr || "").trim();
    if (!keepTemp) safeRmDir(tmpDir);
    throw new Error(`pdftoppm failed (status ${ppm.status})${err ? `: ${err}` : ""}`);
  }

  const rendered = [];
  for (let i = 1; i <= maxPages; i++) {
    const png = `${imgPrefix}-${i}.png`;
    const pgm = `${imgPrefix}-${i}.pgm`;
    const imgPath = fs.existsSync(png) ? png : (fs.existsSync(pgm) ? pgm : null);
    if (imgPath) rendered.push({ page: i, imgPath });
  }

  function ocrOne({ page, imgPath }) {
    const outBase = path.join(tmpDir, `out-${page}`);
    const tess = spawnSync(
      TESSERACT,
      [imgPath, outBase, "-l", lang, "--psm", "6"],
      { encoding: "utf8" }
    );

    if (tess.status !== 0) return { page, text: "" };

    const txtPath = `${outBase}.txt`;
    if (!fs.existsSync(txtPath)) return { page, text: "" };

    return { page, text: fs.readFileSync(txtPath, "utf8") || "" };
  }

  // simple synchronous concurrency
  const queue = rendered.slice();
  const results = [];
  const workerCount = Math.min(concurrency, queue.length);
  for (let w = 0; w < workerCount; w++) {
    while (queue.length) {
      const job = queue.shift();
      results.push(ocrOne(job));
    }
  }

  results.sort((a, b) => a.page - b.page);
  const fullText = results.map((r) => r.text).join("\n").trim();

  if (!keepTemp) safeRmDir(tmpDir);
  return fullText;
}

module.exports = { ocrPdfBufferToText };
