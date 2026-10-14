(() => {
  const S = window.__smd;
  if (!S || S.platform) return;
  S.platform = 'tiktok';
  S.creds = 'include';

  const items = new Map();
  const fallbackSrc = new Map();
  let rehydrated = false;

  const urlList = x => (x && (x.urlList || x.UrlList || x.url_list)) || [];

  function store(o) {
    const id = String(o.id);
    const v = o.video || {};
    const author = typeof o.author === 'object' && o.author ? (o.author.uniqueId || o.author.unique_id) : (o.author || null);
    const img = o.imagePost || o.image_post_info || null;
    const prev = items.get(id) || {};
    items.set(id, {
      id,
      author: author || prev.author || null,
      desc: o.desc || prev.desc || '',
      createTime: Number(o.createTime || o.create_time) || prev.createTime || null,
      cover: v.cover || v.originCover || v.dynamicCover || prev.cover || null,
      bitrateInfo: (v.bitrateInfo || prev.bitrateInfo || []).map(b => ({
        codec: b.CodecType || '',
        bitrate: b.Bitrate || 0,
        area: ((b.PlayAddr && b.PlayAddr.Width) || 0) * ((b.PlayAddr && b.PlayAddr.Height) || 0),
        urls: urlList(b.PlayAddr)
      })),
      playAddr: v.playAddr || prev.playAddr || null,
      images: img ? (img.images || []).map(i => urlList(i.imageURL || i.display_image)[0]).filter(Boolean) : (prev.images || null),
      imageCover: img && img.cover ? urlList(img.cover.imageURL)[0] : (prev.imageCover || null)
    });
  }

  function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 60) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (o.id && /^\d{10,}$/.test(String(o.id)) && o.author && ((o.video && (o.video.playAddr || o.video.bitrateInfo)) || o.imagePost)) {
      store(o);
      return;
    }
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  }

  S.accept = url => /tiktok\.com\/api\//.test(url || '');
  S.ingest = t => {
    if (typeof t === 'string' && t.indexOf('playAddr') === -1 && t.indexOf('imagePost') === -1) return;
    S.parseAny(t, walk);
  };

  function scanRehydration() {
    const el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
    if (!el || rehydrated) return;
    rehydrated = true;
    S.ingest(el.textContent);
  }

  function wrapperId(el) {
    for (let a = el; a; a = a.parentElement) {
      const m = (a.id || '').match(/^xgwrapper-\d+-(\d+)$/);
      if (m) return m[1];
    }
    return null;
  }

  S.detect = () => {
    scanRehydration();
    const out = [];
    const m = location.pathname.match(/\/(?:video|photo)\/(\d+)/);
    if (m) out.push('tt:' + m[1]);
    const vids = [...document.querySelectorAll('video')].map(v => ({ v, r: v.getBoundingClientRect() }))
      .filter(x => x.r.height > 200 && x.r.bottom > 0 && x.r.top < innerHeight);
    const cy = innerHeight / 2;
    vids.sort((a, b) => (a.v.paused - b.v.paused) || (Math.abs((a.r.top + a.r.bottom) / 2 - cy) - Math.abs((b.r.top + b.r.bottom) / 2 - cy)));
    const cur = vids[0];
    if (cur) {
      const id = wrapperId(cur.v);
      if (id) {
        const src = cur.v.currentSrc || '';
        if (/^https?:/.test(src)) fallbackSrc.set(id, src);
        if (!m || m[1] !== id) out.push('tt:' + id);
      }
    }
    return out.reverse();
  };

  function bestVideo(it) {
    const ok = it.bitrateInfo.filter(b => b.urls.length && (/^h264$/i.test(b.codec) || /hvc1/i.test(b.codec)));
    ok.sort((a, b) => (b.area - a.area) || (b.bitrate - a.bitrate));
    if (ok.length) return ok[0].urls[0];
    return it.playAddr || null;
  }

  S.describe = key => {
    if (!key.startsWith('tt:')) return null;
    const id = key.slice(3);
    const it = items.get(id);
    if (!it) {
      const src = fallbackSrc.get(id);
      return src ? { id, kind: 'video', user: null, time: null, thumb: null, files: [{ url: src, ext: 'mp4' }] } : null;
    }
    if (it.images && it.images.length) {
      return { id, kind: 'photo', user: it.author, caption: it.desc, time: it.createTime, thumb: it.imageCover || it.images[0], files: it.images.map(u => ({ url: u, ext: 'jpg' })) };
    }
    const v = bestVideo(it) || fallbackSrc.get(id);
    return { id, kind: 'video', user: it.author, caption: it.desc, time: it.createTime, thumb: it.cover, files: v ? [{ url: v, ext: 'mp4' }] : [] };
  };
})();
