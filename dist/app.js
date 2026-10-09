const disciplines=[{name:'Electrical',th:'งานไฟฟ้า',icon:'ϟ',color:'#956512',bg:'#fff5df'},{name:'Mechanical',th:'งานเครื่องกล',icon:'⚙',color:'#276ba9',bg:'#eaf3ff'},{name:'Civil',th:'งานโยธา',icon:'▥',color:'#28776a',bg:'#e6f5ee'},{name:'Instrument',th:'งานเครื่องมือวัด',icon:'⌁',color:'#8053b2',bg:'#f2ecfb'}];
// Folder metadata read from Google Drive on 17 Sep 2026. Discipline assignments are preliminary.
const raw=[]; // ข้อมูลรายการมาตรฐานโหลดจาก backend ที่ผู้ดูแลตั้งค่า
let standards=raw.map((r,id)=>({id,folderId:'',code:r[0],title:r[1],disciplines:r[2].split(','),description:r[3],keywords:r[4],topic:r[5],publisher:r[6],url:r[7]}));
let indexSource='fallback',driveFileCount=null,indexGeneratedAt='';
const localStandardMetadata=new Map(standards.map(s=>[s.code.toLowerCase(),s]));
const appConfig=window.ENGINEERING_STANDARDS_CONFIG||{};
const appsScriptUrl=String(appConfig.appsScriptUrl||'').trim();
let remoteHits=new Map(),remoteFiles=new Map(),remoteSearchStatus='',remoteSearchTimer=0,remoteSearchVersion=0,openDetailId=null;
let pageIndexCoverage=null;
try{window.localStorage.removeItem('engineeringStandardsOAuthClientId')}catch{}
const remotePageCache=new Map();let remotePageBytes=0,locateTarget=null,locateBusy=false,locateState=null;
let chosen='',view='list',folder='',selectedPublishers=new Set();const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const theme=d=>`--color:${d.color};--bg:${d.bg}`;
function tag(name){const d=disciplines.find(d=>d.name===name);return `<span class="tag" style="${theme(d)}">${name}</span>`}
function setDiscipline(name){chosen=chosen===name?'':name;folder='';currentPage=1;render()}
let currentPage=1, pageSize=10;
function getSearchOptions(){return {query:$('search').value,mode:$('searchMode').value,scope:$('searchScope').value,discipline:chosen,publishers:[...selectedPublishers],folder,sort:$('sort').value,remoteHits}}
function getResults(){return StandardsSearch.search(standards,getSearchOptions())}
function words(){return StandardsSearch.terms($('search').value,$('searchMode').value)}
function highlight(text){
  const clean=String(text||'').normalize('NFC').replace(/\s+/g,' '), lower=clean.toLowerCase();
  const ranges=[];
  words().forEach(word=>{let pos=lower.indexOf(word);while(pos!==-1){ranges.push([pos,pos+word.length]);pos=lower.indexOf(word,pos+Math.max(1,word.length))}});
  ranges.sort((a,b)=>a[0]-b[0]);const merged=[];
  ranges.forEach(r=>{const last=merged[merged.length-1];if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else merged.push(r.slice())});
  let end=0,out='';merged.forEach(([a,b])=>{out+=esc(clean.slice(end,a))+'<mark>'+esc(clean.slice(a,b))+'</mark>';end=b});return out+esc(clean.slice(end));
}
function excerpt(text){const clean=String(text||'').normalize('NFC').replace(/\s+/g,' '),lower=clean.toLowerCase();const positions=words().map(w=>lower.indexOf(w)).filter(n=>n>=0);const start=Math.max(0,(positions.length?Math.min(...positions):0)-65);return (start?'…':'')+clean.slice(start,start+260)+(start+260<clean.length?'…':'')}
function pageMatches(s){return getResults().find(r=>r.id===s.id)?.matchingPages||[]}
function locatedFileMatches(file){
  const cached=remotePageCache.get(file.id),terms=StandardsSearch.terms($('search').value,$('searchMode').value);
  if(cached&&terms.length)return cached.pages.filter(p=>StandardsSearch.matches(p.text,terms,$('searchMode').value));
  if(file.pageIndexStatus==='ready'&&Array.isArray(file.pages))return file.pages;
  return [];
}
function pageIndexNote(file){
  const messages={ready:Array.isArray(file.pages)&&file.pages.length?'พบคำใน '+file.pages.length+' หน้า (จากดัชนีเอกสาร)':'ไม่พบคำในข้อความที่จัดทำดัชนี (Drive อาจพบจากชื่อหรือข้อมูลไฟล์)',restricted:'ยังไม่มีสิทธิ์อ่านดัชนีเลขหน้า · ตรวจสิทธิ์ Apps Script',not_indexed:'ยังไม่มีดัชนีเลขหน้าของไฟล์นี้',queued:'ไฟล์นี้อยู่ในคิวสร้างดัชนีเลขหน้า',processing:'กำลังสร้างดัชนีเลขหน้าของไฟล์นี้',running:'กำลังสร้างดัชนีเลขหน้าของไฟล์นี้',error:'สร้างดัชนีเลขหน้าของไฟล์นี้ไม่สำเร็จ',unavailable:'อ่านดัชนีเลขหน้าของไฟล์นี้ไม่สำเร็จ',deferred:'กำลังโหลดผลค้นเลขหน้าเพิ่มเติม'};
  return messages[file.pageIndexStatus]||'ยังไม่มีข้อมูลเลขหน้า · เลือกไฟล์จากเครื่องเพื่อค้นเพิ่มเติมได้';
}
function renderLocatedFile(file){
  const safeUrl=/^https:\/\/(?:drive|docs)\.google\.com\//.test(file.url)?file.url:'';
  const matches=locatedFileMatches(file),cached=remotePageCache.get(file.id),automatic=!!cached||file.pageIndexStatus==='ready';
  const pending=locateState?.id===file.id?`<p class="search-help" role="status">${esc(locateState.message)}</p>`:'';
  const kind=file.mimeType==='application/pdf'?'PDF':file.mimeType==='application/msword'?'Word (.doc)':'Word';
  const note=cached?matches.length?`พบคำใน ${matches.length} ${cached.pageNumbersAvailable?'หน้า':'ตำแหน่งที่ยังไม่มีเลขหน้า'}`:'ไม่พบคำในเนื้อหาของไฟล์ (Drive อาจพบจากชื่อหรือข้อมูลไฟล์)':pageIndexNote(file);
  return `<div class="page-hit"><strong>${esc(file.name)}</strong> · ${kind} ${safeUrl?`<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">เปิดไฟล์บน Drive ↗</a>`:''}
    ${pending}
    <p class="search-help">${esc(note)}</p>
    ${matches.slice(0,40).map(p=>`<div class="located-page">${p.number&&kind==='PDF'&&safeUrl?`<a href="${esc(safeUrl)}#page=${p.number}" target="_blank" rel="noopener noreferrer">หน้า ${p.number} · เปิด PDF ↗</a>`:p.number?`<strong>หน้า ${p.number} ${file.pageIndexStatus==='ready'?'(ตามดัชนีเอกสาร)':file.mimeType==='application/vnd.google-apps.document'?'(จาก PDF ที่ส่งออก)':'(ตามที่ Word บันทึก)'}</strong>`:'<strong>พบข้อความ แต่ไม่มีเลขหน้าที่บันทึกไว้</strong>'}<p>${highlight(p.excerpt||excerpt(p.text||''))}</p></div>`).join('')}</div>`;
}
function resultCard(s){
  const page=s.matchingPages[0];const snippet=page?page.text:[s.description,s.keywords].filter(Boolean).join(' · ');
  const located=(remoteFiles.get(s.folderId)||[]).map(f=>({file:f,pages:locatedFileMatches(f)})).find(item=>item.pages.some(p=>p.number));
  const source=page&&page.number?'พบใน '+s.fileType+' · หน้า '+page.number:page?'พบข้อความใน Word · ไม่ระบุหน้า':located?`พบใน ${located.file.name} · หน้า ${located.pages.filter(p=>p.number).slice(0,4).map(p=>p.number).join(', ')}${located.pages.length>4?'…':''}`:s.remoteContentMatch?`พบในดัชนีไฟล์ Drive · ${s.matchedFileCount} ไฟล์`:'พบในข้อมูลรายการ';
  const description=located&&!page?highlight(located.pages[0].excerpt||excerpt(located.pages[0].text||'')):s.remoteContentMatch&&!page?'Google Drive พบไฟล์ที่เกี่ยวข้อง · เปิดรายละเอียดเพื่อตรวจสถานะเลขหน้า':highlight(excerpt(snippet));
  return `<article class="standard" tabindex="0" role="button" aria-label="ดูรายละเอียด ${esc(s.code)}" data-detail="${s.id}"><span class="pdf-icon">${s.localFile?esc(s.fileType):'▱'}</span><div class="standard-body"><div class="standard-top"><h2>${highlight(s.code)}</h2><div class="tags">${s.disciplines.map(tag).join('')}</div></div><p>${highlight(s.title)}</p>${words().length?`<p class="match-source">${esc(source)}</p><p class="search-snippet">${description}</p>`:`<p class="thai-desc">${esc(s.description)}</p>`}<div class="standard-meta"><span>${esc(s.publisher)}</span><span class="topic">${esc(s.topic)}</span>${s.localFile&&s.pageNumbersAvailable?`<span>อ่านแล้ว ${s.pages.length} หน้า</span>`:''}${s.matchingPages.length?`<span>พบคำค้นใน ${s.matchingPages.length} ${s.pageNumbersAvailable?'หน้า':'ตำแหน่ง'}</span>`:''}</div></div><span class="standard-arrow">›</span></article>`;
}
function showPagination(total){const pages=Math.ceil(total/pageSize);$('pagination').innerHTML=pages>1?`<button data-page="${currentPage-1}" ${currentPage===1?'disabled':''}>← ก่อนหน้า</button><span>หน้า ${currentPage} / ${pages}</span><button data-page="${currentPage+1}" ${currentPage===pages?'disabled':''}>ถัดไป →</button>`:''}
function render(){
$('searchDiscipline').value=chosen;
const chosenFiles=standards.filter(s=>s.localFile);
const driveStandards=standards.filter(s=>!s.localFile).length;
$('searchCoverage').textContent=indexSource==='drive'?`ข้อมูลจาก Drive ${driveStandards} มาตรฐาน · PDF/Word ${driveFileCount===null?'ยังไม่ทราบจำนวน':driveFileCount} ไฟล์ · ไฟล์ที่เลือก ${chosenFiles.length} ไฟล์ · ${remoteSearchStatus||'ค้นเนื้อหาไฟล์เมื่อใส่คำค้น'}`:`ข้อมูลสำรอง ${driveStandards} มาตรฐาน · กำลังรอข้อมูลปัจจุบันจาก Drive · ไฟล์ที่เลือก ${chosenFiles.length} ไฟล์`;
$('fileTotal').textContent=`PDF/Word ${indexSource==='drive'&&driveFileCount!==null?driveFileCount.toLocaleString('th-TH'):'—'} ไฟล์`;
$('railStandards').textContent=indexSource==='drive'?driveStandards.toLocaleString('th-TH'):'…';
$('searchHelp').textContent={all:'แยกคำด้วยช่องว่าง เช่น tank inspection จะค้นรายการที่มีทั้งสองคำ',any:'แยกคำด้วยช่องว่าง เช่น pump motor จะค้นรายการที่มีคำใดคำหนึ่ง',phrase:'ค้นข้อความต่อเนื่องตามที่พิมพ์ เช่น pressure relief โดยไม่ต้องใส่เครื่องหมายคำพูด'}[$('searchMode').value];
$('libraryNav').querySelector('.nav-count').textContent=indexSource==='drive'?driveStandards:'…';
$('sideDisciplines').innerHTML=disciplines.map(d=>`<button class="nav ${chosen===d.name?'active':''}" data-disc="${d.name}"><span style="color:${d.color==='#956512'?'#e3ba63':d.name==='Mechanical'?'#87b5e1':d.name==='Civil'?'#80c0b3':'#baa3df'}">${d.icon}</span>${d.name}<span class="nav-count">${indexSource==='drive'?standards.filter(s=>s.disciplines.includes(d.name)).length:'…'}</span></button>`).join('');
$('disciplineCards').innerHTML=disciplines.map(d=>`<button class="discipline-card ${chosen===d.name?'chosen':''}" data-disc="${d.name}" aria-pressed="${chosen===d.name}"><div class="card-top"><span class="disc-icon" style="${theme(d)}">${d.icon}</span><span class="card-count">${indexSource==='drive'?standards.filter(s=>s.disciplines.includes(d.name)).length:'…'}</span></div><strong>${d.name}</strong><small>${d.th} <span>↗</span></small></button>`).join('');
$('disciplineLabel').textContent=chosen||'ทุกสาขาวิศวกรรม';$('listTab').classList.toggle('selected',view==='list');$('folderTab').classList.toggle('selected',view==='folders');$('listTab').setAttribute('aria-selected',view==='list');$('folderTab').setAttribute('aria-selected',view==='folders');$('folderPath').innerHTML=view==='folders'&&folder?`<button id="backFolders">← ทุกโฟลเดอร์</button> / ${esc(folder)}`:'';
const list=getResults();currentPage=Math.max(1,Math.min(currentPage,Math.ceil(list.length/pageSize)||1));$('resultCount').innerHTML=`${indexSource==='drive'?'':'ข้อมูลสำรอง · '}พบ <strong>${list.length}</strong> รายการ${$('search').value.trim()?' สำหรับ “'+esc($('search').value.trim())+'”':''}${chosen?' ใน '+chosen:''}`;showPagination(view==='folders'&&!folder?0:list.length);
if(view==='folders'&&!folder){const pubs=[...new Set(list.map(s=>s.publisher))].sort();$('results').innerHTML=pubs.map(p=>`<button class="folder" data-folder="${esc(p)}"><span class="folder-icon">▰</span><div><strong>${esc(p)}</strong><small>${p==='ไฟล์ที่เลือก'?'ไฟล์ที่เลือกในเบราว์เซอร์':'Google Drive / Standards / '+esc(p)}</small></div><span class="number">${list.filter(s=>s.publisher===p).length} มาตรฐาน →</span></button>`).join('')||empty();}
else $('results').innerHTML=list.slice((currentPage-1)*pageSize,currentPage*pageSize).map(resultCard).join('')||empty();}
function empty(){if($('searchScope').value==='content'&&!$('search').value.trim())return '<div class="empty"><h3>ใส่คำที่ต้องการค้นในไฟล์</h3><p>ค้นหา PDF และ Word บน Google Drive หรือเลือกไฟล์จากเครื่องเพื่อดูข้อความและเลขหน้าเมื่อระบุได้</p></div>';if(remoteSearchStatus.startsWith('กำลัง'))return '<div class="empty"><h3>กำลังค้นไฟล์บน Google Drive…</h3></div>';return '<div class="empty"><h3>ไม่พบมาตรฐานที่ตรงกับคำค้น</h3><p>ลองใช้คำที่สั้นลง เช่น pump หรือถังน้ำมัน<br>หรือกดล้างตัวกรองเพื่อค้นหาทุกสาขา</p><button class="primary" id="emptyReset">ล้างคำค้นและตัวกรอง</button></div>'}
function reset(){currentPage=1;$('searchMode').value='all';$('searchScope').value='all';chosen='';folder='';selectedPublishers.clear();$('search').value='';scheduleRemoteSearch();document.querySelectorAll('[data-publisher]').forEach(e=>e.checked=false);render()}
function showDetail(id){
  const s=standards.find(item=>item.id===Number(id));if(!s)return;
  openDetailId=s.id;
  const matchedPages=pageMatches(s);
  const related=standards.filter(r=>r.id!==s.id&&r.disciplines.some(d=>s.disciplines.includes(d))).slice(0,3);
  const pageBlock=s.localFile?`<div class="detail-block"><h3>ข้อความที่พบใน ${esc(s.fileType)} (${matchedPages.length} ${s.pageNumbersAvailable?'หน้า':'ตำแหน่ง'})</h3>
    ${matchedPages.length?matchedPages.map(p=>`<div class="page-hit">${p.number?
      s.fileType==='PDF'? `<a href="${esc(s.url)}#page=${p.number}" target="_blank" rel="noopener noreferrer">หน้า ${p.number} ↗</a>`:`<strong>หน้า ${p.number} (Word บันทึกไว้)</strong>`
      :'<strong>ไม่ระบุเลขหน้า</strong>'}<p>${highlight(excerpt(p.text))}</p></div>`).join(''):'<p>ใส่คำค้นเพื่อแสดงตำแหน่งที่พบ</p>'}
    ${s.fileType==='Word'&&!s.pageNumbersAvailable?'<p class="search-help">ไฟล์ Word นี้ไม่มีตำแหน่งหน้าในข้อมูลที่บันทึกไว้ หากต้องการเลขหน้าที่แน่นอน ให้บันทึกเป็น PDF แล้วเลือกไฟล์ PDF</p>':''}</div>`:'';
  const files=remoteFiles.get(s.folderId)||[];
  const fileBlock=!s.localFile&&files.length?`<div class="detail-block"><h3>ไฟล์ที่พบใน Drive พร้อมตำแหน่งหน้า</h3><p class="search-help">เลขหน้ามาจากดัชนีเอกสารที่พร้อมและมีสิทธิ์อ่าน PDF สแกนต้องผ่าน OCR ก่อน</p>
    ${files.map(f=>renderLocatedFile({...f,folderId:s.folderId})).join('')}${Number(remoteHits.get(s.folderId)||0)>files.length?`<p class="search-help">แสดง ${files.length} จาก ${remoteHits.get(s.folderId)} ไฟล์ · เปิดโฟลเดอร์เพื่อดูที่เหลือ</p>`:''}</div>`:'';
  $('detailContent').innerHTML=`<div class="dialog-top"><span>STANDARD DETAILS · ${s.localFile?'ไฟล์ที่เลือก':'GOOGLE DRIVE INDEX'}</span><button class="close" aria-label="ปิดหน้ารายละเอียด">×</button></div><h2 class="detail-title">${highlight(s.code)}</h2><div class="detail-sub">${highlight(s.title)}</div><div class="tags" style="margin-top:16px">${s.disciplines.map(tag).join('')}</div><div class="detail-block"><h3>เกี่ยวข้องกับงานอะไร?</h3><p>${esc(s.description)}</p><span class="topic">${esc(s.topic)}</span><h3>ตำแหน่งเอกสาร</h3><div class="path">${s.localFile?'ไฟล์ในเบราว์เซอร์ / '+esc(s.code):'Google Drive / Standards / '+esc(s.publisher)+' / '+esc(s.code)}</div></div>${s.localFile?'<div class="notice">ไฟล์ที่เลือกจะอ่านในเบราว์เซอร์นี้เท่านั้น</div>':'<div class="notice">การจัดสาขาจากชื่อโฟลเดอร์เป็นผลเบื้องต้น โปรดตรวจสอบเอกสารต้นฉบับก่อนใช้อ้างอิง</div>'}<a class="primary" style="display:inline-block;margin-top:15px" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${s.localFile?'เปิด '+esc(s.fileType)+' ↗':'เปิดโฟลเดอร์บน Google Drive ↗'}</a>${pageBlock}${fileBlock}<div class="detail-block"><h3>มาตรฐานในสาขาเดียวกัน</h3>${related.map(r=>`<button class="related" data-related="${r.id}">${esc(r.code)} <span>↗</span></button>`).join('')}</div>`;
  if(!$('detail').open)$('detail').showModal();
}
function renderPublisherFilters(){const publishers=[...new Set(standards.map(s=>s.publisher))].sort();$('publishers').innerHTML=publishers.map(p=>`<label class="check-row"><input type="checkbox" data-publisher="${esc(p)}" ${selectedPublishers.has(p)?'checked':''}>${esc(p)}<span>${standards.filter(s=>s.publisher===p).length}</span></label>`).join('')}
function clearLocatedFiles(){
  remotePageCache.forEach(item=>{if(item.url)URL.revokeObjectURL(item.url)});
  remotePageCache.clear();remotePageBytes=0;locateTarget=null;locateState=null;
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-locate-file]');
  if(!button||locateBusy)return;
  const folderId=button.dataset.locateFolder,fileId=button.dataset.locateFile;
  const file=(remoteFiles.get(folderId)||[]).find(item=>item.id===fileId);
  if(!file)return;
  locateTarget={folderId,file};$('locateFile').value='';$('locateFile').click();
});
$('locateFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0],target=locateTarget;
  if(!file||!target||locateBusy)return;
  const expected=target.file.name.toLocaleLowerCase().replace(/\.(pdf|docx|doc)$/i,'');
  const actual=file.name.toLocaleLowerCase().replace(/\.(pdf|docx)$/i,'');
  const pdf=/\.pdf$/i.test(file.name),docx=/\.docx$/i.test(file.name);
  const sourcePdf=target.file.mimeType==='application/pdf';
  if(expected!==actual||sourcePdf&&!pdf||!sourcePdf&&!pdf&&!docx){
    locateState={id:target.file.id,message:`ชื่อหรือชนิดไฟล์ไม่ตรงกับ ${target.file.name} · เลือกไฟล์เดียวกันที่ดาวน์โหลดเป็น PDF หรือ DOCX`};
    showDetail(standards.find(s=>s.folderId===target.folderId)?.id);
    event.target.value='';return;
  }
  if(file.size+importedBytes+remotePageBytes>100*1024*1024){
    locateState={id:target.file.id,message:'ไฟล์รวมเกิน 100 MB · ล้างไฟล์ที่เลือกก่อนเพิ่ม'};
    showDetail(standards.find(s=>s.folderId===target.folderId)?.id);
    event.target.value='';return;
  }
  locateBusy=true;locateState={id:target.file.id,message:'กำลังอ่านไฟล์เพื่อตรวจเลขหน้า…'};
  showDetail(standards.find(s=>s.folderId===target.folderId)?.id);
  try{
    const parsed=await readStandardDocument(file,message=>{
      locateState={id:target.file.id,message};
      const status=$('detailContent').querySelector('[role="status"]');if(status)status.textContent=message;
    });
    const previous=remotePageCache.get(target.file.id);
    if(previous){URL.revokeObjectURL(previous.url);remotePageBytes-=previous.size;}
    remotePageCache.set(target.file.id,{...parsed,size:file.size,url:URL.createObjectURL(file)});
    remotePageBytes+=file.size;locateState=null;
  }catch(error){locateState={id:target.file.id,message:error.name==='PasswordException'?'ไฟล์ PDF มีรหัสผ่าน':error.message||'อ่านไฟล์ไม่สำเร็จ'};}
  finally{locateBusy=false;event.target.value='';showDetail(standards.find(s=>s.folderId===target.folderId)?.id);render();}
});
renderPublisherFilters();
document.addEventListener('click',e=>{const disc=e.target.closest('[data-disc]');if(disc)setDiscipline(disc.dataset.disc);const query=e.target.closest('[data-query]');if(query){$('search').value=query.dataset.query;folder='';currentPage=1;scheduleRemoteSearch(true);render()}const f=e.target.closest('[data-folder]');if(f){folder=f.dataset.folder;currentPage=1;render()}const detail=e.target.closest('[data-detail]');if(detail)showDetail(detail.dataset.detail);const rel=e.target.closest('[data-related]');if(rel)showDetail(rel.dataset.related);if(e.target.closest('.close'))$('detail').close();if(e.target.closest('#backFolders')){folder='';currentPage=1;render()}if(e.target.closest('#emptyReset'))reset()});
document.addEventListener('keydown',e=>{const card=e.target.closest('[data-detail]');if(card&&(e.key==='Enter'||e.key===' ')){e.preventDefault();showDetail(card.dataset.detail)}});document.addEventListener('change',e=>{if(e.target.dataset.publisher){e.target.checked?selectedPublishers.add(e.target.dataset.publisher):selectedPublishers.delete(e.target.dataset.publisher);folder='';currentPage=1;render()}});$('searchForm').onsubmit=e=>{e.preventDefault();folder='';currentPage=1;scheduleRemoteSearch(true);render()};$('search').oninput=()=>{folder='';currentPage=1;scheduleRemoteSearch();render()};$('sort').onchange=()=>{currentPage=1;render()};$('reset').onclick=reset;$('libraryNav').onclick=()=>{view='list';reset()};$('listTab').onclick=()=>{view='list';folder='';currentPage=1;render()};$('folderTab').onclick=()=>{view='folders';folder='';currentPage=1;render()};$('detail').onclick=e=>{if(e.target===$('detail'))$('detail').close()};$('connection').onclick=()=>{$('detailContent').innerHTML=`<div class="dialog-top"><span>GOOGLE DRIVE SOURCE</span><button class="close" aria-label="ปิด">×</button></div><h2 class="detail-title">Standards</h2><p class="detail-sub">อ่านโครงสร้างโฟลเดอร์จาก Google Drive ของ แหล่งข้อมูลที่ตั้งค่าไว้ แล้ว</p><div class="detail-block"><h3>ข้อมูลที่นำมาแสดง</h3><div class="path">Google Drive / Standards / API, ASME, IEC, SDO&amp;Docs</div><h3>สถานะข้อมูล</h3><p>${indexSource==='drive'?'ข้อมูลจาก Drive':'ข้อมูลตัวอย่าง'} ${standards.filter(s=>!s.localFile).length} รายการ และ ${standards.filter(s=>s.localFile).length} ไฟล์ PDF/Word ที่เลือก<br>✓ ค้นหาจากรหัส ชื่อ และหัวข้องานได้<br>✓ เปิดโฟลเดอร์ต้นฉบับบน Google Drive ได้<br>○ การจัด Discipline เป็นผลเบื้องต้นจากชื่อโฟลเดอร์<br>✓ ค้นชื่อไฟล์จากดัชนี Drive<br>○ แสดงเลขหน้าจากดัชนีเอกสาร เมื่อดัชนีพร้อมและมีสิทธิ์อ่านผลค้นหา</p><h3>ขั้นตอนถัดไป</h3><p>หากยังไม่พบเลขหน้า ให้ตรวจสถานะดัชนีเอกสารและสิทธิ์เข้าถึง Apps Script หรือเลือกไฟล์จากเครื่องเพื่อค้นเพิ่มเติม</p><a class="primary" style="display:inline-block;margin-top:8px" href="#" target="_blank" rel="noopener noreferrer">เปิด Standards บน Google Drive ↗</a></div>`;$('detail').showModal()};render();
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'search_standards',description:'Search the indexed Google Drive standard folders and update the visible results.',inputSchema:{type:'object',properties:{keyword:{type:'string'}},required:['keyword'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||typeof input.keyword!=='string')throw new Error('keyword must be a string');reset();$('search').value=input.keyword;view='list';scheduleRemoteSearch(true);render();return getResults().map(s=>({code:s.code,disciplines:s.disciplines,url:s.url}));}})).catch(()=>{})}catch{}}
function setIndexStatus(message,state=''){$('indexStatus').textContent=message;$('indexStatus').classList.remove('success','error');if(state)$('indexStatus').classList.add(state);const diagnostic=$('statusEndpoint');diagnostic.hidden=state!=='error'||!appsScriptUrl;if(!diagnostic.hidden){const url=new URL(appsScriptUrl);url.searchParams.set('action','status');diagnostic.href=url.toString()}}
function formatThaiDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'ไม่ทราบเวลา':new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short'}).format(date)}
function normalizeRemoteStandards(items){const validDisciplines=new Set(disciplines.map(d=>d.name));return items.map((item,id)=>{const code=String(item.code||item.name||'').trim();if(!code)return null;const local=localStandardMetadata.get(code.toLowerCase());const inferred=Array.isArray(item.disciplines)?item.disciplines.filter(d=>validDisciplines.has(d)):[];const assigned=local?.disciplines?.length?local.disciplines:inferred.length?inferred:['Mechanical'];return{id,folderId:String(item.id||''),code,title:local?.title||String(item.title||code),disciplines:assigned,description:local?.description||String(item.description||`มาตรฐานจากโฟลเดอร์ ${code}`),keywords:[local?.keywords||'',item.keywords||'',code,item.publisher||''].join(' '),topic:local?.topic||String(item.topic||'Engineering standard'),publisher:String(item.publisher||local?.publisher||'Unclassified'),url:String(item.url||local?.url||'#'),modifiedAt:String(item.modifiedAt||''),fileCount:Number(item.fileCount||0)}}).filter(Boolean)}
function requestAppsScriptIndex(params={}){
  return new Promise((resolve,reject)=>{
    let url;
    try{url=new URL(appsScriptUrl)}catch{reject(new Error('Apps Script URL ไม่ถูกต้อง'));return}
    if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec')){
      reject(new Error('ต้องใช้ Apps Script Web App URL ที่ลงท้ายด้วย /exec'));return;
    }
    const callback=`engineeringStandardsRefresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement('script');let settled=false;
    const timeout=window.setTimeout(()=>{
      const error=new Error('Apps Script ตอบกลับช้าเกินไป');error.code='TIMEOUT';fail(error);
    },params.action==='status'||params.action==='health'?20000:params.action==='refresh'?40000:45000);
    function cleanup(late=false){
      window.clearTimeout(timeout);script.remove();
      if(late){
        // A timed-out server execution can still deliver its JSONP response.
        window[callback]=()=>{};
        window.setTimeout(()=>delete window[callback],420000);
      }else delete window[callback];
    }
    function fail(error){if(settled)return;settled=true;cleanup(error.code==='TIMEOUT');reject(error)}
    window[callback]=payload=>{if(settled)return;settled=true;cleanup();resolve(payload)};
    script.onerror=()=>{const error=new Error('เชื่อมต่อ Apps Script ไม่สำเร็จ · ตรวจเครือข่าย บัญชี และสิทธิ์ Web App');error.code='NETWORK';fail(error)};
    script.onload=()=>fail(new Error('Web App โหลดแล้ว แต่ไม่ส่งข้อมูลกลับ · ตรวจสิทธิ์และเวอร์ชันที่ Deploy'));
    url.searchParams.set('callback',callback);url.searchParams.set('refresh',Date.now().toString());
    Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
    script.src=url.toString();script.referrerPolicy='no-referrer';document.head.appendChild(script);
  });
}
async function readAppsScriptIndex(params={}){
  try{return await requestAppsScriptIndex(params)}
  catch(error){
    if(error.code!=='TIMEOUT'&&error.code!=='NETWORK')throw error;
    return requestAppsScriptIndex(params); // only reads use this helper
  }
}
function renderSearchResults(){
  render();
  if($('detail').open&&openDetailId!==null)showDetail(openDetailId);
}
async function completeIndexedPages(query,mode,version){
  const deferred=[...remoteFiles.values()].flat().filter(file=>file.pageIndexStatus==='deferred');
  for(let offset=0;offset<deferred.length;offset+=12){
    if(version!==remoteSearchVersion)return;
    const batch=deferred.slice(offset,offset+12);
    try{
      const payload=await requestAppsScriptIndex({action:'pages',query,mode,fileIds:batch.map(file=>file.id).join(',')});
      if(version!==remoteSearchVersion)return;
      if(!payload?.ok||payload.action!=='pages'||!Array.isArray(payload.files))throw new Error(payload?.error||'อ่านดัชนีเลขหน้าไม่สำเร็จ');
      const hits=new Map(payload.files.map(file=>[file.id,file]));
      batch.forEach(file=>{const hit=hits.get(file.id);file.pageIndexStatus=hit?.pageIndexStatus||'not_indexed';file.pages=Array.isArray(hit?.pages)?hit.pages:[]});
      renderSearchResults();
    }catch(error){
      if(version!==remoteSearchVersion)return;
      deferred.slice(offset).forEach(file=>{file.pageIndexStatus='unavailable'});
      remoteSearchStatus+=' · โหลดเลขหน้าเพิ่มเติมไม่สำเร็จ';renderSearchResults();return;
    }
  }
}
function scheduleRemoteSearch(immediate=false){
  window.clearTimeout(remoteSearchTimer);
  const query=$('search').value.trim().replace(/\s+/g,' '),mode=$('searchMode').value;
  const version=++remoteSearchVersion;
  remoteHits=new Map();remoteFiles=new Map();
  if(!query){remoteSearchStatus='';render();return}
  if(query.length>120||mode!=='phrase'&&query.split(' ').length>8){remoteSearchStatus='ค้นหาในไฟล์ได้ครั้งละไม่เกิน 120 ตัวอักษรและ 8 คำ';render();return}
  if(!appsScriptUrl){remoteSearchStatus='ยังไม่ได้เชื่อม Apps Script สำหรับค้นใน Drive';render();return}
  remoteSearchStatus='กำลังค้น PDF/Word ใน Google Drive…';render();
  remoteSearchTimer=window.setTimeout(async()=>{
    try{
      const payload=await requestAppsScriptIndex({action:'search',query,mode});
      if(version!==remoteSearchVersion)return;
      if(!payload?.ok)throw new Error(payload?.error||'Apps Script ค้นหาไม่สำเร็จ');
      if(!Array.isArray(payload.matches)||payload.action!=='search')throw new Error('ต้องอัปเดตและ Deploy Apps Script เวอร์ชันที่รองรับการค้นไฟล์');
      if(Array.isArray(payload.standards)){
        const known=new Set(standards.map(item=>item.folderId).filter(Boolean));
        const additional=normalizeRemoteStandards(payload.standards).filter(item=>!known.has(item.folderId));
        additional.forEach(item=>{item.id=standards.length;standards.push(item)});
        if(additional.length)renderPublisherFilters();
      }
      remoteHits=new Map(payload.matches.filter(hit=>typeof hit.folderId==='string').map(hit=>[hit.folderId,Number(hit.fileCount)||1]));
      remoteFiles=new Map(payload.matches.filter(hit=>typeof hit.folderId==='string').map(hit=>[hit.folderId,Array.isArray(hit.files)?hit.files.map(file=>({...file,folderId:hit.folderId})):[]]));
      remoteSearchStatus=`ค้น Drive แล้ว · พบ ${remoteHits.size} มาตรฐาน${payload.partial?' · ผลลัพธ์บางส่วน':''}${payload.pageIndexRestricted?' · ยังไม่มีสิทธิ์อ่านดัชนีเลขหน้า':!payload.pageIndexEnabled?' · ดัชนีเลขหน้ายังไม่พร้อม':''}`;
      renderSearchResults();
      if(payload.partialPages&&!payload.pageIndexRestricted)await completeIndexedPages(query,mode,version);
    }catch(error){if(version!==remoteSearchVersion)return;remoteSearchStatus=`ค้น Drive ไม่สำเร็จ · ${error.message}`;}
    if(version===remoteSearchVersion)renderSearchResults();
  },immediate?0:650);
}
function finishRefreshButton(){const button=$('refreshButton');button.disabled=false;button.classList.remove('loading');button.querySelector('.refresh-label').textContent='Refresh ข้อมูล'}
const refreshedAt=new URLSearchParams(window.location.search).get('refresh');
if(refreshedAt&&Number.isFinite(Number(refreshedAt)))window.history.replaceState({},'',window.location.pathname);
function indexSummary(){return `${standards.filter(s=>!s.localFile).length} มาตรฐาน · PDF/Word ${driveFileCount===null?'ยังไม่ทราบจำนวน':driveFileCount} ไฟล์`}
function updateStandardsFromIndex(payload,{preserveUi=false}={}){
  if(!Array.isArray(payload.standards)||payload.indexMissing)return false;
  const refreshed=normalizeRemoteStandards(payload.standards);
  if(payload.standards.length&&!refreshed.length)return false;
  standards=[...refreshed,...standards.filter(s=>s.localFile)];
  indexSource='drive';indexGeneratedAt=String(payload.generatedAt||'');
  driveFileCount=Number.isInteger(payload.fileCount)&&payload.fileCount>=0?payload.fileCount:null;
  pageIndexCoverage=payload.pageIndex||null;
  if($('search').value.trim())scheduleRemoteSearch(true);
  if(!preserveUi){currentPage=1;selectedPublishers.clear();folder=''}
  renderPublisherFilters();render();
  return true;
}
function requireRefreshProtocol(payload){
  if(!payload?.ok)throw new Error(payload?.error||'Apps Script ส่งสถานะไม่สำเร็จ');
  if(payload.refreshProtocol!==2)throw new Error('กรุณาอัปเดต Code.gs รุ่น 2026-10-02-refresh-v6 แล้ว Deploy New version');
}
async function showRefreshedIndex(warning='',providedIndex=null,status=null){
  if(!providedIndex&&status?.generatedAt&&indexSource==='drive'&&indexGeneratedAt===status.generatedAt){
    setIndexStatus(`ตรวจ Drive แล้ว · ไม่มีการเปลี่ยนดัชนี · ${indexSummary()} · ตรวจล่าสุด ${formatThaiDate(status.checkedAt||Date.now())}${warning?' · '+warning:''}`,warning?'':'success');
    return;
  }
  const index=providedIndex||await readAppsScriptIndex();
  if(!index?.ok||!updateStandardsFromIndex(index,{preserveUi:true}))throw new Error(index?.error||'ยังไม่มีดัชนีจาก Drive');
  const pageWarning=warning||index.pageIndex?.error||'';
  setIndexStatus(`ข้อมูลจาก Drive · ${indexSummary()} · ${formatThaiDate(index.generatedAt||Date.now())}${pageWarning?' · '+pageWarning:''}`,pageWarning?'':'success');
}
async function waitForIndexRefresh({requestId,jobId='',needsRequest=false}={}){
  // Never infer acceptance/completion from the status of an unrelated old job.
  const deadline=Date.now()+6*60*1000;
  let failures=0,delay=1500,directAttempted=false;
  while(Date.now()<deadline){
    await new Promise(resolve=>window.setTimeout(resolve,delay));
    delay=Math.min(6000,Math.round(delay*1.5));
    let payload;
    try{
      if(needsRequest){
        // The backend deduplicates requestId, so a response timeout is safe to retry.
        payload=await requestAppsScriptIndex({action:'refresh',requestId});
      }else payload=await requestAppsScriptIndex({action:'status'});
    }catch(error){
      failures++;
      setIndexStatus(`ยังยืนยันสถานะไม่ได้ · ${error.message} · กำลังตรวจอีกครั้ง`);
      if(failures>=3)break;
      continue;
    }
    failures=0;requireRefreshProtocol(payload);
    if(needsRequest){
      if(payload.accepted===false){setIndexStatus('งานเบื้องหลังยังใช้งานอยู่ · รอส่งคำขอ Refresh อีกครั้ง…');continue}
      if(payload.accepted!==true||!payload.jobId)throw new Error('Apps Script ไม่ยืนยันการรับงาน Refresh');
      jobId=payload.jobId;needsRequest=false;
    }
    if(jobId&&payload.jobId!==jobId){
      setIndexStatus('มีงานอัปเดตรอบใหม่ · ยังยืนยันผลของคำขอนี้ไม่ได้ กรุณาตรวจสถานะใน Apps Script');return;
    }
    if(!directAttempted&&payload.directRefreshSupported&&payload.syncStatus==='queued'){
      directAttempted=true;
      try{
        const direct=await requestAppsScriptIndex({action:'runRefresh',requestId:jobId});
        requireRefreshProtocol(direct);
        if(direct.jobId===jobId)payload=direct;
      }catch(error){if(error.code!=='TIMEOUT'&&error.code!=='NETWORK')throw error}
    }
    if(payload.syncStatus==='error'||payload.syncStatus==='interrupted')throw new Error(payload.syncError||'ตรวจ Executions ใน Apps Script');
    if(payload.syncStatus==='complete'){
      try{await showRefreshedIndex(payload.warning,payload.index,payload)}
      catch(error){setIndexStatus(`อัปเดตแล้ว แต่ดึงรายการไม่สำเร็จ · ${error.message}`,'error')}
      return;
    }
    if(payload.syncStatus!=='queued'&&payload.syncStatus!=='running'){
      setIndexStatus('ยังไม่พบงานอัปเดต · กรุณาตรวจ Executions ใน Apps Script');return;
    }
    setIndexStatus(payload.syncStatus==='queued'?'รับคำขอแล้ว · รอเริ่มงานอัปเดตเบื้องหลัง…':'กำลังอัปเดตดัชนีจาก Google Drive…');
  }
  setIndexStatus('ยังยืนยันผล Refresh ไม่ได้ · แสดงรายการเดิมไว้ · ตรวจ Executions และ /exec?action=status ใน Apps Script');
}
$('refreshButton').onclick=async()=>{
  const button=$('refreshButton');button.disabled=true;button.classList.add('loading');button.querySelector('.refresh-label').textContent='กำลัง Refresh';
  if(!appsScriptUrl){setIndexStatus('ยังไม่ได้ตั้งค่า Apps Script','error');finishRefreshButton();return}
  const requestId=`refresh_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  setIndexStatus('กำลังส่งคำขออัปเดต…');
  try{
    let payload;
    try{payload=await requestAppsScriptIndex({action:'refresh',requestId})}
    catch(error){
      if(error.code!=='TIMEOUT')throw error;
      // Check backend protocol before retrying a mutation against an old deployment.
      const status=await readAppsScriptIndex({action:'status'});requireRefreshProtocol(status);
      setIndexStatus('คำขอตอบกลับช้า · กำลังยืนยันการรับงาน…');
      await waitForIndexRefresh({requestId,jobId:status.jobId===requestId?requestId:'',needsRequest:status.jobId!==requestId});return;
    }
    requireRefreshProtocol(payload);
    if(payload.accepted===false){
      setIndexStatus('งานเบื้องหลังยังใช้งานอยู่ · กำลังรอส่งคำขอใหม่…');
      await waitForIndexRefresh({requestId,needsRequest:true});
    }else if(payload.accepted===true&&payload.jobId){
      if(payload.syncStatus==='error'||payload.syncStatus==='interrupted')throw new Error(payload.syncError||'Apps Script อัปเดตไม่สำเร็จ');
      if(payload.syncStatus==='complete')await showRefreshedIndex(payload.warning,payload.index,payload);
      else{
        let result;
        if(payload.directRefreshSupported&&payload.syncStatus==='queued'){
          setIndexStatus('พบรายการเปลี่ยนแปลง · เริ่มอัปเดตดัชนี…');
          try{result=await requestAppsScriptIndex({action:'runRefresh',requestId:payload.jobId})}
          catch(error){if(error.code!=='TIMEOUT'&&error.code!=='NETWORK')throw error}
        }
        if(result){
          requireRefreshProtocol(result);
          if(result.jobId!==payload.jobId)throw new Error('มีงานอัปเดตรอบใหม่ กรุณาตรวจสถานะ');
          if(result.syncStatus==='error'||result.syncStatus==='interrupted')throw new Error(result.syncError||'Apps Script อัปเดตไม่สำเร็จ');
          if(result.syncStatus==='complete'){await showRefreshedIndex(result.warning,result.index,result);return}
        }
        await waitForIndexRefresh({requestId,jobId:payload.jobId});
      }
    }else throw new Error('Apps Script ไม่ยืนยันการรับงาน Refresh');
  }catch(error){
    if(error.code==='TIMEOUT')setIndexStatus(`ยังยืนยันผล Refresh ไม่ได้ · ${error.message} · แสดงรายการเดิมไว้`);
    else setIndexStatus(`Refresh ไม่สำเร็จ · ${error.message}`,'error');
  }finally{finishRefreshButton()}
};
async function loadCurrentIndexOnOpen(){
  if(!appsScriptUrl){setIndexStatus('ยังไม่ได้เชื่อม Apps Script · แสดงข้อมูลสำรองเท่านั้น','error');return}
  setIndexStatus('กำลังอ่านดัชนีที่บันทึกไว้…');
  try{
    const index=await readAppsScriptIndex();
    if(!index?.ok)throw new Error(index?.error||'Apps Script ไม่ส่งดัชนี');
    if(updateStandardsFromIndex(index,{preserveUi:true})){
      setIndexStatus(`ข้อมูลจาก Drive · ${indexSummary()} · ${formatThaiDate(indexGeneratedAt)}`,'success');
    }
    else setIndexStatus('ยังไม่มีดัชนีจาก Drive · ให้ Run setupIndexWatcher ใน Apps Script','error');
  }catch(error){setIndexStatus(`โหลดดัชนีไม่ได้ · แสดงข้อมูลสำรอง · ${error.message}`,'error')}
}
loadCurrentIndexOnOpen();
