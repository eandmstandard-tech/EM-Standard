const test=require('node:test'), assert=require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const load=(name)=>fs.readFileSync(path.join(__dirname,'..','owner',name+'.gs'),'utf8');
const signed=(bytes)=>Array.from(bytes,x=>x>127?x-256:x);
const owner='owner@example.test', id='testPdf12345', root='rootTest1234', standard='standard1234', indexId='testIndex12345';
const md5=(bytes)=>crypto.createHash('md5').update(Buffer.from(bytes)).digest('hex');
const response=(status,body)=>({getResponseCode:()=>status,getContentText:()=>typeof body==='string'?body:JSON.stringify(body),
  getBlob:()=>({getBytes:()=>signed(body)})});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=';

async function fixture(){
  const sourceEnv=vm.createContext({});
  vm.runInContext(load('PdfLib'),sourceEnv);
  const bytes=Buffer.from(await vm.runInContext(`(async()=>{
     const doc=await PDFLib.PDFDocument.create();
     const image=await doc.embedPng('${png}');
     doc.addPage([200,300]).drawImage(image,{x:0,y:0,width:100,height:100});
     doc.addPage([250,350]).drawImage(image,{x:0,y:0,width:100,height:100});
     return doc.save({objectsPerTick:Infinity});
  })()`,sourceEnv));
  let active=owner, stored=null, exported=0, download=0, exports=[], log=[], badExport=false, changed=false, deny=false;
  const pdf={id, title:'sample.pdf',mimeType:'application/pdf',modifiedDate:'2026-11-09T03:10:00.000Z',
      md5Checksum:md5(bytes),fileSize:String(bytes.length),parents:[{id:standard}]};
  const config={PDF_OCR_FILE_IDS:id,PDF_OCR_OWNER_EMAIL:owner,PDF_OCR_LANGUAGE:'th',PDF_OCR_TEST_QUERY:'การกัดกร่อน'};
  const temp=new Map(), triggers=[];
  const context=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>config[k],setProperty:(k,v)=>config[k]=v,deleteProperty:k=>delete config[k]})},
    Session:{getActiveUser:()=>({getEmail:()=>active}),getEffectiveUser:()=>({getEmail:()=>owner})},
    LockService:{getUserLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
    Drive:{Files:{get:()=>pdf}}, ScriptApp:{getOAuthToken:()=> 'test-token',getProjectTriggers:()=>triggers.slice(),
      deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),
      newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>{
        assert.equal(n,1);
        const t={getUniqueId:()=> 'testTriggerUID',getHandlerFunction:()=>handler}; triggers.push(t); return t;
      }})})})}, Logger:{log:s=>log.push(s)},
    Utilities:{getUuid:()=>crypto.randomUUID(),newBlob:s=>({getBytes:()=>signed(Buffer.from(s))}),
      DigestAlgorithm:{MD5:'md5'},computeDigest:(algo,data)=>signed(crypto.createHash(algo).update(Buffer.from(data)).digest())},
    UrlFetchApp:{fetch:(url,opt)=>{
      assert.match(url,/^https:\/\/www\.googleapis\.com\//);
      assert.equal(opt.headers.Authorization,'Bearer test-token');
      assert.equal(opt.followRedirects,false);
      if(url.includes('/upload/')){
        const boundary=opt.contentType.split('boundary=')[1];
        const raw=Buffer.from(opt.payload).toString('latin1');
        const [,metadata,media]=raw.split('--'+boundary);
        const m=JSON.parse(metadata.split('\r\n\r\n')[1]);
        const content=Buffer.from(media.slice(media.indexOf('\r\n\r\n')+4,-2),'latin1');
        if(m.mimeType==='application/vnd.google-apps.document'){
          assert.match(url,/ignoreDefaultVisibility=true/);
          assert.match(url,/ocrLanguage=th/);
          assert.equal(m.parents,undefined);
          const docId='temporary'+(++exported);
          temp.set(docId,content); exports.push(content);
          return response(200,{id:docId,mimeType:m.mimeType});
        }
        assert.equal(m.mimeType,'application/json');
        if(opt.method==='post') assert.deepEqual(m.parents,['appDataFolder']);
        else assert.equal(opt.method,'patch');
        stored=JSON.parse(content.toString('utf8')); return response(200,{id:indexId});
      }
      if(url.endsWith('mimeType=text%2Fplain')){
        if(changed) pdf.modifiedDate='2026-11-10T00:00:00Z';
        return badExport ? response(503,'OCR test failure') :
          response(200, exported===1?'Sample first page':'ทดสอบ การกัดกร่อน ในหน้าสอง');
      }
      if(opt.method==='delete'){
        const docId=url.split('/').at(-1);
        assert.ok(temp.delete(docId)); return response(204,'');
      }
      if(url.includes('/'+id+'?alt=media')){
        download++; return deny?response(403,'Forbidden'):response(200,bytes);
      }
      if(url.includes('/'+indexId+'?alt=media')) return stored?response(200,stored):response(404,'');
      throw new Error('Unhandled: '+url);
    }}
  });
  for(const file of ['Code','DriveOcr','PdfLib']) vm.runInContext(load(file),context);
  context.rootFolderId_=()=>root;
  context.getStandardsPayload_=()=>({standards:[{id:standard}]});
  context.resolveStandardFolder_=(parent,folders)=>folders[parent]?parent:parent===standard&&folders[root]?root:'';
  const pageWidths=async()=>{const widths=[];for(const page of exports){
    sourceEnv.page=signed(page);
    const info=await vm.runInContext(`(async()=>{const f=await PDFLib.PDFDocument.load(Uint8Array.from(page),{parseSpeed:Infinity});
      return [f.getPageCount(),f.getPage(0).getWidth()];})()`,sourceEnv);
    assert.equal(info[0],1); widths.push(info[1]);
  }return widths;};
  return {context,triggers,queue:()=>context.queueDrivePdfOcrPilot(),run:()=>context.processDrivePdfOcrPilot(),log,temp,
    setActive:v=>active=v,changeDuringOCR:()=>changed=true,deny:()=>deny=true,badExport:v=>badExport=v,
    search:()=>context.searchDrivePdfOcrPilot('การกัดกร่อน','phrase'), getStored:()=>stored,
    calls:()=>({exported,download}),pageWidths};
}

test('two raster-image pages are split, indexed with original page numbers and reused',async()=>{
 const f=await fixture();
 f.queue();
 assert.deepEqual(f.calls(),{exported:0,download:0});
 assert.equal((await f.run()).status,'processing');
 assert.equal(f.search().partial,true);
 assert.equal((await f.run()).status,'ready');
 assert.deepEqual(await f.pageWidths(),[200,250]);
 const result=f.search();
 assert.equal(result.files[0].pages[0].number,2);
 assert.match(result.files[0].pages[0].excerpt,/การกัดกร่อน/);
 assert.equal(f.temp.size,0);
 f.queue(); await f.run(); f.search();
 assert.deepEqual(f.calls(),{exported:2,download:2});
});

test('Drive denial cannot be bypassed and no page is submitted',async()=>{
 const f=await fixture(); f.queue(); f.deny();
 const result=await f.run();
 assert.equal(result.status,'error'); assert.match(result.error,/HTTP 403/);
 assert.equal(f.calls().exported,0); assert.equal(f.getStored(),null);
});

test('a revised source cannot publish a stale page; the temp file is deleted',async()=>{
 const f=await fixture(); f.queue(); f.changeDuringOCR();
 assert.equal((await f.run()).status,'error');
 assert.equal(f.getStored(),null); assert.equal(f.temp.size,0);
 assert.equal(f.search().files.length,0);
});

test('OCR export failures delete the temp document and never publish partial data',async()=>{
 const f=await fixture(); f.queue(); f.badExport(true);
 assert.equal((await f.run()).status,'error'); assert.equal(f.temp.size,0);
 assert.equal(f.getStored(),null); assert.equal(f.search().partial,true);
});

test('unauthorized identities cannot queue, process or read OCR',async()=>{
 const f=await fixture(); f.setActive('visitor@example.test');
 assert.throws(f.queue,/บัญชีเจ้าของ/); assert.throws(f.run,/บัญชีเจ้าของ/);
 assert.throws(f.search,/บัญชีเจ้าของ/); assert.deepEqual(f.calls(),{exported:0,download:0});
});

test('only the recorded trigger can process the queue and it stops when the final page is ready',async()=>{
 const f=await fixture(); f.queue(); f.context.startDriveOcrBackground();
 assert.equal(f.triggers.length,1);
 f.setActive(''); // time trigger does not rely on active-user identity
 await f.context.scheduledDriveOcrPage_({triggerUid:'wrong'});
 assert.deepEqual(f.calls(),{exported:0,download:0});
 const event={triggerUid:f.triggers[0].getUniqueId()};
 assert.equal((await f.context.scheduledDriveOcrPage_(event)).status,'processing');
 assert.equal((await f.context.scheduledDriveOcrPage_(event)).status,'ready');
 assert.equal(f.triggers.length,0);
});
