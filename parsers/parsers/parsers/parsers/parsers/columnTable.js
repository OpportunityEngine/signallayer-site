const { findTotals, ANCHORS, firstMatch } = require("../lib/anchors");
const { findLineEndMoney } = require("../lib/money");

function scoreColumnSignals(lines) {
  let headerHits = 0;
  const headerWords = ["qty", "quantity", "item", "description", "unit", "price", "amount", "ext", "extended"];
  const top = lines.slice(0, 80).join(" ").toLowerCase();
  for (const w of headerWords) if (top.includes(w)) headerHits++;

  // crude "column-ness": many lines with >= 4 numeric-ish tokens
  let numericDense = 0;
  const scan = lines.slice(0, Math.min(lines.length, 220));
  for (const line of scan) {
    const toks = line.split(" ");
    let nums = 0;
    for (const t of toks) if (/^\d+(\.\d+)?$/.test(t.replace(/[,]/g, ""))) nums++;
    if (nums >= 4) numericDense++;
  }

  return { headerHits, numericDense };
}

function extractHeader(lines) {
  const inv = firstMatch(lines, ANCHORS.invoiceNo, 80);
  const dt = firstMatch(lines, ANCHORS.date, 80);
  const po = firstMatch(lines, ANCHORS.poNo, 120);

  return {
    invoiceNumber: inv ? (inv.match[2] || inv.match[1]) : undefined,
    invoiceDate: dt ? dt.match[2] : undefined,
    poNumber: po ? (po.match[2] || po.match[1]) : undefined,
  };
}

function findLineItems(lines) {
  // heuristic: item lines often end with money and are not totals block lines
  const items = [];
  const stopWords = ["subtotal", "tax", "total", "amount due", "balance due"];

  const start = 0;
  const end = lines.length;

  for (let i = start; i < end; i++) {
    const line = lines[i];
    const low = line.toLowerCase();
    if (stopWords.some(s => low.includes(s))) continue;

    const m = findLineEndMoney(line);
    if (!m) continue;

    // exclude very short lines that are probably totals
    const toks = line.trim().split(" ");
    if (toks.length <= 2) continue;

    // try qty (first numeric token)
    let qty = null;
    for (let k = 0; k < Math.min(toks.length, 4); k++) {
      const t = toks[k].replace(/[,]/g, "");
      if (/^\d+(\.\d+)?$/.test(t)) { qty = Number(t); break; }
    }

    // description = line without trailing amount token
    const desc = toks.slice(0, toks.length - 1).join(" ").trim();

    items.push({
      description: desc,
      quantity: qty || undefined,
      lineTotal: m.value,
    });
  }

  // keep reasonable size
  return items.slice(0, 400);
}

module.exports = {
  id: "columnTable-v1",
  version: "1.0.0",
  match(input) {
    const { lines } = input;
    const { headerHits, numericDense } = scoreColumnSignals(lines);
    const totals = findTotals(lines);

    let score = 0;
    const reasons = [];

    if (headerHits >= 2) { score += 35; reasons.push(`headerHits:${headerHits}`); }
    if (numericDense >= 6) { score += 35; reasons.push(`numericDense:${numericDense}`); }
    if (totals.total !== null && totals.total !== undefined) { score += 20; reasons.push("hasTotal"); }

    // small boost if invoice keyword appears early
    const top = lines.slice(0, 40).join(" ").toLowerCase();
    if (top.includes("invoice")) { score += 10; reasons.push("invoiceKeyword"); }

    return { score: Math.min(100, score), reasons };
  },
  async parse(input) {
    const { lines } = input;
    const header = extractHeader(lines);
    const totals = findTotals(lines);
    const lineItems = findLineItems(lines);

    const draft = {
      invoiceNumber: header.invoiceNumber,
      invoiceDate: header.invoiceDate,
      poNumber: header.poNumber,
      subtotal: totals.subtotal,
      tax: totals.tax,
      total: totals.total,
    };

    const confidence = Math.max(
      (draft.total != null ? 0.4 : 0),
      (lineItems.length >= 5 ? 0.4 : 0),
      (draft.invoiceNumber ? 0.2 : 0)
    );

    return { draft, lineItems, confidence, evidence: {} };
  }
};
