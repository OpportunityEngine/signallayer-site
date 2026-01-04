const { normalizeText } = require("./lib/normalizeText");

const columnTable = require("./parsers/columnTable");
const wrappedGeneric = require("./parsers/wrappedGeneric");

// IMPORTANT: keep your existing Cintas parser intact; this file just adapts it.
// If you already have a working cintas parser, wire it here.
let cintasAdapter = null;
try {
  cintasAdapter = require("./parsers/cintasAdapter");
} catch (_) {
  // optional; safe
}

function getRegistry() {
  const parsers = [];
  if (cintasAdapter) parsers.push(cintasAdapter);
  parsers.push(columnTable);
  parsers.push(wrappedGeneric);
  return parsers;
}

function sortByScoreDesc(arr) {
  return arr.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * selectAndParse({
 *   rawText,
 *   sourceType, // 'html' | 'pdf' | 'ocr' | etc (optional)
 *   meta        // any extra
 * }, { buildCanonicalInvoiceV1, validate })
 */
async function selectAndParse(input, deps) {
  const { rawText, sourceType, meta } = input;
  const { text, lines } = normalizeText(rawText);

  const base = { rawText, text, lines, sourceType: sourceType || "unknown", meta: meta || {} };

  const registry = getRegistry();
  const scored = registry.map(p => {
    let m = { score: 0, reasons: [] };
    try { m = p.match(base) || m; } catch (e) { m = { score: 0, reasons: [`match_error:${String(e.message || e)}`] }; }
    return { id: p.id, version: p.version, parser: p, ...m };
  });

  const ranked = sortByScoreDesc(scored);

  const attempts = [];
  const topN = ranked.slice(0, 3);

  for (const cand of topN) {
    const p = cand.parser;
    try {
      const out = await p.parse(base);
      const draft = out && out.draft ? out.draft : {};
      const lineItems = out && Array.isArray(out.lineItems) ? out.lineItems : [];

      // build canonical via existing pipeline
      const canonical = deps.buildCanonicalInvoiceV1({ ...draft, lineItems });

      const valid = deps.validate(canonical);
      if (valid && valid.ok) {
        return {
          ok: true,
          canonical,
          selected: { id: p.id, version: p.version, matchScore: cand.score, reasons: cand.reasons },
          attempts: attempts.concat([{
            id: p.id, version: p.version, matchScore: cand.score, reasons: cand.reasons,
            confidence: out.confidence || 0, note: "validated_ok"
          }])
        };
      }

      attempts.push({
        id: p.id,
        version: p.version,
        matchScore: cand.score,
        reasons: cand.reasons,
        confidence: out.confidence || 0,
        note: "validate_failed",
        validate: valid || null,
      });
    } catch (e) {
      attempts.push({
        id: p.id,
        version: p.version,
        matchScore: cand.score,
        reasons: cand.reasons,
        note: "parse_error",
        error: String(e && (e.stack || e.message) || e),
      });
    }
  }

  return {
    ok: false,
    canonical: null,
    selected: ranked[0] ? { id: ranked[0].id, version: ranked[0].version, matchScore: ranked[0].score, reasons: ranked[0].reasons } : null,
    attempts,
    debug: { sourceType: base.sourceType, linesPreview: base.lines.slice(0, 60) }
  };
}

module.exports = { selectAndParse };
