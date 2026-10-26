(() => {
  if (window.__smd) return;

  const recent = [];
  const thumbs = new Map();
  const origFetch = window.fetch;

  const S = window.__smd = {
    recent,
    fetch: (...a) => origFetch.apply(window, a),
    accept: () => false,
    ingest: () => {},
    detect: () => [],
    describe: () => null,
    creds: 'omit'
  };

  S.push = key => {
    if (!key) return;
    const i = recent.indexOf(key);
    if (i === 0) return;
    if (i > 0) recent.splice(i, 1);
    recent.unshift(key);
    if (recent.length > 40) recent.length = 40;
  };

  S.stamp = sec => {
    const d = sec ? new Date(sec * 1000) : new Date();
    const z = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
  };

  S.safe = s => String(s || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 60);

  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then(r => {
      try {
        if (!S.accept(r.url)) return;
        const ct = r.headers.get('content-type') || '';
        if (/json|javascript|text/.test(ct)) r.clone().text().then(t => S.ingest(t)).catch(() => {});
      } catch (e) {}
    }).catch(() => {});
    return p;
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        if (!S.accept(this.responseURL)) return;
        if (this.responseType === '' || this.responseType === 'text') S.ingest(this.responseText);
        else if (this.responseType === 'json') S.ingest(this.response);
      } catch (e) {}
    });
    return origSend.apply(this, args);
  };

  S.parseAny = (t, walk) => {
    if (t && typeof t === 'object') { walk(t, 0); return; }
    if (!t || typeof t !== 'string') return;
    const s = t.replace(/^for \(;;\);/, '');
    try { walk(JSON.parse(s), 0); return; } catch (e) {}
    for (const line of s.split('\n')) { if (line.trim()) { try { walk(JSON.parse(line), 0); } catch (e) {} } }
  };

  async function thumb(url) {
    if (!url) return null;
    if (thumbs.has(url)) return thumbs.get(url);
    try {
      const r = await origFetch(url, { credentials: 'omit' });
      if (!r.ok) return null;
      const bmp = await createImageBitmap(await r.blob());
      const w = 240;
      const h = Math.round(bmp.height * w / bmp.width);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const d = c.toDataURL('image/jpeg', 0.75);
      thumbs.set(url, d);
      return d;
    } catch (e) {
      return null;
    }
  }

  function tick() {
    try { S.detect().forEach(S.push); } catch (e) {}
  }
  setInterval(tick, 600);

  async function list(limit) {
    tick();
    const out = [];
    for (const key of recent) {
      const d = S.describe(key);
      if (!d || !d.files || !d.files.length) continue;
      out.push({ key, d });
      if (out.length >= limit) break;
    }
    return Promise.all(out.map(async ({ key, d }) => ({
      key,
      kind: d.kind,
      user: d.user,
      caption: (d.caption || '').slice(0, 80),
      count: d.files.length,
      video: d.files.some(f => f.ext === 'mp4'),
      locked: !!d.protected,
      thumb: await thumb(d.thumb)
    })));
  }

  const PROTECTION_BOXES = new Set(['encv', 'enca', 'pssh', 'tenc', 'sinf', 'schm', 'senc']);
  const CONTAINER_BOXES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf', 'edts', 'dinf']);

  function isProtectedMp4(buf) {
    const u8 = new Uint8Array(buf);
    const v = new DataView(buf);
    const typeAt = p => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
    if (u8.length < 8 || !['ftyp', 'styp', 'moov', 'moof'].includes(typeAt(4))) return false;
    const walk = (start, end, depth) => {
      let p = start;
      while (p + 8 <= end) {
        let size = v.getUint32(p);
        const type = typeAt(p + 4);
        let hdr = 8;
        if (size === 1) {
          if (p + 16 > end) return false;
          size = Number(v.getBigUint64(p + 8));
          hdr = 16;
        } else if (size === 0) {
          size = end - p;
        }
        if (size < hdr) return false;
        const boxEnd = Math.min(p + size, end);
        if (PROTECTION_BOXES.has(type)) return true;
        if (depth < 12) {
          if (CONTAINER_BOXES.has(type) && walk(p + hdr, boxEnd, depth + 1)) return true;
          if (type === 'stsd' && walk(p + hdr + 8, boxEnd, depth + 1)) return true;
        }
        p += size;
      }
      return false;
    };
    return walk(0, u8.length, 0);
  }

  S.isProtectedMp4 = isProtectedMp4;

  async function fetchBlob(url) {
    let r;
    try {
      r = await origFetch(url, { credentials: S.creds });
      if (!r.ok && S.creds !== 'omit') r = await origFetch(url, { credentials: 'omit' });
    } catch (e) {
      if (S.creds === 'omit') throw e;
      r = await origFetch(url, { credentials: 'omit' });
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.blob();
  }

  function saveBlob(blob, name) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  async function download(key) {
    const d = S.describe(key);
    if (!d || !d.files || !d.files.length) throw new Error('NOT_FOUND');
    if (d.protected) throw new Error('PROTECTED');
    const blobs = [];
    for (const f of d.files) {
      const blob = await fetchBlob(f.url);
      if (f.ext === 'mp4' && isProtectedMp4(await blob.arrayBuffer())) throw new Error('PROTECTED');
      blobs.push(blob);
    }
    const names = [];
    for (let i = 0; i < blobs.length; i++) {
      const f = d.files[i];
      const suffix = d.files.length > 1 ? `_${i + 1}` : '';
      const name = `${S.safe(d.user)}_${S.stamp(d.time)}_${S.safe(d.id)}${suffix}.${f.ext}`;
      saveBlob(blobs[i], name);
      names.push(name);
      if (i < blobs.length - 1) await new Promise(r => setTimeout(r, 350));
    }
    return names;
  }

  window.addEventListener('message', async e => {
    if (e.source !== window || !e.data || e.data.source !== 'smd-bridge') return;
    const { id, cmd, key } = e.data;
    let result;
    try {
      if (cmd === 'list') result = { platform: S.platform, items: await list(3) };
      else if (cmd === 'download') result = { ok: true, files: await download(key) };
      else result = { error: 'UNKNOWN_CMD' };
    } catch (err) {
      result = { error: err.message || String(err) };
    }
    window.postMessage({ source: 'smd-main', id, result }, '*');
  });
})();
