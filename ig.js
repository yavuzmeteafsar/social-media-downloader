(() => {
  const S = window.__smd;
  if (!S || S.platform) return;
  S.platform = 'instagram';
  S.creds = 'omit';

  const items = new Map();
  const codes = new Map();
  const reels = new Map();
  const storyPks = new Set();
  const scanned = new WeakSet();

  const fname = u => { try { return new URL(u, location.href).pathname.split('/').pop(); } catch (e) { return ''; } };

  function slimMedia(m) {
    return {
      pk: String(m.pk),
      media_type: m.media_type,
      video_versions: m.video_versions || null,
      image_versions2: m.image_versions2 || null
    };
  }

  function store(m, userHint) {
    const pk = String(m.pk);
    const prev = items.get(pk);
    const it = {
      pk,
      code: m.code || (prev && prev.code) || null,
      media_type: m.media_type,
      product_type: m.product_type || (prev && prev.product_type) || null,
      taken_at: m.taken_at || (prev && prev.taken_at) || null,
      video_duration: m.video_duration || (prev && prev.video_duration) || null,
      user: (m.user && m.user.username) || (m.owner && m.owner.username) || (prev && prev.user) || userHint || null,
      caption: (m.caption && m.caption.text) || (prev && prev.caption) || '',
      video_versions: m.video_versions || (prev && prev.video_versions) || null,
      image_versions2: m.image_versions2 || (prev && prev.image_versions2) || null,
      carousel: Array.isArray(m.carousel_media) && m.carousel_media.length ? m.carousel_media.map(slimMedia) : (prev && prev.carousel) || null
    };
    items.set(pk, it);
    if (it.code) codes.set(it.code, pk);
  }

  function registerReel(reel) {
    const user = (reel.user && reel.user.username) || null;
    const list = reel.items.filter(i => i && i.pk && (i.video_versions || i.image_versions2));
    if (!list.length || !user && !String(reel.id || '').startsWith('highlight:')) return;
    const id = String(reel.id || '');
    const key = id.startsWith('highlight:') ? id : 'user:' + user;
    const pks = list.map(i => String(i.pk));
    const prev = reels.get(key);
    if (!prev || prev.items.length <= pks.length) reels.set(key, { user, items: pks });
    list.forEach(i => { store(i, user); storyPks.add(String(i.pk)); });
  }

  function walk(o, d) {
    if (!o || typeof o !== 'object' || d > 90) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, d + 1); return; }
    if (Array.isArray(o.items) && o.items.length && o.items[0] && typeof o.items[0] === 'object' && 'media_type' in o.items[0] && (o.reel_type || o.latest_reel_media || String(o.id || '').startsWith('highlight:'))) {
      registerReel(o);
    } else if (o.pk && 'media_type' in o && (o.image_versions2 || o.video_versions || o.carousel_media)) {
      store(o);
    }
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') walk(v, d + 1); }
  }

  S.accept = url => /instagram\.com/.test(url || '');
  S.ingest = t => {
    if (typeof t === 'string') {
      if (t.indexOf('media_type') === -1) return;
      if (t.indexOf('image_versions2') === -1 && t.indexOf('video_versions') === -1) return;
    }
    S.parseAny(t, walk);
  };

  function scanScripts() {
    document.querySelectorAll('script[type="application/json"]').forEach(s => {
      if (scanned.has(s)) return;
      scanned.add(s);
      S.ingest(s.textContent);
    });
  }

  function storyRoute() {
    const p = location.pathname.split('/').filter(Boolean);
    if (p[0] !== 'stories' || !p[1]) return null;
    if (p[1] === 'highlights') return { key: 'highlight:' + p[2], pk: p[3] && /^\d+$/.test(p[3]) ? p[3] : null };
    return { key: 'user:' + p[1], pk: p[2] && /^\d+$/.test(p[2]) ? p[2] : null };
  }

  function storyFrame() {
    const all = [...document.querySelectorAll('video, img')]
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(x => x.r.height > innerHeight * 0.5 && x.r.width > 150 && x.r.right > 0 && x.r.left < innerWidth);
    if (!all.length) return null;
    all.sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height));
    const top = all[0];
    const vid = all.find(x => x.el.tagName === 'VIDEO' && Math.abs(x.r.left - top.r.left) < 40 && Math.abs(x.r.top - top.r.top) < 80);
    return vid || top;
  }

  function headerUser(frame) {
    if (!frame) return null;
    const r = frame.r;
    for (const a of document.querySelectorAll('a[href]')) {
      const b = a.getBoundingClientRect();
      if (b.top < r.top - 20 || b.top > r.top + 100 || b.left < r.left - 20 || b.right > r.right + 20) continue;
      const m = a.getAttribute('href').match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (m && m[1] !== 'stories') return m[1];
    }
    return null;
  }

  function overlap(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    return b.width > 0 ? Math.max(0, w) / b.width : 0;
  }

  function progressIndex(frame, expected) {
    const r = frame.r;
    const bars = [...document.querySelectorAll('div')].filter(d => {
      const b = d.getBoundingClientRect();
      return b.height > 0 && b.height <= 4 && b.width > 3 && b.top >= r.top - 80 && b.top <= r.top + 60 && b.left >= r.left - 20 && b.right <= r.right + 20;
    });
    const groups = new Map();
    bars.forEach(d => {
      const p = d.parentElement;
      if (!p) return;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(d);
    });
    let segs = null;
    for (const [, g] of groups) if (g.length === expected) { segs = g; break; }
    if (!segs) {
      let best = null;
      for (const [, g] of groups) if (!best || g.length > best.length) best = g;
      segs = best;
    }
    if (!segs || !segs.length) return -1;
    segs.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    const withFill = segs.map((s, i) => s.children.length ? i : -1).filter(i => i !== -1);
    if (withFill.length === 1) return withFill[0];
    const ratios = segs.map(s => {
      const sb = s.getBoundingClientRect();
      let m = 0;
      s.querySelectorAll('*').forEach(c => { m = Math.max(m, overlap(c.getBoundingClientRect(), sb)); });
      return m;
    });
    const i = ratios.findIndex(x => x < 0.999);
    return i === -1 ? segs.length - 1 : i;
  }

  function currentStory(rt) {
    if (rt.pk && items.has(rt.pk)) return rt.pk;
    const frame = storyFrame();
    let reel = reels.get(rt.key);
    if (!reel) { const u = headerUser(frame); if (u) reel = reels.get('user:' + u); }
    if (!reel) return null;
    const list = reel.items.map(pk => items.get(pk)).filter(Boolean);
    const isVideo = !!frame && frame.el.tagName === 'VIDEO';
    if (frame && !isVideo) {
      const f = fname(frame.el.currentSrc || frame.el.src);
      const m = list.find(it => ((it.image_versions2 && it.image_versions2.candidates) || []).some(c => fname(c.url) === f));
      if (m) return m.pk;
    }
    const dur = isVideo ? frame.el.duration : NaN;
    const ok = it => it && (isVideo
      ? it.media_type === 2 && (!isFinite(dur) || !it.video_duration || Math.abs(it.video_duration - dur) < 1.5)
      : it.media_type === 1);
    const idx = frame ? progressIndex(frame, list.length) : -1;
    if (idx >= 0 && idx < list.length && ok(list[idx])) return list[idx].pk;
    const m = list.filter(ok);
    if (m.length === 1) return m[0].pk;
    if (idx >= 0 && idx < list.length) return list[idx].pk;
    if (list.length === 1) return list[0].pk;
    return null;
  }

  const codeFromHref = h => { const m = (h || '').match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/); return m ? m[1] : null; };

  function visibleFeedCode() {
    const cy = innerHeight / 2;
    let best = null;
    let bestDist = Infinity;
    document.querySelectorAll('article').forEach(a => {
      const r = a.getBoundingClientRect();
      if (r.height < 50 || r.bottom < 0 || r.top > innerHeight) return;
      const dist = r.top <= cy && r.bottom >= cy ? 0 : Math.min(Math.abs(r.top - cy), Math.abs(r.bottom - cy));
      if (dist >= bestDist) return;
      const link = [...a.querySelectorAll('a[href]')].map(x => codeFromHref(x.getAttribute('href'))).find(Boolean);
      if (link) { best = link; bestDist = dist; }
    });
    return best;
  }

  S.detect = () => {
    scanScripts();
    const out = [];
    const rt = storyRoute();
    if (rt) {
      const pk = currentStory(rt);
      if (pk) out.push('pk:' + pk);
      return out;
    }
    const routeCode = codeFromHref(location.pathname);
    if (routeCode) out.push('code:' + routeCode);
    const feed = visibleFeedCode();
    if (feed && feed !== routeCode) out.push('code:' + feed);
    return out.reverse();
  };

  const bestVideo = m => {
    const v = m.video_versions && m.video_versions.length ? [...m.video_versions].sort((a, b) => (b.width * b.height || 0) - (a.width * a.height || 0))[0] : null;
    return v ? { url: v.url, ext: 'mp4' } : null;
  };
  const bestImage = m => {
    const c = m.image_versions2 && m.image_versions2.candidates;
    if (!c || !c.length) return null;
    const b = [...c].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
    return { url: b.url, ext: 'jpg' };
  };
  const smallImage = m => {
    const c = m && m.image_versions2 && m.image_versions2.candidates;
    if (!c || !c.length) return null;
    const s = [...c].sort((a, b) => (a.width || 0) - (b.width || 0));
    return (s.find(x => (x.width || 0) >= 240) || s[s.length - 1]).url;
  };
  const fileOf = m => (m.media_type === 2 ? bestVideo(m) : null) || bestImage(m);

  S.describe = key => {
    let pk = null;
    if (key.startsWith('pk:')) pk = key.slice(3);
    else if (key.startsWith('code:')) pk = codes.get(key.slice(5));
    const it = pk && items.get(pk);
    if (!it) return null;
    const files = it.carousel ? it.carousel.map(fileOf).filter(Boolean) : [fileOf(it)].filter(Boolean);
    let kind = 'post';
    if (storyPks.has(it.pk) || it.product_type === 'story') kind = 'story';
    else if (it.product_type === 'clips') kind = 'reel';
    else if (it.carousel) kind = 'album';
    else if (it.media_type === 2) kind = 'video';
    return {
      id: it.code || it.pk,
      kind,
      user: it.user,
      caption: it.caption,
      time: it.taken_at,
      thumb: smallImage(it) || (it.carousel && smallImage(it.carousel[0])),
      files
    };
  };

  document.addEventListener('DOMContentLoaded', scanScripts);
})();
