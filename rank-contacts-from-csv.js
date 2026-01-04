// rank-contacts-from-csv.js

const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse");

/**
 * 1) Your answer likelihood scoring logic
 * This estimates how likely a number is to reach a human.
 */
function calculateAnswerLikelihood({
  phone_source_label,
  last_verified_date,
  raw_confidence,
  department
}) {
  let score = 0;

  const src = (phone_source_label || "").toString();

  // Base by type
  if (src === "Department") score += 40;
  else if (src === "Direct") score += 35;
  else if (src === "HQ/Main") score += 25;
  else if (src === "Corp Mobile") score += 20;

  // Verification freshness
  let monthsOld = 999;
  if (last_verified_date) {
    const now = new Date();
    const verified = new Date(last_verified_date);
    if (!isNaN(verified.getTime())) {
      monthsOld =
        (now.getFullYear() - verified.getFullYear()) * 12 +
        (now.getMonth() - verified.getMonth());
    }
  }
  if (monthsOld <= 12) score += 20;
  else if (monthsOld <= 24) score += 10;

  // Vendor confidence
  const conf = Number(raw_confidence) || 0;
  if (conf >= 90) score += 20;
  else if (conf >= 75) score += 10;

  // Role adjustments (we want reachable humans)
  const dept = (department || "").toString();
  const humanDepartments = ["Reception", "Admin", "HR"];
  const decisionDepartments = ["Safety", "Maintenance"];

  if (humanDepartments.includes(dept)) score += 10; // humans likely pick up
  else if (decisionDepartments.includes(dept)) score += 5; // decision-makers

  return Math.min(score, 100);
}

/**
 * 2) Rank dial paths from contact array
 * contacts: [
 *   {
 *     account_name,
 *     account_postal_code,
 *     full_name,
 *     title,
 *     department,
 *     last_verified_date,
 *     raw_confidence,
 *     phones: [
 *       { number, type, phone_source_label, location_type }
 *     ]
 *   }, ...
 * ]
 */
function rankDialPaths(contacts) {
  const dialPaths = [];

  (contacts || []).forEach((contact) => {
    const dept = contact.department || "";
    const rawConf = contact.raw_confidence || 0;
    const lastVerified = contact.last_verified_date || null;
    const phones = Array.isArray(contact.phones) ? contact.phones : [];

    phones.forEach((phone) => {
      const src =
        phone.phone_source_label ||
        phone.source_label ||
        phone.type ||
        "Direct";

      const score = calculateAnswerLikelihood({
        phone_source_label: src,
        last_verified_date: lastVerified,
        raw_confidence: rawConf,
        department: dept
      });

      dialPaths.push({
        account_name: contact.account_name || null,
        account_postal_code: contact.account_postal_code || "",
        contact_name: contact.full_name || "",
        title: contact.title || "",
        department: dept,
        phone_number: phone.number,
        phone_type: phone.type || null,
        phone_source_label: src,
        answer_likelihood: score
      });
    });
  });

  // Highest likelihood first
  dialPaths.sort((a, b) => b.answer_likelihood - a.answer_likelihood);
  return dialPaths;
}

/**
 * 3) Map a ZoomInfo-style CSV row into our internal "contact" shape.
 *
 * 🔴 IMPORTANT:
 *   You may need to tweak the header strings in here
 *   to match your actual ZoomInfo column names exactly.
 */
function rowToContact(row) {
  const company = row["Company Name"] || row["Company"] || "";
  const firstName = row["First Name"] || row["FirstName"] || "";
  const lastName = row["Last Name"] || row["LastName"] || "";
  const title = row["Title"] || row["Job Title"] || "";
  const department = row["Department"] || "";
  const email = row["Email Address"] || row["Work Email"] || "";
  const directPhone = row["Direct Phone"] || row["Direct Dial"] || "";
  const mobilePhone = row["Mobile Phone"] || row["Mobile"] || "";
  const companyPhone = row["Company Phone"] || row["Main Phone"] || "";
  const lastVerified = row["Last Updated Date"] || row["Last Verified"] || "";
  const confidence = row["Confidence Score"] || row["Confidence"] || "";

  // NEW: account/site postal code column (from Dynamics or merged data)
  const accountPostalCode =
    row["Account Postal Code"] ||
    row["Site Postal Code"] ||
    row["Account_Zip"] ||
    row["Site_Zip"] ||
    row["Postal Code"] ||
    "";

  const fullName = `${firstName} ${lastName}`.trim();

  const phones = [];

  if (directPhone) {
    phones.push({
      number: directPhone,
      type: "Direct",
      phone_source_label: "Direct",
      location_type: "Local"
    });
  }

  if (mobilePhone) {
    phones.push({
      number: mobilePhone,
      type: "Mobile",
      phone_source_label: "Corp Mobile",
      location_type: "Local"
    });
  }

  if (companyPhone) {
    phones.push({
      number: companyPhone,
      type: "Main",
      phone_source_label: "HQ/Main",
      location_type: "HQ"
    });
  }

  return {
    account_name: company,
    account_postal_code: accountPostalCode,
    full_name: fullName,
    title,
    department,
    email,
    last_verified_date: lastVerified || null,
    raw_confidence: confidence ? Number(confidence) : 80,
    phones
  };
}

/**
 * 4) Group ranked dial paths by account + postal code
 */
function groupByAccountPostal(rankedDialPaths) {
  const byAccount = new Map();

  for (const dp of rankedDialPaths) {
    const name = dp.account_name || "Unknown Account";
    const zip = (dp.account_postal_code || "").toString().trim();

    // Key: "Company Name (ZIP)" or just "Company Name" if no zip
    const key = zip ? `${name} (${zip})` : name;

    if (!byAccount.has(key)) {
      byAccount.set(key, []);
    }
    byAccount.get(key).push(dp);
  }

  return byAccount;
}

/**
 * 5) For each account+postal group, pick:
 *    - primary (best)
 *    - backups (next 2)
 *    - fallback (ultimate best number if others fail, usually reception/HQ/main)
 */
function summarizeAccountDialPlan(accountKey, paths) {
  if (!paths || !paths.length) return null;

  // Already sorted by answer_likelihood (descending)
  const primary = paths[0];
  const backups = paths.slice(1, 3);

  // Fallback: first number that looks like reception / admin / HR / main
  let fallback = null;
  for (const p of paths) {
    const dept = (p.department || "").toLowerCase();
    const src = (p.phone_source_label || "").toLowerCase();
    if (
      dept === "reception" ||
      dept === "admin" ||
      dept === "hr" ||
      src.includes("department") ||
      src.includes("hq") ||
      src.includes("main")
    ) {
      fallback = p;
      break;
    }
  }
  // If we couldn't find a "reception/main" style number, fallback to primary
  if (!fallback) fallback = primary;

  return {
    account_key: accountKey,
    primary,
    backups,
    fallback
  };
}

/**
 * 6) Main: read CSV, parse, score, print summary
 */
function main() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    console.error(
      "Usage: node rank-contacts-from-csv.js path/to/zoominfo_export.csv"
    );
    process.exit(1);
  }

  const fullPath = path.resolve(csvPathArg);
  if (!fs.existsSync(fullPath)) {
    console.error("File not found:", fullPath);
    process.exit(1);
  }

  console.log("Reading CSV:", fullPath);

  const contacts = [];

  fs.createReadStream(fullPath)
    .pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        trim: true
      })
    )
    .on("data", (row) => {
      const contact = rowToContact(row);
      if (contact.account_name && contact.phones.length > 0) {
        contacts.push(contact);
      }
    })
    .on("end", () => {
      console.log(`Parsed ${contacts.length} contacts with phones.`);

      if (!contacts.length) {
        console.log("No usable contacts found. Check your CSV column names.");
        return;
      }

      const ranked = rankDialPaths(contacts);
      const byAccount = groupByAccountPostal(ranked);

      console.log("");
      console.log(
        "=== Best dial paths per account + postal code (primary, backups, fallback) ==="
      );

      for (const [accountKey, paths] of byAccount.entries()) {
        const summary = summarizeAccountDialPlan(accountKey, paths);
        if (!summary) continue;

        console.log("");
        console.log("Account:", summary.account_key);

        // Primary
        console.log("  Primary (start here):");
        console.log(
          `    ${summary.primary.contact_name} (${summary.primary.title}, ${summary.primary.department})`
        );
        console.log(
          `    Phone: ${summary.primary.phone_number} [${summary.primary.phone_source_label}] | Likelihood: ${summary.primary.answer_likelihood}`
        );

        // Backups
        if (summary.backups.length) {
          console.log("  Backups (if primary doesn't answer):");
          summary.backups.forEach((b, idx) => {
            console.log(
              `    ${idx + 1}. ${b.contact_name} (${b.title}, ${b.department})`
            );
            console.log(
              `       Phone: ${b.phone_number} [${b.phone_source_label}] | Likelihood: ${b.answer_likelihood}`
            );
          });
        } else {
          console.log("  Backups: none (only one good number available).");
        }

        // Fallback
        console.log("  Fallback number if no one answers:");
        console.log(
          `    ${summary.fallback.contact_name || summary.fallback.department || "Reception/Main"}`
        );
        console.log(
          `    Phone: ${summary.fallback.phone_number} [${summary.fallback.phone_source_label}] | Likelihood: ${summary.fallback.answer_likelihood}`
        );
      }

      console.log("");
      console.log("Done.");
    })
    .on("error", (err) => {
      console.error("Error reading CSV:", err);
    });
}

main();
