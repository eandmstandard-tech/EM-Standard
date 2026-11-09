'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pattern = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

function readDeploymentUrl(name) {
  const value = (process.env[name] || '').trim();
  if (value && !pattern.test(value)) {
    throw new Error(name + ' ต้องเป็น URL ของ Apps Script Web App ที่ลงท้ายด้วย /exec');
  }
  return value;
}

const config = {
  appsScriptUrl: readDeploymentUrl('APPS_SCRIPT_URL'),
  readerUrl: readDeploymentUrl('APPS_SCRIPT_READER_URL'),
};
if (config.readerUrl && config.readerUrl === config.appsScriptUrl) {
  throw new Error('Owner และ Reader ต้องเป็นคนละ deployment URL');
}
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'config.js'),
  '// Generated from deploy settings. Only URLs, never secrets.\nwindow.ENGINEERING_STANDARDS_CONFIG = ' +
  JSON.stringify(config, null, 2) + ';\n');
