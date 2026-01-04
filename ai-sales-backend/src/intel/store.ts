import Database from "better-sqlite3";

export type Detection = {
  id?: string;
  sourceType: "invoice" | "lead" | "customer";
  sourceId: string;

  rawName?: string;
  rawAddress?: string;

  nameNorm?: string;
  addressNorm?: string;

  createdAt?: string;
};

export type MatchResult = {
  id?: string;
  aId: string;
  bId: string;
  score: number;
  nameScore: number;
  addrScore: number;
  kind: "duplicate_account" | "possible_national_account" | "nearby_locations" | "unknown";
  recommendedActions: string[];
  createdAt?: string;
};

export function createIntelStore(dbPath = "intel.sqlite") {
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

  const insertDetection = db.prepare(`
    INSERT INTO detections (sourceType, sourceId, rawName, rawAddress, nameNorm, addressNorm, createdAt)
    VALUES (@sourceType, @sourceId, @rawName, @rawAddress, @nameNorm, @addressNorm, @createdAt)
  `);

  const listDetections = db.prepare(`SELECT * FROM detections ORDER BY id DESC LIMIT @limit`);

  const insertMatch = db.prepare(`
    INSERT INTO matches (aId, bId, score, nameScore, addrScore, kind, recommendedActions, createdAt)
    VALUES (@aId, @bId, @score, @nameScore, @addrScore, @kind, @recommendedActions, @createdAt)
  `);

  const listMatches = db.prepare(`SELECT * FROM matches ORDER BY id DESC LIMIT @limit`);

  return {
    db,
    insertDetection: (d: Detection) => insertDetection.run({ ...d, createdAt: new Date().toISOString() }),
    listDetections: (limit = 200) => listDetections.all({ limit }),
    insertMatch: (m: MatchResult) => insertMatch.run({ ...m, recommendedActions: JSON.stringify(m.recommendedActions), createdAt: new Date().toISOString() }),
    listMatches: (limit = 200) => listMatches.all({ limit })
  };
}
