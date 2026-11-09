const test=require('node:test');
const assert=require('node:assert/strict');

test('OCR joins Thai glyphs without losing English spacing or line boundaries',async()=>{
  const {normalizeOcrText}=await import('../dist/ocr.js');
  assert.equal(normalizeOcrText(' TEST  ก า ร ท ด ส อ บ แร ง ด ั น\nว า ล์ ว  VALVE INSPECTION '),
    'TEST  การทดสอบแรงดัน\nวาล์ว  VALVE INSPECTION');
});
