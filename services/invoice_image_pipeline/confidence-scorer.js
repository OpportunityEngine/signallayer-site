// =====================================================
// CONFIDENCE SCORER
// Calculate overall confidence and field-level scores
// =====================================================

/**
 * Calculate comprehensive confidence scores
 */
function calculateScore({ ocrConfidence, quality, extraction, attempts }) {
  const result = {
    overallScore: 0,
    ocrAvgConfidence: ocrConfidence || 0,
    fields: {
      vendor: 0,
      date: 0,
      total: 0,
      lineItems: 0
    },
    qualityScore: 0,
    extractionScore: 0,
    validationScore: 0,
    breakdown: {}
  };

  // =========================================
  // Quality Score (0-1)
  // =========================================
  let qualityScore = 1;

  // Blur penalty
  if (quality.blurScore > 0.3) {
    qualityScore -= (quality.blurScore - 0.3) * 0.5;
  }

  // Glare penalty
  if (quality.glareScore > 0.2) {
    qualityScore -= (quality.glareScore - 0.2) * 0.4;
  }

  // Brightness penalty (too dark or too bright)
  const brightnessDiff = Math.abs(quality.brightness - 0.5);
  if (brightnessDiff > 0.25) {
    qualityScore -= (brightnessDiff - 0.25) * 0.3;
  }

  // Contrast bonus
  if (quality.contrast > 0.4) {
    qualityScore += 0.1;
  }

  // Resolution penalty
  const minDim = Math.min(quality.resolution?.width || 0, quality.resolution?.height || 0);
  if (minDim < 500) {
    qualityScore -= 0.2;
  } else if (minDim < 800) {
    qualityScore -= 0.1;
  }

  // Document detection bonus
  if (quality.docDetected) {
    qualityScore += 0.1;
  }

  result.qualityScore = Math.max(0, Math.min(1, qualityScore));
  result.breakdown.quality = result.qualityScore;

  // =========================================
  // Field-level Confidence
  // =========================================

  // Vendor confidence
  if (extraction.vendor) {
    let vendorConf = 0.5;
    // Bonus for company indicators
    if (/inc|llc|corp|ltd|company/i.test(extraction.vendor)) {
      vendorConf += 0.3;
    }
    // Bonus for reasonable length
    if (extraction.vendor.length >= 5 && extraction.vendor.length <= 50) {
      vendorConf += 0.2;
    }
    result.fields.vendor = Math.min(1, vendorConf);
  }

  // Date confidence
  if (extraction.date) {
    let dateConf = 0.6;
    // Check if it's a valid-looking date
    if (/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(extraction.date)) {
      dateConf += 0.3;
    }
    // Check if year is reasonable (2020-2030)
    const yearMatch = extraction.date.match(/20[2-3]\d/);
    if (yearMatch) {
      dateConf += 0.1;
    }
    result.fields.date = Math.min(1, dateConf);
  }

  // Total confidence
  if (extraction.totals?.total) {
    let totalConf = 0.5;
    // Reasonable amount range
    if (extraction.totals.total > 0 && extraction.totals.total < 1000000) {
      totalConf += 0.2;
    }
    // Has subtotal + tax = total validation
    if (extraction.totals.subtotal && extraction.totals.tax) {
      const calculatedTotal = extraction.totals.subtotal + extraction.totals.tax;
      const diff = Math.abs(calculatedTotal - extraction.totals.total);
      if (diff < extraction.totals.total * 0.05) {
        totalConf += 0.3; // Totals validate
      }
    }
    result.fields.total = Math.min(1, totalConf);
  }

  // Line items confidence
  if (extraction.lineItems && extraction.lineItems.length > 0) {
    let itemsConf = 0.4;

    // Bonus for having multiple items
    if (extraction.lineItems.length >= 3) {
      itemsConf += 0.2;
    }

    // Check if items have descriptions
    const withDesc = extraction.lineItems.filter(i => i.description?.length > 5).length;
    itemsConf += (withDesc / extraction.lineItems.length) * 0.2;

    // Check if items have valid prices
    const withPrices = extraction.lineItems.filter(i => i.totalCents > 0).length;
    itemsConf += (withPrices / extraction.lineItems.length) * 0.2;

    // Validation: sum of items close to total
    if (extraction.totals?.total) {
      const itemsSum = extraction.lineItems.reduce((sum, i) => sum + (i.totalCents || 0), 0);
      const totalCents = Math.round(extraction.totals.total * 100);
      const diff = Math.abs(itemsSum - totalCents);
      if (diff < totalCents * 0.1) {
        itemsConf += 0.2; // Items sum validates
      } else if (diff < totalCents * 0.25) {
        itemsConf += 0.1;
      }
    }

    result.fields.lineItems = Math.min(1, itemsConf);
  }

  result.breakdown.fields = { ...result.fields };

  // =========================================
  // Extraction Score (0-1)
  // =========================================
  let extractionScore = 0;

  // Required fields weight
  if (extraction.vendor) extractionScore += 0.15;
  if (extraction.date) extractionScore += 0.15;
  if (extraction.totals?.total) extractionScore += 0.3;
  if (extraction.lineItems?.length > 0) extractionScore += 0.3;
  if (extraction.invoiceNumber) extractionScore += 0.1;

  result.extractionScore = extractionScore;
  result.breakdown.extraction = extractionScore;

  // =========================================
  // Validation Score (0-1)
  // =========================================
  let validationScore = 0.5; // Base score

  // Penalize ambiguous extractions
  if (extraction.ambiguous) {
    validationScore -= 0.2;
  }

  // Penalize missing critical fields
  if (!extraction.totals?.total) {
    validationScore -= 0.2;
  }

  // Penalize no line items when total is high
  if (extraction.totals?.total > 100 && (!extraction.lineItems || extraction.lineItems.length === 0)) {
    validationScore -= 0.1;
  }

  result.validationScore = Math.max(0, Math.min(1, validationScore));
  result.breakdown.validation = result.validationScore;

  // =========================================
  // Overall Score (weighted combination)
  // =========================================
  const weights = {
    ocr: 0.25,
    quality: 0.15,
    extraction: 0.35,
    validation: 0.25
  };

  result.overallScore =
    (ocrConfidence * weights.ocr) +
    (result.qualityScore * weights.quality) +
    (result.extractionScore * weights.extraction) +
    (result.validationScore * weights.validation);

  // Apply attempt bonuses (multiple successful extractions = more reliable)
  if (attempts && attempts.length > 1) {
    const highScoreAttempts = attempts.filter(a => a.score > 0.6).length;
    if (highScoreAttempts >= 2) {
      result.overallScore = Math.min(1, result.overallScore + 0.05);
    }
  }

  result.overallScore = Math.max(0, Math.min(1, result.overallScore));
  result.breakdown.overall = result.overallScore;

  return result;
}

/**
 * Determine user-facing status based on score
 */
function getStatusFromScore(score) {
  if (score >= 0.8) {
    return {
      status: 'success',
      message: 'Invoice processed successfully',
      requiresVerification: false
    };
  } else if (score >= 0.5) {
    return {
      status: 'needs_review',
      message: 'Invoice processed - please verify the extracted data',
      requiresVerification: true
    };
  } else {
    return {
      status: 'low_confidence',
      message: 'Could not reliably extract invoice data - please retake photo or enter manually',
      requiresVerification: true
    };
  }
}

/**
 * Get user-friendly tips based on failure reasons
 */
function getTipsForFailureReasons(failureReasons) {
  const tips = [];

  if (failureReasons.includes('too_blurry')) {
    tips.push('Hold your phone steady and ensure the invoice is in focus');
  }
  if (failureReasons.includes('glare_detected')) {
    tips.push('Avoid taking photos under bright lights or direct sunlight');
  }
  if (failureReasons.includes('image_too_dark')) {
    tips.push('Take the photo in a well-lit area');
  }
  if (failureReasons.includes('image_too_bright')) {
    tips.push('Move away from bright light sources');
  }
  if (failureReasons.includes('document_not_detected')) {
    tips.push('Make sure the entire invoice is visible and flat against a surface');
  }
  if (failureReasons.includes('low_resolution')) {
    tips.push('Move closer to the invoice or use a higher camera resolution');
  }
  if (failureReasons.includes('skew_too_severe')) {
    tips.push('Try to position your phone directly above the invoice');
  }
  if (failureReasons.includes('no_supported_text_detected')) {
    tips.push('Ensure the invoice text is legible and not covered');
  }
  if (failureReasons.includes('totals_not_found')) {
    tips.push('Make sure the total amount is visible in the photo');
  }

  if (tips.length === 0) {
    tips.push('Try taking another photo with better lighting and focus');
  }

  return tips;
}

module.exports = {
  calculateScore,
  getStatusFromScore,
  getTipsForFailureReasons
};
