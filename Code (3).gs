/** Separate Apps Script project. Deploy as the user accessing this web app. */
function doGet() {
  if (!privateReaderIdentity_()) return HtmlService.createHtmlOutput('บัญชีนี้ไม่ได้รับอนุญาตให้ใช้หน้าค้นหาเอกสาร');
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Engineering Standard · ค้นข้อความและเลขหน้า');
}

function privateReaderIdentity_() {
  var allowed = String(PropertiesService.getScriptProperties().getProperty('PRIVATE_PAGE_ALLOWED_EMAILS') || '')
    .toLowerCase().split(/[\s,;]+/).filter(Boolean);
  var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  return active && active === effective && allowed.indexOf(active) >= 0 ? active : '';
}

/** The only RPC that returns document data. No Drive OAuth token leaves this project. */
function searchPrivateDrivePages(input, rawQuery, mode) {
  var email = privateReaderIdentity_();
  if (!email) return {ok:false,status:'denied'};
  var value = String(input || '').trim(), id = /^[A-Za-z0-9_-]{8,128}$/.test(value) ? value : '';
  if (!id) {
    var link = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{8,128})\/(?:view|preview)(?:[?#].*)?$/.exec(value);
    if (link) id = link[1];
  }
  var query = String(rawQuery || '').normalize('NFC').replace(/\s+/g,' ').trim();
  if (!id || !query || query.length > 120 || (mode !== 'phrase' && query.split(' ').length > 8))
    return {ok:false,status:'invalid_query'};
  mode = mode === 'any' || mode === 'phrase' ? mode : 'all';
  var props = PropertiesService.getScriptProperties();
  var key = String(props.getProperty('PRIVATE_PAGE_SHARED_KEY') || '').trim();
  var broker = String(props.getProperty('PRIVATE_PAGE_BROKER_URL') || '').trim();
  if (key.length < 48 || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(broker))
    return {ok:false,status:'configuration'};
  try {
    var fields = 'id,mimeType,trashed,modifiedTime,size,md5Checksum';
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?supportsAllDrives=true&fields=' + encodeURIComponent(fields);
    var lookup = UrlFetchApp.fetch(url,{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
    if (lookup.getResponseCode() === 403 || lookup.getResponseCode() === 404) return {ok:false,status:'denied'};
    if (lookup.getResponseCode() !== 200) return {ok:false,status:'unavailable'};
    var file = JSON.parse(lookup.getContentText());
    if (file.id !== id || file.trashed || !/^[a-f0-9]{32}$/i.test(file.md5Checksum || '') || ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].indexOf(file.mimeType)<0)
      return {ok:false,status:'denied'};
    var payload = ['drive-page-v1',Date.now(),email,id,query,mode,Date.parse(file.modifiedTime),Number(file.size || 0),String(file.md5Checksum || '').toLowerCase()];
    var signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(JSON.stringify(payload),key,Utilities.Charset.UTF_8));
    var response = UrlFetchApp.fetch(broker,{method:'post',contentType:'application/json',payload:JSON.stringify({payload:payload,signature:signature}),muteHttpExceptions:true});
    if (response.getResponseCode() !== 200) return {ok:false,status:'unavailable'};
    var result = JSON.parse(response.getContentText());
    if (result.ok === true) { result.fileId = id; result.mimeType = file.mimeType; }
    return result;
  } catch (ignore) { return {ok:false,status:'unavailable'}; }
}
