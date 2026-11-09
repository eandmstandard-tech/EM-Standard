(function(root) {
  const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const MAX_XML_BYTES = 40 * 1024 * 1024;

  async function readDocumentXml(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ไฟล์ Word ไม่ใช่ DOCX ที่อ่านได้');
    let cursor = view.getUint32(eocd + 16, true);
    const entries = view.getUint16(eocd + 10, true);
    for (let n = 0; n < entries; n++) {
      if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('โครงสร้าง DOCX ไม่สมบูรณ์');
      const nameLength = view.getUint16(cursor + 28, true);
      const extraLength = view.getUint16(cursor + 30, true);
      const commentLength = view.getUint16(cursor + 32, true);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      if (name === 'word/document.xml') {
        const method = view.getUint16(cursor + 10, true);
        const compressedLength = view.getUint32(cursor + 20, true);
        const uncompressedLength = view.getUint32(cursor + 24, true);
        const local = view.getUint32(cursor + 42, true);
        if (uncompressedLength > MAX_XML_BYTES || compressedLength > MAX_XML_BYTES) throw new Error('เนื้อหา Word ใหญ่เกินกว่าจะอ่านในเบราว์เซอร์');
        if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('ข้อมูล DOCX ไม่สมบูรณ์');
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        if (start + compressedLength > bytes.length) throw new Error('ข้อมูล DOCX ไม่สมบูรณ์');
        const compressed = bytes.slice(start, start + compressedLength);
        let xml;
        if (method === 0) xml = compressed;
        else if (method === 8 && typeof DecompressionStream === 'function') {
          xml = new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
        } else throw new Error('เบราว์เซอร์นี้ยังอ่านการบีบอัด DOCX ไม่ได้');
        if (xml.length > MAX_XML_BYTES) throw new Error('เนื้อหา Word ใหญ่เกินกว่าจะอ่านในเบราว์เซอร์');
        return new TextDecoder().decode(xml);
      }
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    throw new Error('ไม่พบเนื้อหาของไฟล์ Word');
  }

  function parseDocumentXml(source, Parser = root.DOMParser) {
    const xml = new Parser().parseFromString(source, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error('อ่าน XML ของ Word ไม่สำเร็จ');
    const body = xml.getElementsByTagNameNS(WORD_NS, 'body')[0];
    if (!body) throw new Error('ไม่พบเนื้อหาของไฟล์ Word');
    // Only Word's last rendered page boundaries provide page positions.
    // Manual page breaks alone do not account for automatic pagination.
    const hasRenderedPages = xml.getElementsByTagNameNS(WORD_NS, 'lastRenderedPageBreak').length > 0;
    const pages = [{number: hasRenderedPages ? 1 : null, text: ''}];
    const current = () => pages[pages.length - 1];
    function visit(node) {
      if (node.nodeType !== 1) return;
      if (node.namespaceURI === WORD_NS) {
        if (node.localName === 'lastRenderedPageBreak') {
          if (hasRenderedPages) pages.push({number: pages.length + 1, text: ''});
          return;
        }
        if (node.localName === 't') { current().text += node.textContent; return; }
        if (node.localName === 'tab') { current().text += ' '; return; }
        if (node.localName === 'br' || node.localName === 'cr') { current().text += ' '; return; }
        if (node.localName === 'del' || node.localName === 'instrText') return;
      }
      for (const child of node.children) visit(child);
      if (node.namespaceURI === WORD_NS && (node.localName === 'p' || node.localName === 'tr')) current().text += ' ';
    }
    visit(body);
    pages.forEach(p => { p.text = p.text.normalize('NFC').replace(/\s+/g, ' ').trim(); });
    return {pages, pageNumbersAvailable: hasRenderedPages};
  }

  async function readDocx(file) {
    return parseDocumentXml(await readDocumentXml(file));
  }
  root.DocumentPageSearch = {readDocx, parseDocumentXml};
})(typeof window !== 'undefined' ? window : globalThis);
