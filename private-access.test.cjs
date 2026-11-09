const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,p),'utf8');
const key='x'.repeat(64),owner='owner@example.test',visitor='reader@example.test',fileId='testFile1234';
const date='2026-11-09T00:00:00.000Z',hash='7'.repeat(32),root='testRoot1234';
const shared={PRIVATE_PAGE_SHARED_KEY:key,PRIVATE_PAGE_OWNER_EMAIL:owner,PAGE_SEARCH_DOMAIN:'example.test'};
const utilities={Charset:{UTF_8:'UTF_8'},computeHmacSha256Signature:(data,k)=>crypto.createHmac('sha256',k).update(data).digest(),base64EncodeWebSafe:b=>b.toString('base64url'),
 newBlob:x=>x,ungzip:x=>({getDataAsString:()=>JSON.stringify(x)})};
const reply=(status,value)=>({getResponseCode:()=>status,getContentText:()=>JSON.stringify(value)});
function fixtures(){
 const brokerFile={id:fileId,title:'Pressure test',mimeType:'application/pdf',fileSize:'400',modifiedDate:date,md5Checksum:hash,parents:[{id:root}]};
 let index={modifiedAt:date,size:400,md5Checksum:hash,pages:[{number:7,text:'The hydrostatic pressure test shall follow the procedure.'}]};
 let reads=0,posts=0,driveStatus=200,identity=visitor,effective=visitor,ready=true;
 const broker=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:k=>shared[k]})},Session:{getEffectiveUser:()=>({getEmail:()=>owner})},
  Utilities:utilities,Drive:{Files:{get:()=>brokerFile}},createOutput_:value=>value,rootFolderId_:()=>root,resolveStandardFolder_:(id,roots)=>roots[id],
  pdfOcrConfig_:()=>null,driveOcrRevision_:()=>'',driveOcrIndexedMatches_:()=>null,pageIndexConfigured_:()=>ready,getPageJobs_:()=>({[fileId]:{status:'ready',modifiedAt:date,size:400}}),
  readGcs_:()=>{reads++;return {getBytes:()=>index}}});
 vm.runInContext(read('owner/Code.gs').split('function findPageMatches_')[1].split('function createOutput_')[0].replace(/^/,'function findPageMatches_'),broker);
 vm.runInContext(read('owner/PrivatePageBroker.gs'),broker);
 const post=(payload,signature)=>broker.doPost({postData:{contents:JSON.stringify({payload,signature})}});
 const reader=vm.createContext({Utilities:utilities,PropertiesService:{getScriptProperties:()=>({getProperty:k=>({...shared,PRIVATE_PAGE_ALLOWED_EMAILS:visitor,
  PRIVATE_PAGE_BROKER_URL:'https://script.google.com/macros/s/broker/exec'})[k]})},
  Session:{getActiveUser:()=>({getEmail:()=>identity}),getEffectiveUser:()=>({getEmail:()=>effective})},ScriptApp:{getOAuthToken:()=> 'test-token'},
  UrlFetchApp:{fetch:(url,opt)=>{
   if(url.startsWith('https://www.googleapis.com/drive/')){assert.equal(opt.headers.Authorization,'Bearer test-token');return reply(driveStatus,{id:fileId,mimeType:'application/pdf',modifiedTime:date,size:'400',md5Checksum:hash});}
   assert.equal(url,'https://script.google.com/macros/s/broker/exec');assert.doesNotMatch(opt.payload,/test-token/);posts++;
   return reply(200,broker.doPost({postData:{contents:opt.payload}}));
  }}});
 vm.runInContext(read('reader/Code.gs'),reader);
 const params=()=>['drive-page-v1',Date.now(),visitor,fileId,'hydrostatic','phrase',Date.parse(date),400,hash];
 const sign=p=>utilities.base64EncodeWebSafe(utilities.computeHmacSha256Signature(JSON.stringify(p),key));
 return {run:()=>reader.searchPrivateDrivePages('https://drive.google.com/file/d/'+fileId+'/view?usp=sharing','hydrostatic','phrase'),
  post,params,sign,brokerFile,reads:()=>reads,posts:()=>posts,
  drive:v=>{driveStatus=v},user:(a,b)=>{identity=a;effective=b},setIndex:v=>{index={...index,...v}},config:v=>{ready=v}};
}
test('authorized account gets only a matching excerpt and its actual page',()=>{
 const f=fixtures(),result=f.run();assert.equal(result.ok,true);assert.equal(result.pages.length,1);
 assert.equal(result.pages[0].number,7);assert.match(result.pages[0].excerpt,/hydrostatic/);assert.equal(f.reads(),1);
});
test('Drive denial blocks all broker and index requests',()=>{
 for(const status of [403,404]){const f=fixtures();f.drive(status);assert.equal(f.run().status,'denied');assert.equal(f.posts(),0);assert.equal(f.reads(),0);}
});
test('an unlisted or impersonated account cannot call the reader',()=>{
 for(const [active,effective] of [['other@example.test','other@example.test'],[visitor,owner],['',owner]]){
  const f=fixtures();f.user(active,effective);assert.equal(f.run().status,'denied');assert.equal(f.posts(),0);
 }
});
test('forged, altered or expired signatures cannot read any index',()=>{
 const f=fixtures(),p=f.params();assert.equal(f.post(p,'forged').status,'denied');
 const signature=f.sign(p);p[4]='another term';assert.equal(f.post(p,signature).status,'denied');
 p[1]-=120000;assert.equal(f.post(p,f.sign(p)).status,'denied');assert.equal(f.reads(),0);
});
test('a moved or revised file is blocked before reading the index',()=>{
 const f=fixtures();f.brokerFile.parents=[{id:'elsewhere'}];assert.equal(f.run().status,'denied');assert.equal(f.reads(),0);
 f.brokerFile.parents=[{id:root}];f.brokerFile.modifiedDate='2026-11-08T01:00:00.000Z';
 assert.equal(f.run().status,'denied');assert.equal(f.reads(),0);
});
test('stale or unconfigured index does not return older text',()=>{
 const f=fixtures();f.setIndex({md5Checksum:'a'.repeat(32)});assert.equal(f.run().status,'index_not_ready');
 f.config(false);assert.equal(f.run().status,'index_not_configured');
});
test('public legacy result path cannot serve page text',()=>{
 const context=vm.createContext({});vm.runInContext(read('owner/Code.gs'),context);
 assert.equal(context.pageSearchAllowed_(),false);
 assert.throws(()=>context.searchIndexedPages_('pressure','all',fileId),/เฉพาะบัญชี/);
});
