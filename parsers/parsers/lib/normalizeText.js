function normalizeText(raw) {
  if (!raw) return { text: "", lines: [] };

  const text = String(raw)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = text.split("\n").map(l => l.replace(/[ \t]+/g, " ").trimEnd());
  return { text, lines };
}

module.exports = { normalizeText };
