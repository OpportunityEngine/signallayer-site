const { normalizeText } = require("./lib/normalizeText");

// these are the two general parsers we already added
const columnTable = require("./parsers/columnTable");
const wrappedGeneric = require("./parsers/wrappedGeneric");

function lineItemsToPayloadItems(lineItems) {
  return (lineItems || []).map((li) => ({
    sku: li.sku || "",
    description: li.description || li.raw_description || "",
    quantity: li.quantity == null ? "" : String(li.quantity),
    unitPrice:
      li.unitPrice == null
        ? (li.unit_price == null ? "" : String(li.unit_price))
        : String(li.unitPrice)
  }));
}

async function selectAndParseTextToItems({ text }) {
  const norm = normalizeText(text);
  const input = { text: norm.text, lines: norm.lines, sourceType: "pdf", meta: {} };

  const registry = [columnTable, wrappedGeneric];

  const ranked = registry
    .map((p) => {
      let m = { score: 0, reasons: [] };
      try { m = p.match(input) || m; } catch (e) { m = { score: 0, reasons: [`match_error:${String(e.message || e)}`] }; }
      return { p, id: p.id, version: p.version, score: m.score || 0, reasons: m.reasons || [] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const attempts = [];

  for (const cand of ranked) {
    try {
      const out = await cand.p.parse(input);
      const items = lineItemsToPayloadItems(out?.lineItems || []);

      if (items.length >= 3) {
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
