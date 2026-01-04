// prepare-zoominfo-company-list.js
//
// This script reads your raw customer CSV (from Dynamics / CRM)
// and produces a clean ZoomInfo-ready "company list" CSV.
//
// Usage:
//   node prepare-zoominfo-company-list.js path/to/your_customers.csv
//
// Output:
//   zoominfo-company-upload.csv in the same folder as this script

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");
const { stringify } = require("csv-stringify/sync"); // small helper for writing CSV

// We need csv-stringify, install it once:
//   npm install csv-stringify
//

/**
 * Map one row from your customer CSV into a ZoomInfo "company" row.
 * Edit the column names in here to match YOUR actual headers.
 */
function rowToZoomInfoCompany(row) {
  // Your CSV currently has "My Input Data" as the main column.
  // We'll treat that as the company name for now.
  const rawInput = row["My Input Data"] || "";

  // If it's empty, skip
  if (!rawInput.trim()) {
    return null;
  }

  // For now, we’ll just use the whole string as the company name.
  // Later, if your "My Input Data" looks like "ABC Mfg - Houston, TX 77001"
  // we can parse out city/state/zip too.
  const accountName = rawInput.trim();

  const city = "";
  const state = "";
  const postalCode = "";
  const country = "US";

  return {
    "Company Name": accountName,
    City: city,
    State: state,
    Country: country,
    "Postal Code": postalCode
  };
}

function main() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    console.error(
      "Usage: node prepare-zoominfo-company-list.js path/to/your_customers.csv"
    );
    process.exit(1);
  }

  const inputPath = path.resolve(csvPathArg);
  if (!fs.existsSync(inputPath)) {
    console.error("File not found:", inputPath);
    process.exit(1);
  }

  console.log("Reading customer CSV:", inputPath);

  const companies = [];
  let headersPrinted = false;

  fs.createReadStream(inputPath)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      })
    )
    .on("data", (row) => {
      // For debugging, print the first row's keys so you can see your header names
      if (!headersPrinted) {
        console.log("Detected columns:", Object.keys(row));
        headersPrinted = true;
      }

      const mapped = rowToZoomInfoCompany(row);
      if (mapped) {
        companies.push(mapped);
      }
    })
    .on("end", () => {
      console.log(`Mapped ${companies.length} customer rows into companies.`);

      if (!companies.length) {
        console.log(
          "No companies mapped. You may need to update the column names in rowToZoomInfoCompany()."
        );
        return;
      }

      const outputCsv = stringify(companies, {
        header: true,
        columns: [
          "Company Name",
          "City",
          "State",
          "Country",
          "Postal Code"
        ]
      });

      const outputPath = path.resolve(
        __dirname,
        "zoominfo-company-upload.csv"
      );
      fs.writeFileSync(outputPath, outputCsv, "utf8");

      console.log("");
      console.log("✅ Created ZoomInfo upload file:");
      console.log("   ", outputPath);
      console.log(
        "You can now upload this in ZoomInfo → Company Lists → Upload CSV."
      );
    })
    .on("error", (err) => {
      console.error("Error reading CSV:", err);
    });
}

main();
