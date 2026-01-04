cat > parsers/registry/statementLineLoose.js <<'JS'
function match(input) {
  const t = input?.text || "";
  let score = 0;
  const reasons = [];

  if (/\bStatement\b/i.test(t) || /\bAccount Summary\b/i.test(t)) { score += 0.30; reasons.push("statement_words"); }
  if (/\bBalance\b/i.test(t) && /\bPayment\b/i.test(t)) { score += 0.20; reasons.push("balance_payment"); }
  if (/\bCharges?\b/i.test(t) || /\bService\b/i.test(t)) { score += 0.10; reasons.push("charges_service"); }

  return { score, reasons };
}

function moneyToNumber(s) {
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parse(input) {
  const lines = input?.lines || [];
  const lineItems = [];

  // capture lines like: "Service Fee $12.34" or "Fuel Surcharge 45.00"
  for (const raw of lines) {
    const line = (raw || "").replace(/\s+/g, " ").trim();
    if (!line) continue;

    // ignore totals
    if (/^(Total|Subtotal|Balance|Amount Due|Payments?)\b/i.test(line)) continue;

    const m = line.match(/^(.+?)\s+\$?([0-9,]+\.[0-9]{2})\s*$/);
    if (!m) continue;

    const desc = m[1].trim();
    const amt = moneyToNumber(m[2]);
    if (!desc || amt == null) continue;

    // treat as qty 1 line with unitPrice=amount
    lineItems.push({ sku: "", description: desc, quantity: 1, unitPrice: amt });
  }
  // Quality gate: if we captured a lot of lines but most are tiny labels, drop.
  // Keep for now if at least 3 items, and at least 1 description looks "real".
  const realish = lineItems.filter((x) => (x.description || "").length >= 8).length;
  if (lineItems.length >= 20 && realish < 5) return { lineItems: [] };

  return { lineItems };
}

module.exports = { id: "statement-line-loose-v1", version: "1.0.0", match, parse };
JS
