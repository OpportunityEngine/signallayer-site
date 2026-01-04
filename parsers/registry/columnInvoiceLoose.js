function match(input) {
  const t = input?.text || "";
  let score = 0;
  const reasons = [];

  if (/\b(Qty|Quantity)\b/i.test(t) && /\b(Unit|Unit Price|Price)\b/i.test(t)) {
    score += 0.45; reasons.push("qty_unit_headers");
  }
  if (/\b(Amount|Line Total|Total)\b/i.test(t)) { score += 0.15; reasons.push("amount_header"); }
  if (/\bInvoice\b/i.test(t)) { score += 0.10; reasons.push("invoice_word"); }

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

    if (/^(Subtotal|Tax|Total|Balance|Payment|Amount Due)\b/i.test(line)) continue;

    // DESC  QTY  $UNIT  $TOTAL
    let m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+\$?([0-9,]+\.[0-9]{2})\s+\$?([0-9,]+\.[0-9]{2})\s*$/);
    if (m) {
      const desc = m[1].trim();
      const qty = Number(m[2]);
      const unit = moneyToNumber(m[3]);
      if (desc && Number.isFinite(qty) && qty > 0 && unit != null) {
        lineItems.push({ sku: "", description: desc, quantity: qty, unitPrice: unit });
      }
      continue;
    }

    // SKU DESC  QTY  $UNIT  $TOTAL
    m = line.match(/^([A-Z0-9\-]{3,})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+\$?([0-9,]+\.[0-9]{2})\s+\$?([0-9,]+\.[0-9]{2})\s*$/);
    if (m) {
      const sku = m[1];
      const desc = m[2].trim();
      const qty = Number(m[3]);
      const unit = moneyToNumber(m[4]);
      if (desc && Number.isFinite(qty) && qty > 0 && unit != null) {
        lineItems.push({ sku, description: desc, quantity: qty, unitPrice: unit });
      }
      continue;
    }
  }

  return { lineItems };
}

module.exports = { id: "column-invoice-loose-v1", version: "1.0.0", match, parse };
