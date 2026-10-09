// VERSION: 2026-10-02-fast-refresh-v7.1 — Drive change gate and immediate refresh runner
/**
 * Engineering Standards Hub - Google Apps Script Web App
 *
 * วิธีใช้โดยย่อ
 * 1) เปิด https://script.new แล้วสร้างโปรเจกต์ชื่อ Engineering Standards Hub API
 * 2) ลบโค้ดเดิมใน Code.gs และวางไฟล์นี้ทั้งหมด
 * 3) ตรวจใน Services ว่ามี Drive API เวอร์ชัน v2 (Identifier: Drive) เพียงรายการเดียว
 * 4) กด Save แล้ว Run ฟังก์ชัน setupRefresh หนึ่งครั้ง
 *    ฟังก์ชันนี้สร้างดัชนีเริ่มต้นและทริกเกอร์ตรวจไฟล์ทุก 15 นาที
 * 5) หากต้องการเลขหน้าอัตโนมัติ ให้ตั้ง Script Properties:
 *    DOC_AI_PROJECT_ID, DOC_AI_LOCATION, DOC_AI_PROCESSOR_ID,
 *    PAGE_GCS_BUCKET, PAGE_SEARCH_DOMAIN
 *    โดยใช้ Layout Parser และ Cloud Storage ของบริษัทในโปรเจกต์เดียวกับ Script
 *    และกำหนด OAuth scopes ตาม README ก่อน Run setupPageIndexing หนึ่งครั้ง
 * 6) Deploy > Manage deployments > Edit > New version > Deploy
 * 7) Execute as: Me; Who has access: ผู้ใช้ภายในองค์กรเท่านั้น
 * 8) เว็บอ่านดัชนีที่บันทึกไว้โดยไม่สแกน Drive เมื่อเปิดหน้า
 *    ทริกเกอร์ตรวจรายการไฟล์/โฟลเดอร์ทุก 15 นาที และบันทึกดัชนีใหม่
 *    เฉพาะเมื่อมีรายการเพิ่ม ลบ หรือย้ายเข้า/ออกจากโฟลเดอร์
 *    หากสร้าง deployment ใหม่ ให้ปรับ URL /exec ใน dist/config.js
 *
 * หมายเหตุ: ใช้ var และไวยากรณ์พื้นฐานเพื่อหลีกเลี่ยงปัญหา
 * SyntaxError: Unexpected token 'const' ในบางโปรเจกต์
 */

var ROOT_FOLDER_ID = 'YOUR_STANDARD_FOLDER_ID'; // ตั้งค่ารหัสโฟลเดอร์ที่ได้รับอนุญาตก่อน Run
var CACHE_SECONDS = 300;
var INDEX_META_KEY = 'HUB_INDEX_META_V2ASYNC';
var INDEX_JOB_KEY = 'HUB_INDEX_JOB_V2ASYNC';
var INDEX_SIGNATURE_KEY = 'HUB_INDEX_TREE_SIGNATURE_V4';
var INDEX_CHECKED_KEY = 'HUB_INDEX_TREE_CHECKED_V4';
var PAGE_JOBS_META_KEY = 'HUB_PAGE_JOBS_META_V5';
var PAGE_SUMMARY_KEY = 'HUB_PAGE_SUMMARY_V7';
var CHANGE_STATE_META_KEY = 'HUB_CHANGE_STATE_V7';
var CHANGE_CURSOR_KEY = 'HUB_CHANGE_CURSOR_V7';
var PAGE_INDEX_LIMIT = 12;
var API_VERSION = '2026-10-02-fast-refresh-v7.1';

/**
 * จุดรับคำขอของ Web App
 * รองรับ JSON ปกติ และ JSONP ผ่านพารามิเตอร์ callback
 */
function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};

  try {
    if (params.action === 'health') {
      return createOutput_({
        ok: true,
        service: 'Engineering Standards Hub API',
        status: 'ready',
        apiVersion: API_VERSION,
        pageIndexEnabled: pageIndexConfigured_(),
        pageSearchAllowed: pageSearchAllowed_(),
        checkedAt: new Date().toISOString()
      }, params.callback);
    }

    if (params.action === 'search') {
      return createOutput_(searchStandardsByContent_(params.query, params.mode), params.callback);
    }

    if (params.action === 'pages') {
      return createOutput_(searchIndexedPages_(params.query, params.mode, params.fileIds), params.callback);
    }

    if (params.action === 'refresh') {
      return createOutput_(queueIndexRefresh_(params.requestId), params.callback);
    }
    if (params.action === 'runRefresh') {
      // Start an already accepted request now; the trigger remains a fallback.
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(String(params.requestId || ''))) throw new Error('requestId ไม่ถูกต้อง');
      rebuildIndex({requestId: String(params.requestId)});
      var result = refreshStatus_();
      if (result.jobId === params.requestId && result.syncStatus === 'complete') result.index = indexResponse_();
      return createOutput_(result, params.callback);
    }

    if (params.action === 'ensureFresh') {
      // Compatibility with an older frontend: never rebuild merely because of age.
      var freshness = refreshStatus_();
      freshness.autoRefreshSupported = true;
      return createOutput_(freshness, params.callback);
    }

    if (params.action === 'status') {
      return createOutput_(refreshStatus_(), params.callback);
    }

    return createOutput_(indexResponse_(), params.callback);
  } catch (error) {
    return createOutput_({
      ok: false,
      error: error && error.message ? error.message : String(error),
      generatedAt: new Date().toISOString()
    }, params.callback);
  }
}

/**
 * Search Drive's existing text index. Only standard folder metadata leaves
 * the script; document text and file names are never placed in the response.
 * Enable the Advanced Google Service "Drive API" (v2) before deploying.
 */
function searchStandardsByContent_(input, requestedMode) {
  var query = String(input || '').trim().replace(/\s+/g, ' ');
  var mode = requestedMode === 'any' || requestedMode === 'phrase' ? requestedMode : 'all';
  if (!query || query.length > 120) {
    throw new Error('โปรดใส่คำค้น 1–120 ตัวอักษร');
  }
  var words = mode === 'phrase' ? [query] : query.split(' ');
  if (words.length > 8) throw new Error('ค้นหาได้ไม่เกิน 8 คำต่อครั้ง');

  var currentIndex = getStandardsPayload_();
  var standards = currentIndex.standards;
  var sourceDriveId = currentIndex.rootFolder && currentIndex.rootFolder.driveId || '';
  var folderIds = {}, standardsById = {};
  for (var i = 0; i < standards.length; i += 1) {
    folderIds[standards[i].id] = true;
    standardsById[standards[i].id] = standards[i];
  }

  // Drive fullText matches indexed words/phrases; it does not return excerpts.
  var predicates = [];
  for (var w = 0; w < words.length; w += 1) {
    var term = mode === 'phrase' ? '"' + words[w].replace(/"/g, '\\"') + '"' : words[w];
    predicates.push("fullText contains '" + term.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'");
  }
  var textQuery = '(' + predicates.join(mode === 'any' ? ' or ' : ' and ') + ')';
  var mimeQuery = "(mimeType = 'application/pdf' or mimeType = 'application/msword' or " +
    "mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' or " +
    "mimeType = 'application/vnd.google-apps.document')";
  var driveQuery = 'trashed = false and ' + mimeQuery + ' and ' + textQuery;
  var matches = {}, matchingFiles = {}, ancestry = {}, pageToken = '', pagesRead = 0;
  do {
    var options = {
      q: driveQuery,
      maxResults: 1000,
      fields: 'nextPageToken,incompleteSearch,items(id,title,mimeType,alternateLink,parents(id))',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: sourceDriveId ? 'drive' : 'allDrives'
    };
    if (sourceDriveId) options.driveId = sourceDriveId;
    if (pageToken) options.pageToken = pageToken;
    var response = Drive.Files.list(options);
    if (response.incompleteSearch) throw new Error('Drive ค้นหาได้ไม่ครบ โปรดจำกัดการค้นใน Shared Drive ที่เก็บมาตรฐาน');
    var files = response.items || [];
    for (var f = 0; f < files.length; f += 1) {
      var parents = files[f].parents || [];
      for (var p = 0; p < parents.length; p += 1) {
        var standardId = resolveStandardFolder_(parents[p].id, folderIds, ancestry, 0);
        if (standardId) {
          matches[standardId] = (matches[standardId] || 0) + 1;
          if (!matchingFiles[standardId]) matchingFiles[standardId] = [];
          // Only file metadata is returned; PDF/Word bytes never leave Drive here.
          if (matchingFiles[standardId].length < 12) matchingFiles[standardId].push({
            id: String(files[f].id),
            name: String(files[f].title || ''),
            mimeType: String(files[f].mimeType || ''),
            url: String(files[f].alternateLink || 'https://drive.google.com/file/d/' + files[f].id + '/view')
          });
        }
      }
    }
    pageToken = response.nextPageToken || '';
    pagesRead += 1;
  } while (pageToken && pagesRead < 10);

  // Google Drive's fullText search identifies files, not pages. Read only the
  // private precomputed page indexes of the first matching files.
  var allowedPages = pageSearchAllowed_();
  var jobs = allowedPages ? getPageJobs_() : {}, pageLookups = 0, pendingPages = 0, deferredPages = 0;
  var standardIds = Object.keys(matchingFiles);
  for (var si = 0; si < standardIds.length; si += 1) {
    var selected = matchingFiles[standardIds[si]];
    for (var fi = 0; fi < selected.length; fi += 1) {
      var candidate = selected[fi], job = jobs[candidate.id];
      candidate.pageIndexStatus = allowedPages ? job ? job.status : 'not_indexed' : 'restricted';
      if (job && job.status === 'ready' && pageLookups < PAGE_INDEX_LIMIT) {
        try {
          candidate.pages = findPagesInIndex_(candidate.id, words, mode);
          pageLookups += 1;
        } catch (error) {
          candidate.pageIndexStatus = 'unavailable';
        }
      } else if (candidate.pageIndexStatus === 'ready') {
        candidate.pageIndexStatus = 'deferred'; deferredPages += 1;
      } else pendingPages += 1;
    }
  }

  return {
    ok: true,
    action: 'search',
    query: query,
    mode: mode,
    matches: Object.keys(matches).map(function(id) { return {folderId: id, fileCount: matches[id], files: matchingFiles[id]}; }),
    standards: Object.keys(matches).map(function(id) { return standardsById[id]; }),
    partial: !!pageToken,
    partialPages: deferredPages > 0,
    pageIndexEnabled: pageIndexConfigured_() && allowedPages,
    pageIndexRestricted: !allowedPages,
    pendingPages: pendingPages,
    generatedAt: new Date().toISOString()
  };
}

/** Fetch the remaining page hits in small batches without repeating Drive fullText. */
function searchIndexedPages_(input, requestedMode, fileIds) {
  if (!pageSearchAllowed_()) throw new Error('ผลค้นเลขหน้าใช้ได้เฉพาะบัญชีในโดเมนบริษัท');
  var query = String(input || '').trim().replace(/\s+/g, ' ');
  var mode = requestedMode === 'any' || requestedMode === 'phrase' ? requestedMode : 'all';
  if (!query || query.length > 120) throw new Error('คำค้นไม่ถูกต้อง');
  var words = mode === 'phrase' ? [query] : query.split(' ');
  if (words.length > 8) throw new Error('ค้นหาได้ไม่เกิน 8 คำต่อครั้ง');
  var ids = String(fileIds || '').split(',').filter(function(id) { return /^[A-Za-z0-9_-]{1,128}$/.test(id); });
  if (!ids.length || ids.length > PAGE_INDEX_LIMIT) throw new Error('จำนวนไฟล์ที่ตรวจเลขหน้าไม่ถูกต้อง');
  var jobs = getPageJobs_(), files = [];
  for (var i = 0; i < ids.length; i += 1) {
    var job = jobs[ids[i]];
    if (!job) continue;
    var entry = {id: ids[i], pageIndexStatus: job.status};
    if (job.status === 'ready') {
      try { entry.pages = findPagesInIndex_(ids[i], words, mode); }
      catch (ignore) { entry.pageIndexStatus = 'unavailable'; }
    }
    files.push(entry);
  }
  return {ok: true, action: 'pages', files: files};
}

function resolveStandardFolder_(folderId, standards, ancestry, depth) {
  if (standards[folderId]) return folderId;
  if (Object.prototype.hasOwnProperty.call(ancestry, folderId)) return ancestry[folderId];
  if (folderId === ROOT_FOLDER_ID || depth >= 8) return '';
  var found = '';
  try {
    var folder = Drive.Files.get(folderId, {fields: 'id,parents', supportsAllDrives: true});
    var parents = folder.parents || [];
    for (var i = 0; i < parents.length; i += 1) {
      found = resolveStandardFolder_(parents[i].id, standards, ancestry, depth + 1);
      if (found) break;
    }
  } catch (ignore) {
    // Unreadable parent cannot establish membership of the standards root.
  }
  ancestry[folderId] = found;
  return found;
}

function testContentSearch() {
  Logger.log(JSON.stringify(searchStandardsByContent_('inspection', 'all')));
}

/**
 * เรียกฟังก์ชันนี้จากหน้า Editor หนึ่งครั้งก่อน Deploy
 * เพื่อทดสอบว่าเจ้าของ Script อ่านโฟลเดอร์ Standards ได้
 */
function testDriveAccess() {
  var payload = rebuildIndex();
  Logger.log(JSON.stringify({
    ok: payload.ok,
    rootFolder: payload.rootFolder.name,
    count: payload.count,
    generatedAt: payload.generatedAt
  }));
}

function getStandardsPayload_() {
  var cache = CacheService.getScriptCache();
  var properties = PropertiesService.getScriptProperties();
  var metaText = properties.getProperty(INDEX_META_KEY);
  if (!metaText) throw new Error('ยังไม่มีดัชนีมาตรฐาน ให้ Run setupIndexWatcher ใน Apps Script หนึ่งครั้ง');
  var meta = JSON.parse(metaText);
  var cached = cache.get('hub-index-' + meta.prefix);
  if (cached) {
    try { return JSON.parse(cached); } catch (ignore) {}
  }
  // Read metadata and chunks together: a writer may retire the old generation.
  var snapshot = properties.getProperties();
  meta = JSON.parse(snapshot[INDEX_META_KEY]);
  var encoded = '';
  for (var i = 0; i < meta.chunks; i += 1) {
    var chunk = snapshot[meta.prefix + i];
    if (!chunk) throw new Error('ดัชนีไม่สมบูรณ์ กรุณาสร้างดัชนีใหม่');
    encoded += chunk;
  }
  var json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip', 'standards-index.json.gz')).getDataAsString();
  if (Utilities.newBlob(json, 'application/json').getBytes().length < 90000) {
    try { cache.put('hub-index-' + meta.prefix, json, CACHE_SECONDS); } catch (ignore) {}
  }
  return JSON.parse(json);
}

function saveStandardsPayload_(payload) {
  var json = JSON.stringify(payload);
  var encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(json, 'application/json')).getBytes());
  var properties = PropertiesService.getScriptProperties();
  var previous = properties.getProperty(INDEX_META_KEY);
  var prefix = 'HUB_INDEX_' + Utilities.getUuid().replace(/-/g, '') + '_';
  var chunks = Math.ceil(encoded.length / 8000);
  var entries = {};
  for (var i = 0; i < chunks; i += 1) entries[prefix + i] = encoded.slice(i * 8000, (i + 1) * 8000);
  properties.setProperties(entries, false);
  properties.setProperty(INDEX_META_KEY, JSON.stringify({prefix: prefix, chunks: chunks, generatedAt: payload.generatedAt, schemaVersion: payload.schemaVersion}));
  if (previous) {
    var old = JSON.parse(previous);
    for (var j = 0; j < old.chunks; j += 1) properties.deleteProperty(old.prefix + j);
  }
  if (Utilities.newBlob(json, 'application/json').getBytes().length < 90000) {
    try { CacheService.getScriptCache().put('hub-index-' + prefix, json, CACHE_SECONDS); } catch (ignore) {}
  }
}

function buildStandardsPayload_(scan) {
  var standards = scan.standards;
  standards.sort(function(a, b) { return a.code.localeCompare(b.code); });
  for (var n = 0; n < standards.length; n += 1) {
    standards[n].fileCount = scan.byFolder[standards[n].id] || 0;
  }
  return {
    ok: true,
    schemaVersion: 5,
    generatedAt: new Date().toISOString(),
    rootFolder: {
      id: ROOT_FOLDER_ID,
      name: scan.rootName,
      driveId: scan.driveId || '',
      url: 'https://drive.google.com/drive/folders/' + ROOT_FOLDER_ID
    },
    count: standards.length,
    fileCount: scan.total,
    standards: standards
  };
}

function indexResponse_() {
  var properties = PropertiesService.getScriptProperties();
  var job = JSON.parse(properties.getProperty(INDEX_JOB_KEY) || '{}');
  var payload;
  try { payload = getStandardsPayload_(); }
  catch (error) {
    payload = {ok: false, error: String(error.message || error), standards: [], count: 0, generatedAt: '', indexMissing: true};
  }
  payload.syncStatus = job.status || 'idle';
  payload.syncError = job.error || '';
  payload.apiVersion = API_VERSION;
  payload.jobId = job.id || '';
  payload.checkedAt = properties.getProperty(INDEX_CHECKED_KEY) || '';
  // A list request never decompresses the whole page-processing queue.
  payload.pageIndex = JSON.parse(properties.getProperty(PAGE_SUMMARY_KEY) || '{}');
  payload.pageIndex.enabled = pageIndexConfigured_();
  return payload;
}

/** A small response for polling; never decode the full index here. */
function refreshStatus_() {
  var properties = PropertiesService.getScriptProperties();
  var job = JSON.parse(properties.getProperty(INDEX_JOB_KEY) || '{}');
  var metaText = properties.getProperty(INDEX_META_KEY);
  var meta = metaText ? JSON.parse(metaText) : {};
  var age = new Date().getTime() - Number(job.startedAt || 0);
  var interrupted = (job.status === 'running' && age > 7 * 60 * 1000) ||
    (job.status === 'queued' && age > 12 * 60 * 1000);
  return {
    ok: true,
    apiVersion: API_VERSION,
    syncStatus: interrupted ? 'interrupted' : job.status || 'idle',
    syncError: interrupted ? 'งานค้างเกินเวลาที่คาดไว้ กรุณาตรวจ Executions แล้วกด Refresh เพื่อเริ่มงานใหม่' : job.error || '',
    jobId: job.id || '',
    refreshProtocol: 2,
    directRefreshSupported: true,
    startedAt: job.startedAt || 0,
    warning: job.warning || '',
    refreshMode: job.mode || '',
    elapsedMs: job.elapsedMs || 0,
    changePages: job.changePages || 0,
    generatedAt: meta.generatedAt || job.generatedAt || '',
    indexAvailable: !!metaText,
    checkedAt: properties.getProperty(INDEX_CHECKED_KEY) || ''
  };
}

function queueIndexRefresh_(requestId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    var busy = refreshStatus_();
    busy.accepted = false;
    busy.busy = true;
    busy.retryAfterMs = 8000;
    return busy;
  }
  try {
    var properties = PropertiesService.getScriptProperties();
    var job = JSON.parse(properties.getProperty(INDEX_JOB_KEY) || '{}');
    if (requestId && job.id === String(requestId)) {
      var duplicate = refreshStatus_(); duplicate.accepted = true; return duplicate;
    }
    var age = new Date().getTime() - Number(job.startedAt || 0);
    if ((job.status === 'queued' && age < 12 * 60 * 1000) ||
        (job.status === 'running' && age < 7 * 60 * 1000)) {
      var active = refreshStatus_(); active.accepted = true; return active;
    }
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i += 1) {
      if (triggers[i].getHandlerFunction() === 'rebuildIndex') ScriptApp.deleteTrigger(triggers[i]);
    }
    var id = /^[a-zA-Z0-9_-]{1,100}$/.test(String(requestId || '')) ? String(requestId) : Utilities.getUuid();
    var startedAt = new Date().getTime();
    var check = checkIndexChanges_(2);
    if (!check.changed) {
      var current = indexResponse_();
      if (current.ok) {
        completeUnchangedRefresh_({id: id, startedAt: startedAt}, check);
        var unchanged = refreshStatus_(); unchanged.accepted = true;
        unchanged.index = current;
        return unchanged;
      }
    }
    properties.setProperty(INDEX_JOB_KEY, JSON.stringify({id: id, status: 'queued',
      startedAt: startedAt, warning: check.warning || '', changePages: check.pages || 0}));
    try { ScriptApp.newTrigger('rebuildIndex').timeBased().after(1000).create(); }
    catch (error) {
      properties.setProperty(INDEX_JOB_KEY, JSON.stringify({id: id, status: 'error', error: String(error.message || error)}));
      throw error;
    }
    var accepted = refreshStatus_(); accepted.accepted = true; return accepted;
  } finally { lock.releaseLock(); }
}

function setupRefresh() {
  setupIndexWatcher();
  if (!PropertiesService.getScriptProperties().getProperty(CHANGE_STATE_META_KEY)) rebuildIndex();
}

/** Capture the cursor BEFORE scanning, so edits during the scan are not lost. */
function startChangeCursor_(driveId) {
  var options = {supportsAllDrives: true};
  if (driveId) options.driveId = driveId;
  var response = Drive.Changes.getStartPageToken(options);
  if (!response.startPageToken) throw new Error('Drive ไม่ส่ง change token');
  return String(response.startPageToken);
}

function readChangeState_() {
  var p = PropertiesService.getScriptProperties();
  var metaText = p.getProperty(CHANGE_STATE_META_KEY);
  var cursor = JSON.parse(p.getProperty(CHANGE_CURSOR_KEY) || '{}');
  var indexMeta = JSON.parse(p.getProperty(INDEX_META_KEY) || '{}');
  if (!metaText) return null;
  var meta = JSON.parse(metaText);
  if (!cursor.token || cursor.prefix !== meta.prefix || meta.indexPrefix !== indexMeta.prefix || meta.rootId !== ROOT_FOLDER_ID) return null;
  var cache = CacheService.getScriptCache(), cached = cache.get('hub-changes-' + meta.prefix);
  var state;
  if (cached) state = JSON.parse(cached);
  else {
    var snapshot = p.getProperties(), encoded = '';
    for (var i = 0; i < meta.chunks; i += 1) {
      if (!snapshot[meta.prefix + i]) return null;
      encoded += snapshot[meta.prefix + i];
    }
    var json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip', 'stored-index.json.gz')).getDataAsString();
    state = JSON.parse(json);
    if (Utilities.newBlob(json, 'application/json').getBytes().length < 90000) {
      try { cache.put('hub-changes-' + meta.prefix, json, CACHE_SECONDS); } catch (ignore) {}
    }
  }
  state.token = cursor.token; state.prefix = meta.prefix;
  return state;
}

function saveChangeState_(scan, token) {
  var p = PropertiesService.getScriptProperties();
  var previous = JSON.parse(p.getProperty(CHANGE_STATE_META_KEY) || '{}');
  var prefix = 'HUB_CHANGES_' + Utilities.getUuid().replace(/-/g, '') + '_';
  var state = {driveId: scan.driveId || '', ids: scan.trackedIds, folders: scan.folderIds};
  var encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(state), 'application/json', 'change-state.json')).getBytes());
  var chunks = Math.ceil(encoded.length / 8000), entries = {};
  for (var i = 0; i < chunks; i += 1) entries[prefix + i] = encoded.slice(i * 8000, (i + 1) * 8000);
  p.setProperties(entries, false);
  p.setProperty(CHANGE_STATE_META_KEY, JSON.stringify({prefix: prefix, chunks: chunks,
    indexPrefix: JSON.parse(p.getProperty(INDEX_META_KEY)).prefix, rootId: ROOT_FOLDER_ID}));
  p.setProperty(CHANGE_CURSOR_KEY, JSON.stringify({prefix: prefix, token: token}));
  if (previous.prefix) for (var j = 0; j < previous.chunks; j += 1) p.deleteProperty(previous.prefix + j);
}

/** Fail closed to a full scan if the cursor is missing, invalid, or too busy. */
function checkIndexChanges_(maxPages) {
  try {
    var state = readChangeState_();
    if (!state || !Array.isArray(state.ids) || !Array.isArray(state.folders)) return {changed: true, pages: 0};
    var ids = {}, folders = {};
    state.ids.forEach(function(id) { ids[id] = true; });
    state.folders.forEach(function(id) { folders[id] = true; });
    var token = state.token;
    for (var page = 0; page < maxPages; page += 1) {
      var options = {pageToken: token, maxResults: 1000, includeDeleted: true,
        includeCorpusRemovals: true, includeSubscribed: true, supportsAllDrives: true,
        includeItemsFromAllDrives: true, spaces: 'drive',
        fields: 'nextPageToken,newStartPageToken,items(fileId,deleted,driveId,file(id,parents(id)))'};
      if (state.driveId) options.driveId = state.driveId;
      var response = Drive.Changes.list(options), items = response.items || [];
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i], file = item.file || {}, parents = file.parents || [];
        if (ids[item.fileId || file.id] || (!item.fileId && state.driveId && item.driveId === state.driveId)) return {changed: true, pages: page + 1};
        for (var j = 0; j < parents.length; j += 1)
          if (folders[parents[j].id]) return {changed: true, pages: page + 1};
      }
      if (!response.nextPageToken) {
        if (!response.newStartPageToken) return {changed: true, pages: page + 1};
        return {changed: false, pages: page + 1, prefix: state.prefix, token: String(response.newStartPageToken)};
      }
      token = response.nextPageToken;
    }
    return {changed: true, pages: maxPages};
  } catch (error) {
    return {changed: true, warning: 'ตรวจรายการเปลี่ยนแปลงไม่ได้ จึงตรวจทั้งคลัง: ' + String(error.message || error)};
  }
}

function completeUnchangedRefresh_(job, check) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty(CHANGE_CURSOR_KEY, JSON.stringify({prefix: check.prefix, token: check.token}));
  p.setProperty(INDEX_CHECKED_KEY, new Date().toISOString());
  var meta = JSON.parse(p.getProperty(INDEX_META_KEY));
  p.setProperty(INDEX_JOB_KEY, JSON.stringify({id: job.id, status: 'complete', startedAt: job.startedAt,
    generatedAt: meta.generatedAt, mode: 'unchanged', elapsedMs: new Date().getTime() - job.startedAt, changePages: check.pages}));
}

function scanAndUpdateIndex_(job, force) {
  var driveId = '';
  var old = getStandardsPayloadSafely_();
  if (old && old.rootFolder) driveId = old.rootFolder.driveId || '';
  var token = '', warning = job.warning || '';
  try { token = startChangeCursor_(driveId); }
  catch (error) { warning = 'ยังใช้ Refresh แบบเร็วไม่ได้: ' + String(error.message || error); }
  var scan = scanIndexTree_();
  // A root moved between shared drives needs a token from its new drive.
  // This token is taken after discovery, so do not checkpoint that scan.
  if ((scan.driveId || '') !== driveId) token = '';
  var payload = updateIndexFromScan_(scan, job, force);
  if (token) {
    try { saveChangeState_(scan, token); }
    catch (error) { warning = 'บันทึกสถานะ Refresh แบบเร็วไม่ได้: ' + String(error.message || error); }
  }
  var p = PropertiesService.getScriptProperties();
  var complete = JSON.parse(p.getProperty(INDEX_JOB_KEY));
  complete.mode = 'full_scan'; complete.elapsedMs = new Date().getTime() - job.startedAt;
  complete.changePages = job.changePages || 0;
  if (warning) complete.warning = [complete.warning, warning].filter(Boolean).join(' · ');
  p.setProperty(INDEX_JOB_KEY, JSON.stringify(complete));
  return payload;
}

function getStandardsPayloadSafely_() {
  try { return getStandardsPayload_(); } catch (ignore) { return null; }
}

/** Remove only the trigger that invoked this execution, never a newer request. */
function removeRefreshTrigger_(event) {
  if (!event || !event.triggerUid) return;
  try {
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (String(trigger.getUniqueId()) === String(event.triggerUid)) ScriptApp.deleteTrigger(trigger);
    });
  } catch (error) { Logger.log('Trigger cleanup: ' + String(error.message || error)); }
}

function updateIndexFromScan_(scan, job, force) {
  var properties = PropertiesService.getScriptProperties();
  var meta = JSON.parse(properties.getProperty(INDEX_META_KEY) || '{}');
  var payload;
  if (force || scan.signature !== properties.getProperty(INDEX_SIGNATURE_KEY) || !meta.prefix) {
    payload = buildStandardsPayload_(scan);
    saveStandardsPayload_(payload);
    properties.setProperty(INDEX_SIGNATURE_KEY, scan.signature);
    meta.generatedAt = payload.generatedAt;
  }
  var warning = '';
  try { if (pageIndexConfigured_()) syncPageJobs_(scan.files); }
  catch (error) {
    warning = 'ดัชนีรายการพร้อม แต่คิวเลขหน้ามีปัญหา: ' + String(error.message || error);
    Logger.log(warning);
  }
  properties.setProperty(INDEX_CHECKED_KEY, new Date().toISOString());
  properties.setProperty(INDEX_JOB_KEY, JSON.stringify({id: job.id, status: 'complete',
    startedAt: job.startedAt, generatedAt: meta.generatedAt, warning: warning}));
  return payload;
}

function rebuildIndex(event) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    // The page worker or watcher may own the lock. Keep this request queued.
    removeRefreshTrigger_(event);
    var waiting = refreshStatus_();
    if (event && event.triggerUid && waiting.syncStatus === 'queued') {
      try { ScriptApp.newTrigger('rebuildIndex').timeBased().after(60000).create(); }
      catch (error) { Logger.log('Refresh retry: ' + String(error.message || error)); }
    }
    return waiting;
  }
  var properties = PropertiesService.getScriptProperties();
  var previous = JSON.parse(properties.getProperty(INDEX_JOB_KEY) || '{}');
  var job = {id: previous.id || Utilities.getUuid(),
    status: 'running', startedAt: new Date().getTime(),
    warning: previous.status === 'queued' ? previous.warning || '' : '',
    changePages: previous.status === 'queued' ? previous.changePages || 0 : 0};
  try {
    if (event && previous.status !== 'queued') return refreshStatus_();
    if (event && event.requestId && previous.id !== event.requestId) return refreshStatus_();
    properties.setProperty(INDEX_JOB_KEY, JSON.stringify(job));
    return scanAndUpdateIndex_(job, !event);
  } catch (error) {
    properties.setProperty(INDEX_JOB_KEY, JSON.stringify({id: job.id, status: 'error',
      startedAt: job.startedAt, error: String(error.message || error)}));
    throw error;
  } finally {
    removeRefreshTrigger_(event);
    lock.releaseLock();
  }
}

/** Run once in the editor. An existing v3 index is upgraded in place. */
function setupIndexWatcher() {
  var triggers = ScriptApp.getProjectTriggers();
  var found = false;
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'watchIndexChanges') found = true;
  }
  if (!found) ScriptApp.newTrigger('watchIndexChanges').timeBased().everyMinutes(15).create();
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(INDEX_SIGNATURE_KEY) || !properties.getProperty(INDEX_META_KEY)) rebuildIndex();
  Logger.log(JSON.stringify(refreshStatus_()));
}

/** Only a changed tree signature causes a persisted index update. */
function watchIndexChanges() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  var properties = PropertiesService.getScriptProperties();
  var previous = JSON.parse(properties.getProperty(INDEX_JOB_KEY) || '{}');
  var job = {id: previous.id || Utilities.getUuid(),
    status: 'running', startedAt: new Date().getTime()};
  try {
    properties.setProperty(INDEX_JOB_KEY, JSON.stringify(job));
    var check = checkIndexChanges_(10);
    job.changePages = check.pages || 0; job.warning = check.warning || '';
    if (!check.changed) completeUnchangedRefresh_(job, check);
    else scanAndUpdateIndex_(job, false);
  } catch (error) {
    properties.setProperty(INDEX_JOB_KEY, JSON.stringify({id: job.id, status: 'error',
      startedAt: job.startedAt, error: String(error.message || error)}));
    throw error;
  } finally { lock.releaseLock(); }
}

/** List immediate child folders in batches instead of one Drive round-trip per publisher. */
function listFolderChildren_(parentIds) {
  var folders = [];
  for (var start = 0; start < parentIds.length; start += 15) {
    var group = parentIds.slice(start, start + 15);
    var conditions = [];
    for (var i = 0; i < group.length; i += 1) {
      conditions.push("'" + group[i].replace(/'/g, "\\'") + "' in parents");
    }
    var token = '';
    do {
      var options = {
        q: 'trashed = false and mimeType = \'application/vnd.google-apps.folder\' and (' + conditions.join(' or ') + ')',
        fields: 'nextPageToken,incompleteSearch,items(id,title,parents(id))',
        maxResults: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        corpora: 'allDrives'
      };
      if (token) options.pageToken = token;
      var response = Drive.Files.list(options);
      if (response.incompleteSearch) throw new Error('Drive อ่านรายการโฟลเดอร์ได้ไม่ครบ โปรดกำหนด Shared Drive ที่เก็บมาตรฐาน');
      folders = folders.concat(response.items || []);
      token = response.nextPageToken || '';
    } while (token);
  }
  return folders;
}

/** Count searchable documents in standard folders without reading file contents. */
function countStandardDocuments_(standards) {
  var byFolder = {}, ownerByFolder = {}, pending = [], seenFolders = {};
  var total = 0, scannedFolders = 0;
  var searchable = {
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/vnd.google-apps.document': true
  };
  for (var i = 0; i < standards.length; i += 1) {
    var id = standards[i].id;
    byFolder[id] = 0;
    ownerByFolder[id] = id;
    seenFolders[id] = true;
    pending.push(id);
  }
  while (pending.length) {
    var batchParents = pending;
    pending = [];
    scannedFolders += batchParents.length;
    if (scannedFolders > 5000) throw new Error('โฟลเดอร์ย่อยเกิน 5,000 รายการ กรุณาแบ่งการสร้างดัชนี');
    for (var start = 0; start < batchParents.length; start += 15) {
      var group = batchParents.slice(start, start + 15);
      var conditions = [];
      for (var g = 0; g < group.length; g += 1) {
        conditions.push("'" + group[g].replace(/'/g, "\\'") + "' in parents");
      }
      var token = '';
      do {
        var options = {
          q: 'trashed = false and (' + conditions.join(' or ') + ')',
          fields: 'nextPageToken,incompleteSearch,items(id,mimeType,parents(id))',
          maxResults: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: 'allDrives'
        };
        if (token) options.pageToken = token;
        var response = Drive.Files.list(options);
        if (response.incompleteSearch) throw new Error('Drive นับไฟล์ได้ไม่ครบ กรุณาตรวจสิทธิ์โฟลเดอร์มาตรฐาน');
        var items = response.items || [];
        for (var f = 0; f < items.length; f += 1) {
          var parents = items[f].parents || [];
          for (var p = 0; p < parents.length; p += 1) {
            var owner = ownerByFolder[parents[p].id];
            if (!owner) continue;
            if (items[f].mimeType === 'application/vnd.google-apps.folder') {
              if (!seenFolders[items[f].id]) {
                seenFolders[items[f].id] = true;
                ownerByFolder[items[f].id] = owner;
                pending.push(items[f].id);
              }
            } else if (searchable[items[f].mimeType]) {
              byFolder[owner] += 1;
              total += 1;
            }
            break;
          }
        }
        token = response.nextPageToken || '';
      } while (token);
    }
  }
  return {total: total, byFolder: byFolder};
}

/** A metadata inventory, including names/edits for safe change-feed checkpoints. */
function scanIndexTree_() {
  var root = Drive.Files.get(ROOT_FOLDER_ID, {fields: 'id,title,driveId', supportsAllDrives: true});
  var pending = [{id: ROOT_FOLDER_ID, depth: 0, name: root.title, standardId: ''}];
  var seenFolders = {}, tracked = {}, entries = [], standards = [], byFolder = {}, files = [];
  var total = 0, scannedFolders = 0;
  var searchable = {
    'application/pdf': true,
    'application/msword': true,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
    'application/vnd.google-apps.document': true
  };
  seenFolders[ROOT_FOLDER_ID] = true;
  tracked[ROOT_FOLDER_ID] = true;
  while (pending.length) {
    var batch = pending;
    pending = [];
    scannedFolders += batch.length;
    if (scannedFolders > 5000) throw new Error('โฟลเดอร์ย่อยเกิน 5,000 รายการ กรุณาแบ่งการสร้างดัชนี');
    for (var start = 0; start < batch.length; start += 15) {
      var group = batch.slice(start, start + 15);
      var byParent = {}, conditions = [];
      for (var g = 0; g < group.length; g += 1) {
        byParent[group[g].id] = group[g];
        conditions.push("'" + group[g].id.replace(/'/g, "\\'") + "' in parents");
      }
      var token = '';
      do {
        var options = {
          q: 'trashed = false and (' + conditions.join(' or ') + ')',
          fields: 'nextPageToken,incompleteSearch,items(id,title,mimeType,modifiedDate,fileSize,parents(id))',
          maxResults: 1000,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          corpora: root.driveId ? 'drive' : 'default'
        };
        if (root.driveId) options.driveId = root.driveId;
        if (token) options.pageToken = token;
        var response = Drive.Files.list(options);
        if (response.incompleteSearch) throw new Error('Drive อ่านรายการได้ไม่ครบ กรุณาตรวจสิทธิ์โฟลเดอร์มาตรฐาน');
        var items = response.items || [];
        for (var f = 0; f < items.length; f += 1) {
          var item = items[f], parents = item.parents || [];
          for (var p = 0; p < parents.length; p += 1) {
            var parent = byParent[parents[p].id];
            if (!parent) continue;
            tracked[item.id] = true;
            entries.push([item.id, parent.id, item.title, item.mimeType, item.modifiedDate || '', item.fileSize || ''].join('|'));
            if (item.mimeType === 'application/vnd.google-apps.folder') {
              if (!seenFolders[item.id]) {
                seenFolders[item.id] = true;
                var standardId = parent.standardId;
                if (parent.depth === 1) {
                  standardId = item.id;
                  standards.push(createStandardRecord_(item, parent.name));
                  byFolder[standardId] = 0;
                }
                pending.push({id: item.id, depth: parent.depth + 1,
                  name: item.title, standardId: standardId});
              }
            } else if (parent.standardId && searchable[item.mimeType]) {
              byFolder[parent.standardId] += 1;
              total += 1;
              if (item.mimeType === 'application/pdf' ||
                  item.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                files.push({id: item.id, name: item.title, mimeType: item.mimeType,
                  modifiedAt: item.modifiedDate || '', size: Number(item.fileSize || 0)});
              }
            }
          }
        }
        token = response.nextPageToken || '';
      } while (token);
    }
  }
  entries.sort();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    root.title + '|' + (root.driveId || '') + '\n' + entries.join('\n'));
  return {rootName: root.title, driveId: root.driveId || '', standards: standards, byFolder: byFolder, files: files,
    total: total, signature: Utilities.base64EncodeWebSafe(digest),
    trackedIds: Object.keys(tracked), folderIds: Object.keys(seenFolders)};
}

function createStandardRecord_(folder, publisherName) {
  var folderName = folder.title.trim();
  var folderId = folder.id;
  var disciplines = classifyDisciplines_(folderName, publisherName);

  return {
    id: folderId,
    code: folderName,
    title: folderName,
    publisher: publisherName,
    disciplines: disciplines,
    description: 'มาตรฐานจากโฟลเดอร์ ' + folderName,
    keywords: [folderName, publisherName].concat(disciplines).join(' '),
    topic: inferTopic_(folderName),
    url: 'https://drive.google.com/drive/folders/' + folderId,
    modifiedAt: '',
    fileCount: null,
    classificationStatus: 'preliminary'
  };
}

/**
 * จัดหมวดเบื้องต้นจากชื่อโฟลเดอร์เท่านั้น
 * ผู้ดูแลมาตรฐานควรตรวจทานก่อนใช้อ้างอิงทางวิศวกรรม
 */
function classifyDisciplines_(folderName, publisherName) {
  var text = (folderName + ' ' + publisherName).toLowerCase();
  var result = [];

  if (matchesAny_(text, [
    'iec', 'ieee', 'nfpa 70', 'electrical', 'electric', 'grounding',
    'earthing', 'cable', 'switchgear', 'transformer', 'ไฟฟ้า', 'สายไฟ'
  ])) {
    result.push('Electrical');
  }

  if (matchesAny_(text, [
    'api', 'asme', 'pump', 'tank', 'piping', 'pipe', 'valve', 'vessel',
    'mechanical', 'welding', 'pressure', 'เครื่องกล', 'ปั๊ม', 'ถัง', 'ท่อ'
  ])) {
    result.push('Mechanical');
  }

  if (matchesAny_(text, [
    'aci', 'aisc', 'civil', 'concrete', 'structure', 'foundation', 'soil',
    'building', 'โยธา', 'คอนกรีต', 'โครงสร้าง', 'ฐานราก'
  ])) {
    result.push('Civil');
  }

  if (matchesAny_(text, [
    'isa', 'api mpms', 'iec 615', 'iec 62682', 'instrument', 'alarm',
    'meter', 'measurement', 'control', 'scada', 'plc', 'calibration',
    'เครื่องมือวัด', 'การวัด', 'สอบเทียบ', 'สัญญาณเตือน'
  ])) {
    result.push('Instrument');
  }

  if (result.length === 0) {
    if (text.indexOf('sdo&docs') !== -1 || text.indexOf('sdo') !== -1) {
      result.push('Mechanical');
    } else {
      result.push('Mechanical');
    }
  }

  return result;
}

function matchesAny_(text, keywords) {
  for (var i = 0; i < keywords.length; i += 1) {
    if (text.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  return false;
}

function inferTopic_(folderName) {
  var text = folderName.toLowerCase();

  if (matchesAny_(text, ['tank', 'ถัง'])) return 'Tank';
  if (matchesAny_(text, ['pump', 'ปั๊ม'])) return 'Pump';
  if (matchesAny_(text, ['alarm', 'สัญญาณเตือน'])) return 'Alarm management';
  if (matchesAny_(text, ['measurement', 'meter', 'mpms', 'การวัด'])) return 'Measurement';
  if (matchesAny_(text, ['electrical', 'grounding', 'earthing', 'ไฟฟ้า'])) return 'Electrical safety';
  if (matchesAny_(text, ['concrete', 'structure', 'คอนกรีต', 'โครงสร้าง'])) return 'Civil structure';
  if (matchesAny_(text, ['fire', 'nfpa', 'ดับเพลิง'])) return 'Fire protection';
  return 'Engineering standard';
}

/** Page indexes stay in the company's Cloud Storage bucket, outside this public Site. */
function pageIndexConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {project: p.getProperty('DOC_AI_PROJECT_ID') || '',
    location: p.getProperty('DOC_AI_LOCATION') || '',
    processor: p.getProperty('DOC_AI_PROCESSOR_ID') || '',
    bucket: p.getProperty('PAGE_GCS_BUCKET') || ''};
}

function pageIndexConfigured_() {
  var c = pageIndexConfig_();
  return !!(c.project && c.location && c.processor && c.bucket);
}

function pageSearchAllowed_() {
  var domain = (PropertiesService.getScriptProperties().getProperty('PAGE_SEARCH_DOMAIN') || '').toLowerCase().trim();
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!(domain && email && email.slice(-(domain.length + 1)) === '@' + domain);
}

function requirePageIndexConfig_() {
  var c = pageIndexConfig_();
  if (!pageIndexConfigured_()) throw new Error('กรอก DOC_AI_PROJECT_ID, DOC_AI_LOCATION, DOC_AI_PROCESSOR_ID และ PAGE_GCS_BUCKET ใน Script Properties');
  if (!PropertiesService.getScriptProperties().getProperty('PAGE_SEARCH_DOMAIN'))
    throw new Error('กรอก PAGE_SEARCH_DOMAIN เพื่อจำกัดผู้ที่เห็นข้อความจากมาตรฐาน');
  if (!/^[a-z][a-z0-9-]+$/.test(c.project) || !/^[a-z][a-z0-9-]+$/.test(c.location) ||
      !/^[a-zA-Z0-9_-]+$/.test(c.processor) || !/^[a-z0-9][a-z0-9._-]+$/.test(c.bucket))
    throw new Error('ค่า Script Properties ของ Document AI หรือ Cloud Storage ไม่ถูกต้อง');
  return c;
}

function getPageJobs_() {
  var snapshot = PropertiesService.getScriptProperties().getProperties();
  var metaText = snapshot[PAGE_JOBS_META_KEY];
  if (!metaText) return {};
  var meta = JSON.parse(metaText), encoded = '';
  for (var i = 0; i < meta.chunks; i += 1) {
    var chunk = snapshot[meta.prefix + i];
    if (!chunk) throw new Error('สถานะดัชนีหน้าไม่สมบูรณ์');
    encoded += chunk;
  }
  return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(encoded), 'application/gzip', 'stored-index.json.gz')).getDataAsString());
}

function savePageJobs_(jobs) {
  var p = PropertiesService.getScriptProperties();
  var encoded = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(jobs), 'application/json', 'page-jobs.json')).getBytes());
  var previous = p.getProperty(PAGE_JOBS_META_KEY);
  var prefix = 'HUB_PAGE_JOBS_' + Utilities.getUuid().replace(/-/g, '') + '_';
  var chunks = Math.ceil(encoded.length / 8000), entries = {};
  for (var i = 0; i < chunks; i += 1) entries[prefix + i] = encoded.slice(i * 8000, (i + 1) * 8000);
  p.setProperties(entries, false);
  p.setProperty(PAGE_JOBS_META_KEY, JSON.stringify({prefix: prefix, chunks: chunks}));
  var ids = Object.keys(jobs), summary = {ready: 0, total: ids.length};
  ids.forEach(function(id) { if (jobs[id].status === 'ready') summary.ready += 1; });
  p.setProperty(PAGE_SUMMARY_KEY, JSON.stringify(summary));
  if (previous) {
    var old = JSON.parse(previous);
    for (var j = 0; j < old.chunks; j += 1) p.deleteProperty(old.prefix + j);
  }
}

function syncPageJobs_(files) {
  var jobs = getPageJobs_(), found = {}, changed = false;
  for (var i = 0; i < files.length; i += 1) {
    var file = files[i];
    found[file.id] = true;
    var job = jobs[file.id];
    if (!job || job.modifiedAt !== file.modifiedAt || job.size !== file.size) {
      jobs[file.id] = {name: file.name, mimeType: file.mimeType,
        modifiedAt: file.modifiedAt, size: file.size, status: 'queued'};
      changed = true;
    }
  }
  Object.keys(jobs).forEach(function(id) {
    if (!found[id]) {
      try { deleteGcsObject_('page-index/search/' + id + '.json.gz'); } catch (ignore) {}
      CacheService.getScriptCache().remove('hub-page-' + id);
      delete jobs[id]; changed = true;
    }
  });
  if (changed) savePageJobs_(jobs);
  return jobs;
}

/** Run once after the company configures Document AI, IAM and OAuth scopes. */
function setupPageIndexing() {
  requirePageIndexConfig_();
  listGcs_('page-index/search/'); // verify bucket access before scheduling paid work
  var triggers = ScriptApp.getProjectTriggers(), found = false;
  for (var i = 0; i < triggers.length; i += 1) {
    if (triggers[i].getHandlerFunction() === 'processPageIndexQueue') found = true;
  }
  if (!found) ScriptApp.newTrigger('processPageIndexQueue').timeBased().everyMinutes(5).create();
  var hadSignature = !!PropertiesService.getScriptProperties().getProperty(INDEX_SIGNATURE_KEY);
  setupIndexWatcher();
  if (hadSignature) rebuildIndex(); // discovers existing PDF/DOCX files; later scans detect additions and edits
  Logger.log(JSON.stringify({pageJobs: Object.keys(getPageJobs_()).length}));
}

/** One short unit of work per trigger; search never waits for this. */
function processPageIndexQueue() {
  var config = requirePageIndexConfig_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var refreshJob = JSON.parse(PropertiesService.getScriptProperties().getProperty(INDEX_JOB_KEY) || '{}');
    if (refreshJob.status === 'queued') return; // let a requested metadata refresh run first
    var jobs = getPageJobs_(), ids = Object.keys(jobs), selected = '';
    var running = 0;
    for (var i = 0; i < ids.length; i += 1) if (jobs[ids[i]].status === 'processing') running += 1;
    if (running < 2) {
      for (var q = 0; q < ids.length; q += 1) {
        if (jobs[ids[q]].status === 'queued') { selected = ids[q]; break; }
      }
    }
    if (!selected) {
      for (var r = 0; r < ids.length; r += 1) {
        if (jobs[ids[r]].status === 'processing') { selected = ids[r]; break; }
      }
    }
    if (!selected) return;
    try {
      if (jobs[selected].status === 'queued') beginPageJob_(selected, jobs[selected], config);
      else completePageJob_(selected, jobs[selected], config);
    } catch (error) {
      jobs[selected].status = 'error';
      jobs[selected].error = String(error.message || error).slice(0, 240);
      Logger.log('Page index failed for ' + selected + ': ' + jobs[selected].error);
    }
    savePageJobs_(jobs);
  } finally { lock.releaseLock(); }
}

function retryPageIndexErrors() {
  var jobs = getPageJobs_();
  Object.keys(jobs).forEach(function(id) {
    if (jobs[id].status === 'error') {
      try {
        if (jobs[id].sourceName) deleteGcsObject_(jobs[id].sourceName);
        if (jobs[id].outputPrefix) listGcs_(jobs[id].outputPrefix).forEach(deleteGcsObject_);
      } catch (ignore) {}
      jobs[id].status = 'queued'; delete jobs[id].error;
      delete jobs[id].sourceName; delete jobs[id].outputPrefix; delete jobs[id].operation;
      delete jobs[id].startedAt;
    }
  });
  savePageJobs_(jobs);
}

function googleApiFetch_(url, options) {
  var opts = options || {};
  opts.headers = opts.headers || {};
  opts.headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();
  opts.muteHttpExceptions = true;
  var response = UrlFetchApp.fetch(url, opts);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300)
    throw new Error('Google API ตอบ ' + status + ': ' + response.getContentText().slice(0, 300));
  return response;
}

function gcsApiUrl_(name, suffix) {
  var c = requirePageIndexConfig_();
  return 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(c.bucket) +
    '/o/' + encodeURIComponent(name) + (suffix || '');
}

function uploadGcs_(name, blob, mimeType) {
  var c = requirePageIndexConfig_();
  var url = 'https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(c.bucket) +
    '/o?uploadType=media&name=' + encodeURIComponent(name);
  googleApiFetch_(url, {method: 'post', contentType: mimeType,
    payload: blob.getBytes()});
}

function readGcs_(name) {
  return googleApiFetch_(gcsApiUrl_(name, '?alt=media')).getBlob();
}

function listGcs_(prefix) {
  var c = requirePageIndexConfig_(), names = [], token = '';
  do {
    var url = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(c.bucket) +
      '/o?prefix=' + encodeURIComponent(prefix) + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var result = JSON.parse(googleApiFetch_(url).getContentText());
    var items = result.items || [];
    for (var i = 0; i < items.length; i += 1) names.push(items[i].name);
    token = result.nextPageToken || '';
  } while (token);
  return names;
}

function deleteGcsObject_(name) {
  var response = UrlFetchApp.fetch(gcsApiUrl_(name), {
    method: 'delete', headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true});
  if (response.getResponseCode() !== 204 && response.getResponseCode() !== 404)
    throw new Error('ลบไฟล์ดัชนีเก่าไม่สำเร็จ: ' + response.getResponseCode());
}

function beginPageJob_(id, job, config) {
  if (job.size > 40 * 1024 * 1024) throw new Error('ไฟล์เกิน 40 MB ซึ่งเกินขนาดที่ Apps Script อ่านได้ต่อครั้ง');
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
    '?alt=media&supportsAllDrives=true';
  var blob = googleApiFetch_(url).getBlob();
  if (blob.getBytes().length > 40 * 1024 * 1024) throw new Error('ไฟล์เกิน 40 MB');
  var sourceName = 'page-index/input/' + id + '/' + new Date().getTime();
  var outputPrefix = 'page-index/output/' + id + '/' + new Date().getTime() + '/';
  job.sourceName = sourceName; job.outputPrefix = outputPrefix;
  uploadGcs_(sourceName, blob, job.mimeType);
  var body = {
    inputDocuments: {gcsDocuments: {documents: [{gcsUri: 'gs://' + config.bucket + '/' + sourceName,
      mimeType: job.mimeType}]}},
    documentOutputConfig: {gcsOutputConfig: {gcsUri: 'gs://' + config.bucket + '/' + outputPrefix,
      fieldMask: 'text,pages.pageNumber,pages.layout,shardInfo',
      shardingConfig: {pagesPerShard: 40, pagesOverlap: 0}}},
    processOptions: {layoutConfig: {returnImages: false}}
  };
  var endpoint = 'https://' + config.location + '-documentai.googleapis.com/v1/projects/' +
    encodeURIComponent(config.project) + '/locations/' + encodeURIComponent(config.location) +
    '/processors/' + encodeURIComponent(config.processor) + ':batchProcess';
  var operation = JSON.parse(googleApiFetch_(endpoint, {method: 'post',
    contentType: 'application/json', payload: JSON.stringify(body)}).getContentText());
  if (!operation.name) throw new Error('Document AI ไม่ส่ง operation กลับมา');
  job.status = 'processing'; job.operation = operation.name;
  job.startedAt = new Date().getTime();
}

function completePageJob_(id, job, config) {
  if (new Date().getTime() - Number(job.startedAt || 0) > 48 * 60 * 60 * 1000)
    throw new Error('Document AI ประมวลผลนานเกิน 48 ชั่วโมง');
  var endpoint = 'https://' + config.location + '-documentai.googleapis.com/v1/' + job.operation;
  var operation = JSON.parse(googleApiFetch_(endpoint).getContentText());
  if (!operation.done) return;
  if (operation.error) throw new Error(operation.error.message || 'Document AI ประมวลผลไม่สำเร็จ');
  var statuses = operation.metadata && operation.metadata.individualProcessStatuses || [];
  if (statuses[0] && statuses[0].status && Number(statuses[0].status.code || 0))
    throw new Error(statuses[0].status.message || 'Document AI อ่านไฟล์ไม่สำเร็จ');
  var destination = statuses[0] && statuses[0].outputGcsDestination || '';
  var prefix = destination.indexOf('gs://' + config.bucket + '/') === 0 ?
    destination.slice(('gs://' + config.bucket + '/').length).replace(/\/?$/, '/') : job.outputPrefix;
  var names = listGcs_(prefix).filter(function(name) { return /\.json$/i.test(name); });
  if (!names.length) throw new Error('ไม่พบผลลัพธ์ JSON จาก Document AI');
  var pages = [], seen = {};
  for (var i = 0; i < names.length; i += 1) {
    var document = JSON.parse(readGcs_(names[i]).getDataAsString());
    var extracted = pagesFromDocumentAi_(document);
    for (var p = 0; p < extracted.length; p += 1) {
      if (!seen[extracted[p].number]) {
        seen[extracted[p].number] = true;
        pages.push(extracted[p]);
      }
    }
  }
  pages.sort(function(a, b) { return a.number - b.number; });
  if (!pages.length || !pages.some(function(page) { return !!page.text; }))
    throw new Error('Document AI ไม่พบข้อความที่ผูกกับเลขหน้า');
  var indexName = 'page-index/search/' + id + '.json.gz';
  var compressed = Utilities.gzip(Utilities.newBlob(JSON.stringify({pages: pages}), 'application/json'));
  uploadGcs_(indexName, compressed, 'application/gzip');
  CacheService.getScriptCache().remove('hub-page-' + id);
  job.status = 'ready'; job.indexedAt = new Date().toISOString();
  delete job.operation; delete job.error; delete job.startedAt;
  try {
    deleteGcsObject_(job.sourceName);
    var outputNames = listGcs_(job.outputPrefix);
    for (var o = 0; o < outputNames.length; o += 1) deleteGcsObject_(outputNames[o]);
  } catch (cleanupError) { Logger.log('Temporary GCS cleanup: ' + cleanupError); }
  delete job.sourceName; delete job.outputPrefix;
}

function pagesFromDocumentAi_(document) {
  var pages = document.pages || [], result = [];
  var shard = document.shardInfo || {}, offset = Number(shard.textOffset || 0);
  var pageOffset = Number(shard.pageOffset || 0), fullText = String(document.text || '');
  for (var i = 0; i < pages.length; i += 1) {
    var anchor = pages[i].layout && pages[i].layout.textAnchor || {};
    var segments = anchor.textSegments || [], text = '';
    for (var s = 0; s < segments.length; s += 1) {
      var from = Math.max(0, Number(segments[s].startIndex || 0) - offset);
      var to = Math.min(fullText.length, Number(segments[s].endIndex || 0) - offset);
      if (to > from) text += fullText.slice(from, to) + ' ';
    }
    if (!text && anchor.content) text = anchor.content;
    var number = shard.pageOffset === undefined ? Number(pages[i].pageNumber || i + 1) : pageOffset + i + 1;
    if (number > 0) result.push({number: number, text: text.normalize('NFC').replace(/\s+/g, ' ').trim()});
  }
  return result;
}

function findPagesInIndex_(id, words, mode) {
  var cache = CacheService.getScriptCache(), cached = cache.get('hub-page-' + id);
  var json = cached || Utilities.ungzip(Utilities.newBlob(readGcs_('page-index/search/' + id + '.json.gz').getBytes(), 'application/gzip', 'page-index.json.gz')).getDataAsString();
  if (!cached && Utilities.newBlob(json, 'application/json').getBytes().length < 90000)
    try { cache.put('hub-page-' + id, json, 300); } catch (ignore) {}
  var data = JSON.parse(json);
  var terms = words.map(function(word) { return String(word).normalize('NFC').toLowerCase(); });
  var pages = [], source = data.pages || [];
  for (var i = 0; i < source.length; i += 1) {
    var lower = String(source[i].text || '').normalize('NFC').toLowerCase();
    var positions = terms.map(function(term) { return lower.indexOf(term); });
    var matched = mode === 'any' ? positions.some(function(n) { return n >= 0; }) :
      positions.every(function(n) { return n >= 0; });
    if (!matched) continue;
    var earliest = Math.min.apply(null, positions.filter(function(n) { return n >= 0; }));
    var start = Math.max(0, earliest - 70), snippet = source[i].text.slice(start, start + 240);
    pages.push({number: source[i].number,
      excerpt: (start ? '…' : '') + snippet + (start + 240 < source[i].text.length ? '…' : '')});
    if (pages.length >= 40) break;
  }
  return pages;
}

function createOutput_(payload, callbackName) {
  var json = JSON.stringify(payload);
  var callback = callbackName ? String(callbackName) : '';

  if (callback && /^[A-Za-z_$][0-9A-Za-z_$]{0,80}$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
