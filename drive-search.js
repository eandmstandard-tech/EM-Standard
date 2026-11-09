(function(root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = clause => clause.mode + ':' + clause.query;
  const cancelled = () => Object.assign(new Error('คำค้นเปลี่ยนแล้ว'), {code: 'CANCELLED'});
  function mergePages(first = [], second = []) {
    const pages = new Map();
    for (const page of [...first, ...second]) {
      const id = page.number == null ? 'unknown:' + (page.excerpt || page.text || '') : String(page.number);
      const previous = pages.get(id);
      if (!previous) pages.set(id, {...page});
      else if (page.excerpt && !String(previous.excerpt || '').includes(page.excerpt)) previous.excerpt = [previous.excerpt, page.excerpt].filter(Boolean).join(' … ').slice(0, 900);
    }
    return [...pages.values()].sort((a,b) => (a.number || 0) - (b.number || 0));
  }
  function createClient(request, {ttl = 120000, maxEntries = 24, now = () => Date.now()} = {}) {
    const cache = new Map(); let generation = 0;
    async function read(params, isCurrent) {
      if (!isCurrent()) throw cancelled();
      const id = JSON.stringify(params), saved = cache.get(id), epoch = generation;
      if (saved && now() - saved.time < ttl) { cache.delete(id); cache.set(id, saved); return clone(saved.value); }
      const payload = await request(params);
      if (!isCurrent() || epoch !== generation) throw cancelled();
      if (!payload || !payload.ok) throw new Error(payload?.error || 'Apps Script ค้นหาไม่สำเร็จ');
      if (params.action === 'search' && (payload.action !== 'search' || !Array.isArray(payload.matches))) throw new Error('Apps Script รุ่นนี้ยังไม่รองรับการค้นไฟล์');
      if (params.action === 'pages' && (payload.action !== 'pages' || !Array.isArray(payload.files))) throw new Error('Apps Script ไม่ส่งดัชนีเลขหน้ากลับมา');
      cache.set(id, {time: now(), value: clone(payload)});
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return payload;
    }
    async function bounded(tasks, isCurrent) {
      const values = new Array(tasks.length); let next = 0, failure;
      async function worker() {
        while (next < tasks.length && !failure) {
          const index = next++;
          if (!isCurrent()) { failure = cancelled(); break; }
          try { values[index] = await tasks[index](); } catch (error) { failure = error; }
        }
      }
      await Promise.all([worker(), worker()]);
      if (failure) throw failure;
      return values;
    }
    function plan(parsed) {
      const groups = parsed.groups.map(group => {
        const plain = group.filter(c => !c.phrase), phrases = group.filter(c => c.phrase);
        return [...(plain.length ? [{query: plain.map(c => c.value).join(' '), mode: 'all'}] : []), ...phrases.map(c => ({query: c.value, mode: 'phrase'}))];
      });
      const plain = parsed.excluded.filter(c => !c.phrase);
      const excluded = [...(plain.length ? [{query: plain.map(c => c.value).join(' '), mode: 'any'}] : []), ...parsed.excluded.filter(c => c.phrase).map(c => ({query: c.value, mode: 'phrase'}))];
      return {groups, excluded};
    }
    function filesOf(payload) {
      const files = new Map();
      for (const hit of payload.matches) for (const file of hit.files || []) if (file.id && typeof hit.folderId === 'string') files.set(file.id, {...file, folderId: hit.folderId});
      return files;
    }
    function truncated(payload) {
      return !!payload.partial || payload.matches.some(hit => Number(hit.fileCount || 0) > (hit.files || []).length);
    }
    async function search(parsed, isCurrent = () => true) {
      if (parsed.error) throw new Error(parsed.error);
      if (!parsed.positives.length) throw new Error('ใส่คำหลักอย่างน้อยหนึ่งคำเพื่อค้นเนื้อหาใน Drive');
      // Preserve the existing one-request path for ordinary queries.
      if (!parsed.advanced) return read({action: 'search', query: parsed.raw, mode: parsed.mode}, isCurrent);
      const planned = plan(parsed);
      const requests = new Map([...planned.groups.flat(), ...planned.excluded].map(q => [key(q), q]));
      const queries = [...requests.values()];
      const payloads = await bounded(queries.map(q => () => read({action: 'search', ...q}, isCurrent)), isCurrent);
      const responses = new Map(queries.map((q,i) => [key(q), payloads[i]]));
      const sets = new Map([...responses].map(([id,payload]) => [id, filesOf(payload)]));
      // Missing excluded IDs could admit a forbidden term. Never claim a complete exclusion on a truncated response.
      if (planned.excluded.some(q => truncated(responses.get(key(q))))) throw new Error('Drive ส่งรายการคำที่ต้องตัดออกมาไม่ครบ กรุณาเพิ่มคำหลักหรือจำกัดคำที่ตัดออกให้แคบลง');
      const result = new Map();
      for (const group of planned.groups) {
        const groupFiles = sets.get(key(group[0]));
        for (const [id, initial] of groupFiles) {
          if (!group.every(q => sets.get(key(q)).has(id))) continue;
          if (planned.excluded.some(q => sets.get(key(q)).has(id))) continue;
          let file = result.get(id) || {...initial, pages: [], pageQueries: []};
          for (const q of group) {
            const source = sets.get(key(q)).get(id);
            file.pages = mergePages(file.pages, source.pages);
            if (source.pageIndexStatus === 'deferred' && !file.pageQueries.some(p => key(p) === key(q))) file.pageQueries.push(q);
            if (source.pageIndexStatus === 'ready') file.pageIndexStatus = 'ready';
          }
          if (file.pageQueries.length) file.pageIndexStatus = 'deferred';
          result.set(id, file);
        }
      }
      const folders = new Map();
      for (const file of result.values()) {
        if (!folders.has(file.folderId)) folders.set(file.folderId, {folderId: file.folderId, fileCount: 0, files: []});
        const hit = folders.get(file.folderId); hit.files.push(file); hit.fileCount++;
      }
      const positivePayloads = planned.groups.flat().map(q => responses.get(key(q)));
      const standards = new Map();
      for (const payload of positivePayloads) for (const standard of payload.standards || []) if (folders.has(standard.id)) standards.set(standard.id, standard);
      return {ok: true, action: 'search', query: parsed.raw, mode: parsed.mode, matches: [...folders.values()], standards: [...standards.values()],
        partial: positivePayloads.some(truncated), partialPages: [...result.values()].some(file => file.pageQueries.length),
        pageIndexRestricted: positivePayloads.some(p => p.pageIndexRestricted), pageIndexEnabled: positivePayloads.every(p => p.pageIndexEnabled), advanced: true};
    }
    async function loadPages(files, isCurrent = () => true, onUpdate = () => {}) {
      const batches = new Map();
      for (const file of files) for (const q of file.pageQueries || []) {
        if (!batches.has(key(q))) batches.set(key(q), {q, files: []});
        batches.get(key(q)).files.push(file);
      }
      const tasks = [];
      for (const {q, files: list} of batches.values()) for (let offset = 0; offset < list.length; offset += 12) {
        const batch = list.slice(offset, offset + 12);
        tasks.push(async () => {
          const payload = await read({action: 'pages', ...q, fileIds: batch.map(f => f.id).join(',')}, isCurrent);
          if (!isCurrent()) throw cancelled();
          const hits = new Map(payload.files.map(f => [f.id,f]));
          for (const file of batch) {
            const hit = hits.get(file.id);
            if (!hit) throw new Error('Apps Script ไม่ส่งผลเลขหน้าของไฟล์ที่ร้องขอ');
            file.pages = mergePages(file.pages, hit.pages);
            file.pageQueries = file.pageQueries.filter(p => key(p) !== key(q));
            file.pageIndexStatus = file.pageQueries.length ? 'deferred' : hit.pageIndexStatus;
          }
          onUpdate();
        });
      }
      return bounded(tasks, isCurrent);
    }
    return {search, loadPages, clear() { generation++; cache.clear(); }};
  }
  root.DriveStandardsSearch = {createClient, mergePages};
})(typeof window !== 'undefined' ? window : globalThis);
