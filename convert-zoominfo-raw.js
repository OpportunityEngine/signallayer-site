// convert-zoominfo-raw.js
//
// Goal:
// - Read a ZoomInfo export in either Excel (zoominfo-raw.xlsx)
//   or CSV (zoominfo-raw.csv)
// - Handle both:
//   * "Preview" style: everything crammed into one tab-separated column
//   * Normal column-based exports
// - Output zoominfo-contacts.csv in a clean format that our lead engine can use.

const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { parse } = require("csv-parse/sync");

// ---------- Helper: CSV escape ----------
function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ---------- Step 1: locate input file ----------
const xlsxPath = path.join(__dirname, "zoominfo-raw.xlsx");
const csvPath = path.join(__dirname, "zoominfo-raw.csv");

let mode = null;
if (fs.existsSync(xlsxPath)) {
  mode = "xlsx";
} else if (fs.existsSync(csvPath)) {
  mode = "csv";
} else {
  console.error(
    "❌ No input file found.\nPlace either zoominfo-raw.xlsx OR zoominfo-raw.csv into this folder: " +
      __dirname
  );
  process.exit(1);
}

console.log("Using mode:", mode);

// ---------- Step 2: read rows into [ [colA, colB,...], ... ] ----------
let rows = [];

if (mode === "xlsx") {
  console.log("Reading Excel:", xlsxPath);
  const workbook = xlsx.readFile(xlsxPath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
} else {
  console.log("Reading CSV:", csvPath);
  const raw = fs.readFileSync(csvPath, "utf8");
  const records = parse(raw, {
    skip_empty_lines: true
  });
  rows = records;
}

console.log("Total rows (including header):", rows.length);
if (!rows.length) {
  console.error("❌ No rows found in input file.");
  process.exit(1);
}

const headerRow = rows[0] || [];
const dataRow = rows[1] || [];

// ---------- Detect "preview" style vs normal table ----------
//
// Preview style usually = 1 column, and the data cell contains tab characters.
// Normal style = multiple columns, each field in its own column.
const isPreviewStyle =
  headerRow.length === 1 &&
  typeof dataRow[0] === "string" &&
  dataRow[0].includes("\t");

console.log("Detected preview style?", isPreviewStyle);

// Final output header for zoominfo-contacts.csv
const outputHeader = [
  "Company",
  "Contact Name",
  "Title",
  "Department",
  "Direct Phone",
  "Mobile Phone",
  "Corporate Phone",
  "Email",
  "City",
  "State",
  "PostalCode",
  "LastVerifiedDate",
  "ConfidenceScore"
];

const outputRows = [outputHeader];

// ---------- Preview-style parser ----------
//
// For files like your "CompanyList Match_Input_...-Preview.xlsx"
// where column A looks like:
//   Company \t Address1 \t Address2 \t City \t State \t Zip \t Phone \t ... Yes/No ... ContactName ... ID
//
function handlePreviewRows() {
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const colA = row[0];
    if (!colA) continue;

    const raw = String(colA).trim();
    if (!raw) continue;

    const parts = raw.split("\t").map((p) => p.trim());
    if (parts.length < 6) continue;

    const company = parts[0] || "";
    const city = parts[3] || "";
    const state = parts[4] || "";
    const postal = parts[5] || "";
    const phone = parts[6] || "";

    // Try to find a contact name near the end, usually after Yes/No flags
    let contactName = "";
    if (parts.includes("Yes") || parts.includes("No")) {
      // take the last non-empty field that isn't Yes/No
      for (let j = parts.length - 1; j >= 0; j--) {
        const val = parts[j];
        if (val && val !== "Yes" && val !== "No") {
          contactName = val;
          break;
        }
      }
    }

    const outRow = [
      company,
      contactName, // Contact Name
      "", // Title
      "", // Department
      "", // Direct Phone
      "", // Mobile Phone
      phone, // Corporate Phone
      "", // Email
      city,
      state,
      postal,
      "", // LastVerifiedDate
      "" // ConfidenceScore
    ];

    outputRows.push(outRow);
  }
}

// ---------- Normal table parser ----------
//
// For "nice" ZoomInfo contact exports with real columns.
//
function findColumnIndex(headerRow, candidates) {
  const lower = headerRow.map((h) =>
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

function handleNormalRows() {
  const h = headerRow.map((v) => (v ? String(v) : ""));

  const idxCompany = findColumnIndex(h, ["company", "account name"]);
  const idxName = findColumnIndex(h, ["contact name", "name", "full name"]);
  const idxTitle = findColumnIndex(h, ["title", "job title"]);
  const idxDept = findColumnIndex(h, ["department", "dept"]);
  const idxDirectPhone = findColumnIndex(h, [
    "direct phone",
    "direct dial",
    "direct line"
  ]);
  const idxMobilePhone = findColumnIndex(h, ["mobile phone", "cell", "mobile"]);
  const idxCorpPhone = findColumnIndex(h, [
    "corporate phone",
    "hq phone",
    "main phone",
    "company phone"
  ]);
  const idxEmail = findColumnIndex(h, [
    "email",
    "business email",
    "work email"
  ]);
  const idxCity = findColumnIndex(h, ["city"]);
  const idxState = findColumnIndex(h, ["state", "region"]);
  const idxPostal = findColumnIndex(h, ["postalcode", "zip", "zip code"]);
  const idxVerified = findColumnIndex(h, ["lastverifieddate", "verified"]);
  const idxConfidence = findColumnIndex(h, [
    "confidencescore",
    "score",
    "confidence"
  ]);

  console.log("Column mapping:");
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
  console.log("  Postal:", idxPostal);
  console.log("  LastVerified:", idxVerified);
  console.log("  Confidence:", idxConfidence);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];

    function get(idx) {
      if (idx === -1) return "";
      const v = row[idx];
      return v === undefined || v === null ? "" : String(v).trim();
    }

    const outRow = [
      get(idxCompany),
      get(idxName),
      get(idxTitle),
      get(idxDept),
      get(idxDirectPhone),
      get(idxMobilePhone),
      get(idxCorpPhone),
      get(idxEmail),
      get(idxCity),
      get(idxState),
      get(idxPostal),
      get(idxVerified),
      get(idxConfidence)
    ];

    // Skip completely empty lines
    if (outRow.every((cell) => cell === "")) continue;

    outputRows.push(outRow);
  }
}

// ---------- Execute appropriate handler ----------
if (isPreviewStyle) {
  console.log(
    "Parsing as preview-style (tab-separated fields packed into one column)..."
  );
  handlePreviewRows();
} else {
  console.log("Parsing as normal column-based table...");
  handleNormalRows();
}

// ---------- Write zoominfo-contacts.csv ----------
const outputPath = path.join(__dirname, "zoominfo-contacts.csv");
console.log("Writing cleaned CSV to:", outputPath);

const csvLines = outputRows.map((row) =>
  row.map((cell) => csvEscape(cell)).join(",")
);
fs.writeFileSync(outputPath, csvLines.join("\n"), "utf8");

console.log(
  "✅ Done! Created zoominfo-contacts.csv with",
  outputRows.length - 1,
  "rows of contacts."
);
console.log(
  "You can now start your backend with `node server.js` and the /find-leads endpoint will use this file."
);
