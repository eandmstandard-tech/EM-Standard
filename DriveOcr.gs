/** Drive OCR pilot. Only the configured owner may create/update the private index. */
var PDF_OCR_JOBS_KEY = 'HUB_DRIVE_PAGE_OCR_V1';
var DRIVE_OCR_MAX_SOURCE = 20 * 1024 * 1024;
var DRIVE_OCR_MAX_PAGE = 2 * 1024 * 1024;
var DRIVE_OCR_MAX_PAGES = 40;
var DRIVE_OCR_TEMP_MARKER = 'engineeringHubOcrV1';
var DRIVE_OCR_TRIGGER_KEY = 'HUB_DRIVE_OCR_TRIGGER_V1';
var DRIVE_OCR_TRIGGER_HANDLER = 'scheduledDriveOcrPage_';

function pdfOcrConfig_() {
  var p = PropertiesService.getScriptProperties();
  var ids = String(p.getProperty('PDF_OCR_FILE_IDS') || '').trim().split(/[\s,]+/).filter(Boolean);
  ids = ids.filter(function(id, i) { return ids.indexOf(id) === i; });
  var owner = String(p.getProperty('PDF_OCR_OWNER_EMAIL') || '').toLowerCase().trim();
  var lang = String(p.getProperty('PDF_OCR_LANGUAGE') || '').trim().toLowerCase();
  if (!ids.length || ids.length > 3 || !ids.every(driveOcrId_) ||
      !/^[^\s@]+@[^\s@]+$/.test(owner) || (lang && !/^[a-z]{2}$/.test(lang))) return null;
  return {ids:ids, owner:owner, lang:lang, key:['drive-page-ocr-v1', owner, lang].join('|')};
}

function driveOcrId_(id) { return /^[A-Za-z0-9_-]{8,128}$/.test(String(id || '')); }

function pdfOcrAccess_(config) {
  if (!config) return false;
  try {
    return String(Session.getActiveUser().getEmail() || '').toLowerCase() === config.owner &&
      String(Session.getEffectiveUser().getEmail() || '').toLowerCase() === config.owner;
  } catch (ignore) { return false; }
}

function requirePdfOcrOwner_() {
  var config = pdfOcrConfig_();
  if (!config) throw new Error('ตั้ง PDF_OCR_OWNER_EMAIL และ PDF_OCR_FILE_IDS (1–3 ID) ก่อน');
  if (!pdfOcrAccess_(config)) throw new Error('โปรดใช้บัญชีเจ้าของที่ระบุใน PDF_OCR_OWNER_EMAIL');
  return config;
}

function getPdfOcrJobs_() {
  return Object.assign(Object.create(null), JSON.parse(PropertiesService.getScriptProperties().getProperty(PDF_OCR_JOBS_KEY) || '{}'));
}

function saveDriveOcrJobs_(jobs) {
  PropertiesService.getScriptProperties().setProperty(PDF_OCR_JOBS_KEY, JSON.stringify(jobs));
}

function driveOcrRevision_(file) {
  return [file.modifiedDate, Number(file.fileSize || 0), String(file.md5Checksum || '').toLowerCase()].join('|');
}

function pdfOcrFile_(id, standards) {
  var file = Drive.Files.get(id, {fields:'id,title,mimeType,fileSize,modifiedDate,md5Checksum,labels(trashed),parents(id)',supportsAllDrives:true});
  if (file.id !== id || file.mimeType !== 'application/pdf' || !file.modifiedDate ||
      !/^[a-f0-9]{32}$/i.test(String(file.md5Checksum || '')) || (file.labels && file.labels.trashed))
    throw new Error('เลือก PDF ต้นฉบับที่ยังใช้งานอยู่ใน Drive');
  var size = Number(file.fileSize || 0);
  if (!size || size > DRIVE_OCR_MAX_SOURCE) throw new Error('PDF ต้นฉบับต้องไม่เกิน 20 MB');
  var folders = Object.create(null), ancestry = Object.create(null), folderId = '', rootId = rootFolderId_();
  standards.forEach(function(s) { folders[s.id] = true; });
  (file.parents || []).some(function(parent) {
    folderId = resolveStandardFolder_(parent.id, folders, ancestry, 0, rootId);
    return !!folderId;
  });
  var root = Object.create(null); root[rootId] = true;
  if (!folderId || !resolveStandardFolder_(folderId, root, Object.create(null), 0, rootId))
    throw new Error('PDF ไม่ได้อยู่ในโฟลเดอร์มาตรฐานที่จัดทำดัชนี');
  return {id:id, size:size, folderId:folderId, name:String(file.title || 'PDF'), mimeType:file.mimeType,
    revision:driveOcrRevision_(file), md5:String(file.md5Checksum).toLowerCase(),
    url:'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view'};
}

/** Queue OCR from the editor. Existing matching, finished indexes are reused. */
function queueDrivePdfOcrPilot() {
  var config = requirePdfOcrOwner_(), lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('กำลังทำ OCR อยู่ ลองอีกครั้งเมื่อจบ');
  try {
    var jobs = getPdfOcrJobs_(), standards = getStandardsPayload_().standards;
    config.ids.forEach(function(id) {
      var file = pdfOcrFile_(id, standards), job = Object.prototype.hasOwnProperty.call(jobs,id) ? jobs[id] : null;
      if (!job || job.configKey !== config.key || job.revision !== file.revision) {
        jobs[id] = {status:'queued', configKey:config.key, revision:file.revision, count:0,
          done:0, indexId:job && job.indexId || ''};
      } else if (job.status === 'error') {
        job.status = job.done ? 'processing' : 'queued'; delete job.error;
      }
    });
    // Preserve only active jobs in script properties. Removed files aren't searchable.
    var selected = Object.create(null);
    config.ids.forEach(function(id) { selected[id] = jobs[id]; });
    saveDriveOcrJobs_(selected);
    Logger.log(JSON.stringify({queued:config.ids.length, statuses:config.ids.map(function(id) { return selected[id].status; })}));
  } finally { lock.releaseLock(); }
}

/** Run from the editor. One original PDF page per invocation; never called by Refresh. */
function processDrivePdfOcrPilot() { return driveOcrRunPage_(requirePdfOcrOwner_()); }

/** Editor-only opt-in. Run after testing OCR manually; stops once the queue is drained. */
function startDriveOcrBackground() {
  var config = requirePdfOcrOwner_(), lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('กำลังทำ OCR อยู่ ลองอีกครั้งเมื่อจบ');
  try {
    var jobs = getPdfOcrJobs_();
    if (!driveOcrPendingId_(config,jobs)) throw new Error('ไม่มีงานรอทำ ให้รัน queueDrivePdfOcrPilot ก่อน');
    stopDriveOcrTrigger_();
    var trigger = ScriptApp.newTrigger(DRIVE_OCR_TRIGGER_HANDLER).timeBased().everyMinutes(1).create();
    PropertiesService.getScriptProperties().setProperty(DRIVE_OCR_TRIGGER_KEY,
      JSON.stringify({uid:trigger.getUniqueId(), owner:config.owner, key:config.key}));
    Logger.log('เปิดการทำ OCR เบื้องหลังแล้ว ดูผลที่ Executions');
  } finally { lock.releaseLock(); }
}

function stopDriveOcrBackground() {
  requirePdfOcrOwner_();
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('กำลังทำ OCR อยู่ ลองอีกครั้งเมื่อจบ');
  try { stopDriveOcrTrigger_(); }
  finally { lock.releaseLock(); }
}

function stopDriveOcrTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === DRIVE_OCR_TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
  PropertiesService.getScriptProperties().deleteProperty(DRIVE_OCR_TRIGGER_KEY);
}

function scheduledDriveOcrPage_(e) {
  var setting = JSON.parse(PropertiesService.getScriptProperties().getProperty(DRIVE_OCR_TRIGGER_KEY) || '{}');
  if (!e || !setting.uid || String(e.triggerUid || '') !== String(setting.uid) ||
      String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== setting.owner) return;
  var config = pdfOcrConfig_();
  return driveOcrRunPage_(config && config.owner === setting.owner && config.key === setting.key ? config : null, String(setting.uid));
}

function driveOcrPendingId_(config,jobs) {
  if (!config) return '';
  return config.ids.filter(function(id) {
    var j = jobs[id];
    return j && j.configKey === config.key && ['queued','processing'].indexOf(j.status) >= 0;
  })[0];
}

async function driveOcrRunPage_(config, scheduled) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) {
    if (scheduled) return;
    throw new Error('กำลังทำ OCR อยู่ ลองอีกครั้งเมื่อจบ');
  }
  try {
    if (scheduled) {
      var current = JSON.parse(PropertiesService.getScriptProperties().getProperty(DRIVE_OCR_TRIGGER_KEY) || '{}');
      if (String(current.uid || '') !== scheduled) return;
    }
    var jobs = getPdfOcrJobs_();
    var id = driveOcrPendingId_(config,jobs);
    if (!id) {
      if (scheduled) stopDriveOcrTrigger_();
      Logger.log('ไม่มีงานค้าง: หากเพิ่งตั้งค่าให้รัน queueDrivePdfOcrPilot'); return;
    }
    var job = jobs[id], result;
    try {
      var standards = getStandardsPayload_().standards;
      var file = pdfOcrFile_(id, standards);
      if (file.revision !== job.revision) throw new Error('PDF เปลี่ยนหลังเข้าคิว ให้รัน Queue ใหม่');
      var data = job.indexId ? driveOcrReadIndex_(job.indexId) : null;
      if (!data) job.indexId = '';
      if (!data || data.revision !== job.revision || data.configKey !== config.key ||
          !driveOcrValidIndex_(data)) {
        data = {revision:job.revision, configKey:config.key, pageCount:0, pages:[]};
        job.done = 0; job.count = 0;
      }
      if (!data.pageCount || data.pages.length < data.pageCount) {
        var bytes = driveOcrApi_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
          '?alt=media&supportsAllDrives=true',{}, 'อ่าน PDF ต้นฉบับ').getBlob().getBytes();
        if (bytes.length !== file.size || driveOcrDigest_(bytes) !== file.md5)
          throw new Error('PDF เปลี่ยนระหว่างอ่าน ให้รัน Queue ใหม่');
        var page = await driveOcrSplitPage_(bytes, data.pages.length);
        if (data.pageCount && data.pageCount !== page.count) throw new Error('จำนวนหน้าของ PDF ไม่ตรงกับดัชนี');
        data.pageCount = page.count;
        var number = data.pages.length + 1;
        var content = driveOcrReadPageText_(page.bytes, config.lang);
        if (pdfOcrFile_(id, standards).revision !== job.revision)
          throw new Error('PDF เปลี่ยนระหว่าง OCR ให้รัน Queue ใหม่');
        data.pages.push({number:number, text:content});
        job.indexId = driveOcrWriteIndex_(job.indexId, id, data);
      }
      job.done = data.pages.length;
      job.count = data.pageCount;
      job.status = job.done < job.count ? 'processing' :
        data.pages.some(function(p) { return !!p.text; }) ? 'ready' : 'no_text';
      delete job.error;
    } catch (error) {
      job.status = 'error'; job.error = String(error.message || error).slice(0,240);
    }
    saveDriveOcrJobs_(jobs);
    result = {status:job.status, pagesDone:job.done, pageCount:job.count, error:job.error || ''};
    Logger.log(JSON.stringify(result));
    if (scheduled && !driveOcrPendingId_(config,jobs)) stopDriveOcrTrigger_();
    return result;
  } finally { lock.releaseLock(); }
}

function driveOcrDigest_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes).map(function(b) {
    return ('0' + (b & 255).toString(16)).slice(-2);
  }).join('');
}

async function driveOcrSplitPage_(bytes, i) {
  if (typeof PDFLib === 'undefined') throw new Error('ยังไม่มีไฟล์ PdfLib.gs ในโปรเจกต์ Owner');
  var original;
  try {
    original = await PDFLib.PDFDocument.load(Uint8Array.from(bytes), {parseSpeed:Infinity, updateMetadata:false});
  } catch (ignore) { throw new Error('เปิด PDF ไม่ได้: ตรวจไฟล์เสียหรือ PDF ที่ล็อก/เข้ารหัส'); }
  var count = original.getPageCount();
  if (count < 1 || count > DRIVE_OCR_MAX_PAGES || i < 0 || i >= count)
    throw new Error('รุ่นทดสอบรองรับ PDF ตั้งแต่ 1 ถึง 40 หน้า');
  var one = await PDFLib.PDFDocument.create({updateMetadata:false});
  var copied = await one.copyPages(original, [i]);
  one.addPage(copied[0]);
  var single = await one.save({objectsPerTick:Infinity, updateFieldAppearances:false});
  if (single.length > DRIVE_OCR_MAX_PAGE) throw new Error('หน้า ' + (i+1) + ' เกิน 2 MB หลังแยกหน้า');
  return {count:count, bytes:Array.from(single, function(n) { return n < 128 ? n : n - 256; })};
}

function driveOcrApi_(url, options, purpose, allowMissing) {
  options = options || {};
  options.headers = {Authorization:'Bearer ' + ScriptApp.getOAuthToken()};
  options.followRedirects = false;
  options.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch(url, options), code = response.getResponseCode();
  if (code === 404 && allowMissing) return null;
  if (code < 200 || code >= 300) throw new Error(purpose + ' ไม่สำเร็จ (HTTP ' + code + ')');
  return response;
}

function driveOcrUpload_(url, metadata, mimeType, bytes, method, purpose) {
  var boundary = 'ocr_' + Utilities.getUuid().replace(/-/g,'');
  var head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: ' + mimeType + '\r\n\r\n';
  var tail = '\r\n--' + boundary + '--\r\n';
  var payload = Utilities.newBlob(head).getBytes().concat(bytes, Utilities.newBlob(tail).getBytes());
  return JSON.parse(driveOcrApi_(url, {method:method,contentType:'multipart/related; boundary=' + boundary,
    payload:payload},purpose).getContentText());
}

function driveOcrReadPageText_(bytes, lang) {
  var docs = 'application/vnd.google-apps.document';
  var created = driveOcrUpload_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart' +
    '&ignoreDefaultVisibility=true&fields=id,mimeType' + (lang ? '&ocrLanguage=' + encodeURIComponent(lang) : ''),
    {name:'ESH-OCR-TEMP-' + Utilities.getUuid() + '.pdf', mimeType:docs, appProperties:{eshOcr:DRIVE_OCR_TEMP_MARKER}},
    'application/pdf', bytes, 'post', 'แปลงหน้า PDF ด้วย Drive OCR');
  if (!driveOcrId_(created.id)) throw new Error('Drive ไม่ส่ง ID ของเอกสาร OCR ชั่วคราว');
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(created.id);
  try {
    if (created.mimeType !== docs) throw new Error('Drive ไม่ได้แปลง PDF เป็น Google Docs');
    var response = driveOcrApi_(url + '/export?mimeType=text%2Fplain', {}, 'อ่านข้อความ OCR');
    var text = response.getContentText('UTF-8').replace(/[\u200B\uFEFF]/g,'').normalize('NFC').replace(/\s+/g,' ').trim();
    if (text.length > 50000) throw new Error('ข้อความ OCR ต่อหน้าเกินขนาดที่รุ่นทดสอบรองรับ');
    return text;
  } finally {
    try { driveOcrApi_(url, {method:'delete'}, 'ลบเอกสาร OCR ชั่วคราว', true); }
    catch (ignore) { Logger.log('ลบเอกสาร OCR ชั่วคราวไม่สำเร็จ ให้รัน cleanupDriveOcrTemp จาก Editor'); }
  }
}

function driveOcrValidIndex_(data) {
  return data && Number.isSafeInteger(data.pageCount) && data.pageCount >= 1 &&
    data.pageCount <= DRIVE_OCR_MAX_PAGES && Array.isArray(data.pages) && data.pages.length <= data.pageCount &&
    data.pages.every(function(p,i) { return p && p.number === i+1 && typeof p.text === 'string' && p.text.length <= 50000; });
}

function driveOcrReadIndex_(id) {
  if (!driveOcrId_(id)) return null;
  var res = driveOcrApi_('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media',
    {}, 'อ่านดัชนี OCR ส่วนตัว', true);
  return res ? JSON.parse(res.getContentText('UTF-8')) : null;
}

function driveOcrWriteIndex_(indexId, fileId, data) {
  var base = 'https://www.googleapis.com/upload/drive/v3/files';
  var current = driveOcrId_(indexId);
  var metadata = {name:'ESH-OCR-index-' + fileId + '.json', mimeType:'application/json'};
  if (!current) metadata.parents = ['appDataFolder'];
  var result = driveOcrUpload_(base + (current ? '/' + encodeURIComponent(indexId) : '') + '?uploadType=multipart&fields=id',
    metadata, 'application/json', Utilities.newBlob(JSON.stringify(data)).getBytes(), current ? 'patch' : 'post', 'บันทึกดัชนี OCR ส่วนตัว');
  if (!driveOcrId_(result.id) || (current && result.id !== indexId)) throw new Error('Drive ไม่ส่ง ID ดัชนีที่ถูกต้อง');
  return result.id;
}

/** Editor cleanup for documents left by an interrupted invocation. Never touches source PDFs. */
function cleanupDriveOcrTemp() {
  requirePdfOcrOwner_();
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1000)) throw new Error('กำลังทำ OCR อยู่ ลองอีกครั้งเมื่อจบ');
  try {
    var query = "trashed = false and 'root' in parents and mimeType = 'application/vnd.google-apps.document'" +
      " and appProperties has {key='eshOcr' and value='" + DRIVE_OCR_TEMP_MARKER + "'}";
    var base = 'https://www.googleapis.com/drive/v3/files';
    var res = JSON.parse(driveOcrApi_(base + '?spaces=drive&pageSize=25&fields=nextPageToken,files(id)&q=' +
      encodeURIComponent(query),{},'ตรวจเอกสาร OCR ชั่วคราว').getContentText());
    var removed = 0;
    (res.files || []).forEach(function(f) {
      if (!driveOcrId_(f.id)) return;
      driveOcrApi_(base + '/' + encodeURIComponent(f.id),{method:'delete'},'ลบเอกสาร OCR ชั่วคราว',true);
      removed++;
    });
    Logger.log(JSON.stringify({removed:removed, more:!!res.nextPageToken}));
  } finally { lock.releaseLock(); }
}

/** Used after validating the current Drive file and the caller's access. */
function driveOcrIndexedMatches_(config, id, revision, words, mode) {
  if (!config || config.ids.indexOf(id) < 0) return null;
  var job = getPdfOcrJobs_()[id];
  if (!job || job.configKey !== config.key || job.revision !== revision || job.status !== 'ready') return null;
  var data = driveOcrReadIndex_(job.indexId);
  if (!driveOcrValidIndex_(data) || data.revision !== revision || data.configKey !== config.key ||
      data.pages.length !== data.pageCount) return null;
  return findPageMatches_(data.pages, words, mode, true);
}

function pdfOcrSearchHits_(config, standards, words, mode) {
  var result = {files:[], partial:false};
  if (!pdfOcrAccess_(config)) return result;
  config.ids.forEach(function(id) {
    try {
      var file = pdfOcrFile_(id, standards);
      var pages = driveOcrIndexedMatches_(config, id, file.revision, words, mode);
      if (!pages) { result.partial = true; return; }
      if (pages.length) result.files.push({id:id, name:file.name, mimeType:file.mimeType, url:file.url,
        folderId:file.folderId, pageIndexStatus:'ready', pages:pages, ocr:true});
    } catch (ignore) { result.partial = true; }
  });
  return result;
}

function testDrivePdfOcrSearch() {
  var query = PropertiesService.getScriptProperties().getProperty('PDF_OCR_TEST_QUERY');
  var result = searchDrivePdfOcrPilot(query, 'phrase');
  Logger.log(JSON.stringify({matches:result.files.length, partial:result.partial,
    pages:result.files.map(function(file) { return file.pages.map(function(page) { return page.number; }); })}));
}

/** Owner-only HTML RPC. Public GET/JSONP never returns OCR excerpts. */
function searchDrivePdfOcrPilot(input, requestedMode) {
  var config = requirePdfOcrOwner_();
  var query = String(input || '').replace(/[\u200B\uFEFF]/g,'').normalize('NFC').trim().replace(/\s+/g,' ');
  if (!query || query.length > 120) throw new Error('ใส่คำค้น 1–120 ตัวอักษร');
  var mode = requestedMode === 'phrase' || requestedMode === 'any' ? requestedMode : 'all';
  var words = mode === 'phrase' ? [query] : query.split(' ');
  if (words.length > 8) throw new Error('ค้นได้ไม่เกิน 8 คำต่อครั้ง');
  return pdfOcrSearchHits_(config, getStandardsPayload_().standards, words, mode);
}
