cat > ocr/ocrPdfToText.js <<'JS'
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function which(cmd) {
  try {
    return execSync(`command -v ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function resolveBin(name, fallbacks = []) {
  return (
    which(name) ||
    fallbacks.find((p) => fs.existsSync(p)) ||
    null
  );
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

if (!PDFTOPPM) {
  throw new Error('OCR requires "pdftoppm" (Poppler). Install: brew install poppler');
}
if (!TESSERACT) {
  throw new Error('OCR requires "tesseract". Install: brew install tesseract');
}

function ocrPdfBufferToText(pdfBuffer, opts = {}) {
  const maxPages = opts.maxPages || 3;
  const lang = opts.lang || "eng";
  const dpi = opts.dpi || 200;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-"));
  const pdfPath = path.join(tmpDir, "input.pdf");
  fs.writeFileSync(pdfPath, pdfBuffer);

  const imgPrefix = path.join(tmpDir, "page");

  const ppm = spawnSync(
    PDFTOPPM,
    ["-png", "-r", String(dpi), "-f", "1", "-l", String(maxPages), pdfPath, imgPrefix],
    { stdio: "ignore" }
  );

  if (ppm.status !== 0) {
    throw new Error("pdftoppm failed to convert PDF to images");
  }

  let fullText = "";

  for (let i = 1; i <= maxPages; i++) {
    const imgPath = `${imgPrefix}-${i}.png`;
    if (!fs.existsSync(imgPath)) continue;

    const outBase = path.join(tmpDir, `out-${i}`);
    const tess = spawnSync(
      TESSERACT,
      [imgPath, outBase, "-l", lang],
      { stdio: "ignore" }
    );

    if (tess.status === 0) {
      const txtPath = `${outBase}.txt`;
      if (fs.existsSync(txtPath)) {
        fullText += fs.readFileSync(txtPath, "utf8") + "\n";
      }
    }
  }

  return fullText.trim();
}

module.exports = { ocrPdfBufferToText };
JS
