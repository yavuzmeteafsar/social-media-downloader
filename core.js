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
      thumb: await thumb(d.thumb)
    })));
  }

  async function save(url, name) {
    let r;
    try {
      r = await origFetch(url, { credentials: S.creds });
      if (!r.ok && S.creds !== 'omit') r = await origFetch(url, { credentials: 'omit' });
    } catch (e) {
      if (S.creds === 'omit') throw e;
      r = await origFetch(url, { credentials: 'omit' });
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
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
    const names = [];
    for (let i = 0; i < d.files.length; i++) {
      const f = d.files[i];
      const suffix = d.files.length > 1 ? `_${i + 1}` : '';
      const name = `${S.safe(d.user)}_${S.stamp(d.time)}_${S.safe(d.id)}${suffix}.${f.ext}`;
      await save(f.url, name);
      names.push(name);
      if (i < d.files.length - 1) await new Promise(r => setTimeout(r, 350));
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
