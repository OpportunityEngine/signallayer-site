// engines/signals/timingCostOptimization.js
// Timing-Based Cost Optimization (universal).
// Uses only invoice history: qty + unit price over time.
// Emits: "buy now vs later saves $X" with conservative confidence.

function isoNow() {
  return new Date().toISOString();
}

function toDateSafe(s) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function median(nums) {
  const arr = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function normalizeSkuOrDesc(line) {
  const sku = (line?.sku || "").trim();
  if (sku) return `SKU:${sku}`;
  const desc = String(line?.raw_description || line?.description || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return desc ? `DESC:${desc}` : "";
}

function extractLineEvents(invoices) {
  const events = [];
  for (const inv of invoices) {
    const issued = inv?.doc?.issued_at || inv?.provenance?.captured_at;
    const dt = toDateSafe(issued);
    if (!dt) continue;

    const currency = inv?.doc?.currency || "USD";
    const lines = Array.isArray(inv?.line_items) ? inv.line_items : [];

    for (const li of lines) {
      const key = normalizeSkuOrDesc(li);
      if (!key) continue;

      const qty = Number(li?.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const unitPrice = li?.unit_price?.amount;
      const price = Number(unitPrice);
      const hasPrice = Number.isFinite(price) && price >= 0;

      events.push({
        key,
        currency,
        date: dt,
        qty,
        unitPrice: hasPrice ? price : null
      });
    }
  }
  return events;
}

function groupByKey(events) {
  const map = new Map();
  for (const e of events) {
    if (!map.has(e.key)) map.set(e.key, []);
    map.get(e.key).push(e);
  }
  for (const [k, arr] of map.entries()) {
    arr.sort((a, b) => a.date.getTime() - b.date.getTime());
    map.set(k, arr);
  }
  return map;
}

function estimateUsageRatePerDay(eventsForKey) {
  const rates = [];
  for (let i = 1; i < eventsForKey.length; i++) {
    const prev = eventsForKey[i - 1];
    const cur = eventsForKey[i];
    const days = Math.max(1, daysBetween(prev.date, cur.date));
    rates.push(cur.qty / days);
  }
  return median(rates);
}

function estimateReorderIntervalDays(eventsForKey) {
  const gaps = [];
  for (let i = 1; i < eventsForKey.length; i++) {
    gaps.push(Math.max(1, daysBetween(eventsForKey[i - 1].date, eventsForKey[i].date)));
  }
  return median(gaps);
}

function priceStats(eventsForKey) {
  const prices = eventsForKey.map((e) => e.unitPrice).filter((p) => Number.isFinite(p));
  if (prices.length < 2) return { low: null, high: null, medianPrice: null };
  const sorted = prices.slice().sort((a, b) => a - b);
  return {
    low: sorted[0],
    high: sorted[sorted.length - 1],
    medianPrice: median(sorted)
  };
}

function latestEvent(eventsForKey) {
  return eventsForKey.length ? eventsForKey[eventsForKey.length - 1] : null;
}

function inferCurrentOnHand(eventsForKey) {
  const last = latestEvent(eventsForKey);
  return last ? last.qty : null;
}

function timingCostOptimizationSignal({ customerNameNormalized, invoices }) {
  const id = "timing_cost_optimization.v1";

  if (!Array.isArray(invoices) || invoices.length < 3) return [];

  const events = extractLineEvents(invoices);
  const grouped = groupByKey(events);

  const out = [];
  const now = new Date();

  for (const [key, evts] of grouped.entries()) {
    if (evts.length < 3) continue;

    const { low, high, medianPrice } = priceStats(evts);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) continue;

    const spreadPct = (high - low) / Math.max(0.0001, low);
    if (spreadPct < 0.12) continue;

    const usagePerDay = estimateUsageRatePerDay(evts);
    const reorderDays = estimateReorderIntervalDays(evts);
    const last = latestEvent(evts);
    if (!last) continue;

    const onHand = inferCurrentOnHand(evts);
    const canForecast = Number.isFinite(usagePerDay) && usagePerDay > 0 && Number.isFinite(onHand);

    let daysOfCover = null;
    if (canForecast) daysOfCover = Math.floor(onHand / usagePerDay);

    const nextReorderDate = canForecast ? new Date(now.getTime() + daysOfCover * 86400000) : null;

    const qtyBasis = Math.max(1, Math.round(last.qty));
    const expectedLaterPrice = Number.isFinite(medianPrice) ? Math.max(medianPrice, low) : high;
    const savings = (expectedLaterPrice - low) * qtyBasis;

    if (!Number.isFinite(savings) || savings < 10) continue;

    const currency = last.currency || "USD";

    out.push({
      signal_id: `${id}:${customerNameNormalized}:${key}`.slice(0, 180),
      type: "savings",
      title: "Potential savings by buying at low price window",
      description: canForecast
        ? `Buying ~${qtyBasis} units now at ~$${low.toFixed(2)} may save ~${currency} $${savings.toFixed(
            0
          )} versus buying near next reorder.`
        : `Buying ~${qtyBasis} units now at ~$${low.toFixed(2)} may save ~${currency} $${savings.toFixed(
            0
          )} versus typical pricing later.`,
      severity: savings > 250 ? "high" : savings > 75 ? "medium" : "low",
      confidence: canForecast ? 0.72 : 0.55,
      impacted_line_ids: [],
      metrics: {
        item_key: key,
        price_low: low,
        price_high: high,
        price_spread_pct: Number(spreadPct.toFixed(2)),
        qty_basis: qtyBasis,
        savings_estimate: Number(savings.toFixed(2)),
        currency,
        last_purchase_date: last.date.toISOString(),
        next_reorder_date: nextReorderDate ? nextReorderDate.toISOString() : null,
        est_days_of_cover: daysOfCover,
        est_reorder_interval_days: reorderDays
      },
      created_at: isoNow()
    });
  }

  return out;
}

timingCostOptimizationSignal.id = "timing_cost_optimization.v1";
module.exports = { timingCostOptimizationSignal };
