/*
 * Quora Ad Shield — cosmetic engine.
 * Runs at document_start on *.quora.com. No remote code, no network requests,
 * no dependencies. Feature-detects chrome.* APIs so it degrades gracefully
 * (Orion iOS beta) and can run under test harnesses.
 */
(() => {
  'use strict';

  if (globalThis.QAS_BOOTED) return; // double-injection guard
  globalThis.QAS_BOOTED = true;

  const R = globalThis.QAS_RULES;
  if (!R) return;

  const HIDDEN = 'qas-hidden';
  const DEBUG_BODY = 'qas-debug-mode';
  const COUNT_FLUSH_MS = 1200;

  /* ------------------------------------------------------------------ */
  /* storage: chrome.storage.local if available, else localStorage        */
  /* ------------------------------------------------------------------ */
  const hasChromeStorage =
    typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local;

  const store = {
    get(defaults) {
      return new Promise((resolve) => {
        if (hasChromeStorage) {
          try {
            chrome.storage.local.get(defaults, (r) => resolve(r || {}));
            return;
          } catch (e) { /* fall through */ }
        }
        const out = {};
        try {
          const saved = JSON.parse(localStorage.getItem(R.storageKey) || '{}');
          for (const k of Object.keys(defaults)) {
            if (k in saved && saved[k] !== null && saved[k] !== undefined) out[k] = saved[k];
          }
        } catch (e) { /* fresh profile */ }
        resolve(out);
      });
    },
    set(obj) {
      return new Promise((resolve) => {
        if (hasChromeStorage) {
          try { chrome.storage.local.set(obj, () => resolve()); return; } catch (e) { /* fall */ }
        }
        try {
          const saved = JSON.parse(localStorage.getItem(R.storageKey) || '{}');
          Object.assign(saved, obj);
          localStorage.setItem(R.storageKey, JSON.stringify(saved));
        } catch (e) { /* storage blocked */ }
        resolve();
      });
    }
  };

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */
  const state = {
    modules: {},
    debug: false,
    paused: false,
    counts: {},
    bootedAt: Date.now()
  };
  for (const id of Object.keys(R.modules)) {
    state.modules[id] = !!R.modules[id].on;
    state.counts[id] = 0;
  }

  /* compiled pattern table */
  const PATTERNS = [];
  for (const id of Object.keys(R.modules)) {
    const mod = R.modules[id];
    if (!mod.patterns) continue;
    const target = mod.target && R.targets[mod.target] ? R.targets[mod.target] : R.targets.default;
    const maxLen = mod.maxLen || 60;
    for (const p of mod.patterns) {
      try { PATTERNS.push({ re: new RegExp(p, 'i'), module: id, target, maxLen, source: p }); }
      catch (e) { /* bad rule — skip rather than break the page */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  const normText = (s) => (s || '').replace(/\s+/g, ' ').trim();

  function climb(el) {
    // 1) nearest ancestor matching a feed-item resolver
    let node = el.parentElement;
    let steps = 0;
    while (node && node !== document.body && steps < R.ancestor.maxClimb) {
      for (const sel of R.ancestor.resolvers) {
        try { if (node.matches(sel)) return node; } catch (e) { /* bad selector */ }
      }
      node = node.parentElement;
      steps++;
    }
    // 2) fallback: the outermost SMALL ancestor within fallbackDepth.
    //    Containers holding lots of content are never hidden (over-block guard):
    //    a label sitting near a wall of text can at worst lose its own tiny wrapper.
    node = el.parentElement;
    steps = 0;
    let best = null;
    while (node && node !== document.body && node !== document.documentElement &&
           steps < R.ancestor.fallbackDepth) {
      if (normText(node.textContent).length <= R.ancestor.fallbackMaxText) best = node;
      node = node.parentElement;
      steps++;
    }
    return best;
  }

  function hide(node, moduleId, reason) {
    if (!node || node === document.body || node === document.documentElement) return false;
    if (state.paused || !state.modules[moduleId]) return false;
    if (node.classList.contains(HIDDEN)) return false;
    node.classList.add(HIDDEN);
    node.dataset.qasModule = moduleId;
    node.dataset.qasReason = reason || '';
    state.counts[moduleId] = (state.counts[moduleId] || 0) + 1;
    scheduleFlush();
    if (state.debug) {
      try { console.info('[QAS] hid', moduleId, reason, node); } catch (e) {}
    }
    return true;
  }

  function unhideModule(id) {
    let touched = 0;
    let roots;
    try { roots = document.querySelectorAll('[data-qas-module="' + id + '"]'); } catch (e) { return 0; }
    roots.forEach((node) => {
      node.classList.remove(HIDDEN);
      delete node.dataset.qasModule;
      delete node.dataset.qasReason;
      // clear label memos inside so re-enabling can re-match
      node.querySelectorAll('[data-qas-seen]').forEach((m) => { delete m.dataset.qasSeen; });
      touched++;
    });
    return touched;
  }

  /* ------------------------------------------------------------------ */
  /* pattern scan (ad labels, nuisance cards, spam questions)            */
  /* ------------------------------------------------------------------ */
  function scanPatterns(root) {
    if (state.paused) return;
    const candidates = new Set();

    for (const p of PATTERNS) {
      if (!state.modules[p.module]) continue;
      let walker;
      try {
        walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      } catch (e) { continue; }
      candidates.clear();
      let tn;
      while ((tn = walker.nextNode())) {
        const raw = tn.nodeValue || '';
        if (!raw || raw.trim().length === 0 || raw.trim().length > p.maxLen) continue;
        let el = tn.parentElement;
        let up = 0;
        while (el && el !== document.body && up < R.engine.chainUp) {
          if (!candidates.has(el)) {
            let ok = false;
            try { ok = el.matches(p.target); } catch (e2) { ok = false; }
            if (ok) candidates.add(el);
          }
          el = el.parentElement;
          up++;
        }
      }
      for (const el of candidates) {
        if (el.dataset.qasSeen) continue;
        const t = normText(el.textContent);
        if (!t || t.length > p.maxLen) continue;
        if (!p.re.test(t)) continue;
        const target = climb(el);
        if (target) hide(target, p.module, 'pattern:' + p.source);
        el.dataset.qasSeen = '1';
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* selector scans (markers, related-answers filters)                   */
  /* ------------------------------------------------------------------ */
  function scanJsSelectors(root) {
    if (state.paused) return;
    for (const id of Object.keys(R.modules)) {
      if (!state.modules[id]) continue;
      const mod = R.modules[id];
      if (mod.jsSelectors) {
        for (const sel of mod.jsSelectors) {
          let els;
          try { els = root.querySelectorAll(sel + ':not(.' + HIDDEN + ')'); } catch (e) { continue; }
          els.forEach((el) => hide(el, id, 'selector:' + sel));
        }
      }
      if (mod.jsFilters) {
        for (const f of mod.jsFilters) {
          let containers;
          try { containers = root.querySelectorAll(f.container + ':not(.' + HIDDEN + ')'); } catch (e) { continue; }
          containers.forEach((c) => {
            let inner = null;
            try { inner = c.querySelector(f.inner); } catch (e2) {}
            if (inner) hide(c, id, 'filter:' + f.container);
          });
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* login wall: hide overlay + unlock scroll                           */
  /* ------------------------------------------------------------------ */
  function unlockScroll() {
    try {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    } catch (e) {}
  }

  function looksLikeWall(el, h) {
    try {
      const cs = getComputedStyle(el);
      const fixed = cs.position === 'fixed' || cs.position === 'absolute';
      if (!fixed) return false;
      const big = (parseFloat(cs.width) > 200 || /100%/.test(cs.width)) &&
                  (parseFloat(cs.height) > 200 || /100%/.test(cs.height) || /100vh/.test(cs.height));
      if (!big) return false;
    } catch (e) { return false; }
    const text = normText(el.textContent);
    if (!text || text.length > h.maxText) return false;
    if (!h.mustMatch.test(text)) return false;
    if (h.needsButton && el.querySelectorAll('button, a[href]').length === 0) return false;
    return true;
  }

  function scanWalls(root) {
    if (state.paused || !state.modules.wall) return;
    const mod = R.modules.wall;
    let els = [];
    for (const sel of mod.cssCandidates) {
      try { els = els.concat(Array.from(root.querySelectorAll(sel))); } catch (e) {}
    }
    // heuristic sweep of generic divs for full-screen auth overlays
    try {
      const divs = root.querySelectorAll('div, section');
      for (const d of divs) {
        if (d.closest && d.closest('.' + HIDDEN)) continue;
        if (els.indexOf(d) === -1) els.push(d);
      }
    } catch (e) {}
    let hid = 0;
    for (const el of els) {
      if (el.classList.contains(HIDDEN)) continue;
      const isCandidate = mod.cssCandidates.some((sel) => {
        try { return el.matches(sel); } catch (e) { return false; }
      });
      if (!isCandidate && !looksLikeWall(el, mod.heuristic)) continue;
      if (isCandidate || looksLikeWall(el, mod.heuristic)) {
        if (hide(el, 'wall', 'login-wall')) hid++;
      }
    }
    if (hid) unlockScroll();
  }

  /* ------------------------------------------------------------------ */
  /* scans + observer                                                    */
  /* ------------------------------------------------------------------ */
  function scanRoot(root) {
    scanJsSelectors(root);
    scanPatterns(root);
    scanWalls(root);
  }

  function fullScan() {
    try { scanRoot(document); } catch (e) {
      if (state.debug) { try { console.info('[QAS] scan error', e); } catch (e2) {} }
    }
  }

  let pendingScan = null;
  function scheduleScan() {
    if (pendingScan) return;
    pendingScan = setTimeout(() => {
      pendingScan = null;
      fullScan();
    }, R.engine.debounceMs);
  }

  let observer = null;
  function startObserver() {
    const target = document.body || document.documentElement;
    if (!target || observer) return;
    try {
      observer = new MutationObserver(() => scheduleScan());
      observer.observe(target, { childList: true, subtree: true });
    } catch (e) { /* no observer — settle timers still scan */ }
  }

  /* ------------------------------------------------------------------ */
  /* module styles (fast pre-paint CSS for marker-based hiding)           */
  /* ------------------------------------------------------------------ */
  const styleEls = {};

  function applyModuleStyles() {
    for (const id of Object.keys(R.modules)) {
      const mod = R.modules[id];
      if (!mod.cssSelectors || !mod.cssSelectors.length) continue;
      const on = !!state.modules[id] && !state.paused;
      if (on && !styleEls[id]) {
        const st = document.createElement('style');
        st.setAttribute('data-qas-module', id);
        st.textContent = '/* Quora Ad Shield: ' + id + ' */\n' +
          mod.cssSelectors.map((s) => s + '{display:none!important;}').join('\n');
        (document.head || document.documentElement).appendChild(st);
        styleEls[id] = st;
      } else if (!on && styleEls[id]) {
        styleEls[id].remove();
        delete styleEls[id];
      }
    }
  }

  function injectCoreCss() {
    if (document.getElementById('qas-core')) return;
    const st = document.createElement('style');
    st.id = 'qas-core';
    st.textContent =
      '.' + HIDDEN + '{display:none!important;}\n' +
      'body.' + DEBUG_BODY + ' .' + HIDDEN + '{display:block!important;' +
      'outline:3px dashed #ff2d55!important;outline-offset:-3px;opacity:0.6;}\n';
    (document.head || document.documentElement).appendChild(st);
  }

  /* ------------------------------------------------------------------ */
  /* public controls (used by popup + tests)                             */
  /* ------------------------------------------------------------------ */
  function setModule(id, enabled) {
    if (!(id in state.modules)) return false;
    state.modules[id] = !!enabled;
    if (!enabled) unhideModule(id);
    applyModuleStyles();
    store.set({ modules: state.modules });
    fullScan();
    return true;
  }

  function setDebug(on) {
    state.debug = !!on;
    try {
      if (on) document.body.classList.add(DEBUG_BODY);
      else document.body.classList.remove(DEBUG_BODY);
    } catch (e) {}
    store.set({ debug: state.debug });
  }

  function setPaused(on) {
    state.paused = !!on;
    if (on) {
      for (const id of Object.keys(state.modules)) unhideModule(id);
    }
    applyModuleStyles();
    store.set({ paused: state.paused });
    if (!on) fullScan();
  }

  function resetCounts() {
    for (const id of Object.keys(state.counts)) state.counts[id] = 0;
    store.set({ counts: state.counts });
  }

  let flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      store.set({ counts: state.counts, updatedAt: Date.now() });
    }, COUNT_FLUSH_MS);
  }

  function snapshot() {
    const meta = {};
    for (const id of Object.keys(R.modules)) {
      meta[id] = { label: R.modules[id].label, desc: R.modules[id].desc };
    }
    return {
      ok: true,
      version: R.version,
      updated: R.updated,
      modules: state.modules,
      meta,
      counts: state.counts,
      debug: state.debug,
      paused: state.paused,
      total: Object.keys(R.modules).reduce((n, id) => n + state.counts[id], 0)
    };
  }

  /* messaging (popup) */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
        const m = msg || {};
        try {
          if (m.type === 'QAS_GET_STATE') respond(snapshot());
          else if (m.type === 'QAS_SET_MODULE') { setModule(m.id, !!m.enabled); respond(snapshot()); }
          else if (m.type === 'QAS_SET_DEBUG') { setDebug(!!m.enabled); respond(snapshot()); }
          else if (m.type === 'QAS_SET_PAUSED') { setPaused(!!m.enabled); respond(snapshot()); }
          else if (m.type === 'QAS_RESET_COUNTS') { resetCounts(); respond(snapshot()); }
          else respond({ ok: false, error: 'unknown message type' });
        } catch (e) {
          try { respond({ ok: false, error: String(e) }); } catch (e2) {}
        }
      });
    } catch (e) {}
  }

  /* live toggle sync if storage events fire (multi-context) */
  try {
    if (hasChromeStorage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        try {
          if (changes.modules) {
            const mods = changes.modules.newValue || {};
            for (const id of Object.keys(state.modules)) {
              if (id in mods && !!mods[id] !== !!state.modules[id]) setModule(id, !!mods[id]);
            }
          }
        } catch (e) {}
      });
    }
  } catch (e) {}

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */
  function onReady() {
    injectCoreCss();
    applyModuleStyles();
    if (state.debug) { try { document.body.classList.add(DEBUG_BODY); } catch (e) {} }
    startObserver();
    fullScan();
    for (const d of R.engine.settleDelays) setTimeout(fullScan, d);
  }

  const ready = store.get({ modules: null, debug: null, paused: null, counts: null }).then((saved) => {
    if (saved.modules && typeof saved.modules === 'object') {
      for (const id of Object.keys(state.modules)) {
        if (id in saved.modules) state.modules[id] = !!saved.modules[id];
      }
    }
    if (typeof saved.debug === 'boolean') state.debug = saved.debug;
    if (typeof saved.paused === 'boolean') state.paused = saved.paused;
    if (saved.counts && typeof saved.counts === 'object') {
      for (const id of Object.keys(state.counts)) {
        if (typeof saved.counts[id] === 'number') state.counts[id] = saved.counts[id];
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => onReady(), { once: true });
    } else {
      onReady();
    }
  });

  /* test/debug API — also used by the popup indirectly via messaging */
  globalThis.QAS = {
    ready,
    state,
    rules: R,
    fullScan,
    scanRoot,
    hide,
    climb,
    setModule,
    setDebug,
    setPaused,
    resetCounts,
    snapshot,
    _scheduleScan: scheduleScan
  };
})();
