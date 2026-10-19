/*
 * Quora Ad Shield — test battery.
 * Boots the real rules.js + cosmetic.js inside a jsdom window and attacks
 * the engine from every angle: hiding, false positives, climbing guards,
 * toggles, counters, observers, the login-wall heuristic, and file lint.
 *
 * Run: npm install && npm test
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const rulesSrc = read('rules.js');
const cosmeticSrc = read('cosmetic.js');

const BASE_HTML = '<!doctype html><html><head></head><body></body></html>';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function makeWindow() {
  return new JSDOM(BASE_HTML, {
    url: 'https://www.quora.com/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
}

async function boot(dom) {
  dom.window.eval(rulesSrc);
  dom.window.eval(cosmeticSrc);
  await dom.window.QAS.ready;
  return dom.window.QAS;
}

/* wrap: build a feed item like Quora's DOM */
function feedItem(win, innerHtml, extraClass) {
  const d = win.document.createElement('div');
  d.className = 'pagedlist_item' + (extraClass ? ' ' + extraClass : '');
  d.innerHTML = innerHtml;
  win.document.body.appendChild(d);
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async function main() {
  console.log('Quora Ad Shield — test battery\n');

  /* ---- T01 rules pack integrity ---- */
  {
    const dom = makeWindow();
    const w = dom.window;
    w.eval(rulesSrc);
    const R = w.QAS_RULES;
    ok(!!R && R.version === '1.0.0', 'T01a rules pack loads with version');
    ok(Object.keys(R.modules).length >= 9, 'T01b nine modules present', String(Object.keys(R.modules).length));
    let bad = [];
    for (const id of Object.keys(R.modules)) {
      const m = R.modules[id];
      for (const sel of (m.cssSelectors || []).concat(m.jsSelectors || [])) {
        try { w.document.querySelector(sel); } catch (e) { bad.push(id + ':' + sel); }
      }
      for (const p of (m.patterns || [])) {
        try { new RegExp(p, 'i'); } catch (e) { bad.push(id + ':/' + p + '/'); }
      }
    }
    ok(bad.length === 0, 'T01c every selector and pattern compiles', bad.join(', '));
  }

  /* ---- T02 static ads CSS injected ---- */
  {
    const dom = makeWindow();
    const QAS = await boot(dom);
    const w = dom.window;
    const style = w.document.querySelector('style[data-qas-module="ads"]');
    ok(!!style, 'T02a ads module stylesheet injected');
    ok(style && style.textContent.includes('.dom_annotate_google_ad'), 'T02b marker selector in stylesheet');
    ok(!!w.document.getElementById('qas-core'), 'T02c core stylesheet injected');
    ok(w.QAS_BOOTED === true, 'T02d boot guard flag set');
    // double injection is a no-op
    w.eval(cosmeticSrc);
    ok(w.QAS.version === QAS.version, 'T02e second boot is a no-op (guard)');
  }

  /* ---- T03-T07 label variants hide the feed item ---- */
  const labelCases = [
    ['Promoted by Acme Corp', 'T03 promoted-by label'],
    ['Sponsored', 'T04a bare Sponsored label'],
    ['Sponsored by BigCo', 'T04b sponsored-by label'],
    ['Ad', 'T05a bare Ad label'],
    ['Ad by Quora for Business', 'T05b ad-by label'],
    ['PROMOTED   BY   SHOUTY   INC', 'T06 case/space normalization'],
    ['Paid for by Someone', 'T07a paid-for-by label'],
    ['Presented by Sponsor', 'T07b presented-by label']
  ];
  for (const [label, name] of labelCases) {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const item = feedItem(w, '<div class="q-box"><div><span class="q-text">' + label + '</span></div></div>');
    w.QAS.fullScan();
    ok(item.classList.contains('qas-hidden'), name);
  }

  /* ---- T08 false positives must NOT hide ---- */
  const fpCases = [
    ['I saw an ad once and it was strange', 'T08a prose mention of ad'],
    ['Sponsored content is evil', 'T08b "Sponsored content is evil"'],
    ['Promoted by me.', 'T08c label with sentence punctuation'],
    ['The promoted answers on this site are out of control lately and everyone complains', 'T08d long prose starting with promoted']
  ];
  for (const [text, name] of fpCases) {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const item = feedItem(w, '<div class="q-box"><div><span class="q-text">' + text + '</span></div></div>');
    w.QAS.fullScan();
    ok(!item.classList.contains('qas-hidden'), name);
  }

  /* ---- T09 climb: hides the feed item, not the label's parent div ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const item = feedItem(w, '<div class="q-box"><div><div><span>Sponsored</span></div></div></div>');
    w.QAS.fullScan();
    const inner = item.querySelector('div');
    ok(item.classList.contains('qas-hidden') && !inner.classList.contains('qas-hidden'),
       'T09 hides resolver-matched feed item, not inner wrapper');
  }

  /* ---- T10 fallback climb with over-block guard ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    // small anonymous wrapper, no resolver anywhere
    const wrap = w.document.createElement('div');
    wrap.innerHTML = '<div><div><div><div><div><div><span>Ad</span></div></div></div></div></div></div>';
    w.document.body.appendChild(wrap);
    w.QAS.fullScan();
    ok(wrap.classList.contains('qas-hidden'), 'T10a fallback climb hides outermost small wrapper');
    // giant content near the label: guard must refuse
    const big = w.document.createElement('div');
    big.innerHTML = '<div><div><div><div><div><div><span>Ad</span></div></div></div></div></div></div><p>' +
      'word '.repeat(1200) + '</p>';
    w.document.body.appendChild(big);
    w.QAS.fullScan();
    ok(!big.classList.contains('qas-hidden'), 'T10b over-block guard: huge container survives');
  }

  /* ---- T11 marker classes hide via jsSelectors ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const a = feedItem(w, 'x', 'dom_annotate_google_ad');
    const b = feedItem(w, 'y', 'dom_annotate_multifeed_bundle_AdBundle_123');
    const c = w.document.createElement('div');
    c.id = 'div-gpt-ad-15713';
    c.textContent = 'gpt';
    w.document.body.appendChild(c);
    w.QAS.fullScan();
    ok(a.classList.contains('qas-hidden') && b.classList.contains('qas-hidden') &&
       c.classList.contains('qas-hidden'), 'T11 marker classes + GPT slot hidden and counted');
    ok((w.QAS.state.counts.ads || 0) >= 3, 'T11b ads counter incremented');
  }

  /* ---- T12 spam module ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const s1 = feedItem(w, '<a class="dom_annotate_question_link">Where can I find hot girls pics?</a>');
    const s2 = feedItem(w, '<a>Watch Free Full Movie Online HD now</a>');
    const s3 = feedItem(w, '<a>How do hot water heaters work?</a>');
    const s4 = feedItem(w, '<a>What is the history of advertising?</a>');
    w.QAS.fullScan();
    ok(s1.classList.contains('qas-hidden'), 'T12a sexual bait question hidden');
    ok(s2.classList.contains('qas-hidden'), 'T12b piracy/free-movie bait hidden');
    ok(!s3.classList.contains('qas-hidden'), 'T12c "hot water heaters" NOT hidden (negative)');
    ok(!s4.classList.contains('qas-hidden'), 'T12d ordinary question NOT hidden');
    // question page with tons of content under the title: guard refuses to hide
    const page = w.document.createElement('div');
    page.innerHTML = '<div><div><div><div><div><div><div><div><div><a>Hot girls pics?</a></div></div></div></div></div></div></div></div></div><p>' +
      'text '.repeat(3000) + '</p>';
    w.document.body.appendChild(page);
    w.QAS.fullScan();
    ok(!page.classList.contains('qas-hidden'), 'T12e spam title on a full question page NOT nuked (guard)');
  }

  /* ---- T13 nuisance modules ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const up = feedItem(w, '<div><span>Try Quora+</span></div>');
    const adfree = feedItem(w, '<div><span>Go Ad-Free</span></div>');
    const fol = feedItem(w, '<div><span>Spaces to follow</span></div>');
    const peo = feedItem(w, '<div><span>People to follow</span></div>');
    const earn = feedItem(w, '<div><span>Earn money writing answers</span></div>');
    const app = feedItem(w, '<div><span>Open in app</span></div>');
    const prompt = feedItem(w, '<div><span>Answer these questions</span></div>');
    w.QAS.fullScan();
    ok(up.classList.contains('qas-hidden') && adfree.classList.contains('qas-hidden'), 'T13a Quora+ upsells hidden');
    ok(fol.classList.contains('qas-hidden') && peo.classList.contains('qas-hidden'), 'T13b follow suggestions hidden');
    ok(earn.classList.contains('qas-hidden'), 'T13c monetization nag hidden');
    ok(app.classList.contains('qas-hidden'), 'T13d app nag hidden');
    ok(prompt.classList.contains('qas-hidden'), 'T13e prompt card hidden');
    ok((w.QAS.state.counts.quoraPlus || 0) >= 2 && (w.QAS.state.counts.followSugs || 0) >= 2,
       'T13f per-module counters correct');
  }

  /* ---- T14 related answers filter ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const rel = w.document.createElement('div');
    rel.className = 'q-box dom_annotate_question_answer_item_2384728';
    rel.innerHTML = '<div class="q-box qu-mb--tiny"><span class="q-inline qu-mr--tiny">x</span></div>';
    w.document.body.appendChild(rel);
    const real = w.document.createElement('div');
    real.className = 'q-box dom_annotate_question_answer_item_9911';
    real.innerHTML = '<div class="q-box qu-p--medium"><span class="q-text">A genuine answer</span></div>';
    w.document.body.appendChild(real);
    w.QAS.fullScan();
    ok(rel.classList.contains('qas-hidden'), 'T14a related-answers item hidden');
    ok(!real.classList.contains('qas-hidden'), 'T14b genuine answer item NOT hidden');
  }

  /* ---- T15 login wall heuristic + scroll unlock ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    w.document.body.style.overflow = 'hidden';
    const wall = w.document.createElement('div');
    wall.style.position = 'fixed';
    wall.style.width = '100%';
    wall.style.height = '100%';
    wall.innerHTML = '<div><h2>Sign up to continue reading</h2><button>Sign up</button></div>';
    w.document.body.appendChild(wall);
    w.QAS.fullScan();
    ok(wall.classList.contains('qas-hidden'), 'T15a login-wall overlay hidden');
    ok(w.document.body.style.overflow === '', 'T15b page scroll unlocked');
    // a fixed chat/toast widget with no auth text must NOT be touched
    const toast = w.document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.width = '100%';
    toast.style.height = '100%';
    toast.innerHTML = '<div><h2>Update available</h2><button>Reload</button></div>';
    w.document.body.appendChild(toast);
    w.QAS.fullScan();
    ok(!toast.classList.contains('qas-hidden'), 'T15c non-auth fixed overlay NOT hidden');
  }

  /* ---- T16 module toggle off/on ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const item = feedItem(w, '<div class="q-box"><span>Promoted by Acme</span></div>');
    w.QAS.fullScan();
    ok(item.classList.contains('qas-hidden'), 'T16a hidden before toggle');
    w.QAS.setModule('ads', false);
    ok(!item.classList.contains('qas-hidden'), 'T16b visible after module off');
    w.QAS.setModule('ads', true);
    ok(item.classList.contains('qas-hidden'), 'T16c hidden again after module on (memo cleared)');
  }

  /* ---- T17 pause everything ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    const item = feedItem(w, '<div class="q-box"><span>Promoted by Acme</span></div>');
    w.QAS.fullScan();
    w.QAS.setPaused(true);
    ok(!item.classList.contains('qas-hidden'), 'T17a pause unhides everything');
    const fresh = feedItem(w, '<div class="q-box"><span>Promoted by Other</span></div>');
    w.QAS.fullScan();
    ok(!fresh.classList.contains('qas-hidden'), 'T17b paused engine hides nothing new');
    w.QAS.setPaused(false);
    ok(item.classList.contains('qas-hidden') && fresh.classList.contains('qas-hidden'),
       'T17c resume re-hides');
  }

  /* ---- T18 counters + idempotency ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    feedItem(w, '<div class="q-box"><span>Promoted by Acme</span></div>');
    w.QAS.fullScan();
    const c1 = w.QAS.state.counts.ads;
    w.QAS.fullScan();
    w.QAS.fullScan();
    ok(w.QAS.state.counts.ads === c1 && c1 >= 1, 'T18 rescans do not double-count');
    w.QAS.resetCounts();
    ok(w.QAS.state.counts.ads === 0, 'T18b reset zeroes counters');
  }

  /* ---- T19 MutationObserver catches late feed items ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    await sleep(50);
    const late = feedItem(w, '<div class="q-box"><span>Promoted by Latecomer</span></div>');
    await sleep(600); // observer debounce is 200ms
    ok(late.classList.contains('qas-hidden'), 'T19 late-injected ad hidden by observer rescan');
  }

  /* ---- T20 persistence fallback (localStorage) ---- */
  {
    const dom = makeWindow();
    await boot(dom);
    const w = dom.window;
    w.QAS.setModule('spam', false);
    w.QAS.setDebug(true);
    const saved = JSON.parse(w.localStorage.getItem('qas-state-v1') || '{}');
    ok(saved.modules && saved.modules.spam === false && saved.debug === true,
       'T20 state persists via fallback store');
  }

  /* ---- T21 manifest lint ---- */
  {
    const m = JSON.parse(read('manifest.json'));
    ok(m.manifest_version === 3, 'T21a manifest v3');
    ok(m.content_scripts[0].matches[0] === '*://*.quora.com/*', 'T21b matches quora only');
    ok(m.permissions.length === 1 && m.permissions[0] === 'storage', 'T21c minimal permissions');
    for (const f of ['rules.js', 'cosmetic.js', 'popup.html', 'popup.js', 'quora-network.txt', 'README.md']) {
      ok(fs.existsSync(path.join(ROOT, f)), 'T21d file present: ' + f);
    }
  }

  /* ---- T22 network list lint ---- */
  {
    const lines = read('quora-network.txt').split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('!'));
    let bad = [];
    for (const l of lines) {
      const okShape = /^\|\|[\w.-]+\^/.test(l) || /^quora\.com##[.\[#\[]?/.test(l);
      if (!okShape) bad.push(l);
    }
    ok(lines.length >= 12 && bad.length === 0, 'T22 network list lines well-formed', bad.join(' | '));
  }

  /* ---- T23 engine API sanity ---- */
  {
    const dom = makeWindow();
    const QAS = await boot(dom);
    const w = dom.window;
    ok(typeof w.QAS.climb === 'function' && typeof w.QAS.snapshot === 'function', 'T23a test/popup API exposed');
    const snap = QAS.snapshot();
    ok(snap.ok === true && snap.version === '1.0.0' && typeof snap.total === 'number', 'T23b snapshot well-formed');
  }

  console.log('\nResult: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
