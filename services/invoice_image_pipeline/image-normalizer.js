// =====================================================
// IMAGE NORMALIZER
// Handles preprocessing, deskewing, quality assessment
// =====================================================

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Target resolution for OCR (balance between quality and speed)
const TARGET_LONG_EDGE = 2800;
const MIN_DIMENSION = 800;
const MAX_DIMENSION = 4000;

/**
 * Normalize image for optimal OCR extraction
 * Creates multiple variants for retry strategy
 */
async function normalize(imageBuffer, options = {}) {
  const result = {
    quality: {
      blurScore: 0,
      glareScore: 0,
      skewScore: 0,
      brightness: 0,
      contrast: 0,
      resolution: { width: 0, height: 0 },
      docDetected: false,
      overallQuality: 0
    },
    variants: [],
    previewPaths: null
  };

  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    result.quality.resolution = {
      width: metadata.width,
      height: metadata.height
    };

    console.log(`[NORMALIZER] Input image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`);

    // Handle HEIC/HEIF conversion
    let workingBuffer = imageBuffer;
    if (metadata.format === 'heif' || options.filename?.toLowerCase().endsWith('.heic')) {
      console.log(`[NORMALIZER] Converting HEIC to JPEG`);
      workingBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 95 })
        .toBuffer();
    }

    // Calculate quality metrics from original
    const qualityMetrics = await assessImageQuality(workingBuffer);
    Object.assign(result.quality, qualityMetrics);

    // Calculate overall quality score
    result.quality.overallQuality = calculateOverallQuality(result.quality);

    // =========================================
    // Create normalized variants
    // =========================================

    // Variant A: Standard normalization (balanced)
    const variantA = await createStandardVariant(workingBuffer, metadata);
    result.variants.push({
      name: 'standard',
      buffer: variantA,
      description: 'Balanced normalization with auto-rotate and contrast enhancement'
    });

    // Variant B: High contrast (for low-quality photos)
    const variantB = await createHighContrastVariant(workingBuffer, metadata);
    result.variants.push({
      name: 'high_contrast',
      buffer: variantB,
      description: 'Aggressive contrast enhancement for dark/faded images'
    });

    // Variant C: Receipt mode (binarization for receipts)
    const variantC = await createReceiptVariant(workingBuffer, metadata);
    result.variants.push({
      name: 'receipt_mode',
      buffer: variantC,
      description: 'Binary threshold for thermal receipts and low-quality prints'
    });

    // Variant D: Sharpen focus (for slightly blurry images)
    if (result.quality.blurScore > 0.3) {
      const variantD = await createSharpVariant(workingBuffer, metadata);
      result.variants.push({
        name: 'sharpened',
        buffer: variantD,
        description: 'Extra sharpening for slightly blurry images'
      });
    }

    console.log(`[NORMALIZER] Created ${result.variants.length} variants`);

    return result;

  } catch (error) {
    console.error(`[NORMALIZER] Error normalizing image:`, error);
    throw error;
  }
}

/**
 * Assess image quality metrics
 */
async function assessImageQuality(imageBuffer) {
  const metrics = {
    blurScore: 0,
    glareScore: 0,
    skewScore: 0,
    brightness: 0,
    contrast: 0,
    docDetected: false
  };

  try {
    // Get image stats
    const stats = await sharp(imageBuffer).stats();

    // Calculate brightness (average of all channels)
    const avgBrightness = stats.channels.reduce((sum, ch) => sum + ch.mean, 0) /
      (stats.channels.length * 255);
    metrics.brightness = avgBrightness;

    // Calculate contrast (standard deviation normalized)
    const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) /
      stats.channels.length;
    metrics.contrast = Math.min(avgStdDev / 80, 1); // Normalize to 0-1

    // Estimate blur using edge detection proxy
    // High entropy in grayscale = sharper image
    const grayBuffer = await sharp(imageBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const edgeVariance = calculateEdgeVariance(grayBuffer.data, grayBuffer.info.width, grayBuffer.info.height);
    // Lower variance = more blur
    metrics.blurScore = Math.max(0, 1 - (edgeVariance / 2000));

    // Estimate glare (overexposed pixels)
    const histogram = await getHistogram(imageBuffer);
    const overexposed = histogram.slice(245, 256).reduce((a, b) => a + b, 0);
    const totalPixels = histogram.reduce((a, b) => a + b, 0);
    metrics.glareScore = Math.min(overexposed / totalPixels * 10, 1);

    // Document detection heuristic
    // Check if image has rectangular structure (edges)
    metrics.docDetected = metrics.contrast > 0.3 && metrics.blurScore < 0.6;

    // Skew estimation (simplified - based on edge distribution)
    metrics.skewScore = estimateSkew(grayBuffer.data, grayBuffer.info.width, grayBuffer.info.height);

  } catch (error) {
    console.error(`[NORMALIZER] Error assessing quality:`, error);
  }

  return metrics;
}

/**
 * Calculate edge variance (Laplacian-like proxy)
 */
function calculateEdgeVariance(data, width, height) {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  // Sample every 4th pixel for performance
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const idx = y * width + x;
      const laplacian = Math.abs(
        4 * data[idx] -
        data[idx - 1] -
        data[idx + 1] -
        data[idx - width] -
        data[idx + width]
      );
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  return (sumSq / count) - (mean * mean);
}

/**
 * Get histogram of image luminance
 */
async function getHistogram(imageBuffer) {
  const { data } = await sharp(imageBuffer)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++;
  }
  return histogram;
}

/**
 * Estimate skew angle (simplified)
 */
function estimateSkew(data, width, height) {
  // Sample horizontal line variance at different positions
  let variance = 0;
  const sampleLines = 10;

  for (let i = 0; i < sampleLines; i++) {
    const y = Math.floor((height / sampleLines) * i + height / (sampleLines * 2));
    let lineSum = 0;
    let lineSumSq = 0;

    for (let x = 0; x < width; x++) {
      const val = data[y * width + x];
      lineSum += val;
      lineSumSq += val * val;
    }

    const lineMean = lineSum / width;
    const lineVar = (lineSumSq / width) - (lineMean * lineMean);
    variance += lineVar;
  }

  // Higher variance suggests more text lines, lower skew
  const avgVariance = variance / sampleLines;
  return Math.max(0, 1 - (avgVariance / 3000));
}

/**
 * Calculate overall quality score
 */
function calculateOverallQuality(quality) {
  // Weighted combination
  const weights = {
    blur: 0.3,
    glare: 0.2,
    brightness: 0.2,
    contrast: 0.2,
    skew: 0.1
  };

  // Penalties for bad values
  const blurPenalty = quality.blurScore > 0.5 ? quality.blurScore : 0;
  const glarePenalty = quality.glareScore > 0.4 ? quality.glareScore : 0;
  const brightnessPenalty = Math.abs(quality.brightness - 0.5) > 0.3 ?
    Math.abs(quality.brightness - 0.5) : 0;
  const contrastBonus = quality.contrast > 0.3 ? 0.2 : 0;
  const skewPenalty = quality.skewScore > 0.4 ? quality.skewScore * 0.5 : 0;

  const score = 1 -
    (blurPenalty * weights.blur) -
    (glarePenalty * weights.glare) -
    (brightnessPenalty * weights.brightness) +
    (contrastBonus * weights.contrast) -
    (skewPenalty * weights.skew);

  return Math.max(0, Math.min(1, score));
}

/**
 * Create standard normalized variant
 */
async function createStandardVariant(imageBuffer, metadata) {
  let pipeline = sharp(imageBuffer)
    .rotate() // Auto-rotate based on EXIF
    .grayscale();

  // Resize if too large or too small
  const longEdge = Math.max(metadata.width, metadata.height);
  if (longEdge > MAX_DIMENSION) {
    pipeline = pipeline.resize(TARGET_LONG_EDGE, TARGET_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true
    });
  } else if (longEdge < MIN_DIMENSION) {
    // Upscale small images
    const scale = MIN_DIMENSION / longEdge;
    pipeline = pipeline.resize(
      Math.round(metadata.width * scale),
      Math.round(metadata.height * scale),
      { fit: 'fill' }
    );
  }

  // Apply normalization
  pipeline = pipeline
    .normalize() // Histogram stretching
    .sharpen({ sigma: 1.2 }) // Mild sharpening
    .median(3); // Light noise reduction

  return pipeline.png().toBuffer();
}

/**
 * Create high contrast variant for dark/faded images
 */
async function createHighContrastVariant(imageBuffer, metadata) {
  let pipeline = sharp(imageBuffer)
    .rotate()
    .grayscale();

  // Resize similarly
  const longEdge = Math.max(metadata.width, metadata.height);
  if (longEdge > MAX_DIMENSION) {
    pipeline = pipeline.resize(TARGET_LONG_EDGE, TARGET_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // Aggressive contrast enhancement
  pipeline = pipeline
    .normalize()
    .linear(1.4, -30) // Increase contrast, reduce brightness
    .sharpen({ sigma: 1.5 })
    .median(3);

  return pipeline.png().toBuffer();
}

/**
 * Create receipt mode variant (binarization)
 */
async function createReceiptVariant(imageBuffer, metadata) {
  let pipeline = sharp(imageBuffer)
    .rotate()
    .grayscale();

  // Resize
  const longEdge = Math.max(metadata.width, metadata.height);
  if (longEdge > MAX_DIMENSION) {
    pipeline = pipeline.resize(TARGET_LONG_EDGE, TARGET_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // Binary threshold for receipts
  pipeline = pipeline
    .normalize()
    .linear(1.3, -20)
    .threshold(140) // Convert to black/white
    .sharpen({ sigma: 0.8 });

  return pipeline.png().toBuffer();
}

/**
 * Create sharpened variant for blurry images
 */
async function createSharpVariant(imageBuffer, metadata) {
  let pipeline = sharp(imageBuffer)
    .rotate()
    .grayscale();

  // Resize
  const longEdge = Math.max(metadata.width, metadata.height);
  if (longEdge > MAX_DIMENSION) {
    pipeline = pipeline.resize(TARGET_LONG_EDGE, TARGET_LONG_EDGE, {
      fit: 'inside',
      withoutEnlargement: true
    });
  }

  // Extra sharpening
  pipeline = pipeline
    .normalize()
    .sharpen({ sigma: 2.5, m1: 1.5, m2: 1.0 }) // Aggressive sharpening
    .median(3);

  return pipeline.png().toBuffer();
}

module.exports = {
  normalize,
  assessImageQuality,
  calculateOverallQuality
};
