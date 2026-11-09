'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const root = __dirname;
const output = path.join(root, 'hub-public');
const assetRoot = path.join(output, 'vendor');
const archive = fs.readFileSync(path.join(root, 'pdf-ocr-vendor.json.gz'));
const frontend = new Map([
  ['hub-index.html', 'index.html'],
  ...['app.js', 'docx-search.js', 'drive-search.js', 'ocr-ui.js', 'ocr.js',
    'pdf-search.js', 'search-engine.js', 'search-snippets.js', 'style.css']
    .map(name => [name, name]),
]);
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

// Do not publish the old dist/, repository root, or previously tracked config.js.
const inputs = [...frontend].map(([file, outputName]) =>
  [outputName, fs.readFileSync(path.join(root, file))]);
const urlPattern = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
function deploymentUrl(name) {
  if (process.env.HUB_ENABLE_DRIVE !== '1') return '';
  const value = String(process.env[name] || '').trim();
  if (value && !urlPattern.test(value)) throw new Error(name + ' must be a Google Apps Script /exec URL');
  return value;
}
const config = {
  appsScriptUrl: deploymentUrl('APPS_SCRIPT_URL'),
  readerUrl: deploymentUrl('APPS_SCRIPT_READER_URL'),
};
if (config.appsScriptUrl && config.appsScriptUrl === config.readerUrl) {
  throw new Error('Owner and Reader must use separate deployment URLs');
}
fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output, {recursive: true});
for (const [name, contents] of inputs) fs.writeFileSync(path.join(output, name), contents);
fs.writeFileSync(path.join(output, 'config.js'),
  'window.ENGINEERING_STANDARDS_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n');
for (const [relative, data] of assets) {
  const target = path.join(assetRoot, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, data);
}
console.log('Prepared ' + assets.size + ' PDF/OCR assets for Vercel.');
