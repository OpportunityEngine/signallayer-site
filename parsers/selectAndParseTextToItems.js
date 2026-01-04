const { normalizeText } = require("./lib/normalizeText");

const receiptPresto = require("./registry/receiptPresto");
const columnInvoiceLoose = require("./registry/columnInvoiceLoose");
const statementLineLoose = require("./registry/statementLineLoose");

function toPayloadItems(lineItems) {
  return (lineItems || [])
    .map((li) => {
      const desc = (li.description || "").toString().trim();
      const qty = Number(li.quantity);
      const unit = Number(li.unitPrice);

      if (!desc) return null;
      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(unit) || unit < 0) return null;

      return {
        sku: li.sku ? String(li.sku) : "",
        description: desc,
        quantity: String(qty),
        unitPrice: String(unit)
      };
    })
    .filter(Boolean);
}

async function selectAndParseTextToItems({ text }) {
  const norm = normalizeText(text);
  const input = { text: norm.text, lines: norm.lines, sourceType: "pdf", meta: {} };

  const registry = [receiptPresto, columnInvoiceLoose, statementLineLoose];

  const ranked = registry
    .map((p) => {
      let m = { score: 0, reasons: [] };
      try { m = p.match(input) || m; } catch (e) { m = { score: 0, reasons: [`match_error:${String(e.message || e)}`] }; }
      return { p, id: p.id, version: p.version, score: m.score || 0, reasons: m.reasons || [] };
    })
    .sort((a, b) => b.score - a.score);

  const attempts = [];

  for (const cand of ranked) {
    try {
      const out = await cand.p.parse(input);
      const items = toPayloadItems(out?.lineItems || []);
      if (items.length >= 1) {
        return {
          ok: true,
          items,
          parserUsed: cand.id,
          summary: { ok: true, selected: { id: cand.id, score: cand.score, reasons: cand.reasons }, attempts }
        };
      }
      attempts.push({ id: cand.id, score: cand.score, reasons: cand.reasons, note: "too_few_items", count: items.length });
    } catch (e) {
      attempts.push({ id: cand.id, score: cand.score, reasons: cand.reasons, note: "parse_error", error: String(e && (e.stack || e.message) || e) });
    }
  }

  return { ok: false, items: [], parserUsed: "none", summary: { ok: false, attempts } };
}

module.exports = { selectAndParseTextToItems };
