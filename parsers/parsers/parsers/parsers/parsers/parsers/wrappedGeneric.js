const { findTotals, ANCHORS, firstMatch } = require("../lib/anchors");
const { findLineEndMoney } = require("../lib/money");

function extractHeader(lines) {
  const inv = firstMatch(lines, ANCHORS.invoiceNo, 120);
  const dt = firstMatch(lines, ANCHORS.date, 120);
  const po = firstMatch(lines, ANCHORS.poNo, 160);

  return {
    invoiceNumber: inv ? (inv.match[2] || inv.match[1]) : undefined,
    invoiceDate: dt ? dt.match[2] : undefined,
    poNumber: po ? (po.match[2] || po.match[1]) : undefined,
  };
}

function findWrappedItems(lines) {
  // “amount-at-end” lines become item starters; preceding non-amount lines are appended as description
  const items = [];
  let pendingDesc = [];

  const stopWords = ["subtotal", "tax", "total", "amount due", "balance due"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const low = line.toLowerCase();

    if (!line) continue;

    if (stopWords.some(s => low.includes(s))) {
      pendingDesc = [];
      continue;
    }

    const m = findLineEndMoney(line);

    if (!m) {
      // keep some context lines as possible continuation
      if (line.length >= 4 && pendingDesc.length < 3) pendingDesc.push(line);
      continue;
    }

    // item line
    const toks = line.trim().split(" ");
    const descMain = toks.slice(0, toks.length - 1).join(" ").trim();
    const desc = [...pendingDesc, descMain].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    pendingDesc = [];

    // qty guess: first numeric token (not money)
    let qty = undefined;
    for (let k = 0; k < Math.min(toks.length, 6); k++) {
      const t = toks[k].replace(/[,]/g, "");
      if (/^\d+(\.\d+)?$/.test(t)) { qty = Number(t); break; }
    }

    items.push({
      description: desc || descMain || line,
      quantity: qty,
      lineTotal: m.value,
    });
  }

  return items.slice(0, 400);
}

module.exports = {
  id: "wrappedGeneric-v1",
  version: "1.0.0",
  match(input) {
    const { lines } = input;

    let score = 0;
    const reasons = [];

    // many lines end with money => good fit
    let moneyEndCount = 0;
    const scan = lines.slice(0, Math.min(lines.length, 260));
    for (const l of scan) if (findLineEndMoney(l)) moneyEndCount++;

    if (moneyEndCount >= 10) { score += 55; reasons.push(`moneyEndCount:${moneyEndCount}`); }
    else if (moneyEndCount >= 5) { score += 35; reasons.push(`moneyEndCount:${moneyEndCount}`); }

    const totals = findTotals(lines);
    if (totals.total !== null && totals.total !== undefined) { score += 25; reasons.push("hasTotal"); }

    const top = lines.slice(0, 60).join(" ").toLowerCase();
    if (top.includes("invoice")) { score += 10; reasons.push("invoiceKeyword"); }

    return { score: Math.min(100, score), reasons };
  },
  async parse(input) {
    const { lines } = input;

    const header = extractHeader(lines);
    const totals = findTotals(lines);
    const lineItems = findWrappedItems(lines);

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
      (lineItems.length >= 6 ? 0.4 : 0),
      (draft.invoiceNumber ? 0.2 : 0)
    );

    return { draft, lineItems, confidence, evidence: {} };
  }
};
