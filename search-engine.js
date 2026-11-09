(function(root) {
  'use strict';
  const normalize = text => String(text || '').normalize('NFC').toLowerCase().replace(/[\u200b\u00ad]/g, '').replace(/\s+/g, ' ').trim();
  const cached = new WeakMap();
  // OR separates alternatives. Exclusions apply to every alternative.
  function parse(query, mode = 'all') {
    const raw = String(query || '').trim().replace(/[“”]/g, '"');
    const result = {raw, mode, groups: [], excluded: [], positives: [], error: '', advanced: false};
    if (!raw) return result;
    if (raw.length > 120) { result.error = 'ใส่คำค้นได้ไม่เกิน 120 ตัวอักษร'; return result; }
    if (mode === 'phrase') {
      const value = normalize(raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw);
      if (value) result.groups = [[{value, phrase: true}]];
    } else {
      let group = [], offset = 0;
      while (offset < raw.length) {
        if (/\s/.test(raw[offset])) { offset++; continue; }
        let negative = false, phrase = false, value = '';
        if (raw[offset] === '-') { negative = true; offset++; result.advanced = true; }
        if (raw[offset] === '"') {
          phrase = true; result.advanced = true; offset++;
          while (offset < raw.length && raw[offset] !== '"') value += raw[offset++];
          if (offset === raw.length) { result.error = 'ปิดเครื่องหมายคำพูดให้ครบ เช่น "pressure relief"'; break; }
          offset++;
          if (offset < raw.length && !/\s/.test(raw[offset])) { result.error = 'เว้นช่องว่างหลังเครื่องหมายคำพูด'; break; }
        } else {
          while (offset < raw.length && !/\s/.test(raw[offset])) value += raw[offset++];
          if (/[()]/.test(value)) { result.error = 'รุ่นทดสอบนี้ยังไม่รองรับวงเล็บ ใช้ OR ระหว่างกลุ่มคำ'; break; }
          if (value.includes('"')) { result.error = 'เว้นช่องว่างก่อนเครื่องหมายคำพูด'; break; }
        }
        if (!negative && !phrase && value === 'OR') {
          result.advanced = true;
          if (!group.length) { result.error = 'ใส่คำค้นทั้งก่อนและหลัง OR'; break; }
          result.groups.push(group); group = []; continue;
        }
        value = normalize(value);
        if (!value) { result.error = 'ใส่คำค้นหลังเครื่องหมาย - หรือภายในเครื่องหมายคำพูด'; break; }
        const clause = {value, phrase};
        if (negative) result.excluded.push(clause); else group.push(clause);
      }
      if (!result.error) {
        if (group.length) result.groups.push(group);
        else if (result.groups.length) result.error = 'ใส่คำค้นหลัง OR';
        if (mode === 'any') result.groups = result.groups.flat().map(clause => [clause]);
      }
    }
    result.positives = result.groups.flat();
    if (result.positives.length + result.excluded.length > 8) result.error = 'ค้นหาได้ไม่เกิน 8 คำหรือวลีต่อครั้ง';
    return result;
  }
  function terms(query, mode) { return [...new Set(parse(query, mode).positives.map(c => c.value))]; }
  function matches(text, words, mode) {
    const value = normalize(text);
    return !words.length || (mode === 'any' ? words.some(w => value.includes(w)) : words.every(w => value.includes(w)));
  }
  function testQuery(text, parsed) {
    const value = normalize(text);
    return !parsed.error && !parsed.excluded.some(c => value.includes(c.value)) && (!parsed.groups.length || parsed.groups.some(group => group.every(c => value.includes(c.value))));
  }
  function grams(text) {
    const found = new Set();
    for (let i = 0; i + 2 < text.length; i++) found.add(text.slice(i, i + 3));
    return found;
  }
  function intersect(a, b) { return new Set([...a].filter(id => b.has(id))); }
  function addPosting(map, text, id) {
    for (const gram of grams(text)) {
      if (!map.has(gram)) map.set(gram, new Set());
      map.get(gram).add(id);
    }
  }
  function fingerprint(record) {
    return [record.code, record.title, record.description, record.keywords, record.publisher, (record.disciplines || []).join(',')].join('\u0001');
  }
  function createIndex(records) {
    const postings = {all: new Map(), title: new Map(), content: new Map()};
    const entries = records.map((record, id) => {
      const pageSource = Array.isArray(record.pages) ? record.pages : [];
      const pages = pageSource.map(page => ({page, text: normalize(page.text)}));
      const title = normalize([record.code, record.title].join(' '));
      const code = normalize(record.code), codeAlias = code.replace(/[\s.-]+/g, '');
      const reference = /^([a-z]{2,8})(?:\s+(?:std|rp|spec|sp|standard|tr))?\s*[-.]?\s*(\d+(?:[.-]\d+)*(?:[a-z](?![a-z]))?)/.exec(code);
      const referenceAlias = reference ? reference[1] + reference[2].replace(/[.-]/g, '') : '';
      const referenceTail = reference ? code.slice(reference[0].length).trim() : '';
      const aliases = reference ? '\u0000' + codeAlias + '\u0000' + referenceAlias + '\u0000' + reference[1] + '-' + reference[2] + '\u0000' + code.replace(/\s+/g, '-') : '';
      const metadata = normalize([title, record.description, record.keywords, (record.disciplines || []).join(' '), record.publisher].join(' '));
      // A phrase must not bridge two pages or metadata and document text.
      const content = pages.map(p => p.text).join('\u0000');
      const fields = {title: title + aliases, content, all: metadata + aliases + '\u0000' + content};
      for (const scope of Object.keys(postings)) addPosting(postings[scope], fields[scope], id);
      return {record, fingerprint: fingerprint(record), pageSource, pageCount: pageSource.length, pages, code, codeAlias, referenceAlias, referenceTail, title, metadata, fields};
    });
    const universe = new Set(entries.map((_, id) => id));
    function lookup(clause, scope) {
      const candidates = [...grams(clause.value)].map(g => postings[scope].get(g) || new Set()).sort((a,b) => a.size - b.size);
      let ids = candidates.length ? new Set(candidates[0]) : new Set(universe);
      for (let i = 1; ids.size && i < candidates.length; i++) ids = intersect(ids, candidates[i]);
      return new Set([...ids].filter(id => entries[id].fields[scope].includes(clause.value)));
    }
    function search(options = {}) {
      const parsed = options.parsed || parse(options.query, options.mode);
      if (parsed.error) return [];
      const scope = options.scope === 'title' || options.scope === 'content' ? options.scope : 'all';
      const lookups = new Map();
      const idsFor = clause => {
        if (!lookups.has(clause.value)) lookups.set(clause.value, lookup(clause, scope));
        return lookups.get(clause.value);
      };
      let ids = parsed.groups.length ? new Set() : new Set(universe);
      for (const group of parsed.groups) {
        let groupIds = new Set(idsFor(group[0]));
        for (const clause of group.slice(1)) groupIds = intersect(groupIds, idsFor(clause));
        for (const id of groupIds) ids.add(id);
      }
      const remoteHits = options.remoteHits || new Map();
      if (scope !== 'title' && parsed.positives.length) entries.forEach((entry, id) => { if (entry.record.folderId && remoteHits.has(entry.record.folderId)) ids.add(id); });
      for (const clause of parsed.excluded) for (const id of idsFor(clause)) ids.delete(id);
      const results = [];
      for (const id of ids) {
        const entry = entries[id], s = entry.record;
        if (options.ocrOnly && !s.localOcr) continue;
        if (options.discipline && !(s.disciplines || []).includes(options.discipline)) continue;
        if ((options.publishers || []).length && !options.publishers.includes(s.publisher)) continue;
        if (options.folder && options.folder !== s.publisher) continue;
        const remoteContentMatch = scope !== 'title' && parsed.positives.length > 0 && !!s.folderId && remoteHits.has(s.folderId);
        if (scope === 'content' && !entry.fields.content && !remoteContentMatch) continue;
        const matchingPages = scope === 'title' ? [] : entry.pages.filter(p => parsed.positives.some(c => p.text.includes(c.value))).map(p => p.page);
        let score = remoteContentMatch ? 5 : 0;
        if (remoteContentMatch) {
          // Keep content eligibility tied to the file index. Within those results,
          // names matching the query are a stronger signal than an unranked Drive hit.
          const names = (options.remoteFiles?.get(s.folderId) || []).map(file => normalize(file.name));
          const matchWeight = text => parsed.positives.reduce((weight, clause) => weight + (text.includes(clause.value) ? (clause.phrase ? 6 : 3) : 0), 0);
          score += Math.max(0, ...names.map(matchWeight)) + (scope === 'content' ? matchWeight(entry.title) : 0);
        }
        for (const clause of parsed.positives) {
          const rarity = 1 + Math.log(1 + entries.length / (1 + idsFor(clause).size));
          const hits = entry.fields[scope].split(clause.value).length - 1;
          score += rarity * Math.min(hits, 12) / (1 + Math.log(1 + entry.fields[scope].length / 500));
          if (scope !== 'content') score += entry.code === clause.value ? 90 : entry.title.includes(clause.value) ? (clause.phrase ? 28 : 16) : entry.metadata.includes(clause.value) ? 4 : 0;
        }
        if (scope !== 'content' && !parsed.excluded.length) {
          const queryCode = parsed.positives.map(c => c.value).join('').replace(/[\s.-]+/g, '');
          if (queryCode && queryCode === entry.codeAlias) score += 160;
          else if (queryCode && queryCode === entry.referenceAlias) score += 100 + (entry.referenceTail ? 0 : 45);
        }
        results.push({...s, score, matchingPages, remoteContentMatch, matchedFileCount: remoteHits.get(s.folderId) || 0});
      }
      return results.sort(options.sort === 'code' ? (a,b) => String(a.code).localeCompare(String(b.code)) : (a,b) => b.score - a.score || String(a.code).localeCompare(String(b.code)));
    }
    return {entries, search, stats: {records: records.length, pages: entries.reduce((sum,e) => sum + e.pages.length, 0)}};
  }
  function getIndex(records) {
    let index = cached.get(records);
    if (!index || index.entries.length !== records.length || index.entries.some((entry,i) => entry.record !== records[i] || entry.fingerprint !== fingerprint(records[i]) || (Array.isArray(records[i].pages) && entry.pageSource !== records[i].pages) || entry.pageCount !== (records[i].pages || []).length)) {
      index = createIndex(records); cached.set(records, index);
    }
    return index;
  }
  root.StandardsSearch = {normalize, parse, terms, matches, testQuery, createIndex, getIndex, search: (records, options) => getIndex(records).search(options)};
})(typeof window !== 'undefined' ? window : globalThis);
