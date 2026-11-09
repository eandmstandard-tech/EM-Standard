const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({console});
vm.runInContext(fs.readFileSync('dist/search-engine.js','utf8'),context);
vm.runInContext(fs.readFileSync('dist/drive-search.js','utf8'),context);
const S=context.StandardsSearch,D=context.DriveStandardsSearch;
const plain=value=>JSON.parse(JSON.stringify(value));
const record=(id,code,title,pages=[])=>({id,code,title,description:'',keywords:'',publisher:'API',disciplines:['Mechanical'],pages});
const records=[record(1,'API 653','Tank inspection',[{number:1,text:'Storage tank foundations.'},{number:2,text:'External inspection requirements.'}]),record(2,'API 510','Pressure vessel inspection',[{number:7,text:'Check the pressure relief valve.'}]),record(3,'LPG 1','LPG tank maintenance',[{number:3,text:'Inspect LPG tank regularly.'}]),record(4,'IEC 1','Motor control',[{number:4,text:'สอบเทียบเครื่องวัดและ motor controls.'}])];
const results=(query,options={})=>S.search(records,{query,mode:'all',scope:'all',...options});
const ids=(query,options)=>Array.from(results(query,options),r=>r.id);

test('quotes, OR, and exclusions parse without becoming literal search words',()=>{
 const p=S.parse('tank "pressure relief" OR motor -LPG -"hot work"');
 assert.equal(p.error,'');assert.equal(p.groups.length,2);assert.equal(p.groups[0][1].phrase,true);
 assert.deepEqual(plain(S.terms(p.raw,'all')),['tank','pressure relief','motor']);assert.deepEqual(plain(p.excluded.map(x=>x.value)),['lpg','hot work']);
});
test('malformed and oversized queries return actionable errors',()=>{
 for(const q of ['"tank','tank OR','OR tank','tank OR OR motor','tank -','""','x'.repeat(121),'a b c d e f g h i'])assert.ok(S.parse(q).error,q);
 assert.equal(S.parse('"pressure relief" inspection').error,'');
});
test('quoted phrases and OR work together with global exclusions',()=>{
 assert.deepEqual(ids('"pressure relief"',{scope:'content'}),[2]);
 assert.deepEqual(new Set(ids('tank OR motor -LPG')),new Set([1,4]));
 assert.deepEqual(ids('tank -LPG'),[1]);assert.deepEqual(new Set(ids('tank',{mode:'phrase',scope:'title'})),new Set([1,3]));
});
test('AND finds words across pages and reports each relevant page',()=>{
 const hit=results('storage inspection',{scope:'content'})[0];
 assert.equal(hit.id,1);assert.deepEqual(plain(hit.matchingPages.map(p=>p.number)),[1,2]);
 assert.equal(results('storage inspection',{scope:'title'}).length,0);
});
test('a phrase cannot be fabricated across a page boundary',()=>{
 const docs=[record(1,'TEST','test',[{number:1,text:'pressure'},{number:2,text:'relief valve'}])];
 assert.equal(S.search(docs,{query:'"pressure relief"',scope:'content'}).length,0);
 assert.equal(S.search(docs,{query:'pressure relief',scope:'content'}).length,1);
});
test('Thai, punctuation in standard identifiers, case, and short terms remain searchable',()=>{
 assert.deepEqual(ids('สอบเทียบ',{scope:'content'}),[4]);
 for(const q of ['API 653','api653','API-653'])assert.equal(results(q)[0]?.id,1,q);
 assert.equal(results('1',{scope:'title'}).length,3);
});
test('exact code outranks incidental mentions and filters remain effective',()=>{
 const docs=[record(1,'OTHER','API 653 reference'),record(2,'API 653','Storage tank'),{...record(3,'API 653 appendix','Appendix'),publisher:'IEC',disciplines:['Electrical']}];
 assert.equal(S.search(docs,{query:'API 653'})[0].id,2);
 assert.deepEqual(Array.from(S.search(docs,{query:'API 653',publishers:['IEC'],discipline:'Electrical'}),r=>r.id),[3]);
});
test('content scope is not biased by matches in the title',()=>{
 const docs=[record(1,'TANK','Tank tank tank tank',[{number:1,text:'pump'}]),record(2,'PUMP','Pump',[{number:1,text:'pump pump pump'}])];
 assert.equal(S.search(docs,{query:'pump',scope:'content'})[0].id,2);
});
test('remote hits add content matches but never bypass a known exclusion',()=>{
 const docs=records.map(r=>({...r,folderId:'f'+r.id}));
 const hits=new Map([['f1',1],['f3',1]]);
 assert.deepEqual(Array.from(S.search(docs,{query:'remote -LPG',scope:'all',remoteHits:hits}),r=>r.id),[1]);
 assert.equal(S.search(docs,{query:'remote',scope:'title',remoteHits:hits}).length,0);
});
test('index is reused and invalidates on additions, deletion, metadata edits, or page replacement',()=>{
 const docs=[record(1,'A','First')],first=S.getIndex(docs);assert.equal(S.getIndex(docs),first);
 docs.push(record(2,'B','Second'));assert.notEqual(S.getIndex(docs),first);assert.equal(S.getIndex(docs).stats.records,2);
 docs[1].title='Updated';assert.equal(S.search(docs,{query:'updated'})[0].id,2);
 docs[0].pages=[{number:12,text:'hidden pump'}];assert.equal(S.search(docs,{query:'hidden',scope:'content'})[0].matchingPages[0].number,12);
 docs.pop();assert.equal(S.search(docs,{query:'updated'}).length,0);
});
test('trigram candidates agree with a direct scan over representative queries',()=>{
 const docs=Array.from({length:150},(_,i)=>record(i,'S '+i,`tank${i%7} ${i%2?'motor':'pump'}`,[{number:1,text:`pressure ${i%3?'relief':'control'} สอบเทียบ ${i%5}`} ]));
 for(const q of ['tank','tank1 pump','"pressure relief"','pump OR motor -tank3','สอบเทียบ','0','control -tank2']){
  const parsed=S.parse(q),expected=docs.filter(r=>S.testQuery([r.code,r.title,r.pages[0].text].join(' '),parsed)).map(r=>r.id).sort((a,b)=>a-b);
  assert.deepEqual(Array.from(S.search(docs,{query:q}),r=>r.id).sort((a,b)=>a-b),expected,q);
 }
});
const file=(id,number=4)=>({id,name:id+'.pdf',pageIndexStatus:'ready',pages:[{number,excerpt:'matched text'}]});
const payload=(files,extra={})=>({ok:true,action:'search',matches:files.length?[{folderId:'folder',fileCount:files.length,files}]:[],standards:[{id:'folder',code:'TEST'}],pageIndexEnabled:true,...extra});

test('simple search uses a single backend request and memory cache',async()=>{
 let calls=0,time=0;const client=D.createClient(async()=>{calls++;return payload([file('a')])},{now:()=>time});
 await client.search(S.parse('tank inspection'));await client.search(S.parse('tank inspection'));assert.equal(calls,1);
 time=120001;await client.search(S.parse('tank inspection'));assert.equal(calls,2);
 client.clear();await client.search(S.parse('tank inspection'));assert.equal(calls,3);
});
test('advanced AND intersects file IDs, not standard folder IDs',async()=>{
 const client=D.createClient(async q=>q.mode==='phrase'?payload([file('phrase-only'),file('both',9)]):payload([file('word-only'),file('both',5)]));
 const response=await client.search(S.parse('inspection "pressure relief"'));
 assert.deepEqual(plain(response.matches[0].files.map(f=>f.id)),['both']);
 assert.deepEqual(plain(response.matches[0].files[0].pages.map(p=>p.number)),[5,9]);
});
test('OR unions files and exclusions remove only excluded file IDs',async()=>{
 const client=D.createClient(async q=>payload(q.query==='pump'?[file('a'),file('b')]:q.query==='motor'?[file('b'),file('c')]:[file('b')]));
 const response=await client.search(S.parse('pump OR motor -LPG'));
 assert.deepEqual(new Set(response.matches[0].files.map(f=>f.id)),new Set(['a','c']));assert.equal(response.matches[0].fileCount,2);
});
test('truncated exclusion fails closed; no misleading results are returned',async()=>{
 for(const extra of [{partial:true},{matches:[{folderId:'folder',fileCount:20,files:[file('b')]}]}]){
  const client=D.createClient(async q=>q.query==='lpg'?payload([file('b')],extra):payload([file('a')]));
  await assert.rejects(client.search(S.parse('tank -LPG')),/ไม่ครบ/);
 }
});
test('negative lookup errors are not treated as an empty exclusion',async()=>{
 const client=D.createClient(async q=>{if(q.query==='lpg')throw new Error('timeout');return payload([file('a')])});
 await assert.rejects(client.search(S.parse('tank -LPG')),/timeout/);
});
test('failed requests are not cached',async()=>{
 let count=0;const client=D.createClient(async()=>++count===1?{ok:false,error:'denied'}:payload([]));
 await assert.rejects(client.search(S.parse('tank')),/denied/);await client.search(S.parse('tank'));assert.equal(count,2);
});
test('advanced searches use at most two concurrent requests',async()=>{
 let running=0,peak=0;const client=D.createClient(async()=>{peak=Math.max(peak,++running);await new Promise(resolve=>setTimeout(resolve,5));running--;return payload([file('a')])});
 await client.search(S.parse('tank "pressure relief" "hot work" -LPG'));assert.equal(peak,2);
});
test('superseded queries and cache invalidation cannot accept in-flight responses',async()=>{
 let resolve,current=true;const client=D.createClient(()=>new Promise(r=>resolve=r));
 const task=client.search(S.parse('tank'),()=>current);current=false;resolve(payload([file('a')]));await assert.rejects(task,{code:'CANCELLED'});
 const other=client.search(S.parse('tank'));client.clear();resolve(payload([]));await assert.rejects(other,{code:'CANCELLED'});
});
test('deferred advanced page requests retain their original query and obey batch limit',async()=>{
 const calls=[];const client=D.createClient(async q=>{calls.push(q);return {ok:true,action:'pages',files:q.fileIds.split(',').map(id=>({...file(id,7)}))}});
 const files=Array.from({length:13},(_,i)=>({...file('p'+i),pageIndexStatus:'deferred',pageQueries:[{query:'pressure relief',mode:'phrase'}]}));
 await client.loadPages(files);assert.equal(calls.length,2);assert.equal(calls[0].fileIds.split(',').length,12);assert.equal(calls[1].query,'pressure relief');assert.equal(calls[1].mode,'phrase');
 assert.ok(files.every(f=>f.pageIndexStatus==='ready'&&f.pages.some(p=>p.number===7)));
});
test('page results from a superseded query never mutate displayed files',async()=>{
 let resolve,current=true;const client=D.createClient(()=>new Promise(r=>resolve=r));
 const files=[{id:'a',pageIndexStatus:'deferred',pageQueries:[{query:'tank',mode:'all'}],pages:[]}];
 const pending=client.loadPages(files,()=>current);current=false;resolve({ok:true,action:'pages',files:[file('a',99)]});
 await assert.rejects(pending,{code:'CANCELLED'});assert.equal(files[0].pages.length,0);
});

test('API 653 recognizes formal STD code and ranks the concise standard before editions',()=>{
 const docs=[record(1,'API STD 653 SPANISH','Tank inspection'),record(2,'API STD 653 Tank Inspection and Repair - Fifth Edition','Tank inspection'),record(3,'API STD 653','Tank inspection')];
 for(const query of ['API 653','api653','API-653'])assert.equal(S.search(docs,{query,scope:'title'})[0]?.id,3,query);
});

test('content search ranks a matching filename higher without adding title-only results',()=>{
 const docs=[{...record(1,'AAA','General reference'),folderId:'f1'},
  {...record(2,'ZZZ','Engineering reference'),folderId:'f2'},
  {...record(3,'TANK','Tank inspection'),folderId:'f3'}];
 const options={query:'tank inspection',scope:'content',remoteHits:new Map([['f1',1],['f2',1]]),
  remoteFiles:new Map([['f1',[{name:'General reference.pdf'}]],['f2',[{name:'Tank Inspection Procedure.pdf'}]]])};
 assert.deepEqual(Array.from(S.search(docs,options),r=>r.id),[2,1]);
 assert.deepEqual(Array.from(S.search(docs,{...options,sort:'code'}),r=>r.id),[1,2]);
});

test('OCR scope searches only locally selected OCR PDFs and keeps actual page numbers',()=>{
 const docs=[{...record(1,'Scanned','Scan',[{number:2,text:'Valve Inspection',ocr:true}]),localOcr:true},
  record(2,'Other','Other',[{number:1,text:'Valve Inspection'}])];
 const matches=S.search(docs,{query:'valve inspection',scope:'content',ocrOnly:true});
 assert.deepEqual(Array.from(matches,x=>x.id),[1]);
 assert.equal(matches[0].matchingPages[0].number,2);
 assert.equal(matches[0].matchingPages[0].ocr,true);
});
