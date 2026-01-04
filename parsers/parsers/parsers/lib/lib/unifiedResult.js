// lib/unifiedResult.js

function truncate(str, n) {
  const s = String(str ?? "");
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

function makeUnifiedResult({
  run_id,
  source_type,
  version,
  parser_debug,
  extracted,
  canonical,
  validation,
  opportunity,
  artifacts,
  error,
}) {
  // status rules:
  // - canonical_valid: canonical exists + validation.valid === true
  // - extracted_only: extracted.items has >=1 but canonical invalid OR not attempted
  // - no_items: extracted.items empty (or absent) AND no canonical
  // - parse_error: hard error occurred
  let status = "no_items";

  if (error) status = "parse_error";
  else if (validation?.valid === true && canonical) status = "canonical_valid";
  else if ((extracted?.items?.length ?? 0) > 0) status = "extracted_only";
  else status = "no_items";

  const rawText = extracted?.raw_text ?? "";
  const rawPreview = truncate(rawText, 2000);

  return {
    run_id,
    source_type,
    version,
    status,

    canonical: status === "canonical_valid" ? canonical : null,

    extracted: {
      items: extracted?.items ?? [],
      tableHtml: extracted?.tableHtml ?? [],
      raw_text_length: rawText.length,
      raw_text_preview: rawPreview,
      meta: extracted?.meta ?? {},
    },

    validation: validation ?? { attempted: false, valid: false, errors: [] },

    opportunity: opportunity ?? { ran: false, reason: "canonical_not_valid" },

    debug: {
      parserUsed: parser_debug?.parserUsed ?? null,
      parsedItemsCount: parser_debug?.parsedItemsCount ?? 0,
      usedOcr: parser_debug?.usedOcr ?? false,
      textLength: parser_debug?.textLength ?? 0,
      version: parser_debug?.version ?? version ?? null,
      // Optional expansions for later
      parserCandidates: parser_debug?.parserCandidates ?? [],
      ocrDecision: parser_debug?.ocrDecision ?? null,
    },

    artifacts: artifacts ?? {},

    error: error
      ? {
          message: error.message ?? String(error),
          stack: error.stack ?? null,
        }
      : null,
  };
}

module.exports = { makeUnifiedResult };
