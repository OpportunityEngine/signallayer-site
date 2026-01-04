import { fuzz } from "rapidfuzz";
import * as usaddress from "usaddress";

export type NormalizedIdentity = {
  rawName?: string;
  rawAddress?: string;

  nameNorm?: string;
  nameTokens?: string[];

  addressNorm?: string;
  addressParts?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
};

const STOP_WORDS = new Set([
  "inc", "llc", "ltd", "co", "company", "corp", "corporation", "the", "and", "&",
  "services", "service", "solutions", "group", "holdings", "holding"
]);

export function normalizeName(name?: string): { nameNorm?: string; nameTokens?: string[] } {
  if (!name) return {};
  const cleaned = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .map(t => t.trim())
    .filter(Boolean)
    .filter(t => !STOP_WORDS.has(t));

  return {
    nameNorm: tokens.join(" "),
    nameTokens: tokens
  };
}

export function normalizeAddress(addr?: string): { addressNorm?: string; addressParts?: NormalizedIdentity["addressParts"] } {
  if (!addr) return {};
  const cleaned = addr
    .replace(/\s+/g, " ")
    .trim();

  try {
    const parsed: any = usaddress.parse(cleaned);
    const parts: any = {};
    for (const p of parsed) {
      const k = p.type;
      parts[k] = parts[k] ? `${parts[k]} ${p.value}` : p.value;
    }

    const street = [parts.AddressNumber, parts.StreetNamePreType, parts.StreetName, parts.StreetNamePostType, parts.OccupancyType, parts.OccupancyIdentifier]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const city = (parts.PlaceName || "").trim();
    const state = (parts.StateName || "").trim();
    const zip = (parts.ZipCode || "").trim();

    const norm = [street, city, state, zip]
      .filter(Boolean)
      .join(", ")
      .toLowerCase();

    return {
      addressNorm: norm || cleaned.toLowerCase(),
      addressParts: { street: street || undefined, city: city || undefined, state: state || undefined, zip: zip || undefined }
    };
  } catch {
    return {
      addressNorm: cleaned.toLowerCase()
    };
  }
}

export function scoreName(a?: string, b?: string): number {
  if (!a || !b) return 0;
  return fuzz.token_set_ratio(a, b); // 0-100
}

export function scoreAddress(a?: string, b?: string): number {
  if (!a || !b) return 0;
  return fuzz.token_set_ratio(a, b); // 0-100
}

export function scoreIdentity(a: NormalizedIdentity, b: NormalizedIdentity): { score: number; nameScore: number; addrScore: number } {
  const nameScore = scoreName(a.nameNorm, b.nameNorm);
  const addrScore = scoreAddress(a.addressNorm, b.addressNorm);

  // Weighted: name matters more unless address is very strong
  const score = Math.round(nameScore * 0.65 + addrScore * 0.35);
  return { score, nameScore, addrScore };
}
