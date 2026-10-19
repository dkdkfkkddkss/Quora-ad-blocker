/*
 * Quora Ad Shield — rules pack (data only, no logic).
 * Edit this file to tune blocking. Bump `version` when you change rules.
 *
 * Selector philosophy, learned from 8 years of uBlock community fights with Quora:
 *  1. `dom_annotate_*` classes are Quora's own internal semantic markers — the most
 *     stable identifiers on the site (they annotate nodes for Quora's own analytics).
 *  2. Ad-label TEXT ("Promoted by", "Sponsored", bare "Ad") is the fallback that
 *     survives every CSS redesign.
 *  3. Generic hashed classes (`CssComponent-sc-*`, `q-box`) churn constantly and are
 *     avoided except as documented legacy.
 */
globalThis.QAS_RULES = {
  version: '1.0.0',
  updated: '2026-10-19',
  storageKey: 'qas-state-v1',

  engine: {
    debounceMs: 200,                       // MutationObserver rescan debounce
    settleDelays: [0, 350, 1200, 3000],    // extra scans after DOM ready (SPA hydration)
    chainUp: 4                             // how far above a text node we test label candidates
  },

  ancestor: {
    /* Ordered selectors that identify a "feed item" boundary. The engine climbs
       from an ad label up the tree and hides at the first match. */
    resolvers: [
      '[class*="dom_annotate_question_answer_item"]',
      '[class*="dom_annotate_feed_item"]',
      '[class*="pagedlist_item"]',
      '[class*="FeedStory"]',
      '[class*="feed_item"]',
      '[class*="multifeed_bundle"]',
      '[class*="dom_annotate_multifeed_bundle"]'
    ],
    maxClimb: 12,        // max ancestor steps when looking for a resolver
    fallbackDepth: 9,    // no resolver matched -> hide this ancestor...
    fallbackMaxText: 4000 // ...but ONLY if its total text is under this (over-broad guard)
  },

  /* Text targets: which elements are eligible for pattern matching per kind */
  targets: {
    default: 'div, span, a, p, h1, h2, h3, h4, h5, h6, button, li, label, strong, em',
    questionish: 'a, [class*="question"], h1, h2, h3, span'
  },

  modules: {
    ads: {
      label: 'Ads & Promoted Answers',
      desc: 'Feed ads, image ads, ad bundles, GPT slots, Promoted Answers',
      on: true,
      maxLen: 40,
      cssSelectors: [
        '.dom_annotate_google_ad',
        '[class*="dom_annotate_google_ad"]',
        '[class*="dom_annotate_ad_image"]',
        '[class*="dom_annotate_multifeed_bundle_Ad"]',
        'div[id^="div-gpt-ad"]',
        '[id^="div-gpt-ad"]',
        '.AdStory',
        '.AdBundle',
        '.HyperLinkBundle',
        '.top_slot',      // legacy (2017) ad slots; harmless if absent
        '.lower_slot'
      ],
      jsSelectors: [
        '.dom_annotate_google_ad',
        '[class*="dom_annotate_google_ad"]',
        '[class*="dom_annotate_ad_image"]',
        '[class*="dom_annotate_multifeed_bundle_Ad"]',
        '[id^="div-gpt-ad"]',
        '.AdStory',
        '.AdBundle',
        '.HyperLinkBundle'
      ],
      /* Anchored, punctuation-guarded label patterns. The [^.:;!?] classes keep
         sentence prose ("Promoted by the way things are going...") from matching. */
      patterns: [
        '^ads?$',
        '^advertisement$',
        '^promoted$',
        '^promoted by [^.:;!?]{2,40}$',
        '^sponsored$',
        '^sponsored by [^.:;!?]{2,40}$',
        '^ad by [^.:;!?]{2,40}$',
        '^paid for by [^.:;!?]{2,40}$',
        '^presented by [^.:;!?]{2,40}$',
        '^by quora for business$'
      ]
    },

    relatedAnswers: {
      label: 'Related Answers clutter',
      desc: 'Hides off-topic "Related Answers" injected into question threads (verified community selector, reimplemented so it works without uBO)',
      on: true,
      /* container + inner filter instead of CSS :has() so it works everywhere
         and gets counted/unhidden properly */
      jsFilters: [
        {
          container: '[class*="dom_annotate_question_answer_item"]',
          inner: '.q-box.qu-mb--tiny .q-inline.qu-mr--tiny'
        }
      ]
    },

    prompts: {
      label: 'Question prompts in feed',
      desc: '"Answer these questions" / "Questions for you" cards',
      on: true,
      maxLen: 60,
      cssSelectors: ['.PromptsList > div:last-child'],
      patterns: [
        '^answer these questions',
        '^questions for you$',
        '^we found questions for you',
        '^questions just for you',
        '^answer this question'
      ]
    },

    quoraPlus: {
      label: 'Quora+ / ad-free upsells',
      desc: 'Try Quora+, Go ad-free, upgrade banners',
      on: true,
      maxLen: 60,
      patterns: [
        '^try quora\\+?$',
        '^(go|get) ad[- ]?free$',
        '^ad[- ]free browsing$',
        '^upgrade( to quora\\+?)?$',
        '^quora\\+$',
        '^remove ads on quora$'
      ]
    },

    followSugs: {
      label: 'Follow suggestions',
      desc: 'People/Spaces/Topics to follow cards',
      on: true,
      maxLen: 60,
      patterns: [
        '^(people|spaces|topics) to follow$',
        '^suggested (spaces|people|topics)$',
        '^who to follow$',
        '^recommended (spaces|people)$',
        '^discover (new )?(spaces|people|topics)$',
        '^find (spaces|people) to follow$'
      ]
    },

    earnMoney: {
      label: 'Monetization nags',
      desc: 'Earn money / partner program invitations',
      on: true,
      maxLen: 60,
      patterns: [
        '^earn money',
        '^get paid to',
        '^quora partner program$',
        '^monetize your content$',
        '^become a paid writer$',
        '^turn your answers into income$'
      ]
    },

    appNag: {
      label: 'App nags',
      desc: 'Open in app / download the app banners',
      on: true,
      maxLen: 60,
      patterns: [
        '^open (the )?app$',
        '^open in app$',
        '^continue in (the )?app$',
        '^get the app$',
        '^use the app$',
        '^download (the )?app$',
        '^quora is better in the app$'
      ]
    },

    spam: {
      label: 'Spam / sexual bait questions',
      desc: 'Classic Quora spam questions (hot/sexy/nudes bait, free-porn/piracy bait, DM spam) — question titles only',
      on: true,
      maxLen: 140,
      target: 'questionish',
      patterns: [
        '\\b(hot|sexy|horny|nude|naked)\\s+(girls?|women|womens?|ladies|teens?|teenagers?|boys?|men|pics?|pictures?|photos?|images?|vids?|videos?|clips?)\\b',
        '\\bfree\\s+(porn|sex\\s+videos?|nudes?)\\b',
        '\\bporn(hub)?\\b',
        '\\bnudes\\b',
        '\\bsex\\s+(chat|stories?|videos?|clips)\\b',
        '(watch|download)[^\\n]{0,50}\\bfree\\b[^\\n]{0,30}\\b(hd|full|online|movie)\\b',
        '\\bdm\\s+me\\b'
      ]
    },

    wall: {
      label: 'Login wall mitigation',
      desc: 'Hides the signup/login overlay and unlocks page scroll. Cannot recover answers the server never sent.',
      on: true,
      cssCandidates: [
        '[class*="login_wall"]',
        '[class*="signup_wall"]',
        '[class*="LoginWall"]',
        '[class*="reg_wall"]',
        '[class*="new_signup_modal"]',
        '[class*="modal_content_inner"]'
      ],
      heuristic: {
        maxText: 600,
        mustMatch: /(sign ?up|log ?in|create (an )?account|continue with)/i,
        needsButton: true
      }
    }
  },

  /* Companion network-layer rules live in quora-network.txt (for Orion's own
     content blocker — see README). Listed here for documentation only. */
  networkDomains: [
    'doubleclick.net',
    'amazon-adsystem.com',
    'btloader.com',
    'googlesyndication.com',
    'googletagservices.com',
    'q.quora.com'
  ]
};
