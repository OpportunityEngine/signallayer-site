/**
 * Invoice Parsing V2 - Cintas Parser
 * Robust state-machine based parser for Cintas uniform invoices
 *
 * Cintas invoice structure:
 * - Header with vendor/customer info
 * - Table sections with columns: EMP#/LOCK# MATERIAL DESCRIPTION FREQ EXCH QTY UNIT PRICE LINE TOTAL TAX
 * - Employee subtotal rows (NOT line items, these sum items above)
 * - Program/fee rows (ARE line items: UNIFORM ADVANTAGE, INVENTORY MANAGEMENT, etc.)
 * - Department subtotals (NOT line items)
 * - Final totals block: SUBTOTAL, SALES TAX, TOTAL USD
 */

const {
  parseMoney,
  parseMoneyToDollars,
  calculateLineTotalCents,
  parseQty,
  scanFromBottom,
  isGroupSubtotal,
  isDeptSubtotal,
  isProgramFeeLine
} = require('../utils');
const { validateAndFixLineItems, isLikelyMisclassifiedItemCode } = require('../numberClassifier');

/**
 * Process price string with 3 decimal precision
 * Returns both cents (rounded) and dollars (precise) for accurate calculations
 */
function processPrice(priceStr, qty = 1) {
  const dollars = parseMoneyToDollars(priceStr, 3);
  const cents = parseMoney(priceStr);
  const computedCents = calculateLineTotalCents(qty, dollars);
  return { dollars, cents, computedCents };
}

/**
 * Parse Cintas invoice header (vendor, customer, invoice number, etc.)
 */
function parseHeader(text, lines) {
  const header = {
    vendorName: 'Cintas Corporation',
    invoiceNumber: null,
    invoiceDate: null,
    accountNumber: null,
    customerName: null,
    soldTo: null,
    billTo: null,
    shipTo: null
  };

  // Invoice number patterns
  const invoicePatterns = [
    /Invoice\s*(?:#|No\.?|Number)?[:\s]*(\d{8,12})/i,
    /Invoice[:\s]+(\d{8,12})/i,
    /(?:^|\s)(\d{10})(?:\s|$)/m  // 10-digit number often is invoice #
  ];

  for (const pattern of invoicePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceNumber = match[1];
      break;
    }
  }

  // Invoice date
  const datePatterns = [
    /Invoice\s+Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    /Date[:\s]*(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/i,
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/  // Any date format
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      header.invoiceDate = match[1];
      break;
    }
  }

  // Account/customer - look for common patterns
  const accountPatterns = [
    /Account[:\s#]*(\d{6,10})/i,
    /Customer[:\s#]*(\d{6,10})/i,
    /Acct[:\s#]*(\d{6,10})/i
  ];

  for (const pattern of accountPatterns) {
    const match = text.match(pattern);
    if (match) {
      header.accountNumber = match[1];
      break;
    }
  }

  // Customer name - usually appears after "SOLD TO" or "BILL TO" or near top
  const soldToMatch = text.match(/SOLD\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (soldToMatch) {
    header.customerName = soldToMatch[1].trim();
    header.soldTo = soldToMatch[1].trim();
  }

  const billToMatch = text.match(/BILL\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (billToMatch) {
    header.billTo = billToMatch[1].trim();
    if (!header.customerName) header.customerName = header.billTo;
  }

  const shipToMatch = text.match(/SHIP\s*TO[:\s]*\n?([A-Z][A-Z0-9\s\.,&'-]+?)(?:\n|$)/im);
  if (shipToMatch) {
    header.shipTo = shipToMatch[1].trim();
  }

  // If no customer found, look for company name pattern near top
  if (!header.customerName) {
    // Look in first 20 lines for a company name
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const line = lines[i].trim();
      // Company patterns: ends with INC, LLC, CORP, etc.
      if (/\b(INC\.?|LLC|CORP\.?|COMPANY|CO\.?)$/i.test(line) && line.length < 60) {
        header.customerName = line;
        break;
      }
    }
  }

  return header;
}

/**
 * Find table regions in the text
 * Cintas tables have header: EMP#/LOCK# MATERIAL DESCRIPTION FREQ EXCH QTY UNIT PRICE LINE TOTAL TAX
 */
function findTableRegions(lines) {
  const regions = [];
  let currentRegion = null;

  const headerPatterns = [
    /EMP#.*MATERIAL.*DESCRIPTION/i,
    /MATERIAL.*DESCRIPTION.*FREQ.*QTY/i,
    /DESCRIPTION.*QTY.*UNIT\s*PRICE/i,
    /ITEM.*QTY.*PRICE.*TOTAL/i
  ];

  const terminatorPatterns = [
    /^FOR ALL NON-?PAYMENT/i,
    /^SPECIAL PROGRAMS BREAKDOWN/i,
    /^TERMS AND CONDITIONS/i,
    /^SUBTOTAL\s+TAX\s+TOTAL/i,  // Totals block header
    /^SUBTOTAL\s+[\d,]+\.\d{2}\s*$/i,  // Final subtotal line
    /^Please detach/i,
    /^REMIT TO/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for table header
    if (!currentRegion) {
      for (const pattern of headerPatterns) {
        if (pattern.test(line)) {
          currentRegion = {
            startLine: i,
            headerLine: i,
            endLine: null,
            lines: []
          };
          break;
        }
      }
    }

    // If in a region, check for terminator
    if (currentRegion && i > currentRegion.startLine) {
      let terminated = false;

      for (const pattern of terminatorPatterns) {
        if (pattern.test(line)) {
          currentRegion.endLine = i - 1;
          terminated = true;
          break;
        }
      }

      if (terminated) {
        // Collect lines in region
        for (let j = currentRegion.startLine + 1; j <= currentRegion.endLine; j++) {
          currentRegion.lines.push({ index: j, text: lines[j] });
        }
        regions.push(currentRegion);
        currentRegion = null;
      }
    }
  }

  // Close any open region at end
  if (currentRegion) {
    currentRegion.endLine = lines.length - 1;
    for (let j = currentRegion.startLine + 1; j <= currentRegion.endLine; j++) {
      currentRegion.lines.push({ index: j, text: lines[j] });
    }
    regions.push(currentRegion);
  }

  return regions;
}

/**
 * Parse a single line item row from Cintas table
 * Uses right-anchored parsing (extract numbers from end first)
 */
function parseItemRow(line) {
  // Skip empty lines
  if (!line.trim()) return null;

  // Skip if it's a group/dept subtotal
  if (isGroupSubtotal(line) || isDeptSubtotal(line)) return null;

  // Skip location/department header lines (e.g., "LOC 001 FR DEPT 1")
  if (/^LOC\s+\d+/i.test(line.trim()) || /^FR\s+DEPT\s+\d+/i.test(line.trim())) return null;

  // Skip lines that are just "Subtotal" with a number (department subtotals)
  if (/^Subtotal\s+[\d,]+\.?\d*\s*$/i.test(line.trim())) return null;

  // Check if it's a fee/program line (these ARE line items)
  const isFee = isProgramFeeLine(line);

  // Pattern for Cintas item row (simplified):
  // [EMP#] SKU DESCRIPTION FREQ EXCH QTY UNIT_PRICE LINE_TOTAL TAX
  // Example: "0001 X59294 PANTS INDUST HW 01 R 1 12.00 12.00 Y"
  // Example fee: "UNIFORM ADVANTAGE 104.48 Y"

  // Extract tax flag from end
  const taxMatch = line.match(/\s+([YN])\s*$/i);
  const taxFlag = taxMatch ? taxMatch[1].toUpperCase() : null;

  // Remove tax flag for number extraction
  let workLine = taxFlag ? line.slice(0, line.lastIndexOf(taxMatch[0])) : line;

  // Extract numbers from the line (from right to left: lineTotal, unitPrice, qty, ...)
  const numbers = [];
  const numPattern = /(\d[\d,]*\.?\d*)/g;
  let match;
  while ((match = numPattern.exec(workLine)) !== null) {
    const num = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(num)) {
      numbers.push({
        value: num,
        index: match.index,
        raw: match[1]
      });
    }
  }

  if (numbers.length === 0) return null;

  // For fee lines, format is simpler: "DESCRIPTION AMOUNT TAX"
  if (isFee) {
    const lineTotalValue = numbers[numbers.length - 1].value;
    const descMatch = line.match(/^(.+?)\s+[\d,]+\.?\d*\s*[YN]?\s*$/i);
    const description = descMatch ? descMatch[1].trim() : line.trim();

    // Use precision processing
    const priceProc = processPrice(lineTotalValue, 1);

    return {
      type: 'fee',
      sku: null,
      description: description,
      qty: 1,
      unitPriceDollars: priceProc.dollars,
      unitPriceCents: priceProc.cents,
      lineTotalCents: priceProc.cents,
      computedTotalCents: priceProc.computedCents,
      taxFlag: taxFlag,
      employeeId: null,
      raw: line
    };
  }

  // For regular item rows, we need at least 3 numbers (qty, unitPrice, lineTotal)
  // Sometimes 4 if there's a freq code
  if (numbers.length < 2) return null;

  // Work backwards from the rightmost numbers
  const lineTotal = numbers[numbers.length - 1].value;
  const unitPrice = numbers.length >= 2 ? numbers[numbers.length - 2].value : lineTotal;

  // Qty might be right before unitPrice, or might be implied as 1
  let qty = 1;
  if (numbers.length >= 3) {
    const possibleQty = numbers[numbers.length - 3].value;
    // Qty is usually a small integer
    if (possibleQty >= 1 && possibleQty <= 999 && Number.isInteger(possibleQty)) {
      qty = possibleQty;
    }
  }

  // Extract SKU (X##### pattern for Cintas)
  const skuMatch = line.match(/\b(X\d{4,6})\b/i);
  const sku = skuMatch ? skuMatch[1].toUpperCase() : null;

  // Extract employee ID if present (4-digit number at start)
  const empMatch = line.match(/^(\d{4})\s+/);
  const employeeId = empMatch ? empMatch[1] : null;

  // Description is everything between SKU (or start) and the first number we're using
  const lastUsedNumIdx = numbers.length >= 3 ? numbers[numbers.length - 3].index : numbers[numbers.length - 2].index;
  let descStart = skuMatch ? skuMatch.index + skuMatch[0].length : (empMatch ? empMatch[0].length : 0);
  const description = workLine.slice(descStart, lastUsedNumIdx).trim();

  // Use precision processing for accurate calculations
  const unitPriceDollars = parseMoneyToDollars(unitPrice, 3);
  const lineTotalCents = Math.round(lineTotal * 100);

  // Validate: lineTotal should roughly equal qty * unitPrice
  const expectedTotal = qty * unitPriceDollars;
  const tolerance = Math.max(0.01, expectedTotal * 0.05);  // 5% tolerance
  if (Math.abs(lineTotal - expectedTotal) > tolerance && qty !== 1) {
    // Qty might be wrong, recalculate
    qty = Math.round(lineTotal / unitPriceDollars);
    if (qty < 1) qty = 1;
  }

  const computedTotalCents = calculateLineTotalCents(qty, unitPriceDollars);

  return {
    type: 'item',
    sku: sku,
    description: description || 'Unknown Item',
    qty: qty,
    unitPriceDollars: unitPriceDollars,
    unitPriceCents: Math.round(unitPriceDollars * 100),
    lineTotalCents: lineTotalCents,
    computedTotalCents: computedTotalCents,
    taxFlag: taxFlag,
    employeeId: employeeId,
    raw: line
  };
}

/**
 * Extract final totals from bottom of invoice
 * Cintas format: SUBTOTAL / SALES TAX / TOTAL USD appearing near end
 */
function extractTotals(text, lines) {
  const totals = {
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    currency: 'USD',
    debug: {
      subtotalLine: null,
      taxLine: null,
      totalLine: null
    }
  };

  // Scan from bottom to find totals block
  // Cintas can have two formats:
  // 1) Labels and amounts on same line: "SUBTOTAL 1867.42"
  // 2) Stacked: "SUBTOTAL TAX TOTAL USD" then "1227.60 0.00 1227.60"

  // CRITICAL: Prioritize TOTAL USD over generic TOTAL (to avoid picking up SUBTOTAL)
  const totalPatterns = [
    /TOTAL\s+USD\s*([\d,]+\.?\d*)/i,          // Highest priority - Cintas specific
    /INVOICE\s+TOTAL\s*([\d,]+\.?\d*)/i,       // High priority
    /AMOUNT\s+DUE\s*([\d,]+\.?\d*)/i,          // Medium priority
    /(?:^|\s)TOTAL\s*:?\s*\$?([\d,]+\.?\d*)/i  // Lowest priority - must not be SUBTOTAL
  ];

  const subtotalPatterns = [
    /^SUBTOTAL\s+([\d,]+\.?\d*)\s*$/im,
    /SUBTOTAL\s*:?\s*\$?([\d,]+\.?\d*)/i
  ];

  const taxPatterns = [
    /SALES\s+TAX\s*([\d,]+\.?\d*)/i,
    /TAX\s*:?\s*\$?([\d,]+\.?\d*)/i
  ];

  // Scan from bottom (last 100 lines)
  const scanLines = lines.slice(-100);
  const baseIdx = lines.length - scanLines.length;

  // FIRST PASS: Look for TOTAL USD specifically (most reliable for Cintas)
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];

    // Skip employee/dept subtotals
    if (isGroupSubtotal(line) || isDeptSubtotal(line)) continue;

    // CRITICAL: Check for "TOTAL USD" pattern first
    const totalUsdMatch = line.match(/TOTAL\s+USD\s*([\d,]+\.?\d*)/i);
    if (totalUsdMatch) {
      totals.totalCents = parseMoney(totalUsdMatch[1]);
      totals.debug.totalLine = baseIdx + i;
      console.log(`[CINTAS TOTALS] Found TOTAL USD: $${(totals.totalCents/100).toFixed(2)} at line ${baseIdx + i}`);

      // Now look backwards for subtotal and tax
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const prevLine = scanLines[j];

        if (!totals.debug.taxLine) {
          for (const taxPat of taxPatterns) {
            const taxMatch = prevLine.match(taxPat);
            if (taxMatch) {
              totals.taxCents = parseMoney(taxMatch[1]);
              totals.debug.taxLine = baseIdx + j;
              console.log(`[CINTAS TOTALS] Found TAX: $${(totals.taxCents/100).toFixed(2)} at line ${baseIdx + j}`);
              break;
            }
          }
        }

        if (!totals.debug.subtotalLine) {
          // Make sure we're not picking up a group subtotal
          if (!isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
            for (const subPat of subtotalPatterns) {
              const subMatch = prevLine.match(subPat);
              if (subMatch) {
                totals.subtotalCents = parseMoney(subMatch[1]);
                totals.debug.subtotalLine = baseIdx + j;
                console.log(`[CINTAS TOTALS] Found SUBTOTAL: $${(totals.subtotalCents/100).toFixed(2)} at line ${baseIdx + j}`);
                break;
              }
            }
          }
        }

        if (totals.debug.taxLine && totals.debug.subtotalLine) break;
      }

      return totals;
    }
  }

  // SECOND PASS: Try other total patterns if TOTAL USD not found
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];

    // Skip employee/dept subtotals AND lines containing "SUBTOTAL"
    if (isGroupSubtotal(line) || isDeptSubtotal(line) || /SUBTOTAL/i.test(line)) continue;

    for (const pattern of totalPatterns) {
      const match = line.match(pattern);
      if (match) {
        totals.totalCents = parseMoney(match[1]);
        totals.debug.totalLine = baseIdx + i;
        console.log(`[CINTAS TOTALS] Found TOTAL (fallback): $${(totals.totalCents/100).toFixed(2)} at line ${baseIdx + i}`);

        // Now look backwards for subtotal and tax
        for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
          const prevLine = scanLines[j];

          if (!totals.debug.taxLine) {
            for (const taxPat of taxPatterns) {
              const taxMatch = prevLine.match(taxPat);
              if (taxMatch) {
                totals.taxCents = parseMoney(taxMatch[1]);
                totals.debug.taxLine = baseIdx + j;
                break;
              }
            }
          }

          if (!totals.debug.subtotalLine) {
            // Make sure we're not picking up a group subtotal
            if (!isGroupSubtotal(prevLine) && !isDeptSubtotal(prevLine)) {
              for (const subPat of subtotalPatterns) {
                const subMatch = prevLine.match(subPat);
                if (subMatch) {
                  totals.subtotalCents = parseMoney(subMatch[1]);
                  totals.debug.subtotalLine = baseIdx + j;
                  break;
                }
              }
            }
          }

          if (totals.debug.taxLine && totals.debug.subtotalLine) break;
        }

        return totals;
      }
    }
  }

  // Fallback: Look for stacked format "SUBTOTAL TAX TOTAL USD" on one line
  // followed by numbers on next line (columnar format common in PDFs)
  for (let i = scanLines.length - 1; i >= 1; i--) {
    const line = scanLines[i];
    const prevLine = scanLines[i - 1];

    // Match variations: "SUBTOTAL TAX TOTAL", "SUBTOTAL TAX TOTAL USD", "SUBTOTAL SALES TAX TOTAL USD"
    if (/SUBTOTAL\s+(?:SALES\s+)?TAX\s+TOTAL(?:\s+USD)?/i.test(prevLine)) {
      // Next line should have the numbers
      const numbers = line.match(/([\d,]+\.?\d*)/g);
      if (numbers && numbers.length >= 3) {
        totals.subtotalCents = parseMoney(numbers[0]);
        totals.taxCents = parseMoney(numbers[1]);
        totals.totalCents = parseMoney(numbers[2]);
        totals.debug.subtotalLine = baseIdx + i;
        totals.debug.taxLine = baseIdx + i;
        totals.debug.totalLine = baseIdx + i;
        console.log(`[CINTAS TOTALS] Found stacked format - Subtotal: $${(totals.subtotalCents/100).toFixed(2)}, Tax: $${(totals.taxCents/100).toFixed(2)}, Total: $${(totals.totalCents/100).toFixed(2)}`);
        return totals;
      }
    }
  }

  // ADDITIONAL FALLBACK: Look for labeled rows near bottom
  // Format: "SUBTOTAL 1867.42" then "SALES TAX 130.72" then "TOTAL USD 1998.14" (each on its own line)
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];

    // Skip group/dept subtotals
    if (isGroupSubtotal(line) || isDeptSubtotal(line)) continue;

    // Look for "TOTAL USD" with value (may have been split by PDF extraction)
    const totalUsdSpaced = line.match(/TOTAL\s+USD[\s:]*\$?([\d,]+\.?\d*)/i);
    if (totalUsdSpaced && parseMoney(totalUsdSpaced[1]) > 0) {
      totals.totalCents = parseMoney(totalUsdSpaced[1]);
      totals.debug.totalLine = baseIdx + i;
      console.log(`[CINTAS TOTALS] Found TOTAL USD (labeled row): $${(totals.totalCents/100).toFixed(2)}`);

      // Search backwards for subtotal and tax on their own lines
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const prevLine = scanLines[j];
        if (isGroupSubtotal(prevLine) || isDeptSubtotal(prevLine)) continue;

        // SALES TAX pattern
        if (!totals.debug.taxLine) {
          const taxMatch = prevLine.match(/(?:SALES\s+)?TAX[\s:]*\$?([\d,]+\.?\d*)/i);
          if (taxMatch && parseMoney(taxMatch[1]) >= 0) {
            totals.taxCents = parseMoney(taxMatch[1]);
            totals.debug.taxLine = baseIdx + j;
          }
        }

        // SUBTOTAL pattern (not group subtotal)
        if (!totals.debug.subtotalLine && /^SUBTOTAL/i.test(prevLine.trim())) {
          const subMatch = prevLine.match(/SUBTOTAL[\s:]*\$?([\d,]+\.?\d*)/i);
          if (subMatch && parseMoney(subMatch[1]) > 0) {
            totals.subtotalCents = parseMoney(subMatch[1]);
            totals.debug.subtotalLine = baseIdx + j;
          }
        }
      }

      return totals;
    }
  }

  // Last resort: find the LARGEST subtotal near the bottom (likely the final one)
  let maxSubtotal = 0;
  for (let i = scanLines.length - 1; i >= 0; i--) {
    const line = scanLines[i];
    if (isGroupSubtotal(line) || isDeptSubtotal(line)) continue;

    const subMatch = line.match(/SUBTOTAL\s*([\d,]+\.?\d*)/i);
    if (subMatch) {
      const value = parseMoney(subMatch[1]);
      if (value > maxSubtotal) {
        maxSubtotal = value;
        totals.subtotalCents = value;
        totals.debug.subtotalLine = baseIdx + i;
      }
    }
  }

  return totals;
}

/**
 * Extract employee information (for grouping/display purposes)
 */
function extractEmployees(text, lines) {
  const employees = [];
  const seenNames = new Set();

  // Pattern: "0001 JOHN DOE SUBTOTAL - 34.79" or "JOHN DOE SUBTOTAL - 34.79"
  const empSubtotalPattern = /(?:^|\n)\s*(?:\d{4}\s+)?([A-Z][A-Z ,.'\-]+?)\s+SUBTOTAL\s*-?\s*([\d,\.]+)/gim;

  let match;
  while ((match = empSubtotalPattern.exec(text)) !== null) {
    const name = match[1].trim();
    const subtotal = parseMoney(match[2]);

    // Filter out non-employee patterns
    const nameUpper = name.toUpperCase();
    if (nameUpper.includes('INVOICE') ||
        nameUpper.includes('DEPT') ||
        nameUpper.includes('CORPORATION') ||
        nameUpper.includes('INC') ||
        nameUpper.includes('LLC') ||
        nameUpper.length < 5 ||
        seenNames.has(nameUpper)) {
      continue;
    }

    seenNames.add(nameUpper);
    employees.push({
      name: name,
      subtotalCents: subtotal
    });
  }

  return employees;
}

/**
 * Extract additional fees/adjustments from Cintas invoice
 * Note: Many Cintas fees are captured as line items already
 * This catches any additional fees/credits not in the main table
 */
function extractCintasAdjustments(text, lines) {
  const adjustments = [];

  // Cintas-specific fee patterns (fees that might be outside the main table)
  const feePatterns = [
    { regex: /FUEL\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Fuel Surcharge' },
    { regex: /ENERGY\s+SURCHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Energy Surcharge' },
    { regex: /ROUTE\s+SERVICE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Route Service Fee' },
    { regex: /STOP\s+CHARGE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Stop Charge' },
    { regex: /DELIVERY\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Delivery Fee' },
    { regex: /MINIMUM\s+BILLING?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Minimum Billing' },
    { regex: /LOST\s+(?:GARMENT|ITEM)\s+(?:FEE|CHARGE)?[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Lost Item Fee' },
    { regex: /DAMAGE\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Damage Fee' },
    { regex: /ENVIRONMENTAL\s+(?:FEE|SURCHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Environmental Fee' },
    { regex: /ADMIN(?:ISTRATION)?\s+(?:FEE|CHARGE)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'fee', desc: 'Admin Fee' },
  ];

  // Credit/discount patterns
  const creditPatterns = [
    { regex: /(?:VOLUME|LOYALTY)\s+DISCOUNT[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Volume Discount' },
    { regex: /(?:CUSTOMER\s+)?CREDIT[:\s]*\-?\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Credit' },
    { regex: /CONTRACT\s+(?:DISCOUNT|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Contract Discount' },
    { regex: /PROMOTIONAL\s+(?:DISCOUNT|CREDIT)[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Promotional Credit' },
    { regex: /REBATE[:\s]*\$?([\d,]+\.?\d*)/i, type: 'credit', desc: 'Rebate' },
  ];

  // Search for fees
  for (const pattern of feePatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 50000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: value,
          raw: match[0]
        });
        console.log(`[CINTAS ADJ] Found ${pattern.desc}: $${(value/100).toFixed(2)}`);
      }
    }
  }

  // Search for credits
  for (const pattern of creditPatterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = parseMoney(match[1]);
      if (value > 0 && value < 100000) {
        adjustments.push({
          type: pattern.type,
          description: pattern.desc,
          amountCents: -value,  // Credits are negative
          raw: match[0]
        });
        console.log(`[CINTAS ADJ] Found ${pattern.desc}: -$${(value/100).toFixed(2)} (credit)`);
      }
    }
  }

  // Calculate net adjustments
  const totalAdjustmentsCents = adjustments.reduce((sum, adj) => sum + adj.amountCents, 0);

  console.log(`[CINTAS ADJ] Total adjustments: ${adjustments.length} items, net: $${(totalAdjustmentsCents/100).toFixed(2)}`);

  return {
    adjustments,
    totalAdjustmentsCents
  };
}

/**
 * Main Cintas parser function
 */
function parseCintasInvoice(normalizedText, options = {}) {
  const lines = normalizedText.split('\n');

  // Extract totals and adjustments
  const totals = extractTotals(normalizedText, lines);
  const miscCharges = extractCintasAdjustments(normalizedText, lines);

  // Add adjustments to totals
  totals.adjustmentsCents = miscCharges.totalAdjustmentsCents;
  totals.adjustments = miscCharges.adjustments;

  const result = {
    vendorKey: 'cintas',
    parserVersion: '2.2.0',  // Bumped for adjustments support
    header: parseHeader(normalizedText, lines),
    totals: totals,
    lineItems: [],
    adjustments: miscCharges.adjustments,
    employees: extractEmployees(normalizedText, lines),
    departments: [],
    debug: {
      tableRegions: [],
      parseAttempts: [],
      rawLineCount: lines.length,
      adjustmentsFound: miscCharges.adjustments.length,
      netAdjustmentsCents: miscCharges.totalAdjustmentsCents
    }
  };

  // Find and parse table regions
  const tableRegions = findTableRegions(lines);
  result.debug.tableRegions = tableRegions.map(r => ({
    startLine: r.startLine,
    endLine: r.endLine,
    lineCount: r.lines.length
  }));

  // Parse line items from table regions
  const seenItems = new Set();  // Dedup by raw line

  for (const region of tableRegions) {
    let continuationBuffer = '';

    for (const { text: line, index } of region.lines) {
      // Skip empty lines
      if (!line.trim()) continue;

      // Skip group/dept subtotals (these are NOT line items)
      if (isGroupSubtotal(line) || isDeptSubtotal(line)) {
        continuationBuffer = '';
        continue;
      }

      // Check if this line is a continuation of previous (no tax flag at end)
      const hasTaxFlag = /\s+[YN]\s*$/i.test(line);
      const hasNumbers = /\d+\.?\d*\s*[YN]?\s*$/i.test(line);

      if (!hasTaxFlag && !hasNumbers && continuationBuffer) {
        // Continuation line - append to buffer
        continuationBuffer += ' ' + line.trim();
        continue;
      }

      // Try to parse the line (with any continuation buffer)
      const fullLine = continuationBuffer ? continuationBuffer + ' ' + line : line;
      const item = parseItemRow(fullLine);

      if (item && !seenItems.has(item.raw)) {
        seenItems.add(item.raw);
        result.lineItems.push({
          ...item,
          sourceLineIndex: index
        });
      }

      // Reset buffer if we successfully parsed or if line looks complete
      if (item || hasTaxFlag) {
        continuationBuffer = '';
      } else if (line.match(/^[A-Z]/)) {
        // New description starting - save as continuation buffer
        continuationBuffer = line;
      }
    }
  }

  // Also scan for fee/program lines that might be outside table regions
  const feePatterns = [
    /^\s*(UNIFORM\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(EMBLEM\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(PREP\s+ADVANTAGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(INVENTORY\s+MANAGEMENT)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(SERVICE\s+CHARGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim,
    /^\s*(ENERGY\s+SURCHARGE)\s+([\d,]+\.?\d*)\s*([YN])\s*$/gim
  ];

  for (const pattern of feePatterns) {
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const description = match[1].trim();
      const amount = parseMoney(match[2]);
      const taxFlag = match[3].toUpperCase();

      // Check if already captured
      const exists = result.lineItems.some(item =>
        item.description.toUpperCase().includes(description.toUpperCase()) &&
        item.lineTotalCents === amount
      );

      if (!exists) {
        result.lineItems.push({
          type: 'fee',
          sku: null,
          description: description,
          qty: 1,
          unitPriceCents: amount,
          lineTotalCents: amount,
          taxFlag: taxFlag,
          employeeId: null,
          raw: match[0]
        });
      }
    }
  }

  // Post-processing: validate and fix line items
  result.lineItems = validateAndFixLineItems(result.lineItems);

  // Update parser version and add debug info
  result.parserVersion = '2.1.0';
  result.debug.mathCorrectedItems = result.lineItems.filter(i => i.mathCorrected).length;

  // Calculate confidence score
  result.confidence = calculateCintasConfidence(result.lineItems, result.totals);

  return result;
}

/**
 * Calculate confidence score for Cintas parse
 */
function calculateCintasConfidence(lineItems, totals) {
  let score = 50;
  const issues = [];
  const warnings = [];

  if (lineItems.length === 0) {
    score -= 30;
    issues.push('No line items extracted');
  } else {
    score += Math.min(20, lineItems.length * 2);
  }

  if (totals.totalCents > 0) {
    score += 15;
  } else {
    issues.push('No invoice total found');
  }

  if (lineItems.length > 0 && totals.totalCents > 0) {
    const itemsSum = lineItems.reduce((sum, item) => sum + (item.lineTotalCents || 0), 0);
    const diff = Math.abs(totals.totalCents - itemsSum);
    const pctDiff = totals.totalCents > 0 ? diff / totals.totalCents : 1;

    if (pctDiff <= 0.01) {
      score += 15;
    } else if (pctDiff <= 0.05) {
      score += 10;
    } else if (pctDiff <= 0.15) {
      score += 5;
      warnings.push(`Line items sum differs from total by ${(pctDiff * 100).toFixed(1)}%`);
    } else {
      warnings.push(`Significant difference: items sum $${(itemsSum/100).toFixed(2)} vs total $${(totals.totalCents/100).toFixed(2)}`);
    }
  }

  // Check math validation status
  const mathValidatedCount = lineItems.filter(item => item.mathValidated).length;
  const mathCorrectedCount = lineItems.filter(item => item.mathCorrected).length;

  if (lineItems.length > 0) {
    const validationRate = mathValidatedCount / lineItems.length;
    if (validationRate >= 0.9) {
      score += 10;
    } else if (validationRate < 0.5) {
      score -= 5;
      warnings.push(`Only ${Math.round(validationRate * 100)}% of items passed math validation`);
    }

    if (mathCorrectedCount > 0) {
      warnings.push(`${mathCorrectedCount} items had quantities auto-corrected`);
    }
  }

  return {
    score: Math.min(100, Math.max(0, score)),
    issues: issues,
    warnings: warnings
  };
}

module.exports = {
  parseCintasInvoice,
  parseHeader,
  findTableRegions,
  parseItemRow,
  extractTotals,
  extractCintasAdjustments,
  extractEmployees,
  calculateCintasConfidence
};
