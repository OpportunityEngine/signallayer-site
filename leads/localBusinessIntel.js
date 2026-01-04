// localBusinessIntel.js
// Distinguishes between national account HQ and local facility contacts

/**
 * Determine if an address/phone is likely a headquarters vs. local facility
 *
 * HQ indicators:
 * - Address contains "corporate", "headquarters", "HQ", "main office"
 * - Phone is 1-800 or toll-free
 * - City is a major metro (NYC, Chicago, etc.) for manufacturing companies
 * - Title includes "Chief", "VP", "Corporate"
 *
 * Local indicators:
 * - Address contains "plant", "facility", "site", "branch", "location"
 * - ZIP matches invoice ship-to ZIP
 * - City/state match invoice
 * - Title includes "Site", "Plant", "Facility", "Local"
 */
function classifyLocation(contact, invoiceAddress) {
  const score = {
    hq: 0,
    local: 0,
    confidence: 0
  };

  // Check address text
  const addrText = [
    contact.address || "",
    contact.city || "",
    contact.state || "",
    contact.title || "",
    contact.department || ""
  ].join(" ").toLowerCase();

  // HQ indicators (+1 each)
  if (addrText.includes("headquarters") || addrText.includes(" hq ")) score.hq += 2;
  if (addrText.includes("corporate")) score.hq += 2;
  if (addrText.includes("main office")) score.hq += 1;
  if (contact.title && /chief|ceo|cfo|coo|president|vp|vice president/i.test(contact.title)) score.hq += 2;

  // Local indicators (+1 each)
  if (addrText.includes("plant")) score.local += 2;
  if (addrText.includes("facility")) score.local += 2;
  if (addrText.includes("site")) score.local += 1;
  if (addrText.includes("branch")) score.local += 1;
  if (addrText.includes("location #") || addrText.includes("store #")) score.local += 1;
  if (contact.title && /site manager|plant manager|facility manager|local/i.test(contact.title)) score.local += 2;

  // ZIP match (strongest signal)
  if (invoiceAddress && invoiceAddress.postalCode && contact.postalCode) {
    const invoiceZip = String(invoiceAddress.postalCode).replace(/\s+/g, "").substring(0, 5);
    const contactZip = String(contact.postalCode).replace(/\s+/g, "").substring(0, 5);

    if (invoiceZip === contactZip) {
      score.local += 5; // Very strong local indicator
      score.confidence = 0.95;
    } else if (invoiceZip.substring(0, 3) === contactZip.substring(0, 3)) {
      score.local += 2; // Same ZIP prefix (nearby area)
      score.confidence = 0.7;
    }
  }

  // City/State match
  if (invoiceAddress && invoiceAddress.city && contact.city) {
    if (invoiceAddress.city.toLowerCase() === contact.city.toLowerCase()) {
      score.local += 3;
      score.confidence = Math.max(score.confidence, 0.8);
    }
  }

  // Phone number analysis
  const phone = contact.corpPhone || contact.directPhone || "";
  if (phone) {
    // Toll-free = likely HQ
    if (/^1?[-.\s]?8(00|44|55|66|77|88)[-.\\s]?\d{3}[-.\\s]?\d{4}/.test(phone)) {
      score.hq += 3;
    }
    // Local area code match
    if (invoiceAddress && invoiceAddress.postalCode) {
      // This is simplified - in production you'd have a ZIP->area code lookup table
      // For now, just note that different area code suggests different location
    }
  }

  // Determine classification
  let classification = "unknown";
  if (score.local > score.hq && score.local >= 3) {
    classification = "local";
    score.confidence = Math.max(score.confidence, 0.7);
  } else if (score.hq > score.local && score.hq >= 3) {
    classification = "hq";
    score.confidence = Math.max(score.confidence, 0.6);
  } else {
    score.confidence = Math.max(score.confidence, 0.3);
  }

  return {
    classification,
    confidence: score.confidence,
    hqScore: score.hq,
    localScore: score.local,
    reason: score.local > score.hq
      ? `Local facility (score: ${score.local} vs ${score.hq})`
      : score.hq > score.local
      ? `Headquarters (score: ${score.hq} vs ${score.local})`
      : "Uncertain"
  };
}

/**
 * Filter and rank contacts, preferring local facility contacts over HQ
 */
function prioritizeLocalContacts(contacts, invoiceAddress) {
  const classified = contacts.map(contact => ({
    ...contact,
    location: classifyLocation(contact, invoiceAddress)
  }));

  // Sort: Local > Unknown > HQ
  const sorted = classified.sort((a, b) => {
    // First priority: Local contacts
    if (a.location.classification === "local" && b.location.classification !== "local") return -1;
    if (b.location.classification === "local" && a.location.classification !== "local") return 1;

    // Second priority: Unknown over HQ
    if (a.location.classification === "unknown" && b.location.classification === "hq") return -1;
    if (b.location.classification === "unknown" && a.location.classification === "hq") return 1;

    // Third priority: Confidence score
    return b.location.confidence - a.location.confidence;
  });

  return sorted;
}

/**
 * Enhance contact with local vs HQ metadata
 */
function enhanceContactWithLocationData(contact, invoiceAddress) {
  const location = classifyLocation(contact, invoiceAddress);

  return {
    ...contact,
    locationClassification: location.classification,
    locationConfidence: location.confidence,
    isLocalFacility: location.classification === "local",
    isHeadquarters: location.classification === "hq",
    locationReason: location.reason
  };
}

module.exports = {
  classifyLocation,
  prioritizeLocalContacts,
  enhanceContactWithLocationData
};
