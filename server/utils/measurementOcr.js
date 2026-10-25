/**
 * Measurement OCR pipeline .1).
 * photographed paper -> sharp preprocessing -> up to 3 bounded Tesseract
 * passes (PSM 6, PSM 11, threshold-fallback PSM 6 only when needed) ->
 * best text by (parsed items, confidence). Temp files are the caller's
 * responsibility (see controller finally-cleanup).
 *
 * One worker is reused across passes (fast) and always terminated.
 * Confidence is a review signal only — never proof of correctness.
 */
const path = require("path");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const PASS_PSMS = [6, 11];
const FALLBACK_PSM = 6;

async function preprocess(srcPath, destPath, { threshold = false } = {}) {
  const meta = await sharp(srcPath).metadata();
  const longest = Math.max(meta.width || 0, meta.height || 0);

  let pipe = sharp(srcPath).rotate(); // EXIF orientation first

  if (longest > 2200) {
    // Cap huge camera images (memory-safe), keep aspect.
    pipe = pipe.resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true });
  } else if (longest > 0 && longest < 1000) {
    // Upscale tiny images so handwritten digits survive segmentation.
    pipe = pipe.resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: false });
  }

  pipe = pipe.grayscale().normalize().sharpen({ sigma: 1 });
  if (threshold) {
    pipe = pipe.threshold(140);
  }
  await pipe.png().toFile(destPath);
  return destPath;
}

async function recognizeWithPsm(worker, imagePath, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
  const { data } = await worker.recognize(imagePath);
  return {
    psm,
    text: (data && data.text) || "",
    confidence: typeof data?.confidence === "number" ? Math.round(data.confidence) : null
  };
}

// parseFn(text) -> { items }. Injected to avoid a util cycle
// (controller wires parseMeasurementText here).
async function runMeasurementOcr(srcPath, workDir, fileBase, parseFn) {
  const processedA = path.join(workDir, `${fileBase}-ocr-a.png`);
  const processedB = path.join(workDir, `${fileBase}-ocr-b.png`);
  const tempFiles = [processedA];
  const passes = [];
  const worker = await createWorker("eng");
  try {
    await preprocess(srcPath, processedA, { threshold: false });
    for (const psm of PASS_PSMS) {
      const pass = await recognizeWithPsm(worker, processedA, psm);
      pass.items = parseFn(pass.text).items;
      pass.detected_items = pass.items.length;
      passes.push({ psm: pass.psm, text: pass.text, confidence: pass.confidence, detected_items: pass.detected_items });
    }
    // Fallback only when both passes found nothing usable.
    const usable = passes.filter((p) => p.detected_items > 0);
    if (usable.length === 0) {
      await preprocess(srcPath, processedB, { threshold: true });
      tempFiles.push(processedB);
      const fallback = await recognizeWithPsm(worker, processedB, FALLBACK_PSM);
      fallback.items = parseFn(fallback.text).items;
      fallback.detected_items = fallback.items.length;
      passes.push({ psm: fallback.psm, text: fallback.text, confidence: fallback.confidence, detected_items: fallback.detected_items, fallback: true });
    }
  } finally {
    try { await worker.terminate(); } catch { /* already gone */ }
  }

  const withItems = passes.filter((p) => p.detected_items > 0);
  const pool = withItems.length > 0 ? withItems : passes;
  pool.sort((a, b) => {
    if (b.detected_items !== a.detected_items) return b.detected_items - a.detected_items;
    return (b.confidence ?? -1) - (a.confidence ?? -1);
  });
  const best = pool[0] || { psm: PASS_PSMS[0], text: "", confidence: null, detected_items: 0 };
  return { best, passes, tempFiles };
}

module.exports = { preprocess, recognizeWithPsm, runMeasurementOcr, PASS_PSMS };
