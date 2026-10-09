let localPdfId=-1, importedBytes=0, pdfImportBusy=false;
async function readStandardDocument(file, onProgress=()=>{}){
  const isPdf=/\.pdf$/i.test(file.name)||file.type==='application/pdf';
  const isDocx=/\.docx$/i.test(file.name)||file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(!isPdf&&!isDocx)throw new Error('รองรับ PDF และ Word .docx เท่านั้น');
  if(file.size>30*1024*1024)throw new Error('ไฟล์เกิน 30 MB');
  let task;
  try{
    let pages,pageNumbersAvailable;
    if(isPdf){
      const pdfjs=await import('./vendor/pdfjs/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.min.mjs',document.baseURI).href;
      task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
        cMapUrl:new URL('./vendor/pdfjs/cmaps/',document.baseURI).href,cMapPacked:true,
        standardFontDataUrl:new URL('./vendor/pdfjs/standard_fonts/',document.baseURI).href,
        wasmUrl:new URL('./vendor/pdfjs/wasm/',document.baseURI).href});
      const pdf=await task.promise;
      if(pdf.numPages>500)throw new Error('เกิน 500 หน้า กรุณาแบ่งไฟล์ก่อน');
      pages=[];pageNumbersAvailable=true;
      for(let n=1;n<=pdf.numPages;n++){
        onProgress(`กำลังอ่าน ${file.name} · หน้า ${n} / ${pdf.numPages}`);
        const page=await pdf.getPage(n),content=await page.getTextContent();
        const text=content.items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('').normalize('NFC').replace(/[ \t]+/g,' ').trim();
        pages.push({number:n,text});page.cleanup();
      }
    }else{
      onProgress(`กำลังอ่าน ${file.name}`);
      const parsed=await DocumentPageSearch.readDocx(file);
      pages=parsed.pages;pageNumbersAvailable=parsed.pageNumbersAvailable;
    }
    const unread=pages.filter(p=>!p.text).length;
    if(unread===pages.length)throw new Error(isPdf?'ไม่พบข้อความที่อ่านได้ กรุณาทำ OCR ก่อน':'ไม่พบข้อความที่อ่านได้ใน Word');
    return {pages,pageNumbersAvailable,fileType:isPdf?'PDF':'Word',unread};
  }finally{if(task)await task.destroy().catch(()=>{});}
}
['searchMode','searchScope','searchDiscipline'].forEach(id=>$(id).addEventListener('change',()=>{
  if(id==='searchDiscipline')chosen=$(id).value;
  folder='';currentPage=1;if(id==='searchMode')scheduleRemoteSearch(true);render();
}));
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-page]');
  if(button&&!button.disabled){currentPage=Number(button.dataset.page);render();$('resultCount').scrollIntoView({block:'start'});}
});
$('clearPdfs').onclick=()=>{
  if(pdfImportBusy||locateBusy)return;
  clearLocatedFiles();
  standards.filter(s=>s.localFile).forEach(s=>URL.revokeObjectURL(s.url));
  standards=standards.filter(s=>!s.localFile);importedBytes=0;
  selectedPublishers.delete('ไฟล์ที่เลือก');folder='';currentPage=1;
  $('pdfFiles').value='';$('pdfStatus').textContent='ล้างไฟล์ที่เลือกแล้ว';
  renderPublisherFilters();render();
};
$('pdfFiles').addEventListener('change',async event=>{
  const files=Array.from(event.target.files||[]);if(!files.length||pdfImportBusy)return;
  const discipline=$('importDiscipline').value;const notes=[];let added=0;
  pdfImportBusy=true;$('pdfFiles').disabled=true;$('clearPdfs').disabled=true;
  $('pdfStatus').textContent='กำลังเตรียมอ่านไฟล์…';
  try{
    for(const file of files){
      const key=[file.name,file.size,file.lastModified].join('|');
      if(standards.some(s=>s.localKey===key)){notes.push(file.name+': มีไฟล์นี้แล้ว');continue;}
      const isPdf=/\.pdf$/i.test(file.name)||file.type==='application/pdf';
      const isDocx=/\.docx$/i.test(file.name)||file.type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      if(!isPdf&&!isDocx){notes.push(file.name+': รองรับ PDF และ DOCX เท่านั้น');continue;}
      if(file.size>30*1024*1024){notes.push(file.name+': เกิน 30 MB');continue;}
      if(importedBytes+file.size>100*1024*1024){notes.push(file.name+': ไฟล์รวมเกิน 100 MB กรุณาล้างไฟล์ก่อนเพิ่ม');continue;}
      try{
        $('pdfStatus').textContent='กำลังอ่าน '+file.name;
        const {pages,pageNumbersAvailable,unread}=await readStandardDocument(file,text=>{$('pdfStatus').textContent=text});
        if(isDocx&&!pageNumbersAvailable)notes.push(file.name+': ค้นข้อความได้ แต่ Word ไม่ได้บันทึกตำแหน่งหน้า กรุณาบันทึกเป็น PDF แล้วเลือกอีกครั้งเพื่อดูเลขหน้าที่แน่นอน');
        if(isPdf&&unread)notes.push(`${file.name}: ${unread} หน้าไม่มีข้อความที่อ่านได้ จึงค้นหาได้เฉพาะหน้าที่อ่านแล้ว`);
        const name=file.name.replace(/\.(pdf|docx)$/i,'');
        standards.push({id:localPdfId--,localFile:true,fileType:isPdf?'PDF':'Word',pageNumbersAvailable,localKey:key,code:name,title:name,disciplines:discipline?[discipline]:[],description:'เอกสารที่เลือกในเบราว์เซอร์',keywords:'',topic:'ข้อความในเอกสาร',publisher:'ไฟล์ที่เลือก',url:URL.createObjectURL(file),pages});
        importedBytes+=file.size;added++;
      }catch(error){notes.push(file.name+': '+(error.name==='PasswordException'?'ไฟล์มีรหัสผ่าน กรุณาเลือกสำเนาที่เปิดอ่านได้':error.message||'อ่านไฟล์ไม่สำเร็จ'));}
    }
    if(added){view='list';folder='';chosen='';selectedPublishers.clear();$('searchScope').value='content';currentPage=1;renderPublisherFilters();render();}
    $('pdfStatus').textContent=`เพิ่มไฟล์พร้อมค้น ${added} ไฟล์`+(notes.length?'\n'+notes.join('\n'):' · ใส่คำค้นแล้วกดค้นหา');
  }catch(error){$('pdfStatus').textContent='เตรียมอ่านไฟล์ไม่สำเร็จ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';}
  finally{pdfImportBusy=false;$('pdfFiles').disabled=false;$('clearPdfs').disabled=false;$('pdfFiles').value='';}
});
