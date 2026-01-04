const fs = require("fs");
const path = require("path");

const BACKEND = "http://127.0.0.1:5050";
const ENDPOINT = `${BACKEND}/capture-pdf`;

function argVal(name, def) {
  const ix = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (ix === -1) return def;
  const tok = process.argv[ix];
  if (tok.includes("=")) return tok.split("=").slice(1).join("=");
  return process.argv[ix + 1] ?? def;
}
function boolVal(name, defBool) {
  const v = String(argVal(name, defBool ? "true" : "false")).toLowerCase().trim();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
}
async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function main() {
  const folder = process.argv[2];
  if (!folder) {
    console.log("Usage: node tools/batchCapturePdf.js ./fixtures/invoices --ocr=false --maxPages=4");
    process.exit(1);
  }

  const enableOcr = boolVal("--ocr", false);
  const maxPages = parseInt(argVal("--maxPages", "4"), 10);
  const accountName = argVal("--accountName", "Batch Test Account");

  const absFolder = path.resolve(process.cwd(), folder);
  if (!fs.existsSync(absFolder)) {
    console.error("Folder not found:", absFolder);
    process.exit(1);
  }

  const pdfs = fs
    .readdirSync(absFolder)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(absFolder, f));

  if (!pdfs.length) {
    console.error("No PDFs found in:", absFolder);
    process.exit(1);
  }

  const runId = nowStamp();
  const outDir = path.join(process.cwd(), "storage", "runs", runId);
  fs.mkdirSync(outDir, { recursive: true });

  console.log("=== Universal Invoice Parser Batch Run ===");
  console.log("Backend:", BACKEND);
  console.log("Input folder:", absFolder);
  console.log("Run output:", outDir);
  console.log("OCR enabled:", enableOcr, "ocrMaxPages:", maxPages);
  console.log("PDF count:", pdfs.length);
  console.log("=========================================");

  const summary = [];

  for (const pdfPath of pdfs) {
    const fileName = path.basename(pdfPath);
    const baseName = fileName.replace(/\.pdf$/i, "");
    const outJson = path.join(outDir, `${baseName}.json`);

    console.log("\n---", fileName, "---");

    const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");

    const body = {
      pdfBase64,
      accountName,
      enableOcr,
      ocrMaxPages: maxPages,
      sourceLabel: fileName
    };

    let status = "unknown";
    let parserUsed = "";
    let parsedItemsCount = 0;
    let textLength = 0;
    let usedOcr = false;
    let message = "";

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await safeJson(res);
      fs.writeFileSync(outJson, JSON.stringify({ httpStatus: res.status, data }, null, 2), "utf8");

      if (!data) {
        status = "fail";
        message = "No JSON response";
      } else if (data.ok !== true) {
        status = "fail";
        message = data.message || "ok:false";
      } else {
        message = data.message || "";
        const extracted = data.extracted || {};
        textLength = extracted.textLength || 0;
        usedOcr = !!extracted.usedOcr;
        parserUsed = extracted.parserUsed || "";
        parsedItemsCount = extracted.parsedItemsCount || 0;

        if (parsedItemsCount > 0) status = "pass-items";
        else if (textLength > 200) status = "pass-text-only";
        else status = "needs-ocr-or-parser";
      }
    } catch (e) {
      status = "fail";
      message = String(e && e.message ? e.message : e);
      fs.writeFileSync(outJson, JSON.stringify({ error: message }, null, 2), "utf8");
    }

    console.log("status:", status);
    console.log("parserUsed:", parserUsed || "(none)");
    console.log("textLength:", textLength, "usedOcr:", usedOcr);
    console.log("parsedItemsCount:", parsedItemsCount);
    console.log("saved:", path.relative(process.cwd(), outJson));

    summary.push({ file: fileName, status, parserUsed, textLength, usedOcr, parsedItemsCount, message });
  }

  const summaryPath = path.join(outDir, `_SUMMARY.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log("\n=== SUMMARY ===");
  const counts = summary.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  console.log(counts);
  console.log("Summary file:", path.relative(process.cwd(), summaryPath));
}

main().catch((e) => {
  console.error("Batch runner crashed:", e);
  process.exit(1);
});
