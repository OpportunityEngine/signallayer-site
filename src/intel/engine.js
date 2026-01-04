const { createIntelStore } = require("./store");
const { normalizeName, normalizeAddress, scoreIdentity } = require("./identity");

function createIntelEngine(dbPath) {
  const store = createIntelStore(dbPath);

  function addDetection({ sourceType, sourceId, rawName, rawAddress }) {
    const n = normalizeName(rawName);
    const a = normalizeAddress(rawAddress);

    store.insertDetection({
      sourceType: String(sourceType || "unknown"),
      sourceId: String(sourceId || ""),
      rawName: rawName || "",
      rawAddress: rawAddress || "",
      nameNorm: n.nameNorm || "",
      addressNorm: a.addressNorm || "",
      nameTokens: JSON.stringify(n.tokens || []),
      addrTokens: JSON.stringify(a.tokens || [])
    });
  }

  function recomputeMatches(limitScan = 500) {
    const rows = store.listDetections(limitScan).reverse();
    let matchesCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const A = {
          nameNorm: rows[i].nameNorm,
          nameTokens: safeJson(rows[i].nameTokens),
          addressNorm: rows[i].addressNorm,
          addrTokens: safeJson(rows[i].addrTokens)
        };

        const B = {
          nameNorm: rows[j].nameNorm,
          nameTokens: safeJson(rows[j].nameTokens),
          addressNorm: rows[j].addressNorm,
          addrTokens: safeJson(rows[j].addrTokens)
        };

        const { score, nameScore, addrScore } = scoreIdentity(A, B);
        if (score < 80) continue;

        let kind = "unknown";
        const actions = [];

        if (nameScore >= 92 && addrScore >= 88) {
          kind = "duplicate_account";
          actions.push("MERGE_ACCOUNTS_REVIEW", "DEDUP_CONTACTS_REVIEW");
        } else if (nameScore >= 90 && addrScore < 70) {
          kind = "possible_national_account";
          actions.push("FLAG_NATIONAL_ACCOUNT_REVIEW", "CHECK_MLA_CONTRACT_PATH");
        } else if (nameScore < 90 && addrScore >= 92) {
          kind = "nearby_locations";
          actions.push("FLAG_SAME_LOCATION_DIFFERENT_NAME", "CHECK_PARENT_CHILD_RELATIONSHIP");
        }

        store.insertMatch({
          aId: rows[i].id,
          bId: rows[j].id,
          score,
          nameScore,
          addrScore,
          kind,
          recommendedActions: actions
        });

        matchesCreated += 1;
      }
    }

    return { scanned: rows.length, matchesCreated };
  }

  function listMatches(limit = 200) {
    const rows = store.listMatches(limit);
    return rows.map(r => ({
      ...r,
      recommendedActions: safeJson(r.recommendedActions)
    }));
  }

  function listDetections(limit = 200) {
    return store.listDetections(limit);
  }

  return { addDetection, recomputeMatches, listMatches, listDetections };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return []; }
}

module.exports = { createIntelEngine };
