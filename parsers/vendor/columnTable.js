const fs = require("fs");
const path = require("path");

function findFile(rootDir, filename) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === filename) return full;
    }
  }
  return null;
}

const root = path.join(__dirname, ".."); // parsers/
const target = findFile(root, "columnTable.js");

if (!target) {
  throw new Error("columnTable.js not found under parsers/");
}

module.exports = require(target);
