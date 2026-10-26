chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (!msg || msg.smd !== true) return;
  const id = Math.random().toString(36).slice(2);
  const onMsg = e => {
    if (e.source !== window || !e.data || e.data.source !== 'smd-main' || e.data.id !== id) return;
    window.removeEventListener('message', onMsg);
    clearTimeout(timer);
    send(e.data.result);
  };
  const timer = setTimeout(() => {
    window.removeEventListener('message', onMsg);
    send({ error: 'TIMEOUT' });
  }, msg.cmd === 'download' ? 180000 : 15000);
  window.addEventListener('message', onMsg);
  window.postMessage({ source: 'smd-bridge', id, cmd: msg.cmd, key: msg.key }, '*');
  return true;
});
