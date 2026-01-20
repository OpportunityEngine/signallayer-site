// =====================================================
// OCR ENGINE
// Multi-engine OCR with scoring and best-result selection
// =====================================================

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Check for PaddleOCR availability (feature flag)
const PADDLE_OCR_ENABLED = process.env.PADDLE_OCR_ENABLED === 'true';

// PSM modes to try (in order of preference for invoices)
const PSM_MODES = [
  { mode: 6, name: 'uniform_block', description: 'Assume uniform text block' },
  { mode: 4, name: 'single_column', description: 'Assume single column of variable text' },
  { mode: 3, name: 'fully_auto', description: 'Fully automatic page segmentation' },
  { mode: 11, name: 'sparse_text', description: 'Sparse text, find as much as possible' },
  { mode: 1, name: 'auto_osd', description: 'Automatic with orientation detection' }
];

// Invoice-related keywords for scoring
const INVOICE_KEYWORDS = [
  'invoice', 'total', 'subtotal', 'tax', 'amount', 'due', 'qty', 'quantity',
  'price', 'unit', 'description', 'item', 'date', 'bill', 'payment',
  'ship', 'address', 'po', 'order', 'receipt', 'balance', 'net', 'gross'
];

/**
 * Extract text from image using OCR
 */
async function extractText(imageBuffer, options = {}) {
  const result = {
    text: '',
    confidence: 0,
    score: 0,
    engine: 'tesseract',
    boxes: [],
    notes: []
  };

  const tempDir = os.tmpdir();
  const tempId = `ocr-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const inputPath = path.join(tempDir, `${tempId}-input.png`);

  try {
    // Write image to temp file
    fs.writeFileSync(inputPath, imageBuffer);

    // Try PaddleOCR first if enabled
    if (PADDLE_OCR_ENABLED) {
      try {
        const paddleResult = await runPaddleOCR(inputPath);
        if (paddleResult.score > 0.7) {
          result.text = paddleResult.text;
          result.confidence = paddleResult.confidence;
          result.score = paddleResult.score;
          result.engine = 'paddleocr';
          result.boxes = paddleResult.boxes;
          result.notes.push('PaddleOCR primary extraction');
          return result;
        }
        result.notes.push(`PaddleOCR score too low: ${paddleResult.score}`);
      } catch (paddleErr) {
        result.notes.push(`PaddleOCR failed: ${paddleErr.message}`);
      }
    }

    // Tesseract extraction with multiple PSM modes
    let bestTesseractResult = null;
    let bestTesseractScore = 0;

    for (const psmConfig of PSM_MODES) {
      try {
        const tesseractResult = await runTesseract(inputPath, psmConfig.mode);
        const score = scoreOCRResult(tesseractResult.text, tesseractResult.confidence);

        if (score > bestTesseractScore) {
          bestTesseractScore = score;
          bestTesseractResult = {
            ...tesseractResult,
            score,
            psmMode: psmConfig.mode,
            psmName: psmConfig.name
          };
        }

        // Early exit if we get excellent result
        if (score >= 0.85) {
          result.notes.push(`Early exit with PSM ${psmConfig.mode} (${psmConfig.name}), score: ${score.toFixed(2)}`);
          break;
        }
      } catch (tesseractErr) {
        result.notes.push(`Tesseract PSM ${psmConfig.mode} failed: ${tesseractErr.message}`);
      }
    }

    if (bestTesseractResult) {
      result.text = bestTesseractResult.text;
      result.confidence = bestTesseractResult.confidence;
      result.score = bestTesseractResult.score;
      result.engine = 'tesseract';
      result.notes.push(`Best PSM: ${bestTesseractResult.psmMode} (${bestTesseractResult.psmName})`);
    }

    return result;

  } finally {
    // Cleanup temp files
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch (cleanErr) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run Tesseract OCR
 */
async function runTesseract(inputPath, psmMode = 6) {
  const tempDir = os.tmpdir();
  const outputBase = path.join(tempDir, `tesseract-${Date.now()}`);

  const result = {
    text: '',
    confidence: 0
  };

  try {
    // Build Tesseract command
    const cmd = [
      'tesseract',
      `"${inputPath}"`,
      `"${outputBase}"`,
      '-l eng',
      `--psm ${psmMode}`,
      '--oem 3', // Use LSTM engine
      '-c preserve_interword_spaces=1',
      '-c tessedit_pageseg_mode=' + psmMode,
      'tsv' // Output TSV for confidence data
    ].join(' ');

    execSync(cmd, {
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Read TSV output for confidence
    const tsvPath = `${outputBase}.tsv`;
    if (fs.existsSync(tsvPath)) {
      const tsvContent = fs.readFileSync(tsvPath, 'utf8');
      const { text, avgConfidence } = parseTesseractTSV(tsvContent);
      result.text = text;
      result.confidence = avgConfidence;
      fs.unlinkSync(tsvPath);
    }

    // Also try plain text output as backup
    const txtPath = `${outputBase}.txt`;
    if (fs.existsSync(txtPath)) {
      if (!result.text) {
        result.text = fs.readFileSync(txtPath, 'utf8');
      }
      fs.unlinkSync(txtPath);
    }

  } catch (error) {
    // Try simpler command without TSV
    try {
      const simpleCmd = [
        'tesseract',
        `"${inputPath}"`,
        `"${outputBase}"`,
        '-l eng',
        `--psm ${psmMode}`,
        '--oem 3'
      ].join(' ');

      execSync(simpleCmd, {
        timeout: 30000,
        maxBuffer: 50 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      const txtPath = `${outputBase}.txt`;
      if (fs.existsSync(txtPath)) {
        result.text = fs.readFileSync(txtPath, 'utf8');
        result.confidence = estimateConfidenceFromText(result.text);
        fs.unlinkSync(txtPath);
      }
    } catch (simpleErr) {
      throw new Error(`Tesseract failed: ${simpleErr.message}`);
    }
  }

  return result;
}

/**
 * Parse Tesseract TSV output
 */
function parseTesseractTSV(tsvContent) {
  const lines = tsvContent.split('\n');
  const words = [];
  let totalConf = 0;
  let confCount = 0;

  for (let i = 1; i < lines.length; i++) { // Skip header
    const parts = lines[i].split('\t');
    if (parts.length >= 12) {
      const conf = parseInt(parts[10], 10);
      const text = parts[11];

      if (text && text.trim()) {
        words.push(text);
        if (!isNaN(conf) && conf > 0) {
          totalConf += conf;
          confCount++;
        }
      }
    }
  }

  return {
    text: words.join(' '),
    avgConfidence: confCount > 0 ? totalConf / confCount / 100 : 0.5
  };
}

/**
 * Run PaddleOCR (if installed)
 */
async function runPaddleOCR(inputPath) {
  return new Promise((resolve, reject) => {
    // PaddleOCR Python command
    const pythonCmd = `python3 -c "
import sys
import json
from paddleocr import PaddleOCR
ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
result = ocr.ocr('${inputPath}', cls=True)
output = {'lines': [], 'confidence': 0}
total_conf = 0
count = 0
for line in result[0]:
    box, (text, conf) = line
    output['lines'].append({'text': text, 'confidence': conf, 'box': box})
    total_conf += conf
    count += 1
output['confidence'] = total_conf / count if count > 0 else 0
print(json.dumps(output))
"`;

    exec(pythonCmd, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`PaddleOCR error: ${error.message}`));
        return;
      }

      try {
        const data = JSON.parse(stdout.trim());
        const text = data.lines.map(l => l.text).join('\n');
        const confidence = data.confidence;
        const score = scoreOCRResult(text, confidence);

        resolve({
          text,
          confidence,
          score,
          boxes: data.lines
        });
      } catch (parseErr) {
        reject(new Error(`PaddleOCR parse error: ${parseErr.message}`));
      }
    });
  });
}

/**
 * Score OCR result based on content quality
 */
function scoreOCRResult(text, rawConfidence) {
  if (!text || text.length < 10) return 0;

  let score = 0;

  // Base score from raw confidence
  score += rawConfidence * 0.3;

  // Check for invoice keywords
  const lowerText = text.toLowerCase();
  let keywordCount = 0;
  for (const keyword of INVOICE_KEYWORDS) {
    if (lowerText.includes(keyword)) {
      keywordCount++;
    }
  }
  score += Math.min(keywordCount / 8, 0.25); // Max 0.25 from keywords

  // Check for currency/numbers
  const pricePattern = /\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g;
  const prices = text.match(pricePattern) || [];
  score += Math.min(prices.length / 10, 0.2); // Max 0.2 from prices

  // Check for date patterns
  const datePattern = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g;
  const dates = text.match(datePattern) || [];
  score += Math.min(dates.length / 3, 0.1); // Max 0.1 from dates

  // Penalize gibberish (high ratio of non-alphanumeric)
  const alphanumeric = text.replace(/[^a-zA-Z0-9]/g, '').length;
  const total = text.length;
  const alphaRatio = alphanumeric / total;
  if (alphaRatio < 0.4) {
    score -= 0.2; // Penalty for too much garbage
  }

  // Penalize very short text
  if (text.length < 100) {
    score -= 0.1;
  } else if (text.length > 500) {
    score += 0.05; // Bonus for substantial text
  }

  // Penalize repetitive characters (OCR artifacts)
  const repetitive = /(.)\1{4,}/g;
  const artifacts = text.match(repetitive) || [];
  score -= artifacts.length * 0.05;

  return Math.max(0, Math.min(1, score));
}

/**
 * Estimate confidence from text content when TSV not available
 */
function estimateConfidenceFromText(text) {
  if (!text || text.length < 10) return 0.1;

  let confidence = 0.5;

  // Check for readable words
  const words = text.split(/\s+/).filter(w => w.length > 2);
  const readableWords = words.filter(w => /^[a-zA-Z0-9$.,]+$/.test(w));
  const readableRatio = readableWords.length / Math.max(words.length, 1);

  confidence += readableRatio * 0.3;

  // Check for invoice indicators
  const lowerText = text.toLowerCase();
  if (lowerText.includes('total') || lowerText.includes('amount')) confidence += 0.1;
  if (lowerText.includes('invoice') || lowerText.includes('receipt')) confidence += 0.05;
  if (/\$\d/.test(text)) confidence += 0.05;

  return Math.min(confidence, 0.95);
}

module.exports = {
  extractText,
  runTesseract,
  scoreOCRResult,
  INVOICE_KEYWORDS
};
