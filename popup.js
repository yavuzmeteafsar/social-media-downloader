const SITES = {
  instagram: { pattern: '*://www.instagram.com/*', home: 'https://www.instagram.com/', name: 'Instagram', test: /^https:\/\/www\.instagram\.com\// },
  tiktok: { pattern: '*://www.tiktok.com/*', home: 'https://www.tiktok.com/foryou', name: 'TikTok', test: /^https:\/\/www\.tiktok\.com\// }
};

const I18N = {
  tr: {
    recent: 'Son görüntülenenler',
    recentHere: 'Bu sekmede son görüntülenenler',
    recentOther: 'Diğer sekmede son görüntülenenler',
    refresh: '↻ Yenile',
    refreshTitle: 'Yenile',
    noTabTitle: name => `Açık ${name} sekmesi yok`,
    noTabText: name => `${name}'ı aç, bir içeriğe bak, sonra buraya dön.`,
    open: name => `${name}'ı aç`,
    notReadyTitle: 'Sekme hazır değil',
    notReadyText: 'Eklenti bu sekme açıldıktan sonra yüklendi.',
    reloadTab: 'Sekmeyi yenile',
    reloadedTitle: 'Yenilendi',
    reloadedText: 'Bir içerik aç, sonra eklentiyi tekrar aç.',
    errorTitle: 'Bir sorun oldu',
    emptyTitle: 'Henüz içerik yok',
    emptyIg: 'Bir hikaye, post ya da reel aç; burada görünür.',
    emptyTt: 'Bir video izle; burada görünür.',
    downloading: 'İndiriliyor…',
    doneMany: n => `${n} dosya indirildi`,
    errPrefix: 'Hata: ',
    kinds: { story: 'Story', post: 'Post', reel: 'Reel', album: 'Albüm', video: 'Video', photo: 'Foto' },
    errors: { NO_BRIDGE: 'sekmeyi yenile', NOT_FOUND: 'içerik bulunamadı', TIMEOUT: 'sayfa yanıt vermedi', UNKNOWN_CMD: 'bilinmeyen komut', NO_RESPONSE: 'yanıt yok' }
  },
  en: {
    recent: 'Recently viewed',
    recentHere: 'Recently viewed in this tab',
    recentOther: 'Recently viewed in another tab',
    refresh: '↻ Refresh',
    refreshTitle: 'Refresh',
    noTabTitle: name => `No open ${name} tab`,
    noTabText: name => `Open ${name}, view something, then come back here.`,
    open: name => `Open ${name}`,
    notReadyTitle: 'Tab not ready',
    notReadyText: 'The extension was loaded after this tab was opened.',
    reloadTab: 'Reload tab',
    reloadedTitle: 'Reloaded',
    reloadedText: 'Open some content, then reopen the extension.',
    errorTitle: 'Something went wrong',
    emptyTitle: 'Nothing here yet',
    emptyIg: 'Open a story, post or reel and it will show up here.',
    emptyTt: 'Watch a video and it will show up here.',
    downloading: 'Downloading…',
    doneMany: n => `${n} files downloaded`,
    errPrefix: 'Error: ',
    kinds: { story: 'Story', post: 'Post', reel: 'Reel', album: 'Album', video: 'Video', photo: 'Photo' },
    errors: { NO_BRIDGE: 'reload the tab', NOT_FOUND: 'content not found', TIMEOUT: 'page did not respond', UNKNOWN_CMD: 'unknown command', NO_RESPONSE: 'no response' }
  }
};

const grid = document.getElementById('grid');
const foot = document.getElementById('foot');
const hint = document.getElementById('hint');
const refreshBtn = document.getElementById('refresh');
let platform = 'instagram';
let lang = 'en';
let tab = null;
let lastRender = null;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
};

const T = () => I18N[lang];
const errText = e => T().errors[e] || e;

function setLang(l) {
  lang = I18N[l] ? l : 'en';
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.l === lang)));
  refreshBtn.textContent = T().refresh;
  refreshBtn.title = T().refreshTitle;
  store.set('lang', lang);
}

function setPlatform(p) {
  platform = p;
  document.body.dataset.p = p;
  document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.p === p)));
  store.set('platform', p);
}

function message(title, text, btnLabel, onClick) {
  grid.innerHTML = '';
  const m = document.createElement('div');
  m.className = 'msg';
  const b = document.createElement('b');
  b.textContent = title;
  m.appendChild(b);
  m.appendChild(document.createTextNode(text));
  if (btnLabel) {
    const btn = document.createElement('button');
    btn.textContent = btnLabel;
    btn.addEventListener('click', onClick);
    m.appendChild(document.createElement('br'));
    m.appendChild(btn);
  }
  grid.appendChild(m);
}

function skeleton() {
  grid.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
}

async function findTab(p) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && SITES[p].test.test(active.url || '')) return active;
  const tabs = await chrome.tabs.query({ url: SITES[p].pattern });
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return tabs[0] || null;
}

function send(cmd, key) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { smd: true, cmd, key }, res => {
      if (chrome.runtime.lastError) resolve({ error: 'NO_BRIDGE' });
      else resolve(res || { error: 'NO_RESPONSE' });
    });
  });
}

function card(item) {
  const c = document.createElement('button');
  c.className = 'card';
  c.title = [item.user ? '@' + item.user : '', item.caption].filter(Boolean).join(' — ');
  if (item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    c.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.textContent = item.video ? '▶' : '▣';
    c.appendChild(ph);
  }
  const shade = document.createElement('div');
  shade.className = 'shade';
  c.appendChild(shade);
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = T().kinds[item.kind] || item.kind;
  c.appendChild(badge);
  if (item.count > 1) {
    const n = document.createElement('span');
    n.className = 'count';
    n.textContent = '×' + item.count;
    c.appendChild(n);
  }
  const u = document.createElement('span');
  u.className = 'user';
  u.textContent = item.user ? '@' + item.user : '';
  c.appendChild(u);
  const st = document.createElement('div');
  st.className = 'state';
  c.appendChild(st);

  c.addEventListener('click', async () => {
    if (c.dataset.s === 'busy') return;
    c.dataset.s = 'busy';
    foot.textContent = T().downloading;
    const res = await send('download', item.key);
    if (res.ok) {
      c.dataset.s = 'ok';
      foot.textContent = res.files.length > 1 ? T().doneMany(res.files.length) : res.files[0];
    } else {
      c.dataset.s = 'err';
      foot.textContent = T().errPrefix + errText(res.error);
    }
    setTimeout(() => { delete c.dataset.s; }, 2500);
  });
  return c;
}

function render(state) {
  lastRender = state;
  const t = T();
  const site = SITES[platform];
  hint.textContent = state.hint ? t[state.hint] : t.recent;
  switch (state.type) {
    case 'noTab':
      message(t.noTabTitle(site.name), t.noTabText(site.name), t.open(site.name), () => chrome.tabs.create({ url: site.home }));
      break;
    case 'notReady':
      message(t.notReadyTitle, t.notReadyText, t.reloadTab, async () => {
        await chrome.tabs.reload(tab.id);
        render({ type: 'reloaded', hint: state.hint });
      });
      break;
    case 'reloaded':
      message(t.reloadedTitle, t.reloadedText);
      break;
    case 'error':
      message(t.errorTitle, errText(state.error));
      break;
    case 'empty':
      message(t.emptyTitle, platform === 'instagram' ? t.emptyIg : t.emptyTt);
      break;
    case 'items':
      grid.innerHTML = '';
      state.items.forEach(it => grid.appendChild(card(it)));
      break;
  }
}

async function load() {
  foot.textContent = '';
  skeleton();
  tab = await findTab(platform);
  if (!tab) return render({ type: 'noTab' });
  const h = tab.active ? 'recentHere' : 'recentOther';
  const res = await send('list');
  if (res.error === 'NO_BRIDGE') return render({ type: 'notReady', hint: h });
  if (res.error) return render({ type: 'error', error: res.error, hint: h });
  if (!res.items || !res.items.length) return render({ type: 'empty', hint: h });
  render({ type: 'items', items: res.items, hint: h });
}

document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.p === platform) return;
  setPlatform(b.dataset.p);
  load();
}));
document.querySelectorAll('.lang button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.l === lang) return;
  setLang(b.dataset.l);
  foot.textContent = '';
  if (lastRender) render(lastRender);
}));
refreshBtn.addEventListener('click', load);

(async () => {
  const ui = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'en';
  setLang(store.get('lang') || (/^tr/i.test(ui) ? 'tr' : 'en'));
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (active && active.url) || '';
  const p = SITES.tiktok.test.test(url) ? 'tiktok' : SITES.instagram.test.test(url) ? 'instagram' : (store.get('platform') || 'instagram');
  setPlatform(p);
  load();
})();
