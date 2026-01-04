import { createIntelStore } from "./store";
import { normalizeAddress, normalizeName, scoreIdentity, NormalizedIdentity } from "./identity";

export function createIntelEngine(dbPath?: string) {
  const store = createIntelStore(dbPath);

  function addDetection(args: { sourceType: "invoice" | "lead" | "customer"; sourceId: string; rawName?: string; rawAddress?: string; }) {
    const n = normalizeName(args.rawName);
    const a = normalizeAddress(args.rawAddress);

    store.insertDetection({
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      rawName: args.rawName,
      rawAddress: args.rawAddress,
      nameNorm: n.nameNorm,
      addressNorm: a.addressNorm
    });
  }

  function recomputeMatches(limitScan = 500) {
    const rows = store.listDetections(limitScan).reverse(); // older -> newer
    const results: any[] = [];

    // naive O(n^2) is fine up to a few thousand; later we index
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const A: NormalizedIdentity = { nameNorm: rows[i].nameNorm, addressNorm: rows[i].addressNorm };
        const B: NormalizedIdentity = { nameNorm: rows[j].nameNorm, addressNorm: rows[j].addressNorm };

        const { score, nameScore, addrScore } = scoreIdentity(A, B);

        if (score < 80) continue;

        let kind: "duplicate_account" | "possible_national_account" | "nearby_locations" | "unknown" = "unknown";
        const actions: string[] = [];

        if (nameScore >= 92 && addrScore >= 88) {
          kind = "duplicate_account";
          actions.push("MERGE_ACCOUNTS_REVIEW");
          actions.push("DEDUP_CONTACTS_REVIEW");
        } else if (nameScore >= 90 && addrScore < 70) {
          kind = "possible_national_account";
          actions.push("FLAG_NATIONAL_ACCOUNT_REVIEW");
          actions.push("CHECK_MLA_CONTRACT_PATH");
        } else if (nameScore < 90 && addrScore >= 92) {
          kind = "nearby_locations";
          actions.push("FLAG_SAME_LOCATION_DIFFERENT_NAME");
          actions.push("CHECK_PARENT_CHILD_RELATIONSHIP");
        }

        results.push({ aId: rows[i].id, bId: rows[j].id, score, nameScore, addrScore, kind, recommendedActions: actions });

        // Persist immediately
        store.insertMatch({ aId: rows[i].id, bId: rows[j].id, score, nameScore, addrScore, kind, recommendedActions: actions });
      }
    }

    return { scanned: rows.length, matchesCreated: results.length };
  }

  function listMatches(limit = 200) {
    const rows: any[] = store.listMatches(limit);
    return rows.map(r => ({
      ...r,
      recommendedActions: safeJson(r.recommendedActions)
    }));
  }

  function listDetections(limit = 200) {
    return store.listDetections(limit);
  }

  return {
    addDetection,
    recomputeMatches,
    listMatches,
    listDetections
  };
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return []; }
}
