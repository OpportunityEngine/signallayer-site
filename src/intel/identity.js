function normalizeName(name) {
  if (!name) return { nameNorm: "", tokens: [] };

  const cleaned = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stop = new Set(["inc","llc","ltd","co","company","corp","corporation","the","and","&","services","service","solutions","group","holdings","holding"]);
  const tokens = cleaned.split(" ").filter(Boolean).filter(t => !stop.has(t));

  return { nameNorm: tokens.join(" "), tokens };
}

function normalizeAddress(addr) {
  if (!addr) return { addressNorm: "", tokens: [] };

  const cleaned = String(addr)
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();

  // tokens for similarity
  const tokens = cleaned
    .replace(/,/g, " ")
    .split(" ")
    .filter(Boolean);

  return { addressNorm: cleaned, tokens };
}

// Jaccard similarity on token sets (0-100)
function jaccardScore(tokensA, tokensB) {
  if (!tokensA?.length || !tokensB?.length) return 0;
  const A = new Set(tokensA);
  const B = new Set(tokensB);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  if (union <= 0) return 0;
  return Math.round((inter / union) * 100);
}

// Dice coefficient for strings (0-100)
function diceScore(a, b) {
  if (!a || !b) return 0;
  const s1 = String(a);
  const s2 = String(b);
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 100 : 0;

  function bigrams(s) {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) || 0) + 1);
    }
    return m;
  }

  const m1 = bigrams(s1);
  const m2 = bigrams(s2);

  let overlap = 0;
  for (const [bg, c1] of m1.entries()) {
    const c2 = m2.get(bg) || 0;
    overlap += Math.min(c1, c2);
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return Math.round((2 * overlap / total) * 100);
}

function scoreIdentity(A, B) {
  const nameScore = Math.max(
    jaccardScore(A.nameTokens, B.nameTokens),
    diceScore(A.nameNorm, B.nameNorm)
  );

  const addrScore = Math.max(
    jaccardScore(A.addrTokens, B.addrTokens),
    diceScore(A.addressNorm, B.addressNorm)
  );

  const score = Math.round(nameScore * 0.65 + addrScore * 0.35);
  return { score, nameScore, addrScore };
}

module.exports = { normalizeName, normalizeAddress, scoreIdentity };
