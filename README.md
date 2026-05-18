# ANA Award Waitlist (THE Room)

A Tampermonkey userscript that auto-waitlists ANA Business class award flights operating ANA's **THE Room** business suite, on the ANA Mileage Club international award booking site (`aswbe-i.ana.co.jp`).

> **Scope.** One date per run. You manually pick the route, date, and Business cabin in ANA's search form; the script submits the search and walks every matching flight on that day through ANA's multi-step waitlist confirmation flow. If a flight isn't waitlist-eligible right now, it's skipped — there's **no polling**.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open `ana-award-waitlist.user.js` from this repo and click "Raw" — Tampermonkey will offer to install it.
   - Or copy-paste its contents into a new Tampermonkey script.
3. Open Tampermonkey's dashboard → confirm the script is enabled.
4. Log into ANA Mileage Club at https://www.ana.co.jp/ as usual.

---

## First-time setup (selector discovery)

ANA's award booking pages use Japanese-language DOM with non-obvious IDs. The script ships with **placeholder selectors** — you must replace them with the real ones before it can do anything useful.

The script has a **selector discovery mode** to help.

1. Open `ana-award-waitlist.user.js` in the Tampermonkey editor.
2. Leave defaults as-is: `DRY_RUN: true`, `CONFIRM_BEFORE_FINAL_SUBMIT: true`.
3. Set `SELECTOR_DISCOVERY_MODE: true`. Save.
4. Open ANA's award search input page, e.g.
   `https://aswbe-i.ana.co.jp/rei11d/international_asw/pages/award/search/roundtrip/award_search_roundtrip_input.xhtml`
5. Fill the form yourself: from, to, single departure date, Business class. **Don't** click Search yet.
6. Open DevTools → Console. You'll see a `[ANA-WL] DISCOVERY DUMP` group listing every button, form, and candidate flight row on the page.
7. Find the real submit button in the dump, copy its `id` / `class` / `name` into `SELECTORS.searchSubmitButton`. Save.
8. Tampermonkey menu → **▶ Start ANA Waitlist Run**.
   - In DRY_RUN, the script will log "would click search submit" and stop. To actually navigate, flip DRY_RUN off (or click search manually).
9. On the results page, repeat: read the discovery dump, fill in `resultsTable`, `resultsRow`, `resultsRowFlightNumber`, `resultsRowWaitlistJButton`.
10. Manually advance one flight through pax confirm → itinerary → personal info → final confirm → success. At each step, read the dump and fill in the matching SELECTORS keys.
11. Once selectors are stable, set `SELECTOR_DISCOVERY_MODE: false`.

---

## Configuration (top of the userscript)

| Key | Default | What it does |
|---|---|---|
| `DRY_RUN` | `true` | Logs intended clicks but never submits. Flip to `false` for live booking. |
| `CONFIRM_BEFORE_FINAL_SUBMIT` | `true` | `window.confirm()` popup before the final waitlist submit. |
| `MAX_WAITLISTS_PER_RUN` | `5` | Hard cap. Script aborts when reached. |
| `CABIN` | `'J'` | Business class only. |
| `AUTO_RESUME_AFTER_NAV` | `true` | After page navigation, router auto-fires to continue the flow. |
| `SELECTOR_DISCOVERY_MODE` | `false` | Dump DOM info to console on every page. Use during setup. |
| `VERBOSE_LOGGING` | `true` | Extra debug lines in console. |
| `WAIT_FOR_DOM_MS` | `8000` | How long to wait for a selector to appear before giving up. |
| `POST_NAV_SETTLE_MS` | `1500` | Pause after navigation before acting. |
| `MAX_STUCK_RETRIES` | `3` | Give up on an unrecognized page after this many loads. |
| `MAX_STALE_MS` | `300000` | Dead-man's switch: reset state if it's older than 5 min. |
| `THE_ROOM_WHITELIST` | `[NH9, NH10, NH11, NH12, NH201, NH202, NH211, NH212, NH203, NH204, NH223, NH224]` | Flight numbers that count as "THE Room". Edit to match current seasonal deployment. |

Flight numbers are compared after normalization (uppercase, no spaces, no leading zeros), so `NH 009` matches `NH9`.

---

## Running

1. Open ANA's award search input page.
2. Fill the form (origin, destination, single departure date, Business class).
3. Tampermonkey menu (browser toolbar icon) → **▶ Start ANA Waitlist Run**.
4. Watch the console. The script will:
   - Submit the search.
   - On the results page, build a queue of whitelisted, waitlist-eligible flights.
   - For each: click waitlist → pax confirm → itinerary → personal info → final submit → success → back to results → repeat.
5. When the queue empties (or `MAX_WAITLISTS_PER_RUN` is hit), the script stops. Console will say `phase=DONE` or `ABORTED: <reason>`.

For the **next date**, change the date in ANA's form and trigger Start again. The script remembers what it's already waitlisted (cross-session via Tampermonkey storage) and skips duplicates.

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

- `DRY_RUN: true` — the script will never actually submit a waitlist booking until you flip this off.
- `CONFIRM_BEFORE_FINAL_SUBMIT: true` — even with DRY_RUN off, a browser confirm dialog appears before the very last click for every flight.
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

- Compares the flight number shown on the itinerary review and final submit pages against the flight it queued. **Mismatch aborts the run.** This prevents booking the wrong flight if ANA's flow ever crosses streams.
- Detects captcha / rate-limit pages by URL and DOM markers — aborts cleanly.
- Detects logout mid-flow (login form re-appears) — aborts.
- Dead-man's switch: if no navigation has happened for 5 minutes, state resets to IDLE so a stale run can't resume unexpectedly.

### Status flow at a glance

```
search input  →  results  →  pax confirm  →  itinerary  →  personal info
                                                                    │
                                                                    ▼
            ←  back to results  ←  success  ←  final submit (gated)
                    │
            (loop until queue empty)
                    │
                    ▼
                  DONE
```

---

## Customizing THE Room whitelist

`THE_ROOM_WHITELIST` ships with the user-supplied seed plus common LHR / FRA flights. **Verify each flight number against the current ANA seatmap before trusting it** — THE Room deployment changes seasonally and by aircraft swap.

Way to verify: search the flight on ana.co.jp's booking site, look at the cabin layout / aircraft type. If you see the angular 1-2-1 suite with sliding doors → THE Room. If you see the older staggered herringbone → not THE Room.

---

## ToS / disclaimer

This script automates clicks on your behalf inside your own browser session. It does not access ANA's APIs directly or impersonate you. Even so, automating airline booking sites may run afoul of ANA's terms of service. Use at your own risk; the safety defaults exist for a reason.

The script never logs you in, never reads your password, never fills personal info — it only clicks Next on pages you've already authenticated through.
