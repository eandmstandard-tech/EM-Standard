// Optional private Reader link. Access is enforced by the Apps Script deployment.
(()=>{
  const node=document.getElementById('driveReaderLink');
  const value=String(window.ENGINEERING_STANDARDS_CONFIG?.readerUrl||'').trim();
  if(node&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value)){
    node.href=value;node.hidden=false;
  }
})();
function ocrPageRange(){
  const from=Number($('ocrFrom').value),to=Number($('ocrTo').value);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>500||to-from>=20)
    throw new Error('ระบุช่วงหน้า 1–500 และไม่เกิน 20 หน้าต่อรอบ');
  return {from,to,force:$('ocrForce').checked};
}
let requestedOcrRange=null;
$('startOcr').onclick=()=>{
  if(pdfImportBusy||locateBusy)return;
  try{requestedOcrRange=ocrPageRange();}
  catch(error){$('ocrStatus').textContent=error.message;return;}
  $('ocrFile').value='';$('ocrFile').click();
};
try{
  const link=new URL(appsScriptUrl);
  if(link.protocol==='https:'&&link.hostname==='script.google.com'&&link.pathname.endsWith('/exec')){
    link.search='';link.hash='';link.searchParams.set('action','ocrPilot');
    $('driveOcrLink').href=link.toString();$('driveOcrLink').hidden=false;
  }
}catch{}
$('ocrFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0],range=requestedOcrRange;
  if(!file||!range||pdfImportBusy||locateBusy)return;
  if(!/\.pdf$/i.test(file.name)&&file.type!=='application/pdf'){$('ocrStatus').textContent='เลือกเฉพาะไฟล์ PDF';return;}
  const key=[file.name,file.size,file.lastModified].join('|');
  const existing=standards.find(s=>s.localKey===key);
  if(!existing&&file.size+importedBytes+remotePageBytes>100*1024*1024){$('ocrStatus').textContent='ไฟล์รวมเกิน 100 MB · ล้างไฟล์ที่เลือกก่อนเพิ่ม';return;}
  pdfImportBusy=true;$('startOcr').disabled=true;$('pdfFiles').disabled=true;$('clearPdfs').disabled=true;
  view='list';folder='';selectedPublishers.clear();chosen='';currentPage=1;$('searchScope').value='ocr';
  scheduleRemoteSearch(true);
  try{
    const parsed=await readStandardDocument(file,message=>{$('ocrStatus').textContent=message;},range);
    const prior=new Map((existing?.pages||[]).map(p=>[p.number,p]));
    const pages=parsed.pages.map(p=>!p.ocr&&prior.get(p.number)?.ocr?prior.get(p.number):p);
    const readable=pages.filter(p=>p.text).length;
    if(!readable)throw new Error('อ่านไม่พบข้อความในช่วงที่เลือก ลองเลือกช่วงหน้าอื่นหรือใช้ไฟล์สแกนที่คมชัดขึ้น');
    const name=file.name.replace(/\.pdf$/i,'');
    const item={id:existing?.id??localPdfId--,localFile:true,localOcr:true,fileType:'PDF',pageNumbersAvailable:true,localKey:key,
      code:name,title:name,disciplines:existing?.disciplines||[],description:'PDF ที่เลือกสำหรับ OCR ในเบราว์เซอร์',keywords:'',topic:'ข้อความในเอกสาร',
      publisher:'ไฟล์ที่เลือก',url:existing?.url||URL.createObjectURL(file),pages};
    standards=existing?standards.map(s=>s===existing?item:s):[...standards,item];
    if(!existing)importedBytes+=file.size;
    const ocrTotal=pages.filter(p=>p.ocr).length;
    $('ocrStatus').textContent=`ค้นได้ ${readable} จาก ${pages.length} หน้า · อ่านด้วย OCR ${ocrTotal} หน้า`+
      (parsed.ocrFailed?` · รอบนี้ OCR ไม่พบข้อความหรืออ่านไม่สำเร็จ ${parsed.ocrFailed} หน้า`:'')+
      ' · ใส่คำค้นเพื่อดูเลขหน้า';
    renderPublisherFilters();render();
  }catch(error){$('ocrStatus').textContent='OCR ไม่สำเร็จ · '+(error?.message||'ลองเลือก PDF อีกครั้ง');}
  finally{pdfImportBusy=false;$('startOcr').disabled=false;$('pdfFiles').disabled=false;$('clearPdfs').disabled=false;event.target.value='';}
});
