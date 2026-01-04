cat > parsers/registry/receiptPresto.js <<'JS'
function match(input) {
  const t = (input?.text || "");
  let score = 0;
  const reasons = [];

  if (/Your Receipt/i.test(t)) { score += 0.35; reasons.push("your_receipt"); }
  if (/Item\s*Price\s*Qty\s*Line\s*Total/i.test(t)) { score += 0.45; reasons.push("item_price_qty_total_header"); }
  if (/presto\.com/i.test(t)) { score += 0.15; reasons.push("presto"); }
  if (/Chili'?s/i.test(t)) { score += 0.05; reasons.push("chilis"); }

  return { score, reasons };
}

/**
 * Parses lines like:
 *   CHIPS & DIPS$5.691$5.69
 *   MODELO ESP L$7.591$7.59
 *   TRIPLE DIPPER$14.691$14.69
 * Ignores indented modifier lines.
 */
function parse(input) {
  const lines = input?.lines || [];
  const lineItems = [];

  // start after header if present
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/Item\s*Price\s*Qty\s*Line\s*Total/i.test(lines[i] || "")) { start = i + 1; break; }
  }

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] || "";
    const line = raw.trimEnd();

    if (!line) continue;
    if (/^(Payment|Subtotal|Tax|Tip|Total)\b/i.test(line)) break;

    // ignore modifiers/indented lines
    if (/^\s{2,}/.test(raw)) continue;

    // DESC $UNIT QTY? $LINE
    const m = line.match(/^(.+?)\s*\$([0-9]+\.[0-9]{2})\s*([0-9]+)?\s*\$([0-9]+\.[0-9]{2})\s*$/);
    if (m) {
      const desc = m[1].trim();
      const unit = Number(m[2]);
      const qty = m[3] ? Number(m[3]) : 1;

      if (desc && Number.isFinite(unit) && Number.isFinite(qty) && qty > 0) {
        lineItems.push({
          sku: "",
          description: desc,
          quantity: qty,
          unitPrice: unit
        });
      }
      continue;
    }

    // fallback: DESC $TOTAL
    const m2 = line.match(/^(.+?)\s*\$([0-9]+\.[0-9]{2})\s*$/);
    if (m2) {
      const desc = m2[1].trim();
      const total = Number(m2[2]);
      if (desc && Number.isFinite(total)) {
        lineItems.push({ sku: "", description: desc, quantity: 1, unitPrice: total });
      }
    }
  }

  return { lineItems };
}

module.exports = { id: "receipt-presto-v1", version: "1.0.0", match, parse };
JS
