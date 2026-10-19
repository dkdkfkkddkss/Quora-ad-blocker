/* Quora Ad Shield — popup UI */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  let tabId = null;

  function warn(msg) {
    const w = $('#warn');
    w.hidden = false;
    w.textContent = msg;
  }

  function send(msg) {
    return new Promise((resolve) => {
      if (tabId === null) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, msg, (r) => {
          const err = chrome.runtime.lastError; // swallow "no receiver"
          resolve(r && r.ok ? r : null);
        });
      } catch (e) { resolve(null); }
    });
  }

  async function activeTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] ? tabs[0] : null;
    } catch (e) { return null; }
  }

  function render(snap) {
    $('#ver').textContent = 'v' + snap.version + ' · rules ' + snap.updated;
    const wrap = $('#modules');
    wrap.textContent = '';
    for (const id of Object.keys(snap.modules)) {
      const meta = snap.meta[id] || { label: id, desc: '' };
      const row = document.createElement('label');
      row.className = 'row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!snap.modules[id];
      cb.addEventListener('change', () => send({ type: 'QAS_SET_MODULE', id, enabled: cb.checked }).then(refresh));
      const t = document.createElement('div');
      t.className = 't';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = meta.label;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = meta.desc;
      t.appendChild(name); t.appendChild(desc);
      const count = document.createElement('div');
      const n = snap.counts[id] || 0;
      count.className = 'count' + (n ? '' : ' zero');
      count.textContent = n > 999 ? '999+' : String(n);
      count.title = n + ' hidden';
      row.appendChild(cb); row.appendChild(t); row.appendChild(count);
      wrap.appendChild(row);
    }
    $('#total').textContent = snap.total + ' items hidden (all time on this device)';
    const dbg = $('#btn-debug');
    dbg.textContent = 'Debug: ' + (snap.debug ? 'on' : 'off');
    dbg.classList.toggle('on', !!snap.debug);
    const pau = $('#btn-pause');
    pau.textContent = snap.paused ? 'Resume blocking' : 'Pause all blocking';
    pau.classList.toggle('on', !!snap.paused);
  }

  async function refresh() {
    const snap = await send({ type: 'QAS_GET_STATE' });
    if (!snap) {
      warn('No Quora tab active. Open quora.com, then reopen this popup.');
      return;
    }
    render(snap);
  }

  $('#btn-debug').addEventListener('click', async () => {
    const snap = await send({ type: 'QAS_GET_STATE' });
    if (!snap) return;
    await send({ type: 'QAS_SET_DEBUG', enabled: !snap.debug });
    refresh();
  });

  $('#btn-reset').addEventListener('click', async () => {
    await send({ type: 'QAS_RESET_COUNTS' });
    refresh();
  });

  $('#btn-pause').addEventListener('click', async () => {
    const snap = await send({ type: 'QAS_GET_STATE' });
    if (!snap) return;
    await send({ type: 'QAS_SET_PAUSED', enabled: !snap.paused });
    refresh();
  });

  (async function init() {
    const tab = await activeTab();
    if (!tab || !tab.id) {
      warn('Cannot reach tabs in this browser. The extension still runs on Quora pages.');
      return;
    }
    tabId = tab.id;
    if (tab.url && !/quora\.com/.test(tab.url)) {
      warn('Active tab is not on quora.com — controls below apply to Quora tabs.');
    }
    refresh();
  })();
})();
