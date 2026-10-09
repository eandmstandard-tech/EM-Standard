const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('dist/app.js','utf8');
function searchFrontend(request){
  let task;const calls=[];const elements={search:{value:'inspection'},searchMode:{value:'all'},detail:{open:false}};
  const context=vm.createContext({Map,Set,Array,Number,String,Error,console,
    window:{clearTimeout(){},setTimeout(fn){task=fn;return 1}},
    $:id=>elements[id],remoteSearchTimer:null,remoteSearchVersion:0,
    remoteFiles:new Map(),remoteHits:new Map(),remoteSearchStatus:'',
    appsScriptUrl:'https://script.google.com/macros/s/example/exec',standards:[],openDetailId:null,
    render(){},showDetail(){},normalizeRemoteStandards:v=>v,renderPublisherFilters(){},
    requestAppsScriptIndex:async params=>{calls.push(params);return request(params,context)}});
  vm.runInContext(source.slice(source.indexOf('function renderSearchResults'),source.indexOf('function finishRefreshButton')),context);
  return {context,calls,run:async()=>{context.scheduleRemoteSearch(true);await task()}};
}
test('content search reads Apps Script page hits without a Google identity client',async()=>{
  const f=searchFrontend(()=>({ok:true,action:'search',pageIndexEnabled:true,matches:[{folderId:'standard',fileCount:1,files:[{id:'pdf',pageIndexStatus:'ready',pages:[{number:35,excerpt:'inspection'}]}]}]}));
  await f.run();assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'search');assert.equal(f.context.remoteFiles.get('standard')[0].pages[0].number,35);assert.doesNotMatch(f.context.remoteSearchStatus,/เชื่อมบัญชี|OAuth/);
});
test('remaining page hits load in batches of at most twelve',async()=>{
  const f=searchFrontend(params=>params.action==='search'?{ok:true,action:'search',pageIndexEnabled:true,partialPages:true,matches:[{folderId:'standard',files:Array.from({length:13},(_,i)=>({id:'pdf'+i,pageIndexStatus:'deferred'}))}]}:{ok:true,action:'pages',files:params.fileIds.split(',').map(id=>({id,pageIndexStatus:'ready',pages:[{number:7}]}))});
  await f.run();assert.equal(f.calls.length,3);assert.equal(f.calls[1].fileIds.split(',').length,12);assert.equal(f.calls[2].fileIds.split(',').length,1);assert.ok(f.context.remoteFiles.get('standard').every(file=>file.pages[0].number===7));
});
test('restricted page results preserve file matches and do not request page text',async()=>{
  const f=searchFrontend(()=>({ok:true,action:'search',pageIndexRestricted:true,partialPages:true,matches:[{folderId:'standard',files:[{id:'pdf',pageIndexStatus:'restricted'}]}]}));
  await f.run();assert.equal(f.calls.length,1);assert.equal(f.context.remoteHits.size,1);assert.match(f.context.remoteSearchStatus,/ยังไม่มีสิทธิ์/);
});
test('a failed page lookup preserves file search results',async()=>{
  const f=searchFrontend(params=>{if(params.action==='pages')throw new Error('timeout');return {ok:true,action:'search',pageIndexEnabled:true,partialPages:true,matches:[{folderId:'standard',files:[{id:'pdf',pageIndexStatus:'deferred'}]}]}});
  await f.run();assert.equal(f.context.remoteHits.size,1);assert.equal(f.context.remoteFiles.get('standard')[0].pageIndexStatus,'unavailable');assert.match(f.context.remoteSearchStatus,/โหลดเลขหน้าเพิ่มเติมไม่สำเร็จ/);
});
test('page results for an earlier query cannot overwrite a newer query',async()=>{
  const f=searchFrontend((params,c)=>{if(params.action==='search')return {ok:true,action:'search',pageIndexEnabled:true,partialPages:true,matches:[{folderId:'old',files:[{id:'pdf',pageIndexStatus:'deferred'}]}]};c.remoteSearchVersion++;c.remoteFiles=new Map([['new',[{id:'newpdf',pageIndexStatus:'ready',pages:[{number:99}]}]]]);return {ok:true,action:'pages',files:[{id:'pdf',pageIndexStatus:'ready',pages:[{number:7}]}]}});
  await f.run();assert.equal(f.context.remoteFiles.get('new')[0].pages[0].number,99);assert.equal(f.context.remoteFiles.has('old'),false);
});
