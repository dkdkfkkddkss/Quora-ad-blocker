# Quora Ad Shield

A single-purpose content blocker for **quora.com**, built to run as a file-based
WebExtension in **Orion (iOS / iPadOS / macOS)** — the only iOS browser that
accepts Chrome/Firefox-style extensions.

## What it blocks

| Module | Blocks | How |
|---|---|---|
| **Ads & Promoted Answers** | Feed ads, image ads, ad bundles, Google Ad Manager (`div-gpt-ad`) slots, Promoted Answers | Quora's `dom_annotate_*` marker classes + anchored ad-label text matching ("Ad", "Promoted by …", "Sponsored by …") |
| **Related Answers clutter** | Off-topic "Related Answers" injected into threads | Community-verified container+inner filter, engine-implemented (no uBO needed) |
| **Question prompts** | "Answer these questions" feed cards | CSS + text patterns |
| **Quora+ upsells** | Try Quora+, Go ad-free, Upgrade banners | Text patterns |
| **Follow suggestions** | People/Spaces/Topics to follow cards | Text patterns |
| **Monetization nags** | Earn money / partner program invites | Text patterns |
| **App nags** | Open in app / download banners | Text patterns |
| **Spam / sexual bait** | Classic spam questions (hot/sexy/nudes bait, free-porn and piracy bait, DM spam) | Question-title patterns, feed items only |
| **Login wall** | Signup overlay + page scroll lock | Class candidates + fixed-overlay heuristic. *Cannot recover answers the server never sent.* |

Every module has an on/off toggle and a per-module counter in the popup.
**Debug mode** shows would-be-hidden items outlined in red instead of hiding
them — use it to check for false positives before trusting a new rules version.

## Install (Orion)

1. Put these files in a GitHub repo (or any folder), download as ZIP, unzip.
2. Orion → Settings → Extensions → enable **Chrome or Firefox extensions**.
3. ••• → Extensions → **+** → file-based → select the extension
   (manifest.json — the file Orion asks for in your usual flow).
4. Optional but recommended (network layer): add `quora-network.txt` as a
   custom blocklist — Settings → Content Blockers → Manage → Add New → paste a
   raw URL to it (e.g. your repo's raw GitHub URL).

The extension is self-contained: no remote code, no network requests, no
analytics. `permissions` is `storage` only (with a localStorage fallback if
Orion's iOS storage API is unavailable).

## Tuning

All rules live in **`rules.js`** (data only — no logic to break):

- Add a label pattern → `modules.ads.patterns` (regex source, case-insensitive)
- Add a marker selector → `modules.ads.cssSelectors` (fast path) and
  `jsSelectors` (counted path)
- Make spam filtering milder → trim `modules.spam.patterns`
- Bump `version` + `updated` when you change rules

Selector philosophy: trust `dom_annotate_*` semantic classes and ad-label text;
distrust hashed/`q-*` utility classes (they churn every redesign — Quora has
cycled class schemes at least three times since 2017).

## Tests

```
npm install        # dev-only: jsdom
npm test           # runs tests/run-tests.js (25 checks)
```

The suite boots the real engine in a DOM and verifies: label hiding across
patterns, false-positive guards (prose, "Sponsored content is evil"), ancestor
climbing with the over-block guard, spam filtering (incl. the "hot water
heaters" negative), module toggling/unhiding, counters, idempotency,
MutationObserver-driven rescans, login-wall heuristic + scroll unlock,
manifest and network-list lint.

## Honest limitations

- **First-party ad endpoints**: the commented block at the bottom of
  `quora-network.txt` must be completed from Orion's network log on your
  device — blocking guessed quora.com paths can break login/feed.
- **Login wall**: hides the overlay and unlocks scroll; it cannot restore
  content Quora never sent to logged-out users.
- **Orion iOS is beta**: extension APIs have regressed between releases before
  (Violentmonkey, background fetch). If the extension stops working after an
  Orion update, toggle it off/on, and re-file against Kagi's API sheet.
- **Unverified selectors**: selectors not marked "verified" in `rules.js`
  comments are best-effort from community history; enable Debug mode after
  install and skim a feed page.

## Credits

Ad-label patterns and marker classes derive from the public uBlock Origin
community filter history for quora.com (r/uBlockOrigin threads 2018–2024,
uAssets issues #2937, #3683, #9883, #26768). Original code, MIT-style: do
whatever you want with it.
