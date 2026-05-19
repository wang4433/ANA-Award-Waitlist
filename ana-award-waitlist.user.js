// ==UserScript==
// @name         ANA Award Waitlist (THE Room)
// @namespace    https://github.com/wang4433/ANA-Award-Waitlist
// @version      0.1.0
// @description  Auto-waitlist whitelisted ANA Business (THE Room) flights on a chosen date.
// @author       wang4433
// @match        https://aswbe-i.ana.co.jp/*
// @match        https://aswbe.ana.co.jp/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================================
  // 1. CONFIG  — user-edit zone. Flip flags here.
  // ============================================================================
  const CONFIG = {
    // Safety
    DRY_RUN: true,                     // true = log intended clicks but never submit
    CONFIRM_BEFORE_FINAL_SUBMIT: true, // window.confirm() gate before the very last click
    MAX_WAITLISTS_PER_RUN: 5,          // hard cap; script aborts when reached

    // Behavior
    CABIN: 'J',                        // Business class only
    AUTO_RESUME_AFTER_NAV: true,       // when a page loads mid-run, continue the flow

    // Discovery / debugging
    SELECTOR_DISCOVERY_MODE: false,    // dump page DOM info to console on every page
    VERBOSE_LOGGING: true,

    // Timing
    WAIT_FOR_DOM_MS: 8000,             // how long to wait for a selector to appear
    POST_NAV_SETTLE_MS: 1500,          // pause after a navigation before acting
    MAX_STUCK_RETRIES: 3,              // give up on an UNKNOWN page after this many loads
    MAX_STALE_MS: 5 * 60 * 1000,       // dead-man's switch: reset if state is older than this

    // ⚠️  PRIVACY: values here are stored in this script file.  Do NOT commit
    // real personal data if this repo/file is public or shared.  Edit your
    // LOCAL Tampermonkey copy and keep real values OUT of any committed
    // version.  Set a value to '' to skip filling that field.
    USER_INFO: {
      phoneCountryCode: '', // ISO 2-letter; e.g. 'US' = USA/Canada, 'JP' = Japan, 'CN' = China
      phoneNumber: '',      // digits only, no leading 0, no country code
    },

    // THE Room flight whitelist.  Verify against current seasonal deployment.
    // Compare is normalized (uppercase, no spaces, no leading zeros).
    THE_ROOM_WHITELIST: [
      'NH112',                                 // HND-ORD — confirmed THE Room via SHA-ORD test
      'NH9', 'NH10', 'NH11', 'NH12',          // user-supplied seed
      'NH201', 'NH202', 'NH211', 'NH212',     // LHR
      'NH203', 'NH204',                        // LHR alt
      'NH223', 'NH224',                        // FRA
      // Candidates to verify before adding:
      // 'NH105','NH106','NH109','NH110','NH111'
    ],
  };

  // ============================================================================
  // 2. SELECTORS  — placeholders.  Run with SELECTOR_DISCOVERY_MODE=true on
  //    each page, then paste the real selectors here.  Arrays are tried in
  //    order; first match wins.
  // ============================================================================
  const SELECTORS = {
    // Search input page
    // ANA uses JSF, so name="j_idt1080" is auto-generated and renumbers between
    // builds — never rely on it.  Anchor on type+value (English/Japanese UI) or
    // the page-specific class combo.
    searchSubmitButton: [
      'input[type="submit"][value="Search"]',
      'input[type="submit"][value="検索"]',
      'input[type="submit"].btnVerticalMain.btnWidthVariable',
    ],

    // Results page — ANA shows itineraries (not single flights) as divs
    // wrapped in itinModeAvailabilityResult.  To proceed: click the
    // td.selectItineraryCheck inside the target itinerary to select its
    // radio, then click the page-bottom #nextButton to submit.  Itineraries
    // requiring waitlisting show <p class="flagWait">Waitlisted</p>.  The
    // flight-number label is a visually-hidden <label> like
    // "FlightNH972,NH012" — easy to parse and order-stable.
    resultsTable: ['form#searchContentsForm', '#main.noSummaryArea'],
    resultsRow: 'div.itinModeAvailabilityResult',
    resultsRowFlightNumber: 'label[id$="radioItemLabel"]',
    resultsRowWaitlistJButton: 'td.selectItineraryCheck',
    resultsRowWaitlistBadge: 'p.flagWait',
    resultsNextButton: '#nextButton',

    // Multi-step confirmation pages
    paxConfirmMarker: ['#pax-confirm', '.passenger-confirm', '[data-page="passenger"]'],
    paxConfirmNextButton: ['button.next', '#toItinerary', 'input[type="submit"]'],

    // Itinerary review page — shown after clicking Next on results.  ANA pops
    // a "availability may change" modal that must be dismissed before the
    // page-bottom Next button is reachable.  Same #nextButton id as results.
    itineraryMarker: ['form#searchContentsForm', '#main'],
    itineraryFlightNumber: '#main',
    itineraryNextButton: '#nextButton',
    modalConfirmButton: [
      // Discovered selectors get pinned here.  Defensive fallbacks:
      '.cmnModalContents input[type="submit"][value="Confirm"]',
      '[role="dialog"] input[type="submit"][value="Confirm"]',
      '.modalContents input[value="Confirm"]',
      'div[class*="modal" i] input[type="submit"][value="Confirm"]',
      'div[class*="dialog" i] input[type="submit"][value="Confirm"]',
      'div[class*="modal" i] button.btnMainStream',
    ],

    // Mandatory passenger info input page.  Selectors use [id$="..."]
    // attribute-ends-with so they survive JSF's per-passenger index prefix
    // (contactsSms:0:..., contactsSms:1:..., etc).  Currently targets the
    // first passenger only — multi-pax bookings would need iteration.
    personalInfoMarker: ['[id^="contactsSms"]', 'form[id*="mandatoryInfo" i]', 'form[id*="passenger" i]'],
    personalInfoAgreeCheckboxes: ['input.agree[type="checkbox"]', 'input[type="checkbox"][required]'],
    personalInfoPhoneCountrySelect: '[id$=":passengerSmsCountry"]',
    personalInfoPhoneNumberInput: '[id$=":flightStatusNotificationContactPointSmsDescription"]',
    personalInfoNextButton: '#nextButton',
    // After clicking Next, ANA pops a passport-name confirmation modal.
    // The OK button's onclick (Asw.Dialog.callOpener) is what actually
    // submits the waitlist — treat this click as the final submission.
    personalInfoNameConfirmOkButton: [
      'input[aria-controls="prebookConfirmDialog"][value="OK"]',
      '#prebookConfirmDialog input[type="submit"][value="OK"]',
      'input.btnModal.btnMainStream[value="OK"]',
    ],

    finalSubmitButton: ['#finalSubmit', 'button.submit-final', 'input[type="submit"][value*="確定" i]'],
    finalSubmitFlightNumber: ['.flt-num', '.flight-number', '[data-flight-no]'],

    successMarker: ['.booking-complete', '#success', '[data-page="complete"]'],
    successBackToResultsLink: ['a.back-to-results', 'a[href*="search"]'],

    // Error / abort conditions
    captchaMarker: ['#captcha', '.error-rate-limit', '.g-recaptcha'],
    logoutMarker: ['#loginForm', 'input[name="amcMemberNumber"]'],
  };

  // Selectors that MUST resolve or we hard-abort.
  const CRITICAL_SELECTORS = ['searchSubmitButton', 'resultsRow', 'resultsNextButton', 'finalSubmitButton', 'successMarker'];

  // ============================================================================
  // 3. PAGE_MARKERS  — URL regex + DOM probe combos to identify the current page
  // ============================================================================
  // Marker order matters — first match wins.  Keep narrow patterns above broad
  // ones, otherwise broad ITINERARY_REVIEW would swallow PERSONAL_INFO etc.
  const PAGE_MARKERS = {
    SEARCH_INPUT:     { urlRegex: /award_search_roundtrip_input\.xhtml/i, probeKey: 'searchSubmitButton' },
    RESULTS:          { urlRegex: /award_search_roundtrip_result_/i, probeKey: 'resultsRow' },
    PERSONAL_INFO:    { urlRegex: /mandatory_passenger|passenger_information_input|personal_info|contact/i, probeKey: 'personalInfoMarker' },
    PAX_CONFIRM:      { urlRegex: /pax_confirm|passenger_(?!information_input)/i, probeKey: 'paxConfirmMarker' },
    FINAL_SUBMIT:     { urlRegex: /final_confirm|booking_confirm|reservation_confirm/i, probeKey: 'finalSubmitButton' },
    SUCCESS:          { urlRegex: /complete|success|booking_complete/i, probeKey: 'successMarker' },
    CAPTCHA_OR_RL:    { urlRegex: /error|maintenance|captcha/i, probeKey: 'captchaMarker' },
    LOGIN:            { urlRegex: /login|signin/i, probeKey: 'logoutMarker' },
    // Broad catch-all — anything else under /award/ is treated as itinerary
    // review.  Last in order so narrower markers above win first.
    ITINERARY_REVIEW: { urlRegex: /\/award_/i, probeKey: 'itineraryMarker' },
  };

  // ============================================================================
  // 4. LOG / UTIL
  // ============================================================================
  const TAG = '[ANA-WL]';
  function log(...args)  { console.log(TAG, ...args); }
  function warn(...args) { console.warn(TAG, ...args); }
  function err(...args)  { console.error(TAG, ...args); }
  function debug(...args){ if (CONFIG.VERBOSE_LOGGING) console.log(TAG, '·', ...args); }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** Wait for a selector to return ≥1 element, up to timeoutMs. */
  async function waitFor(selectorOrArray, timeoutMs = CONFIG.WAIT_FOR_DOM_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = qFirst(selectorOrArray);
      if (el) return el;
      await sleep(150);
    }
    return null;
  }

  /** Try selectors in order; return first matching element (or null). Logs which entry survived. */
  function qFirst(selectorOrArray) {
    const list = Array.isArray(selectorOrArray) ? selectorOrArray : [selectorOrArray];
    for (const sel of list) {
      if (!sel) continue;
      try {
        const el = document.querySelector(sel);
        if (el) {
          if (CONFIG.VERBOSE_LOGGING && list.length > 1) debug('selector matched:', sel);
          return el;
        }
      } catch (e) {
        warn('bad selector', sel, e.message);
      }
    }
    return null;
  }

  /** Return ALL elements matched by the FIRST selector that yields ≥1 match. */
  function qAll(selectorOrArray) {
    const list = Array.isArray(selectorOrArray) ? selectorOrArray : [selectorOrArray];
    for (const sel of list) {
      if (!sel) continue;
      try {
        const nodes = document.querySelectorAll(sel);
        if (nodes.length) return Array.from(nodes);
      } catch (e) {
        warn('bad selector', sel, e.message);
      }
    }
    return [];
  }

  /** Is the element actually visible (not display:none / visibility:hidden / detached)? */
  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  /** Set a form-field value and fire the events client-side validation listens for. */
  function setInputValue(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  /** Click with DRY_RUN respect and a small settle delay. */
  async function safeClick(el, label) {
    if (!el) { warn('safeClick: null element for', label); return false; }
    if (Safety.isDryRun()) { log('DRY_RUN: would click', label); return true; }
    debug('click', label);
    el.click();
    await sleep(150);
    return true;
  }

  /** Normalize "NH 009 " → "NH9".  Used for whitelist comparison. */
  function normalizeFlightNumber(raw) {
    if (!raw) return '';
    const s = String(raw).toUpperCase().replace(/\s+/g, '');
    const m = s.match(/^([A-Z]{2})0*(\d+)$/);
    return m ? `${m[1]}${m[2]}` : s;
  }

  function isWhitelisted(rawFlightNumber) {
    const norm = normalizeFlightNumber(rawFlightNumber);
    return CONFIG.THE_ROOM_WHITELIST.map(normalizeFlightNumber).includes(norm);
  }

  // ============================================================================
  // 5. STATE  — sessionStorage for live run, GM_* for cross-session history
  // ============================================================================
  const KEY_PREFIX = 'ana_wl::';
  const GM_PREFIX  = 'ana_wl_gm::';

  const PHASE = {
    IDLE: 'IDLE',
    INITIALIZING: 'INITIALIZING',
    SUBMITTING_SEARCH: 'SUBMITTING_SEARCH',
    SCANNING_RESULTS: 'SCANNING_RESULTS',
    SELECTING_FLIGHT: 'SELECTING_FLIGHT',
    PAX_CONFIRM: 'PAX_CONFIRM',
    ITINERARY_REVIEW: 'ITINERARY_REVIEW',
    PERSONAL_INFO: 'PERSONAL_INFO',
    FINAL_SUBMIT: 'FINAL_SUBMIT',
    AWAITING_SUCCESS: 'AWAITING_SUCCESS',
    SUCCESS: 'SUCCESS',
    RETURNING_TO_RESULTS: 'RETURNING_TO_RESULTS',
    DONE: 'DONE',
    ABORTED: 'ABORTED',
  };

  const State = {
    _read(key, fallback) {
      try {
        const raw = sessionStorage.getItem(KEY_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { warn('state read fail', key, e); return fallback; }
    },
    _write(key, value) {
      try { sessionStorage.setItem(KEY_PREFIX + key, JSON.stringify(value)); }
      catch (e) { warn('state write fail', key, e); }
    },
    _del(key) { sessionStorage.removeItem(KEY_PREFIX + key); },

    load() {
      return this._read('state', { phase: PHASE.IDLE, abortReason: null });
    },
    save(s) {
      s.lastNavAt = Date.now();
      this._write('state', s);
    },
    setPhase(phase, extra = {}) {
      const s = this.load();
      s.phase = phase;
      Object.assign(s, extra);
      this.save(s);
      debug('phase →', phase);
      return s;
    },

    getQueue()       { return this._read('queue', []); },
    setQueue(q)      { this._write('queue', q); },
    getProcessed()   { return this._read('processed', []); },
    setProcessed(p)  { this._write('processed', p); },
    getCurrent()     { return this._read('currentFlight', null); },
    setCurrent(f)    { this._write('currentFlight', f); },
    clearCurrent()   { this._del('currentFlight'); },
    getStats()       { return this._read('stats', { waitlisted: 0, skipped: 0, errors: 0, startedAt: null, stuckCount: 0 }); },
    setStats(st)     { this._write('stats', st); },
    bumpStat(key, by = 1) {
      const st = this.getStats();
      st[key] = (st[key] || 0) + by;
      this.setStats(st);
    },

    reset() {
      ['state', 'queue', 'processed', 'currentFlight', 'stats'].forEach(k => this._del(k));
      log('state reset');
    },

    // Cross-session GM history
    getHistorical() {
      try { return JSON.parse(GM_getValue(GM_PREFIX + 'historicalWaitlists', '[]')); }
      catch { return []; }
    },
    pushHistorical(entry) {
      const all = this.getHistorical();
      all.push(entry);
      GM_setValue(GM_PREFIX + 'historicalWaitlists', JSON.stringify(all));
    },
    isAlreadyDone(flightNumber, dateISO) {
      const norm = normalizeFlightNumber(flightNumber);
      return this.getHistorical().some(h =>
        normalizeFlightNumber(h.flight) === norm && h.dateISO === dateISO);
    },
  };

  // ============================================================================
  // 6. SAFETY  — gates and aborts
  // ============================================================================
  const Safety = {
    isDryRun() {
      const override = GM_getValue(GM_PREFIX + 'dryRunOverride', null);
      if (override === 'true') return true;
      if (override === 'false') return false;
      return CONFIG.DRY_RUN;
    },

    killSwitch() {
      if (localStorage.getItem(KEY_PREFIX + 'kill') === '1') {
        err('KILL SWITCH ACTIVE — aborting.  Clear with: localStorage.removeItem("ana_wl::kill")');
        abort('kill_switch');
        return true;
      }
      return false;
    },

    deadMansSwitch() {
      const s = State.load();
      if (s.lastNavAt && Date.now() - s.lastNavAt > CONFIG.MAX_STALE_MS) {
        warn('dead-man\'s switch tripped (state stale > '
          + (CONFIG.MAX_STALE_MS / 1000) + 's) — resetting to IDLE');
        State.reset();
        return true;
      }
      return false;
    },

    checkCaptcha() {
      if (PAGE_MARKERS.CAPTCHA_OR_RL.urlRegex.test(location.href)) return true;
      return !!qFirst(SELECTORS.captchaMarker);
    },

    checkRateLimit() {
      const txt = (document.body && document.body.innerText) || '';
      const hits = [
        /too many requests/i,
        /rate limit/i,
        /アクセスが集中/,
        /しばらく時間をおいて/,
        /システムが混雑/,
      ];
      return hits.some(re => re.test(txt));
    },

    checkLogout() {
      if (PAGE_MARKERS.LOGIN.urlRegex.test(location.href)) return true;
      return !!qFirst(SELECTORS.logoutMarker);
    },

    checkCap() {
      const st = State.getStats();
      return (st.waitlisted || 0) >= CONFIG.MAX_WAITLISTS_PER_RUN;
    },

    confirmFinal(current) {
      if (!CONFIG.CONFIRM_BEFORE_FINAL_SUBMIT) return true;
      const msg = `[ANA-WL] About to WAITLIST ${current.flightNumber} on ${current.dateISO}.\n\nProceed?`;
      return window.confirm(msg);
    },
  };

  function abort(reason) {
    err('ABORT:', reason);
    const s = State.load();
    s.phase = PHASE.ABORTED;
    s.abortReason = reason;
    State.save(s);
    printStats();
    try { GM_notification && GM_notification({ text: `ANA Waitlist aborted: ${reason}`, title: 'ANA-WL', timeout: 8000 }); }
    catch (_) { /* notification grant may not exist */ }
  }

  function printStats() {
    const s = State.load();
    const st = State.getStats();
    log('── stats ──');
    log('phase:', s.phase, s.abortReason ? '(' + s.abortReason + ')' : '');
    log('waitlisted:', st.waitlisted, 'skipped:', st.skipped, 'errors:', st.errors);
    log('queue remaining:', State.getQueue().length);
    log('processed:', State.getProcessed().map(f => f.flightNumber + ':' + f.status).join(', '));
  }

  // ============================================================================
  // 7. DISCOVERY  — fires when SELECTOR_DISCOVERY_MODE is true
  // ============================================================================
  const Discovery = {
    dumpAll() {
      console.group(TAG + ' DISCOVERY DUMP');
      log('URL:', location.href);
      log('title:', document.title);

      console.group('buttons / submits');
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn'));
      btns.forEach((b, i) => {
        const text = (b.innerText || b.value || '').trim().slice(0, 60);
        console.log(i, { tag: b.tagName, id: b.id, cls: b.className, text, name: b.name });
      });
      console.groupEnd();

      console.group('forms / inputs');
      Array.from(document.forms).forEach((f, i) => {
        console.log('form', i, { id: f.id, name: f.name, action: f.action, method: f.method });
      });
      console.groupEnd();

      console.group('candidate flight rows');
      const candidates = [
        ...document.querySelectorAll('tr'),
        ...document.querySelectorAll('[role="row"]'),
        ...document.querySelectorAll('[class*="flight" i]'),
        ...document.querySelectorAll('[data-flight-no]'),
      ];
      const seen = new Set();
      candidates.slice(0, 30).forEach(el => {
        if (seen.has(el)) return; seen.add(el);
        console.log({ tag: el.tagName, id: el.id, cls: el.className, text: (el.innerText || '').slice(0, 120) });
      });
      console.groupEnd();

      console.groupEnd();
    },
  };

  // ============================================================================
  // 8. PAGE HANDLERS
  // ============================================================================

  async function handleSearchInput() {
    const s = State.load();

    // Auto-launched on every load.  Only act if user triggered Start.
    if (s.phase === PHASE.IDLE || s.phase === PHASE.DONE || s.phase === PHASE.ABORTED) {
      log('on search input page — idle.  Use Tampermonkey menu → "Start ANA Waitlist Run" to begin.');
      return;
    }

    if (s.phase !== PHASE.INITIALIZING) {
      warn('on search input page but phase is', s.phase, '— resetting to IDLE');
      State.reset();
      return;
    }

    log('INITIALIZING — submitting search form');
    const btn = await waitFor(SELECTORS.searchSubmitButton);
    if (!btn) { abort('missing_critical_selector:searchSubmitButton'); return; }

    State.setPhase(PHASE.SUBMITTING_SEARCH);
    if (Safety.isDryRun()) {
      log('DRY_RUN: would click search submit (skipping navigation)');
      State.setPhase(PHASE.IDLE);
      return;
    }
    btn.click();
  }

  async function handleResults() {
    log('SCANNING_RESULTS');
    const firstRow = await waitFor(SELECTORS.resultsRow);
    if (!firstRow) { abort('missing_critical_selector:resultsRow'); return; }

    await sleep(CONFIG.POST_NAV_SETTLE_MS);

    const s = State.load();
    if (!s.searchDate) {
      s.searchDate = guessSearchDateFromPage();
      State.save(s);
    }
    const dateISO = s.searchDate || 'unknown-date';

    const itineraryDivs = qAll(SELECTORS.resultsRow);
    debug('itineraries found:', itineraryDivs.length);

    // Dedupe by THE Room flight: if 3 connection variants all contain NH112,
    // we waitlist exactly one (the first).  User can edit if they want all.
    const processedFlightNos = new Set(State.getProcessed().map(f =>
      normalizeFlightNumber(f.flightNumber)));
    const queue = [];

    itineraryDivs.forEach((div, idx) => {
      const label = div.querySelector(coalesce(SELECTORS.resultsRowFlightNumber));
      const labelText = label ? (label.textContent || '') : '';
      const flightNos = (labelText.match(/[A-Z]{2}\s*\d{1,4}/g) || [])
        .map(normalizeFlightNumber);

      if (!flightNos.length) {
        debug('itinerary', idx, '— no flight numbers in label, skipping');
        return;
      }

      const matched = flightNos.find(isWhitelisted);
      if (!matched) {
        debug('itinerary', idx, flightNos.join(','), '— no whitelisted match');
        return;
      }

      if (processedFlightNos.has(matched)) {
        debug('itinerary', idx, '(' + matched + ') — already queued/processed this run');
        return;
      }

      if (State.isAlreadyDone(matched, dateISO)) {
        log('skip itinerary', idx, '— flight', matched, 'already in GM historical for', dateISO);
        const skipped = { flightNumber: matched, dateISO, status: 'skipped_already_done', allFlights: flightNos };
        const p = State.getProcessed(); p.push(skipped); State.setProcessed(p);
        State.bumpStat('skipped');
        processedFlightNos.add(matched);
        return;
      }

      const selectTarget = div.querySelector(coalesce(SELECTORS.resultsRowWaitlistJButton));
      if (!selectTarget) {
        log('skip itinerary', idx, '(' + matched + ') — no selectItineraryCheck cell');
        return;
      }
      // Absence of flagWait usually means seat is immediately confirmable
      // (better than waitlist) rather than ineligible — still proceed.
      const badge = div.querySelector(coalesce(SELECTORS.resultsRowWaitlistBadge));
      if (!badge) debug('itinerary', idx, '— no flagWait badge; proceeding anyway (may be direct confirm)');

      queue.push({
        flightNumber: matched,
        dateISO,
        itineraryIndex: idx,
        allFlights: flightNos,
        status: 'pending',
      });
      processedFlightNos.add(matched);
    });

    State.setQueue(queue);
    log('queue built:', queue.length, 'whitelisted itinerar' + (queue.length === 1 ? 'y' : 'ies'));

    if (queue.length === 0) {
      log('no whitelisted THE Room itineraries on this date — DONE');
      State.setPhase(PHASE.DONE);
      printStats();
      return;
    }

    const next = queue[0];
    log('proceeding with itinerary', next.itineraryIndex,
        '— flights:', next.allFlights.join(','),
        '— THE Room flight:', next.flightNumber);
    State.setCurrent(next);

    const itinDiv = itineraryDivs[next.itineraryIndex];
    if (!itinDiv) { abort('itinerary_disappeared'); return; }

    const selectTarget = itinDiv.querySelector(coalesce(SELECTORS.resultsRowWaitlistJButton));
    if (!selectTarget) { abort('select_target_missing'); return; }

    State.setPhase(PHASE.SELECTING_FLIGHT);

    // ANA pre-selects one itinerary by default.  Clicking the radio of an
    // already-selected row may toggle it off — only click if not pressed.
    const radio = selectTarget.querySelector('i[role="button"]');
    const alreadySelected = radio && radio.getAttribute('aria-pressed') === 'true';
    if (alreadySelected) {
      debug('itinerary', next.itineraryIndex, 'already selected — skipping radio click');
    } else {
      await safeClick(selectTarget,
        'selectItineraryCheck for itinerary ' + next.itineraryIndex + ' (' + next.flightNumber + ')');
      await sleep(800); // let changeItineraryFlight() settle client-side state
    }

    const nextBtn = qFirst(SELECTORS.resultsNextButton);
    if (!nextBtn) { abort('missing_critical_selector:resultsNextButton'); return; }
    await safeClick(nextBtn, 'results page Next button');

    // In DRY_RUN no navigation happens; simulate progression so the user can
    // verify the full loop drains the queue.
    if (Safety.isDryRun()) {
      log('DRY_RUN: simulating success for', next.flightNumber);
      finishCurrentFlightAsSuccess(true /* simulated */);
      State.setPhase(PHASE.SCANNING_RESULTS);
      await handleResults();
    }
  }

  async function handlePaxConfirm() {
    log('PAX_CONFIRM');
    const marker = await waitFor(SELECTORS.paxConfirmMarker);
    if (!marker) warn('paxConfirmMarker not found — proceeding anyway');
    const btn = await waitFor(SELECTORS.paxConfirmNextButton);
    if (!btn) { abort('missing_selector:paxConfirmNextButton'); return; }
    State.setPhase(PHASE.ITINERARY_REVIEW);
    await safeClick(btn, 'pax confirm Next');
  }

  async function handleItineraryReview() {
    log('ITINERARY_REVIEW');
    const marker = await waitFor(SELECTORS.itineraryMarker);
    if (!marker) warn('itineraryMarker not found — proceeding anyway');

    await sleep(CONFIG.POST_NAV_SETTLE_MS);

    // ANA pops an "availability may change" notice modal on this page.
    // Dismiss it (single Confirm button) before clicking Next.  No-op if the
    // modal isn't shown (e.g. already dismissed in this session).
    const modalBtn = qFirst(SELECTORS.modalConfirmButton);
    if (modalBtn && isVisible(modalBtn)) {
      log('dismissing availability-change modal');
      await safeClick(modalBtn, 'modal Confirm button');
      await sleep(700);
    } else {
      debug('no visible modal to dismiss');
    }

    if (!verifyCurrentFlightOnPage(SELECTORS.itineraryFlightNumber, 'itinerary review')) return;

    const btn = await waitFor(SELECTORS.itineraryNextButton);
    if (!btn) { abort('missing_selector:itineraryNextButton'); return; }
    State.setPhase(PHASE.PERSONAL_INFO);
    await safeClick(btn, 'itinerary review Next');
  }

  async function handlePersonalInfo() {
    log('PERSONAL_INFO');
    const marker = await waitFor(SELECTORS.personalInfoMarker);
    if (!marker) warn('personalInfoMarker not found — proceeding anyway');

    await sleep(CONFIG.POST_NAV_SETTLE_MS);

    const ui = CONFIG.USER_INFO || {};

    // Fill phone country (US/JP/CN/etc).  Skipped if CONFIG value is empty.
    if (ui.phoneCountryCode) {
      const sel = qFirst(SELECTORS.personalInfoPhoneCountrySelect);
      if (!sel) {
        warn('phone country select not found — skipping');
      } else if (sel.value === ui.phoneCountryCode) {
        debug('phone country already', ui.phoneCountryCode);
      } else if (Safety.isDryRun()) {
        log('DRY_RUN: would set phone country to', ui.phoneCountryCode);
      } else {
        log('setting phone country →', ui.phoneCountryCode);
        sel.value = ui.phoneCountryCode;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(200);
      }
    }

    // Fill phone number.  Don't log the actual digits (PII).
    if (ui.phoneNumber) {
      const inp = qFirst(SELECTORS.personalInfoPhoneNumberInput);
      if (!inp) {
        warn('phone number input not found — skipping');
      } else if (inp.value === ui.phoneNumber) {
        debug('phone number already filled');
      } else if (Safety.isDryRun()) {
        log('DRY_RUN: would set phone number (' + ui.phoneNumber.length + ' digits)');
      } else {
        log('setting phone number (' + ui.phoneNumber.length + ' digits)');
        setInputValue(inp, ui.phoneNumber);
        await sleep(200);
      }
    }

    // Tick any required agreement checkboxes
    const checkboxes = qAll(SELECTORS.personalInfoAgreeCheckboxes);
    if (checkboxes.length) {
      log('ticking', checkboxes.length, 'agreement checkbox(es)');
      for (const cb of checkboxes) {
        if (!cb.checked) {
          if (Safety.isDryRun()) { log('DRY_RUN: would tick', cb.id || cb.name); continue; }
          cb.click();
          await sleep(80);
        }
      }
    }

    // Surface any still-empty required inputs so the user can see what's missing
    const stillEmpty = qAll('input[required]:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
      .filter(i => !(i.value || '').trim());
    if (stillEmpty.length) {
      warn('after fill, still', stillEmpty.length, 'required input(s) empty:',
        stillEmpty.slice(0, 6).map(i => i.id || i.name).join(' | '));
    }

    const btn = await waitFor(SELECTORS.personalInfoNextButton);
    if (!btn) { abort('missing_selector:personalInfoNextButton'); return; }

    // Clicking Next on the pax info page triggers a passport-name confirmation
    // modal — not navigation.  The OK button on that modal is the real submit.
    await safeClick(btn, 'personal info Next (opens passport-name modal)');

    await sleep(800);
    const okBtn = await waitFor(SELECTORS.personalInfoNameConfirmOkButton, 5000);
    if (!okBtn || !isVisible(okBtn)) {
      warn('expected passport-name confirm modal but did not appear — page may have navigated unexpectedly');
      return;
    }

    // OK is effectively the final-submit click.  Apply safety gates here.
    const current = State.getCurrent();
    if (!current) { abort('no_current_flight'); return; }
    if (Safety.checkCap()) { abort('cap_reached'); return; }
    if (!Safety.confirmFinal(current)) { abort('user_declined_confirm'); return; }

    if (Safety.isDryRun()) {
      log('DRY_RUN: would click OK on passport-name modal (submits waitlist for ' + current.flightNumber + ')');
      finishCurrentFlightAsSuccess(true);
      State.setPhase(PHASE.SCANNING_RESULTS);
      return;
    }

    log('confirming passport-name modal — submitting waitlist for', current.flightNumber);
    State.setPhase(PHASE.AWAITING_SUCCESS);
    await safeClick(okBtn, 'passport-name OK button (submits waitlist)');
  }

  async function handleFinalSubmit() {
    log('FINAL_SUBMIT');
    const current = State.getCurrent();
    if (!current) { abort('no_current_flight'); return; }

    if (!verifyCurrentFlightOnPage(SELECTORS.finalSubmitFlightNumber, 'final submit')) return;

    // Safety gates
    if (Safety.checkCap()) { abort('cap_reached'); return; }
    if (!Safety.confirmFinal(current)) { abort('user_declined_confirm'); return; }

    const btn = await waitFor(SELECTORS.finalSubmitButton);
    if (!btn) { abort('missing_critical_selector:finalSubmitButton'); return; }

    if (Safety.isDryRun()) {
      log('DRY_RUN: would click FINAL submit for', current.flightNumber, 'on', current.dateISO);
      finishCurrentFlightAsSuccess(true /* simulated */);
      State.setPhase(PHASE.SCANNING_RESULTS);
      // In real run, navigation drives next page.  In DRY_RUN we have no
      // navigation so just stop here.  The user can re-trigger from results.
      return;
    }

    State.setPhase(PHASE.AWAITING_SUCCESS);
    btn.click();
  }

  async function handleSuccess() {
    log('SUCCESS');
    const marker = await waitFor(SELECTORS.successMarker);
    if (!marker) { abort('missing_critical_selector:successMarker'); return; }

    finishCurrentFlightAsSuccess(false);

    // Navigate back to results to process next flight
    State.setPhase(PHASE.RETURNING_TO_RESULTS);
    const backLink = qFirst(SELECTORS.successBackToResultsLink);
    if (backLink) {
      await safeClick(backLink, 'back-to-results link');
    } else {
      log('no back-to-results link — using history.back()');
      history.back();
    }
  }

  async function handleUnknown() {
    const st = State.getStats();
    st.stuckCount = (st.stuckCount || 0) + 1;
    State.setStats(st);
    warn('UNKNOWN page (stuckCount=' + st.stuckCount + ')', 'url:', location.href, 'title:', document.title);
    if (st.stuckCount >= CONFIG.MAX_STUCK_RETRIES) { abort('unknown_page_max_retries'); return; }
  }

  // ----- handler helpers -------------------------------------------------------

  function coalesce(selectorOrArray) {
    // For row.querySelector we need a single string.  Join arrays with comma
    // (CSS selector list — first match wins per row).
    return Array.isArray(selectorOrArray) ? selectorOrArray.join(', ') : selectorOrArray;
  }

  function findRowByFlightNumber(rows, normalizedFn) {
    for (const row of rows) {
      const fnEl = row.querySelector(coalesce(SELECTORS.resultsRowFlightNumber)) || row;
      const txt  = (fnEl.innerText || fnEl.textContent || '').trim();
      const m = txt.match(/[A-Z]{2}\s*\d{1,4}/i);
      if (m && normalizeFlightNumber(m[0]) === normalizedFn) return row;
    }
    return null;
  }

  /** Compare the flight number(s) on the current page against state.currentFlight;
   *  abort on mismatch.  Multi-segment itineraries pass if the THE Room flight
   *  appears, or as a fallback if any queued connection flight appears. */
  function verifyCurrentFlightOnPage(selectorOrArray, pageLabel) {
    const current = State.getCurrent();
    if (!current) { abort('no_current_flight'); return false; }
    const el = qFirst(selectorOrArray);
    if (!el) {
      warn('no flight-number element on', pageLabel, '— skipping sanity check');
      return true;
    }
    // Scan whole page text — multi-flight itineraries have flight numbers
    // spread across several DOM nodes, so a single-element selector isn't
    // enough.  Use the matched element's nearest container, fall back to body.
    const scope = el.closest('form, #main, body') || document.body;
    const text = (scope.innerText || scope.textContent || '').trim();
    const found = (text.match(/[A-Z]{2}\s*\d{1,4}/g) || []).map(normalizeFlightNumber);
    if (!found.length) {
      warn('could not extract flight numbers on', pageLabel, '— text snippet:', text.slice(0, 200));
      return true;
    }
    const expected = normalizeFlightNumber(current.flightNumber);
    if (found.includes(expected)) {
      debug('flight sanity check OK on', pageLabel, '→', expected, 'present');
      return true;
    }
    // Fall back: any connection flight in the queued itinerary present?
    const allExpected = (current.allFlights || []).map(normalizeFlightNumber);
    const matches = found.filter(f => allExpected.includes(f));
    if (matches.length) {
      warn('THE Room flight', expected, 'not on', pageLabel,
           '— but connection flights match:', matches.join(','), '— continuing');
      return true;
    }
    err('wrong-booking sanity check FAILED on', pageLabel,
        '— expected', expected, '(or', allExpected.join(',') + ')',
        'but page shows', found.slice(0, 8).join(','));
    abort('flight_number_mismatch:' + pageLabel);
    return false;
  }

  function finishCurrentFlightAsSuccess(simulated) {
    const current = State.getCurrent();
    if (!current) return;

    const entry = { ...current, status: simulated ? 'success_simulated' : 'success', ts: Date.now() };
    const processed = State.getProcessed();
    processed.push(entry);
    State.setProcessed(processed);

    // Remove from queue
    const queue = State.getQueue().filter(f =>
      normalizeFlightNumber(f.flightNumber) !== normalizeFlightNumber(current.flightNumber));
    State.setQueue(queue);

    State.clearCurrent();
    State.bumpStat('waitlisted');

    if (!simulated) {
      State.pushHistorical({ flight: current.flightNumber, dateISO: current.dateISO, ts: Date.now() });
    }
    log(simulated ? '✓ SIMULATED waitlist:' : '✓ WAITLISTED:', current.flightNumber, 'on', current.dateISO);
  }

  function guessSearchDateFromPage() {
    // Best effort: scan visible text for ISO or JP date.
    const txt = (document.body && document.body.innerText) || '';
    const iso = txt.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) return iso[0];
    const jp = txt.match(/(20\d{2})\D(\d{1,2})\D(\d{1,2})/);
    if (jp) return `${jp[1]}-${jp[2].padStart(2, '0')}-${jp[3].padStart(2, '0')}`;
    return null;
  }

  // ============================================================================
  // 9. ROUTER
  // ============================================================================
  async function identifyPage() {
    for (const [name, marker] of Object.entries(PAGE_MARKERS)) {
      if (!marker.urlRegex.test(location.href)) continue;
      const probe = await waitFor(SELECTORS[marker.probeKey], 2000);
      if (probe) return name;
    }
    return 'UNKNOWN';
  }

  async function router() {
    if (Safety.killSwitch()) return;
    Safety.deadMansSwitch();

    if (CONFIG.SELECTOR_DISCOVERY_MODE) Discovery.dumpAll();

    if (Safety.checkCaptcha())  { abort('captcha'); return; }
    if (Safety.checkRateLimit()){ abort('rate_limit'); return; }
    if (Safety.checkLogout())   { abort('logged_out'); return; }

    const s = State.load();
    // Terminal phases: only handle search input page (to log idle message)
    if (s.phase === PHASE.ABORTED) {
      log('phase=ABORTED (' + s.abortReason + ').  Use Tampermonkey menu → "Stop / Reset" to clear.');
      return;
    }
    if (s.phase === PHASE.DONE) {
      log('phase=DONE.  Use Tampermonkey menu → "Stop / Reset" to start a new run.');
      return;
    }

    const page = await identifyPage();
    debug('identifyPage →', page, '| phase →', s.phase);

    switch (page) {
      case 'SEARCH_INPUT':     return handleSearchInput();
      case 'RESULTS':          return handleResults();
      case 'PAX_CONFIRM':      return handlePaxConfirm();
      case 'ITINERARY_REVIEW': return handleItineraryReview();
      case 'PERSONAL_INFO':    return handlePersonalInfo();
      case 'FINAL_SUBMIT':     return handleFinalSubmit();
      case 'SUCCESS':          return handleSuccess();
      case 'CAPTCHA_OR_RL':    return abort('captcha_or_rate_limit');
      case 'LOGIN':            return abort('logged_out');
      default:                 return handleUnknown();
    }
  }

  // ============================================================================
  // 10. MENU + BOOTSTRAP
  // ============================================================================
  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') {
      warn('GM_registerMenuCommand unavailable — menu commands disabled');
      return;
    }
    GM_registerMenuCommand('▶ Start ANA Waitlist Run', () => {
      State.reset();
      const st = State.getStats(); st.startedAt = Date.now(); State.setStats(st);
      State.setPhase(PHASE.INITIALIZING);
      log('user triggered START');
      router().catch(e => { err('router exception', e); abort('exception:' + e.message); });
    });

    GM_registerMenuCommand('■ Stop / Reset', () => {
      log('user triggered STOP / RESET');
      State.reset();
    });

    GM_registerMenuCommand('⚙ Toggle DRY_RUN (current: ' + Safety.isDryRun() + ')', () => {
      const next = !Safety.isDryRun();
      GM_setValue(GM_PREFIX + 'dryRunOverride', String(next));
      log('DRY_RUN override set to', next, '(refresh menu to see updated label)');
    });

    GM_registerMenuCommand('📊 Print stats', () => printStats());

    GM_registerMenuCommand('🔍 Toggle selector discovery (file-level: '
      + CONFIG.SELECTOR_DISCOVERY_MODE + ')', () => {
      // Runtime toggle stored in sessionStorage; takes effect on next page load
      const cur = sessionStorage.getItem(KEY_PREFIX + 'discoveryOverride');
      const next = cur === '1' ? '0' : '1';
      sessionStorage.setItem(KEY_PREFIX + 'discoveryOverride', next);
      // Patch CONFIG so this load also dumps if turning on
      CONFIG.SELECTOR_DISCOVERY_MODE = next === '1';
      log('discovery mode →', CONFIG.SELECTOR_DISCOVERY_MODE);
      if (CONFIG.SELECTOR_DISCOVERY_MODE) Discovery.dumpAll();
    });

    GM_registerMenuCommand('🩺 Clear historical waitlist log (GM)', () => {
      GM_deleteValue(GM_PREFIX + 'historicalWaitlists');
      log('historical waitlist log cleared');
    });
  }

  function bootstrap() {
    if (window.top !== window.self) return; // no iframes

    // Apply runtime discovery override (from menu) on top of CONFIG default
    const discoOverride = sessionStorage.getItem(KEY_PREFIX + 'discoveryOverride');
    if (discoOverride === '1') CONFIG.SELECTOR_DISCOVERY_MODE = true;
    if (discoOverride === '0') CONFIG.SELECTOR_DISCOVERY_MODE = false;

    registerMenuCommands();

    log('loaded.  DRY_RUN=' + Safety.isDryRun()
      + ' | discovery=' + CONFIG.SELECTOR_DISCOVERY_MODE
      + ' | whitelist=' + CONFIG.THE_ROOM_WHITELIST.length + ' flights');

    if (!CONFIG.AUTO_RESUME_AFTER_NAV) {
      log('AUTO_RESUME_AFTER_NAV=false — router will not auto-fire on page load');
      return;
    }

    router().catch(e => { err('router exception', e); abort('exception:' + e.message); });
  }

  if (document.readyState === 'complete') {
    bootstrap();
  } else {
    window.addEventListener('load', bootstrap);
  }
})();
