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

  for (const raw of lines) {
    const line = (raw || "").replace(/\s+/g, " ").trim();
    if (!line) continue;

    if (/^(Total|Subtotal|Balance|Amount Due|Payments?)\b/i.test(line)) continue;

    const m = line.match(/^(.+?)\s+\$?([0-9,]+\.[0-9]{2})\s*$/);
    if (!m) continue;

    const desc = m[1].trim();
    const amt = moneyToNumber(m[2]);
    if (!desc || amt == null) continue;

    lineItems.push({ sku: "", description: desc, quantity: 1, unitPrice: amt });
  }

  return { lineItems };
}

module.exports = { id: "statement-line-loose-v1", version: "1.0.0", match, parse };
