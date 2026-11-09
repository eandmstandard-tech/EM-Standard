// OCR often adds gaps between Thai glyphs, including before combining marks.
export function normalizeOcrText(text){
  return String(text||'').normalize('NFC').replace(/([\u0E00-\u0E7F])[ \t]+(?=[\u0E00-\u0E7F])/gu,'$1').trim();
}

/** Private, on-device OCR: only the same-origin engine and model assets are fetched. */
export async function createPdfOcr(onProgress){
  const base=new URL('./vendor/ocr/',import.meta.url);
  const {default:Tesseract}=await import('./vendor/ocr/tesseract.esm.min.js');
  let label='กำลังโหลดเครื่องมือ OCR';
  const worker=await Tesseract.createWorker(['eng','tha'],1,{
    workerPath:new URL('worker.min.js',base).href,
    corePath:new URL('tesseract-core-lstm.wasm.js',base).href,
    langPath:new URL('lang',base).href,
    workerBlobURL:false,
    logger:info=>onProgress(label+(info.status==='recognizing text'?' · '+Math.round(info.progress*100)+'%':''))
  });
  return {
    async read(page,n,total){
      label='OCR หน้า '+n+' / '+total;onProgress(label);
      const original=page.getViewport({scale:1});
      const scale=Math.min(2.5,2600/Math.max(original.width,original.height));
      const viewport=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));
      try{
        await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'#fff'}).promise;
        const {data}=await worker.recognize(canvas);
        return normalizeOcrText(data.text);
      }finally{canvas.width=canvas.height=0;}
    },
    close:()=>worker.terminate()
  };
}
