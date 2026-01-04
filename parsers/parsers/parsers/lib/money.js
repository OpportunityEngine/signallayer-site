function parseMoneyToken(tok) {
  if (!tok) return null;
  let s = String(tok).trim();

  // common noise
  s = s.replace(/[,$]/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/CR$/i, ""); // e.g., 12.34CR

  // parentheses negative
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  }

  // must be number-ish
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;

  const val = Number(s);
  if (!Number.isFinite(val)) return null;
  return neg ? -val : val;
}

function findLineEndMoney(line) {
  if (!line) return null;
  const parts = String(line).trim().split(" ");
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = parseMoneyToken(parts[i]);
    if (m !== null) return { value: m, token: parts[i], idxFromEnd: parts.length - 1 - i };
  }
  return null;
}

module.exports = { parseMoneyToken, findLineEndMoney };
