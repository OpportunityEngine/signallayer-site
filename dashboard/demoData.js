// Demo data used until you wire real invoice/issue generation.
// Matches the shapes expected by the VP dashboard frontend.

const metrics = {
  totalPotentialOverbillingCents: 1842000,
  vendorsImpactedCount: 3,
  invoicesAnalyzedCount: 1284,
  locationsCount: 42,
  flaggedIssuesCount: 67,
  avgMonthlyImpactCents: 614000,
};

const vendorRows = [
  { id: "v1", name: "Vendor A (Uniform & Facility)", amountCents: 782000, issuesCount: 21, invoicesCount: 210 },
  { id: "v2", name: "Vendor B (Pest Control)", amountCents: 543000, issuesCount: 18, invoicesCount: 144 },
  { id: "v3", name: "Vendor C (Waste & Recycling)", amountCents: 391000, issuesCount: 12, invoicesCount: 88 },
];

const locationRows = [
  { id: "l1", name: "Chicago – West Loop", amountCents: 214000, issuesCount: 7, invoicesCount: 66 },
  { id: "l2", name: "St. Louis – Downtown", amountCents: 198000, issuesCount: 5, invoicesCount: 61 },
  { id: "l3", name: "Kansas City – North", amountCents: 172000, issuesCount: 6, invoicesCount: 58 },
  { id: "l4", name: "Nashville – South", amountCents: 156000, issuesCount: 4, invoicesCount: 49 },
];

const issues = [
  {
    issueId: "iss-001",
    vendorId: "v1",
    vendorName: "Vendor A (Uniform & Facility)",
    locationId: "l2",
    locationName: "St. Louis – Downtown",
    issueType: "PRICE_INCREASE",
    currentChargeCents: 24500,
    expectedChargeCents: 21000,
    deltaCents: 3500,
    confidence: "HIGH",
    invoiceId: "INV-88421",
    invoiceDate: "2025-12-10",
  },
  {
    issueId: "iss-002",
    vendorId: "v1",
    vendorName: "Vendor A (Uniform & Facility)",
    locationId: "l1",
    locationName: "Chicago – West Loop",
    issueType: "NEW_FEE",
    currentChargeCents: 9800,
    expectedChargeCents: 0,
    deltaCents: 9800,
    confidence: "HIGH",
    invoiceId: "INV-88488",
    invoiceDate: "2025-12-12",
  },
  {
    issueId: "iss-003",
    vendorId: "v2",
    vendorName: "Vendor B (Pest Control)",
    locationId: "l3",
    locationName: "Kansas City – North",
    issueType: "QUANTITY_DRIFT",
    currentChargeCents: 52000,
    expectedChargeCents: 41000,
    deltaCents: 11000,
    confidence: "MEDIUM",
    invoiceId: "PC-22019",
    invoiceDate: "2025-12-08",
  },
];

const proofByIssueId = {
  "iss-002": {
    issueId: "iss-002",
    summary: {
      headline: "New fee added: “Environmental Surcharge”",
      details: "Fee not observed in prior 8 invoices for this location.",
      confidence: "HIGH",
    },
    financial: {
      currentChargeCents: 9800,
      expectedChargeCents: 0,
      deltaCents: 9800,
      calculation: "$98 fee × 1 = $98",
    },
    evidence: {
      currentInvoice: {
        invoiceId: "INV-88488",
        invoiceDate: "2025-12-12",
        snippetText:
          "Line Items\n- Weekly Service: $210.00\n- Environmental Surcharge: $98.00\nTotal: $308.00",
        highlight: { start: 33, end: 70 },
      },
      priorInvoice: {
        invoiceId: "INV-88310",
        invoiceDate: "2025-11-12",
        snippetText: "Line Items\n- Weekly Service: $210.00\nTotal: $210.00",
        highlight: { start: 12, end: 34 },
      },
    },
    history: {
      stableInvoicesCount: 8,
      stableSinceDate: "2025-04-12",
      notes: "Service line item is stable; surcharge appears newly introduced.",
    },
    suggestedAction: "Request vendor credit or documentation referencing contract amendment.",
  },
  "iss-001": {
    issueId: "iss-001",
    summary: { headline: "Unit price increased from $2.10 → $2.45", confidence: "HIGH" },
    financial: {
      currentChargeCents: 24500,
      expectedChargeCents: 21000,
      deltaCents: 3500,
      calculation: "$0.35 per unit × 100 units = $35",
    },
    evidence: {
      currentInvoice: {
        invoiceId: "INV-88421",
        invoiceDate: "2025-12-10",
        snippetText:
          "Uniform Items\n- Mat Service (100 units) @ $2.45 = $245.00\nTotal: $245.00",
        highlight: { start: 36, end: 63 },
      },
      priorInvoice: {
        invoiceId: "INV-88112",
        invoiceDate: "2025-11-10",
        snippetText:
          "Uniform Items\n- Mat Service (100 units) @ $2.10 = $210.00\nTotal: $210.00",
        highlight: { start: 36, end: 63 },
      },
    },
    history: { stableInvoicesCount: 14, stableSinceDate: "2024-10-10" },
  },
  "iss-003": {
    issueId: "iss-003",
    summary: { headline: "Quantity drift: billed units higher than historical average", confidence: "MEDIUM" },
    financial: {
      currentChargeCents: 52000,
      expectedChargeCents: 41000,
      deltaCents: 11000,
      calculation: "Billed 8 visits; expected 6 visits based on prior 12 invoices",
    },
    evidence: {
      currentInvoice: {
        invoiceId: "PC-22019",
        invoiceDate: "2025-12-08",
        snippetText:
          "Service Visits\n- Monthly Visits: 8 @ $65.00 = $520.00\nTotal: $520.00",
      },
      priorInvoice: {
        invoiceId: "PC-21901",
        invoiceDate: "2025-11-08",
        snippetText:
          "Service Visits\n- Monthly Visits: 6 @ $68.33 = $410.00\nTotal: $410.00",
      },
    },
    history: { stableInvoicesCount: 12, stableSinceDate: "2024-12-01" },
    suggestedAction: "Confirm service schedule; request credit for excess visits if unapproved.",
  },
};

// Demo invoices for My Invoices page
const invoices = [
  {
    id: 1,
    runId: 'demo-run-001',
    accountName: 'Chicago – West Loop',
    vendorName: 'Cintas Corporation',
    fileName: 'cintas-invoice-dec-2025.pdf',
    fileSize: 245678,
    status: 'completed',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 45000).toISOString(),
    lineItemCount: 12,
    totalCents: 48750,
  },
  {
    id: 2,
    runId: 'demo-run-002',
    accountName: 'St. Louis – Downtown',
    vendorName: 'Cintas Corporation',
    fileName: 'cintas-stl-nov-2025.pdf',
    fileSize: 198432,
    status: 'completed',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 38000).toISOString(),
    lineItemCount: 8,
    totalCents: 32400,
  },
  {
    id: 3,
    runId: 'demo-run-003',
    accountName: 'Kansas City – North',
    vendorName: 'Rentokil Initial',
    fileName: 'rentokil-pest-control-dec.pdf',
    fileSize: 156234,
    status: 'completed',
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000 + 52000).toISOString(),
    lineItemCount: 4,
    totalCents: 52000,
  },
  {
    id: 4,
    runId: 'demo-run-004',
    accountName: 'Nashville – South',
    vendorName: 'Waste Management',
    fileName: 'waste-mgmt-invoice-q4.pdf',
    fileSize: 312456,
    status: 'completed',
    createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000 + 67000).toISOString(),
    lineItemCount: 6,
    totalCents: 89500,
  },
  {
    id: 5,
    runId: 'demo-run-005',
    accountName: 'Chicago – West Loop',
    vendorName: 'Cintas Corporation',
    fileName: 'cintas-invoice-nov-2025.pdf',
    fileSize: 234567,
    status: 'completed',
    createdAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000 + 42000).toISOString(),
    lineItemCount: 11,
    totalCents: 45200,
  },
  {
    id: 6,
    runId: 'demo-run-006',
    accountName: 'St. Louis – Downtown',
    vendorName: 'Rentokil Initial',
    fileName: 'rentokil-stl-monthly.pdf',
    fileSize: 145678,
    status: 'completed',
    createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000 + 35000).toISOString(),
    lineItemCount: 3,
    totalCents: 41000,
  },
  {
    id: 7,
    runId: 'demo-run-007',
    accountName: 'Kansas City – North',
    vendorName: 'Waste Management',
    fileName: 'wm-kc-recycling-nov.pdf',
    fileSize: 278900,
    status: 'completed',
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000 + 58000).toISOString(),
    lineItemCount: 5,
    totalCents: 67800,
  },
  {
    id: 8,
    runId: 'demo-run-008',
    accountName: 'Nashville – South',
    vendorName: 'Cintas Corporation',
    fileName: 'cintas-nashville-oct.pdf',
    fileSize: 198765,
    status: 'completed',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    completedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000 + 41000).toISOString(),
    lineItemCount: 9,
    totalCents: 38900,
  },
];

module.exports = {
  metrics,
  vendorRows,
  locationRows,
  issues,
  proofByIssueId,
  invoices,
};
