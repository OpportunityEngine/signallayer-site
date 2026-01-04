// Adapt your existing Cintas parser output into { draft, lineItems }.
// Replace the require path + mapping to match your codebase.

const existingCintas = require("../../canonical/parsers/cintasParser"); 
// ^ CHANGE THIS PATH to your real existing parser module

module.exports = {
  id: "cintas-adapter",
  version: "1.0.0",
  match(input) {
    const top = input.lines.slice(0, 80).join(" ").toLowerCase();
    let score = 0;
    const reasons = [];
    if (top.includes("cintas")) { score += 80; reasons.push("cintasKeyword"); }
    if (top.includes("odor") || top.includes("hygiene") || top.includes("restroom")) { score += 15; reasons.push("cintasProductLexicon"); }
    return { score: Math.min(100, score), reasons };
  },
  async parse(input) {
    // EXPECTED: your existing parser should accept text/lines and return something.
    // Modify mapping as needed.
    const out = await existingCintas.parseFromText(input.text);

    // Minimal mapping example:
    const draft = {
      invoiceNumber: out.invoiceNumber,
      invoiceDate: out.invoiceDate,
      subtotal: out.subtotal,
      tax: out.tax,
      total: out.total,
      poNumber: out.poNumber,
    };

    const lineItems = (out.lineItems || []).map(li => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
      sku: li.sku,
      uom: li.uom,
    }));

    return { draft, lineItems, confidence: 0.9, evidence: out.evidence || {} };
  }
};
