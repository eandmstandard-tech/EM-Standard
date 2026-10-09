const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const zlib=require('node:zlib');
const crypto=require('node:crypto');

function backend(){
  const values={},cached=new Map(),triggers=[];let locked=false,sequence=0,onRelease=null;
  const blob=(data,contentType)=>({getBytes:()=>Buffer.from(data),getDataAsString:()=>Buffer.from(data).toString(),
    getContentType:()=>contentType||(typeof data==='string'?'text/plain':null)});
  const properties={getProperty:key=>values[key]||null,getProperties:()=>({...values}),
    setProperty:(key,value)=>{values[key]=value},setProperties:items=>Object.assign(values,items),deleteProperty:key=>delete values[key]};
  const context=vm.createContext({console,Date,JSON,Object,String,Number,Math,
    Drive:{Changes:{getStartPageToken:()=>({startPageToken:'baseline'}),list:()=>({items:[{fileId:'folder'}],newStartPageToken:'next'})}},
    PropertiesService:{getScriptProperties:()=>properties},
    CacheService:{getScriptCache:()=>({get:key=>cached.get(key),put:(key,value)=>cached.set(key,value),remove:key=>cached.delete(key)})},
    Utilities:{getUuid:()=>`id-${++sequence}`,newBlob:blob,gzip:b=>blob(zlib.gzipSync(b.getBytes()),'application/gzip'),
      ungzip:b=>{if(!b.getContentType())throw new Error('Blob must have a non-null content type');return blob(zlib.gunzipSync(b.getBytes()),'application/json')},
      base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>Buffer.from(s,'base64'),
      DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,text)=>crypto.createHash(alg).update(text).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true},releaseLock:()=>{locked=false;onRelease?.()}})},
    Logger:{log:()=>{}},ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),
      newTrigger:handler=>{let delay;const builder={timeBased:()=>builder,after:ms=>{delay=ms;return builder},everyMinutes:()=>builder,
        create:()=>{const id=`t-${++sequence}`;const t={getHandlerFunction:()=>handler,getUniqueId:()=>id,delay};triggers.push(t);return t}};return builder}}});
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context);
  context.pageIndexConfigured_=()=>false;
  const actualScan=context.scanIndexTree_;
  const scan={standards:[{id:'folder',code:'API 653'}],byFolder:{folder:2},total:2,rootName:'Standards',signature:'sig',files:[],
    trackedIds:[context.ROOT_FOLDER_ID,'folder','file'],folderIds:[context.ROOT_FOLDER_ID,'folder']};
  context.scanIndexTree_=()=>scan;
  return {context,values,triggers,properties,scan,actualScan,setBusy:v=>{locked=v},setRelease:f=>{onRelease=f}};
}
test('busy response cannot masquerade as the previous error or completion',()=>{
  const b=backend();b.values[b.context.INDEX_JOB_KEY]=JSON.stringify({id:'old',status:'error',error:'old error'});b.setBusy(true);
  const response=b.context.queueIndexRefresh_('new');assert.equal(response.ok,true);assert.equal(response.accepted,false);assert.equal(response.busy,true);assert.equal(b.triggers.length,0);
});
test('same request is deduplicated before and after completion',()=>{
  const b=backend();const first=b.context.queueIndexRefresh_('request');assert.equal(first.jobId,'request');assert.equal(first.accepted,true);
  b.context.queueIndexRefresh_('request');assert.equal(b.triggers.length,1);
  const id=b.triggers[0].getUniqueId();b.context.rebuildIndex({triggerUid:id});
  const done=b.context.queueIndexRefresh_('request');assert.equal(done.syncStatus,'complete');assert.equal(done.jobId,'request');assert.equal(b.triggers.length,0);
});
test('trigger lock contention preserves queued job and schedules a retry',()=>{
  const b=backend();b.context.queueIndexRefresh_('request');const id=b.triggers[0].getUniqueId();b.setBusy(true);
  const response=b.context.rebuildIndex({triggerUid:id});assert.equal(response.syncStatus,'queued');assert.equal(b.triggers.length,1);assert.equal(b.triggers[0].delay,60000);
});
test('completion cannot delete a trigger created after lock release',()=>{
  const b=backend();b.context.queueIndexRefresh_('request');const id=b.triggers[0].getUniqueId();
  b.setRelease(()=>{b.setRelease(null);b.context.queueIndexRefresh_('next')});
  b.context.rebuildIndex({triggerUid:id});assert.equal(b.triggers.length,1);assert.equal(b.context.refreshStatus_().jobId,'next');assert.equal(b.context.refreshStatus_().syncStatus,'queued');
});
test('watcher fulfills queued request even when tree has no additions/deletions',()=>{
  const b=backend();b.context.rebuildIndex();b.context.queueIndexRefresh_('request');b.context.watchIndexChanges();
  assert.equal(b.context.refreshStatus_().jobId,'request');assert.equal(b.context.refreshStatus_().syncStatus,'complete');
  b.context.watchIndexChanges();assert.equal(b.context.refreshStatus_().jobId,'request');
});
test('page queue failure is a warning, while list remains available',()=>{
  const b=backend();b.context.pageIndexConfigured_=()=>true;b.context.syncPageJobs_=()=>{throw new Error('page queue broken')};
  b.context.rebuildIndex();const response=b.context.refreshStatus_();assert.equal(response.syncStatus,'complete');assert.match(response.warning,/page queue broken/);
  b.context.getPageJobs_=()=>{throw new Error('list must never decode page queue')};const index=b.context.indexResponse_();assert.equal(index.ok,true);assert.equal(index.count,1);assert.equal(index.pageIndex.enabled,true);
});
test('index read survives generation retirement after snapshot; old reader cannot poison new cache',()=>{
  const b=backend();const first={ok:true,standards:[{code:'old'}],generatedAt:'old'};
  b.context.saveStandardsPayload_(first);const oldPrefix=JSON.parse(b.values[b.context.INDEX_META_KEY]).prefix;
  // Force a cache miss, then retire the old generation just after read snapshot.
  b.context.CacheService.getScriptCache().remove('hub-index-'+oldPrefix);
  const read=b.properties.getProperties;b.properties.getProperties=()=>{const snapshot=read();b.properties.getProperties=read;
    b.context.saveStandardsPayload_({ok:true,standards:[{code:'new'}],generatedAt:'new'});return snapshot};
  assert.equal(b.context.getStandardsPayload_().standards[0].code,'old');assert.equal(b.context.getStandardsPayload_().standards[0].code,'new');
});
test('missing chunks surface a real error rather than success with an empty list',()=>{
  const b=backend();b.values[b.context.INDEX_META_KEY]=JSON.stringify({prefix:'missing_',chunks:1});
  const index=b.context.indexResponse_();assert.equal(index.ok,false);assert.equal(index.indexMissing,true);assert.match(index.error,/ดัชนีไม่สมบูรณ์/);
});
test('stale running status is reported as interrupted and a new request can recover',()=>{
  const b=backend();b.values[b.context.INDEX_JOB_KEY]=JSON.stringify({id:'old',status:'running',startedAt:Date.now()-8*60000});
  assert.equal(b.context.refreshStatus_().syncStatus,'interrupted');assert.equal(b.context.queueIndexRefresh_('new').jobId,'new');
});

function frontend(responses){
  let now=0,shown=0,reads=0;const messages=[],calls=[],delays=[];const button={disabled:false,classList:{add(){},remove(){}},querySelector:()=>({textContent:''})};
  const context=vm.createContext({Date:{now:()=>now},Math,Error,console,
    window:{setTimeout:(f,ms)=>{now+=ms;delays.push(ms);f()}},appsScriptUrl:'https://script.google.com/macros/s/example/exec',
    indexSource:'fallback',indexGeneratedAt:'',
    $:()=>button,setIndexStatus:(message,state)=>messages.push({message,state}),finishRefreshButton:()=>{button.disabled=false},
    requestAppsScriptIndex:async params=>{calls.push(params);const response=responses.shift();if(response instanceof Error)throw response;if(!response)throw new Error('Unexpected extra request');return response},
    readAppsScriptIndex:async()=>{reads++;return {ok:true,standards:[],generatedAt:'today'}},updateStandardsFromIndex:()=>{shown++;return true},indexSummary:()=>'',formatThaiDate:v=>v});
  const source=fs.readFileSync('dist/app.js','utf8');
  vm.runInContext(source.slice(source.indexOf('function requireRefreshProtocol'),source.indexOf('async function loadCurrentIndexOnOpen')),context);
  return {context,messages,calls,button,delays,get shown(){return shown},get reads(){return reads}};
}
const state=(syncStatus,extra={})=>({ok:true,refreshProtocol:2,syncStatus,jobId:'request',...extra});
test('frontend retries busy old completion, only displays the accepted job result',async()=>{
  const f=frontend([state('complete',{accepted:false,jobId:'old'}),state('queued',{accepted:true}),state('complete')]);
  await f.context.waitForIndexRefresh({requestId:'request',needsRequest:true});assert.equal(f.shown,1);assert.equal(f.calls[0].action,'refresh');assert.equal(f.calls[1].requestId,'request');assert.equal(f.calls[2].action,'status');
});
test('a polling timeout can recover without claiming refresh failed',async()=>{
  const timeout=Object.assign(new Error('slow'),{code:'TIMEOUT'});const f=frontend([timeout,state('running'),state('complete')]);
  await f.context.waitForIndexRefresh({requestId:'request',jobId:'request'});assert.equal(f.shown,1);assert.ok(!f.messages.some(x=>x.state==='error'));
});
test('unrelated job completion is never reported as successful refresh',async()=>{
  const f=frontend([state('complete',{jobId:'old'})]);await f.context.waitForIndexRefresh({jobId:'request'});assert.equal(f.shown,0);assert.match(f.messages.at(-1).message,/ยังยืนยันผล/);
});
test('three transport failures leave previous list and report uncertainty',async()=>{
  const f=frontend([new Error('slow'),new Error('slow'),new Error('slow')]);await f.context.waitForIndexRefresh({jobId:'request'});
  assert.equal(f.shown,0);assert.match(f.messages.at(-1).message,/ยังยืนยันผล Refresh ไม่ได้/);assert.ok(!f.messages.some(x=>x.state==='error'));
});
test('actual backend failure remains an error and old deployment has actionable message',async()=>{
  const f=frontend([state('error',{syncError:'Drive denied'})]);await assert.rejects(f.context.waitForIndexRefresh({jobId:'request'}),/Drive denied/);
  assert.throws(()=>f.context.requireRefreshProtocol({ok:true,apiVersion:'old'}),/Deploy New version/);
});

test('unchanged refresh takes one changes request, no scan, no trigger, and includes the saved index',()=>{
  const b=backend();b.context.rebuildIndex();let scans=0,changes=0;
  b.context.scanIndexTree_=()=>{scans++;throw new Error('must not scan')};
  b.context.Drive.Changes.list=options=>{changes++;assert.equal(options.pageToken,'baseline');return {items:[],newStartPageToken:'next'}};
  const response=b.context.queueIndexRefresh_('fast');
  assert.equal(response.syncStatus,'complete');assert.equal(response.refreshMode,'unchanged');assert.equal(response.index.count,1);
  assert.equal(scans,0);assert.equal(changes,1);assert.equal(b.triggers.length,0);
  assert.equal(JSON.parse(b.values[b.context.CHANGE_CURSOR_KEY]).token,'next');
});
test('unrelated Drive edits advance cursor without scanning the standards tree',()=>{
  const b=backend();b.context.rebuildIndex();b.context.Drive.Changes.list=()=>({items:[{fileId:'outside',file:{parents:[{id:'outsideFolder'}]}}],newStartPageToken:'next'});
  assert.equal(b.context.queueIndexRefresh_('fast').refreshMode,'unchanged');assert.equal(b.triggers.length,0);
});
for(const [name,change] of [
  ['new file in a known folder',{fileId:'new',file:{parents:[{id:'folder'}]}}],
  ['new subfolder with imported files',{fileId:'newFolder',file:{parents:[{id:'folder'}]}}],
  ['deleted known file',{fileId:'file',deleted:true}],
  ['known file moved outside the tree',{fileId:'file',file:{parents:[{id:'outside'}]}}],
  ['known folder renamed',{fileId:'folder',file:{parents:[{id:'root'}]}}]
])test(name+' causes refresh and does not advance the cursor early',()=>{
  const b=backend();b.context.rebuildIndex();b.context.Drive.Changes.list=()=>({items:[change],newStartPageToken:'next'});
  const response=b.context.queueIndexRefresh_('changed');assert.equal(response.syncStatus,'queued');assert.equal(b.triggers.length,1);
  assert.equal(JSON.parse(b.values[b.context.CHANGE_CURSOR_KEY]).token,'baseline');
});
test('all change pages must be read before concluding that the tree is unchanged',()=>{
  const b=backend();b.context.rebuildIndex();let calls=0;
  b.context.Drive.Changes.list=opts=>{calls++;return opts.pageToken==='baseline'?{items:[],nextPageToken:'second'}:{items:[{fileId:'file'}],newStartPageToken:'next'}};
  assert.equal(b.context.queueIndexRefresh_('changed').syncStatus,'queued');assert.equal(calls,2);
});
test('rejected token and over-budget feed both fall back to full scan',()=>{
  const b=backend();b.context.rebuildIndex();b.context.Drive.Changes.list=()=>{throw new Error('410 token rejected')};
  const response=b.context.queueIndexRefresh_('changed');assert.equal(response.syncStatus,'queued');assert.match(response.warning,/410/);
  const c=backend();c.context.rebuildIndex();let calls=0;c.context.Drive.Changes.list=()=>({items:[],nextPageToken:'more-'+(++calls)});
  assert.equal(c.context.queueIndexRefresh_('changed').syncStatus,'queued');assert.equal(calls,2);
});
test('changes occurring during a full scan are checked on the next refresh',()=>{
  const b=backend();let current='before';b.context.Drive.Changes.getStartPageToken=()=>({startPageToken:current});
  b.context.scanIndexTree_=()=>{current='after';return b.scan};b.context.rebuildIndex();
  assert.equal(JSON.parse(b.values[b.context.CHANGE_CURSOR_KEY]).token,'before');
  b.context.Drive.Changes.list=options=>{assert.equal(options.pageToken,'before');return {items:[{fileId:'file'}],newStartPageToken:'after'}};
  assert.equal(b.context.queueIndexRefresh_('changed').syncStatus,'queued');
});
test('shared-drive feed stays scoped to the library drive',()=>{
  const b=backend();b.scan.driveId='shared';b.context.saveStandardsPayload_({ok:true,rootFolder:{driveId:'shared'},standards:[]});
  b.context.Drive.Changes.getStartPageToken=opts=>{assert.equal(opts.driveId,'shared');return {startPageToken:'baseline'}};
  b.context.rebuildIndex();b.context.Drive.Changes.list=opts=>{assert.equal(opts.driveId,'shared');return {items:[],newStartPageToken:'next'}};
  assert.equal(b.context.queueIndexRefresh_('fast').refreshMode,'unchanged');
});
test('direct runner cannot execute a different queued request and preserves fallback trigger',()=>{
  const b=backend();b.context.queueIndexRefresh_('right');let scans=0;b.context.scanIndexTree_=()=>{scans++;return b.scan};
  b.context.rebuildIndex({requestId:'wrong'});assert.equal(scans,0);assert.equal(b.context.refreshStatus_().syncStatus,'queued');
  b.context.rebuildIndex({requestId:'right'});assert.equal(scans,1);assert.equal(b.context.refreshStatus_().syncStatus,'complete');assert.equal(b.triggers.length,1);
});
test('frontend consumes inline index without another read and checks status sooner',async()=>{
  const index={ok:true,standards:[],generatedAt:'today'};
  const f=frontend([state('complete',{index})]);await f.context.waitForIndexRefresh({jobId:'request'});
  assert.equal(f.shown,1);assert.equal(f.reads,0);assert.equal(f.delays[0],1500);
});
test('unchanged index generation does not download the list again',async()=>{
  const f=frontend([]);f.context.indexSource='drive';f.context.indexGeneratedAt='today';
  await f.context.showRefreshedIndex('',null,state('complete',{generatedAt:'today',checkedAt:'now'}));assert.equal(f.reads,0);assert.equal(f.shown,0);
});
test('click starts accepted refresh directly and consumes result in two requests',async()=>{
  const index={ok:true,standards:[],generatedAt:'today'};
  const f=frontend([state('queued',{accepted:true,directRefreshSupported:true}),state('complete',{index})]);
  await f.button.onclick();assert.deepEqual(f.calls.map(x=>x.action),['refresh','runRefresh']);assert.equal(f.shown,1);assert.equal(f.reads,0);assert.equal(f.delays.length,0);assert.equal(f.button.disabled,false);
});

test('real tree scan tracks membership, restricts corpus, and signatures detect renames/content edits',()=>{
  const b=backend(),root=b.context.ROOT_FOLDER_ID;
  const rows=[{id:'publisher',title:'API',mimeType:'application/vnd.google-apps.folder',parents:[{id:root}]},
    {id:'folder',title:'API 653',mimeType:'application/vnd.google-apps.folder',parents:[{id:'publisher'}]},
    {id:'file',title:'standard.pdf',mimeType:'application/pdf',modifiedDate:'first',parents:[{id:'folder'}]}];
  let rootTitle='Standards';
  b.context.Drive.Files={get:()=>({id:root,title:rootTitle,driveId:'shared'}),list:options=>{
    assert.equal(options.corpora,'drive');assert.equal(options.driveId,'shared');
    return {items:rows.filter(row=>row.parents.some(p=>options.q.includes("'"+p.id+"' in parents")))};
  }};
  const first=b.actualScan();assert.equal(first.total,1);assert.ok(first.trackedIds.includes('file'));assert.ok(first.folderIds.includes('folder'));
  rows[1].title='API 650';const renamed=b.actualScan();assert.notEqual(first.signature,renamed.signature);assert.equal(renamed.standards[0].code,'API 650');
  rows[2].modifiedDate='second';assert.notEqual(renamed.signature,b.actualScan().signature);
  const beforeRootRename=b.actualScan().signature;rootTitle='New root';assert.notEqual(beforeRootRename,b.actualScan().signature);
});
test('polling starts an accepted request directly after busy retry',async()=>{
  const f=frontend([state('queued',{accepted:true,directRefreshSupported:true}),state('complete',{index:{ok:true,standards:[]}})]);
  await f.context.waitForIndexRefresh({requestId:'request',needsRequest:true});assert.deepEqual(f.calls.map(x=>x.action),['refresh','runRefresh']);assert.equal(f.shown,1);
});
test('stored page jobs round-trip through gzip with explicit binary MIME type',()=>{
  const b=backend();b.context.savePageJobs_({file:{status:'ready',name:'Standard.pdf'}});
  assert.equal(b.context.getPageJobs_().file.name,'Standard.pdf');
  assert.equal(JSON.parse(b.values[b.context.PAGE_SUMMARY_KEY]).ready,1);
});
test('uncached change-state reload uses a typed compressed Blob',()=>{
  const b=backend();b.context.rebuildIndex();
  const meta=JSON.parse(b.values[b.context.CHANGE_STATE_META_KEY]);
  b.context.CacheService.getScriptCache().remove('hub-changes-'+meta.prefix);
  const state=b.context.readChangeState_();assert.equal(state.token,'baseline');assert.ok(state.ids.includes('file'));
});
