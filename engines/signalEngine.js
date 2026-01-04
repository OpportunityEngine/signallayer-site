// engines/signalEngine.js
// Universal signal engine runner (plug-in detectors).

const { timingCostOptimizationSignal } = require("./signals/timingCostOptimization");

const SIGNALS = [
  timingCostOptimizationSignal
  // Later: priceDriftSignal, vendorFragmentationSignal, packSizeInefficiencySignal, etc.
];

function runSignals({ customerNameNormalized, invoices }) {
  const signals = [];
  const warnings = [];

  for (const detector of SIGNALS) {
    try {
      const out = detector({ customerNameNormalized, invoices });
      if (Array.isArray(out) && out.length) signals.push(...out);
    } catch (e) {
      warnings.push(`Signal ${detector.id || "unknown"} failed: ${String(e)}`);
    }
  }

  return { signals, warnings };
}

module.exports = { runSignals };
