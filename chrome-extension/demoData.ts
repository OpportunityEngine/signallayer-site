export const demoMetrics = {
  revenueLeakage: 12450,
  missedOpportunities: 18,
  duplicateVendors: 6,
  suspectedMlaAccounts: 4,
  ocrFallbackRate: 0.12,
  parsingSuccessRate: 0.88,
};

export const demoFlaggedIssues = [
  {
    id: "iss_demo_001",
    severity: "high",
    title: "Missed opportunity: billed qty lower than contract baseline",
    accountName: "Blue Harbor Hospitality Group",
    location: "St. Louis, MO",
    impact: 2480,
    category: "Missed Opportunity",
    proof: {
      summary: "Historical average shows 2.4x higher service volume than last invoice.",
      evidence: [
        "Invoice line items show reduced weekly service count",
        "Prior 90 days trend indicates stable demand",
      ],
    },
  },
  {
    id: "iss_demo_002",
    severity: "medium",
    title: "Possible duplicate vendor: similar name + nearby address",
    accountName: "Midwest Event Center",
    location: "Chesterfield, MO",
    impact: 760,
    category: "Duplicate / Merge",
    proof: {
      summary: "Two vendor names differ by punctuation; addresses within 0.2 miles.",
      evidence: ["Vendor name similarity score: 0.94", "Address proximity: 0.2 miles"],
    },
  },
  {
    id: "iss_demo_003",
    severity: "low",
    title: "OCR fallback used: confirm totals match",
    accountName: "Riverside Taproom",
    location: "St. Charles, MO",
    impact: 0,
    category: "OCR Review",
    proof: {
      summary: "Document format required OCR; extracted totals should be verified.",
      evidence: ["OCR confidence 0.86", "Totals reconciled within tolerance"],
    },
  },
];
