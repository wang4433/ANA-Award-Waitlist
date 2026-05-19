# ANA Award Waitlist (THE Room)

A Tampermonkey userscript that auto-waitlists ANA Business class award flights operating ANA's **THE Room** business suite, on the ANA Mileage Club international award booking site (`aswbe-i.ana.co.jp`).

> **Scope.** One date per run. You manually pick the route, date, and Business cabin in ANA's search form; the script submits the search and walks every matching flight on that day all the way through ANA's multi-step waitlist confirmation flow (results → itinerary review → passenger info → payment → success). If a flight isn't waitlist-eligible right now, it's skipped — there's **no polling**.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open `ana-award-waitlist.user.js` from this repo and copy-paste its contents into a new Tampermonkey script (or use Tampermonkey's "Install from URL" with the Raw file URL).
3. Open Tampermonkey's dashboard → confirm the script is enabled.
4. Log into ANA Mileage Club at https://www.ana.co.jp/ as usual.

---

## One-time configuration (in your LOCAL Tampermonkey copy)

⚠️ **Privacy warning.** The script needs your phone number to fill ANA's mandatory SMS notification field. The committed file in this repo ships with **empty** `USER_INFO` defaults on purpose. Edit your local Tampermonkey copy only — **do not commit real personal data back to a public repo.**

Open the script in Tampermonkey's editor, find the `USER_INFO` block near the top, and fill it in:

```js
USER_INFO: {
  phoneCountryCode: 'US',     // ISO 2-letter; 'US' = USA/Canada, 'JP' = Japan, 'CN' = China
  phoneNumber: '5551234567',  // digits only, no leading 0, no country code
},
```

Optionally review `THE_ROOM_WHITELIST` and adjust to current seasonal deployment. The defaults cover known THE Room flights on HND-ORD (NH112), JFK (NH9-12), LHR (NH201-204, NH211-212), and FRA (NH223-224).

---

## Running

1. Open ANA's award search input page:
   `https://aswbe-i.ana.co.jp/rei12f/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml`
2. Manually fill the form: origin, destination, single departure date, **Business** class. Don't click Search.
3. Tampermonkey menu (browser toolbar icon) → **▶ Start ANA Waitlist Run**.
4. Watch the DevTools console. The script will:
   - Click Search.
   - On the results page, parse all itineraries and queue every one whose flight numbers intersect `THE_ROOM_WHITELIST` (deduped — the first connection variant containing each THE Room flight, since N variants sharing the same long-haul leg would waste waitlist slots).
   - For each queued itinerary, walk: select itinerary radio → Next → dismiss "availability may change" modal → Next → fill SMS phone country & number → Next → dismiss passport-name modal → OK → on payment page dismiss "miles will be taken" modal → tick consent checkbox → **Waitlisting Request** (gated by `CONFIRM_BEFORE_FINAL_SUBMIT` and `MAX_WAITLISTS_PER_RUN`) → OK on the final purchase dialog → success page → back to results for next flight.
5. When the queue empties (or `MAX_WAITLISTS_PER_RUN` is hit), the script stops. Console will say `phase=DONE` or `ABORTED: <reason>`.

For the **next date**, change the date in ANA's form and trigger Start again. The script remembers what it's already waitlisted (cross-session via Tampermonkey storage) and skips duplicates.

---

## Configuration reference

| Key | Default | What it does |
|---|---|---|
| `DRY_RUN` | `true` | Logs intended clicks but never submits. Flip to `false` for live booking. |
| `CONFIRM_BEFORE_FINAL_SUBMIT` | `true` | `window.confirm()` popup before the Waitlisting Request click. |
| `MAX_WAITLISTS_PER_RUN` | `5` | Hard cap. Script aborts when reached. |
| `USER_INFO.phoneCountryCode` | `''` | ISO 2-letter country code for SMS notifications. **Edit locally; do not commit.** |
| `USER_INFO.phoneNumber` | `''` | Digits-only phone number. **Edit locally; do not commit.** |
| `THE_ROOM_WHITELIST` | seeded list | Flight numbers that count as "THE Room". Edit to match current deployment. |
| `CABIN` | `'J'` | Business class only. |
| `AUTO_RESUME_AFTER_NAV` | `true` | After page navigation, router auto-fires to continue the flow. |
| `SELECTOR_DISCOVERY_MODE` | `false` | Dump DOM info to console on every page. Use only if ANA changes its site. |
| `VERBOSE_LOGGING` | `true` | Extra debug lines in console. |
| `WAIT_FOR_DOM_MS` | `8000` | How long to wait for a selector to appear before giving up. |
| `POST_NAV_SETTLE_MS` | `1500` | Pause after navigation before acting. |
| `MAX_STUCK_RETRIES` | `3` | Give up on an unrecognized page after this many loads. |
| `MAX_STALE_MS` | `300000` | Dead-man's switch: reset state if it's older than 5 min. |

Flight numbers are compared after normalization (uppercase, no spaces, no leading zeros), so `NH 009` matches `NH9`.

---

## Tampermonkey menu commands

| Command | What it does |
|---|---|
| **▶ Start ANA Waitlist Run** | Resets state and kicks the router. |
| **■ Stop / Reset** | Clears live state (queue, processed, current flight, stats). |
| **⚙ Toggle DRY_RUN** | Runtime override; persists across reloads. |
| **📊 Print stats** | Dumps current phase + counters + queue to console. |
| **🔍 Toggle selector discovery** | Turn dump on/off without editing the file. |
| **🩺 Clear historical waitlist log** | Wipes the cross-session "already waitlisted" memory. |

---

## Safety

### Defaults stop short of a real booking

- `DRY_RUN: true` — the script will never actually submit a waitlist until you flip this off.
- `CONFIRM_BEFORE_FINAL_SUBMIT: true` — even with DRY_RUN off, a browser confirm dialog appears before the Waitlisting Request click for every flight. Click Cancel to abort.
- `MAX_WAITLISTS_PER_RUN: 5` — hard cap.

### Kill switch

To halt a running script immediately, in DevTools console:

```js
localStorage.setItem('ana_wl::kill', '1');
```

On the next page load, the script will see this and abort. Clear it with:

```js
localStorage.removeItem('ana_wl::kill');
```

### Sanity checks the script performs on its own

- Compares the flight number(s) shown on the itinerary review and payment pages against the flight it queued. **Mismatch aborts the run.** Prevents booking the wrong flight if ANA's flow ever crosses streams. Multi-segment itineraries pass if the THE Room flight is on the page; falls back to any queued connection flight.
- Detects captcha / rate-limit pages by URL and body-text scan (English + Japanese phrases) — aborts cleanly.
- Detects logout mid-flow (login form re-appears) — aborts.
- Dead-man's switch: if no navigation has happened for 5 minutes, state resets to IDLE so a stale run can't resume unexpectedly.

### Status flow at a glance

```
search input
    │
    ▼
results (pick THE Room itinerary)
    │
    ▼
itinerary review  ─ dismiss "availability may change" modal ─→ Next
    │
    ▼
passenger info  ─ fill SMS country + phone ─→ Next ─→ dismiss passport-name modal ─→ OK
    │
    ▼
payment  ─ dismiss "miles will be taken" modal ─→ tick consent ─→
    ─ Waitlisting Request (gated by CONFIRM_BEFORE_FINAL_SUBMIT, cap, DRY_RUN)
    ─→ OK on purchase confirm modal
    │
    ▼
success
    │
    ├─ queue empty? ──→ DONE
    └─ more flights? ──→ back to results (loop)
```

---

## Re-discovering selectors if ANA changes its site

The script's selectors are pinned to ANA's current DOM (verified by walking the full flow). If ANA ships a redesign and the script breaks, set `SELECTOR_DISCOVERY_MODE: true`, run, and on each page check the console for the `[ANA-WL] DISCOVERY DUMP` group. It lists every button, form, and candidate row on the page. Pick the new selectors and replace the matching entries in the `SELECTORS` block. Switch discovery mode off when done.

Anchor priorities (most stable → least):
1. `aria-controls="..."` and stable `id` values (e.g. `#purchaseButton`, `#nextButton`)
2. Attribute-ends-with selectors for JSF colon-style IDs (`[id$=":detailRuleMessageCheckbox"]`) — survive per-passenger-index changes
3. `value` attribute on submit buttons (`input[type="submit"][value="Confirm"]`) — survives JSF auto-name renumbering
4. Class combinations (`input.btnVerticalMain.btnWidthVariable`) — survive minor refactors
5. **Avoid** JSF-generated `name` and `id` attributes like `j_idt1080` — they renumber between builds.

---

## Limitations

- **One date per run.** Re-trigger Start after changing the date in ANA's form to process the next date.
- **Single passenger only.** Multi-pax bookings would need iteration over the JSF passenger index (`contactsSms:0:...`, `contactsSms:1:...`); not implemented.
- **Business class (J) only.** First class and economy not in scope.
- **One waitlist per THE Room flight per run.** If 3 connection variants all contain NH112, only the first is waitlisted — booking the same long-haul flight 3 different ways is wasteful for award space.
- **Desktop site only.** `@match` covers `aswbe-i.ana.co.jp` and `aswbe.ana.co.jp` — not the mobile site.

---

## ToS / disclaimer

This script automates clicks on your behalf inside your own browser session. It does not access ANA's APIs directly, never reads your password, and runs entirely in your browser. It does fill one form field (SMS phone) from your local CONFIG.

Automating airline booking sites may run afoul of ANA's terms of service. Use at your own risk; the safety defaults (DRY_RUN, confirm gate, hard cap, kill switch) exist for a reason.
