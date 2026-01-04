const ANCHORS = {
  invoiceNo: [/invoice\s*(no|#)\s*[:#]?\s*([A-Z0-9\-]+)/i, /\binv\s*#\s*[:#]?\s*([A-Z0-9\-]+)/i],
  poNo: [/\bpo\s*(no|#)?\s*[:#]?\s*([A-Z0-9\-]+)/i],
  date: [/\b(date|invoice date)\b\s*[:#]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i],
  total: [/\btotal\b/i],
  subtotal: [/\bsub\s*total\b/i, /\bsubtotal\b/i],
  tax: [/\btax\b/i, /\bsales tax\b/i],
};

function firstMatch(lines, regexes, maxLines = 80) {
  const n = Math.min(lines.length, maxLines);
  for (let i = 0; i < n; i++) {
    const line = lines[i];
    for (const rx of regexes) {
      const m = line.match(rx);
      if (m) return { lineIdx: i, line, match: m };
    }
  }
  return null;
}

function findTotals(lines) {
  // look in bottom area
  const start = Math.max(0, lines.length - 80);
  const slice = lines.slice(start);

  let subtotal = null, tax = null, total = null;

  for (let i = 0; i < slice.length; i++) {
    const line = slice[i];
    const lower = line.toLowerCase();
    const endMoney = require("./money").findLineEndMoney(line);

    if (!endMoney) continue;

    if (!subtotal && (ANCHORS.subtotal.some(rx => rx.test(lower)))) subtotal = endMoney.value;
    if (!tax && (ANCHORS.tax.some(rx => rx.test(lower)))) tax = endMoney.value;

    // total last: avoid "total tax" confusion by requiring " total" word and not "subtotal"
    if (!total && /\btotal\b/i.test(lower) && !/\bsub\s*total\b/i.test(lower) && !/\bsubtotal\b/i.test(lower)) {
      total = endMoney.value;
    }
  }

  return { subtotal, tax, total };
}

module.exports = { ANCHORS, firstMatch, findTotals };
