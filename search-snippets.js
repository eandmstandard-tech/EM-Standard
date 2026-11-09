(function(root){
  'use strict';
  function clean(value){
    return String(value||'').normalize('NFC').replace(/[\u200b\u00ad]/g,'').replace(/\s+/g,' ').trim();
  }
  function occurrences(text,terms){
    // Match case-insensitively on the displayed string, preserving UTF-16 offsets.
    const found=[];
    for(const term of new Set(terms)){
      if(!term)continue;
      const pattern=new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');
      let hit,count=0;
      while((hit=pattern.exec(text))&&count++<40)found.push({start:hit.index,end:hit.index+hit[0].length,term});
    }
    return found.sort((a,b)=>a.start-b.start||b.end-a.end);
  }
  function render(value,terms,escape){
    const text=clean(value),merged=[];
    for(const hit of occurrences(text,terms)){
      const last=merged[merged.length-1];
      if(last&&hit.start<last.end)last.end=Math.max(last.end,hit.end);
      else merged.push({...hit});
    }
    let end=0,html='';
    for(const hit of merged){html+=escape(text.slice(end,hit.start))+'<mark>'+escape(text.slice(hit.start,hit.end))+'</mark>';end=hit.end;}
    return html+escape(text.slice(end));
  }
  function best(sources,terms,{limit=2,width=168}={}){
    const candidates=[];
    for(const [index,source] of sources.entries()){
      const text=clean(source.text),hits=occurrences(text,terms);
      for(const hit of hits){
        const start=Math.max(0,hit.start-28),end=Math.min(text.length,start+width);
        const inWindow=hits.filter(other=>other.start>=start&&other.end<=end);
        candidates.push({index,source,text,start,end,hits:inWindow,terms:[...new Set(inWindow.map(x=>x.term))]});
      }
    }
    const result=[],covered=new Set();
    while(result.length<limit){
      let selected=null,bestScore=-Infinity;
      for(const item of candidates){
        if(result.some(prev=>prev.index===item.index&&item.start<prev.end&&item.end>prev.start))continue;
        const added=item.terms.filter(term=>!covered.has(term)).length;
        if(!added)continue;
        const phraseSpan=item.hits.at(-1).start-item.hits[0].start;
        const score=added*1000+item.terms.length*20+Math.min(8,item.hits.length)-phraseSpan/1000+(item.source.weight||0);
        if(score>bestScore){bestScore=score;selected=item;}
      }
      if(!selected)break;
      const {text,start,end}=selected;
      // Avoid splitting a surrogate pair or a Thai combining mark at the edges.
      let left=start,right=end;
      while(left>0&&/[\p{M}\uDC00-\uDFFF]/u.test(text[left]||''))left--;
      while(right<text.length&&/[\p{M}\uDC00-\uDFFF]/u.test(text[right]||''))right++;
      selected.terms.forEach(term=>covered.add(term));
      result.push({...selected,excerpt:(left?'…':'')+text.slice(left,right).trim()+(right<text.length?'…':'')});
    }
    return result;
  }
  function keywords(values,terms){
    const seen=new Map();
    for(const value of values){
      const text=clean(value);
      for(const hit of occurrences(text,terms)){
        if(!seen.has(hit.term))seen.set(hit.term,text.slice(hit.start,hit.end));
      }
    }
    return [...new Set(terms)].filter(term=>seen.has(term)).map(term=>seen.get(term));
  }
  root.SearchSnippets={clean,render,best,keywords};
})(typeof window!=='undefined'?window:globalThis);
