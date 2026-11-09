const test=require('node:test');
const assert=require('node:assert/strict');
require('../dist/search-snippets.js');
const {best,render,keywords}=globalThis.SearchSnippets;

test('a denser passage beats the first keyword mention and preserves original casing',()=>{
  const source={text:'Inspection is listed in the glossary. '+ 'background '.repeat(25)+'Tank Inspection procedures apply here.',page:4};
  const [hit]=best([source],['tank','inspection']);
  assert.equal(hit.source.page,4);
  assert.match(hit.excerpt,/Tank Inspection procedures/);
  assert.doesNotMatch(hit.excerpt,/glossary/);
  assert.deepEqual(keywords([hit.excerpt],['tank','inspection','pump']),['Tank','Inspection']);
});

test('separate snippets show keywords on their actual pages',()=>{
  const hits=best([{text:'ปั้นจั่นต้องผ่านการตรวจสอบ',page:2},{text:'ประกาศเมื่อ 2564',page:5}],['ปั้นจั่น','2564']);
  assert.deepEqual(hits.map(h=>h.source.page),[2,5]);
  assert.equal(hits[0].excerpt,'ปั้นจั่นต้องผ่านการตรวจสอบ');
  assert.equal(hits[1].excerpt,'ประกาศเมื่อ 2564');
});

test('does not claim context when an indexed document has no visible matching text',()=>{
  assert.deepEqual(best([{text:'unrelated text'},{text:''}],['inspection']),[]);
  assert.deepEqual(keywords(['a PDF match without text'],['inspection']),[]);
});

test('preserves matched Thai and punctuation while escaping markup',()=>{
  const escape=x=>x.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  assert.equal(render('<img> B31.3 ปั้น\u200bจั่น', ['b31.3','ปั้นจั่น'],escape),
    '&lt;img&gt; <mark>B31.3</mark> <mark>ปั้นจั่น</mark>');
  assert.equal(render('B31X3', ['b31.3'],escape),'B31X3');
});
