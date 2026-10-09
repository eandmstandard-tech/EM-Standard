(function(root) {
  const normalize = text => String(text || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  function terms(query, mode) {
    const q = normalize(query);
    return !q ? [] : mode === 'phrase' ? [q] : [...new Set(q.split(' '))];
  }
  function matches(text, words, mode) {
    const normalized = normalize(text);
    return !words.length || (mode === 'any' ? words.some(w => normalized.includes(w)) : words.every(w => normalized.includes(w)));
  }
  function search(records, options) {
    const words = terms(options.query, options.mode);
    const remoteHits = options.remoteHits || new Map();
    return records.filter(s => (!options.discipline || s.disciplines.includes(options.discipline)) &&
      (!options.publishers.length || options.publishers.includes(s.publisher)) &&
      (!options.folder || s.publisher === options.folder)).map(s => {
        const pages = Array.isArray(s.pages) ? s.pages : [];
        const title = s.code + ' ' + s.title;
        const metadata = title + ' ' + s.description + ' ' + s.keywords + ' ' + s.disciplines.join(' ') + ' ' + s.publisher;
        const content = pages.map(p => p.text).join('\n');
        const remoteContentMatch = options.scope !== 'title' && !!words.length && !!s.folderId && remoteHits.has(s.folderId);
        const fields = options.scope === 'title' ? title : options.scope === 'content' ? content : metadata + '\n' + content;
        if (options.scope === 'content' && !content.trim() && !remoteContentMatch) return null;
        if (!matches(fields, words, options.mode) && !remoteContentMatch) return null;
        const matchingPages = options.scope === 'title' || !words.length ? [] : pages.filter(p => matches(p.text, words, options.mode));
        const score = words.reduce((n, w) => n + (normalize(title).includes(w) ? 10 : 0) + (normalize(metadata).includes(w) ? 3 : 0) + (normalize(content).includes(w) ? 1 : 0), 0) + (remoteContentMatch ? 5 : 0);
        return {...s, score, matchingPages, remoteContentMatch, matchedFileCount: remoteHits.get(s.folderId) || 0};
      }).filter(Boolean).sort(options.sort === 'code' ? (a,b) => a.code.localeCompare(b.code) : (a,b) => b.score - a.score || a.code.localeCompare(b.code));
  }
  root.StandardsSearch = {normalize, terms, matches, search};
})(typeof window !== 'undefined' ? window : globalThis);
