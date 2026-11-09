/** Server-to-server only. The reader proves a successful Drive lookup made as the visitor. */
function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  try {
    var owner = String(props.getProperty('PRIVATE_PAGE_OWNER_EMAIL') || '').trim().toLowerCase();
    var key = String(props.getProperty('PRIVATE_PAGE_SHARED_KEY') || '').trim();
    var domain = String(props.getProperty('PAGE_SEARCH_DOMAIN') || '').trim().toLowerCase();
    var body = String(e && e.postData && e.postData.contents || '');
    if (!owner || key.length < 48 || !domain || String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== owner ||
        !body || body.length > 2200) return createOutput_({ok:false,status:'denied'});
    var message = JSON.parse(body), p = message.payload;
    if (!Array.isArray(p) || p.length !== 9 || p[0] !== 'drive-page-v1' ||
        !Number.isSafeInteger(p[1]) || Math.abs(Date.now() - p[1]) > 90000 ||
        typeof p[2] !== 'string' || !p[2].endsWith('@' + domain) ||
        typeof p[3] !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(p[3]) ||
        typeof p[4] !== 'string' || !p[4] || p[4].length > 120 ||
        ['all','any','phrase'].indexOf(p[5]) < 0 ||
        !Number.isSafeInteger(p[6]) || p[6] <= 0 ||
        !Number.isSafeInteger(p[7]) || p[7] < 0 ||
        typeof p[8] !== 'string' || !/^[a-f0-9]{32}$/.test(p[8]) ||
        !privatePageSignatureMatches_(p, message.signature, key))
      return createOutput_({ok:false,status:'denied'});
    return createOutput_(privatePageIndexLookup_(p));
  } catch (error) {
    // Do not log request bodies, secrets, query text or excerpts.
    return createOutput_({ok:false,status:'unavailable'});
  }
}

function privatePageSignatureMatches_(payload, signature, key) {
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(JSON.stringify(payload), key, Utilities.Charset.UTF_8));
  if (typeof signature !== 'string' || expected.length !== signature.length) return false;
  var different = 0;
  for (var i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return different === 0;
}

function privatePageIndexLookup_(p) {
  var id = p[3], query = p[4].replace(/[\u200B\uFEFF]/g,'').normalize('NFC').trim(), mode = p[5], words = mode === 'phrase' ? [query] : query.split(/\s+/);
  if (!query || words.length > 8) return {ok:false,status:'invalid_query'};
  var file = Drive.Files.get(id, {fields:'id,title,mimeType,fileSize,modifiedDate,md5Checksum,labels(trashed),parents(id)',supportsAllDrives:true});
  var supported = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (file.id !== id || supported.indexOf(file.mimeType) < 0 || file.labels && file.labels.trashed ||
      Date.parse(file.modifiedDate) !== p[6] || Number(file.fileSize || 0) !== p[7] ||
      String(file.md5Checksum || '').toLowerCase() !== p[8])
    return {ok:false,status:'denied'};
  var rootId = rootFolderId_(), root = Object.create(null), visited = Object.create(null);
  root[rootId] = true;
  if (!(file.parents || []).some(function(parent) { return !!resolveStandardFolder_(parent.id, root, visited, 0, rootId); }))
    return {ok:false,status:'denied'};

  var pages = file.mimeType === 'application/pdf' ? driveOcrIndexedMatches_(pdfOcrConfig_(), id, driveOcrRevision_(file), words, mode) : null;
  var source = pages ? 'ocr' : '';
  if (!source) {
    if (!pageIndexConfigured_()) return {ok:false,status:'index_not_configured'};
    var job = getPageJobs_()[id];
    if (!job || Date.parse(job.modifiedAt) !== p[6] || Number(job.size) !== p[7] || job.status !== 'ready')
      return {ok:false,status:'index_not_ready'};
    // Require a revision marker in the stored index. An older blob must not
    // accidentally be paired with the latest job while it is being replaced.
    var layout = JSON.parse(Utilities.ungzip(Utilities.newBlob(readGcs_('page-index/search/' + id + '.json.gz').getBytes(), 'application/gzip')).getDataAsString());
    if (Date.parse(layout.modifiedAt) !== p[6] || Number(layout.size) !== p[7] || layout.md5Checksum !== p[8])
      return {ok:false,status:'index_not_ready'};
    pages = findPageMatches_(layout.pages || [], words, mode, true); source = 'document';
  }
  return {ok:true,source:source,pages:pages,fileName:String(file.title || 'เอกสาร')};
}

/** Editor-only pilot: one chosen PDF/DOCX, no trigger and no whole-library queue. */
function processPrivatePageSample() {
  var props = PropertiesService.getScriptProperties();
  var owner = String(props.getProperty('PRIVATE_PAGE_OWNER_EMAIL') || '').trim().toLowerCase();
  if (!owner || String(Session.getActiveUser().getEmail() || '').toLowerCase() !== owner ||
      String(Session.getEffectiveUser().getEmail() || '').toLowerCase() !== owner) throw new Error('ใช้บัญชีเจ้าของสคริปต์เท่านั้น');
  var id = String(props.getProperty('PRIVATE_PAGE_TEST_FILE_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('ตั้ง PRIVATE_PAGE_TEST_FILE_ID เป็น ID ของ PDF/DOCX ทดสอบ');
  var config = requirePageIndexConfig_(), lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('มีงานอื่นกำลังทำงาน ลองอีกครั้ง');
  try {
    var rootId = rootFolderId_(), root = Object.create(null);
    root[rootId] = true;
    function readCurrent() {
      var f = Drive.Files.get(id, {fields:'id,title,mimeType,fileSize,modifiedDate,md5Checksum,labels(trashed),parents(id)',supportsAllDrives:true});
      if (f.id !== id || f.labels && f.labels.trashed || !f.modifiedDate || Number(f.fileSize || 0) <= 0 ||
          Number(f.fileSize) > 40 * 1024 * 1024 ||
          ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].indexOf(f.mimeType) < 0 ||
          !(f.parents || []).some(function(parent) { return !!resolveStandardFolder_(parent.id, root, Object.create(null), 0, rootId); }))
        throw new Error('เลือก PDF/DOCX ใน 31_Standard ที่ยังใช้งานอยู่และไม่เกิน 40 MB');
      return f;
    }
    var current = readCurrent(), jobs = getPageJobs_(), job = jobs[id];
    if (job && job.status === 'processing' && (job.modifiedAt !== current.modifiedDate || job.size !== Number(current.fileSize)))
      throw new Error('ไฟล์เปลี่ยนระหว่างประมวลผล ให้เลือกไฟล์ทดสอบอื่น');
    if (!job || job.modifiedAt !== current.modifiedDate || job.size !== Number(current.fileSize) ||
        ['queued','processing','ready'].indexOf(job.status)<0) job = null;
    if (job && job.status === 'ready') {
      try {
        var old = JSON.parse(Utilities.ungzip(Utilities.newBlob(readGcs_('page-index/search/' + id + '.json.gz', config).getBytes(), 'application/gzip')).getDataAsString());
        if (old.modifiedAt !== current.modifiedDate || old.size !== Number(current.fileSize) || old.md5Checksum !== current.md5Checksum) job = null;
      } catch (ignore) { job = null; }
    }
    if (!job) job = {name:current.title,mimeType:current.mimeType,modifiedAt:current.modifiedDate,size:Number(current.fileSize),status:'queued'};
    if (job.status === 'queued') beginPageJob_(id,job,config);
    else if (job.status === 'processing') completePageJob_(id,job,config,function(){
      var latest = readCurrent();
      if (latest.modifiedDate !== job.modifiedAt || Number(latest.fileSize) !== job.size || latest.md5Checksum !== job.md5Checksum) throw new Error('ไฟล์เปลี่ยนระหว่างประมวลผล');
    });
    jobs[id] = job;
    savePageJobs_(jobs);
    Logger.log(JSON.stringify({status:job.status}));
  } finally { lock.releaseLock(); }
}
