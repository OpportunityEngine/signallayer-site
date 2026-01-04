const Database = require("better-sqlite3");

function createIntelStore(dbPath = "intel.sqlite") {
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS detections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sourceType TEXT NOT NULL,
      sourceId TEXT NOT NULL,
      rawName TEXT,
      rawAddress TEXT,
      nameNorm TEXT,
      addressNorm TEXT,
      nameTokens TEXT,
      addrTokens TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      aId INTEGER NOT NULL,
      bId INTEGER NOT NULL,
      score INTEGER NOT NULL,
      nameScore INTEGER NOT NULL,
      addrScore INTEGER NOT NULL,
      kind TEXT NOT NULL,
      recommendedActions TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);

  const insertDetectionStmt = db.prepare(`
    INSERT INTO detections
      (sourceType, sourceId, rawName, rawAddress, nameNorm, addressNorm, nameTokens, addrTokens, createdAt)
    VALUES
      (@sourceType, @sourceId, @rawName, @rawAddress, @nameNorm, @addressNorm, @nameTokens, @addrTokens, @createdAt)
  `);

  const listDetectionsStmt = db.prepare(`
    SELECT * FROM detections ORDER BY id DESC LIMIT @limit
  `);

  const insertMatchStmt = db.prepare(`
    INSERT INTO matches
      (aId, bId, score, nameScore, addrScore, kind, recommendedActions, createdAt)
    VALUES
      (@aId, @bId, @score, @nameScore, @addrScore, @kind, @recommendedActions, @createdAt)
  `);

  const listMatchesStmt = db.prepare(`
    SELECT * FROM matches ORDER BY id DESC LIMIT @limit
  `);

  return {
    insertDetection(d) {
      insertDetectionStmt.run({
        ...d,
        createdAt: new Date().toISOString()
      });
    },
    listDetections(limit = 200) {
      return listDetectionsStmt.all({ limit });
    },
    insertMatch(m) {
      insertMatchStmt.run({
        ...m,
        recommendedActions: JSON.stringify(m.recommendedActions || []),
        createdAt: new Date().toISOString()
      });
    },
    listMatches(limit = 200) {
      return listMatchesStmt.all({ limit });
    }
  };
}

module.exports = { createIntelStore };
