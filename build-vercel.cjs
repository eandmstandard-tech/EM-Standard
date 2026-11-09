'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const assetRoot = path.join(root, 'dist', 'vendor');
const archive = fs.readFileSync(path.join(root, 'assets', 'pdf-ocr-vendor.json.gz'));
const manifest = JSON.parse(zlib.gunzipSync(archive, {maxOutputLength: 32 * 1024 * 1024}).toString('utf8'));
if (manifest.format !== 1 || !Array.isArray(manifest.files) ||
    manifest.files.length === 0 || manifest.files.length > 1000) {
  throw new Error('Invalid PDF/OCR asset bundle');
}

const assets = new Map();
for (const entry of manifest.files) {
  if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid asset record');
  const [relative, data] = entry;
  if (typeof relative !== 'string' || !/^(ocr|pdfjs)\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(relative) ||
      typeof data !== 'string' || assets.has(relative)) {
    throw new Error('Invalid or duplicate asset path');
  }
  const decoded = Buffer.from(data, 'base64');
  if (decoded.toString('base64') !== data) throw new Error('Invalid asset contents');
  assets.set(relative, decoded);
}

for (const name of [
  'pdfjs/pdf.min.mjs', 'pdfjs/pdf.worker.min.mjs',
  'ocr/tesseract.esm.min.js', 'ocr/worker.min.js', 'ocr/tesseract-core-lstm.wasm.js',
  'ocr/lang/eng.traineddata.gz', 'ocr/lang/tha.traineddata.gz',
]) {
  if (!assets.has(name)) throw new Error('Missing PDF/OCR asset: ' + name);
}

// Validate deployment URLs before writing the generated vendor files.
require('./build-config.cjs');
fs.rmSync(assetRoot, {recursive: true, force: true});
for (const [relative, data] of assets) {
  const target = path.join(assetRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, data);
}
console.log('Prepared ' + assets.size + ' PDF/OCR assets for Vercel.');
