# NITABot

An unofficial live map of Chicago's CTA 'L' and Metra trains on one real-geography map.

NITABot is an unofficial personal project made for fun and is not affiliated with NITA. It isn't affiliated with the CTA, Metra or the RTA either; train positions and times come from CTA's public Train Tracker data and Metra's public GTFS feeds.

**Status: live at https://evan-dawkins.github.io/nitabot/ (GitHub Pages, from `main`). Phases A–E done; no report card, by choice.** CTA 'L' and Metra trains share one real-geography map that opens on Chicago and zooms out to all of Metra. Metra's lines carry a rail stripe so they never read as L lines. Train cards, station times, Metra's downtown departure boards, both systems' alerts, voice check-ins for both, and checked CTA-Metra transfers.

## Run it

Open `index.html` in a browser. Live data comes through the same Cloudflare Worker that MetraBot and CTABot use.

## Build it

```
python3 tools/build.py && python3 tools/build_layout.py
```

See `src/README.md` for the source files.

## Test it

```
pip install playwright && python3 -m playwright install chromium
python3 tests/test_page.py
```

For the long-running checks (background tabs, request budget, memory, keyboard, phone; about 3 minutes):

```
python3 tests/test_hardening.py
```

More suites (each about a minute):

```
python3 tests/test_positions.py      # train-position rules: held jumps, confirmations, blips, stale, hidden, recovery
python3 tests/test_health_alerts.py  # Metra feed health (subtle mark, banner, recovery) and alert filters
python3 tests/test_redesign.py       # drag never selects, crisp pings, transfers, state lines, welcome guide, favicon
```

The tests run headless Chromium against a **mock** Worker with fake trains. They prove the page works with data shaped like the Worker's, not that the live feeds work. Screenshots land in `tests/out/`.

## Data

| File | From | Rebuilt by |
| --- | --- | --- |
| `data/stations.json` | CTA's GTFS timetable | `tools/build_stations.py`, weekly Action |
| `data/geo.json` | US Census TIGER shoreline and towns | `tools/build_geo.py` |
| `data/ats.json` | OpenStreetMap (O'Hare airport train) | `tools/build_ats.py` |
| `data/metra.json` | Metra's GTFS timetable (track shapes, stations) | `tools/build_metra.py`, weekly Action; checked by `tools/check_metra.py` and `tools/check_osm.py` |
| `schedule.json` | Metra's timetable, trimmed for the departure boards | `tools/build_schedule.py`, nightly Action |
| `data/network.json` | All of the above | `tools/build_layout.py` (+ `tools/layout_metra.py`) |
| `data/transfers.json` | CTA's station pages: CTA-Metra pairs, and CTA walks between two stations (`cta_pairs`); each entry quotes its page (checked 2026-10-25) | by hand |
| `data/states.json` | Illinois-Wisconsin and Illinois-Indiana lines from Census state outlines (cb_2023 500k from census.gov when reachable; otherwise the CC0 copy at github.com/unitedstates/districts), checked against the TIGER town edges in `geo.json` | `tools/build_states.py` |
| `voice/cta/` | Kokoro voice clips | `tools/build_voice.py` |
| `voice/metra/` | Kokoro voice clips (recorded for MetraBot) | `tools/build_voice_metra.py` |

Data: Chicago Transit Authority; Metra; US Census Bureau TIGER/Line and cartographic boundary files; OpenStreetMap contributors (ODbL); USDA and USGS The National Map (satellite imagery).

### Geography

Everything is projected the same way (`tools/build_layout.py`): equirectangular around 42.25 N, 88.20 W, 30 map units per km, from WGS84 latitude/longitude. Nothing is moved to make the map tidier: lines that share track are drawn side by side (a few metres apart on the ground, a line width apart on screen), and that offset is the only change. State lines come from Census outlines (`data/states.json`); the build records how far they sit from Census TIGER town edges (median 27 m on the Indiana line, 52 m on the Wisconsin line). Where a state line runs into Lake Michigan, the lake is drawn over it. Attribution for all of it is in the line above; Census data is public domain, the @unitedstates copy is CC0, OpenStreetMap is ODbL.

### Transfers

A station that serves several lines under one id (CTA's station id, Metra's stop id) is an interchange by the agency's own data: a white pill with a dark outline. A walk between two different stations is drawn (a short white link between dark-outlined stations) only when a CTA station page names it; each entry in `data/transfers.json` quotes the page. A line crossing another, or two stations that are merely close, is not shown as a transfer.

## How a train's position is decided

Each train keeps the latest report exactly as it arrived, the last report NITABot trusts, and any report being checked (`src/systems/cta/trains.js`). A report is held back when it would mean an impossible trip from the trusted one (faster than 31 m/s on the L or 37 m/s on Metra, plus 700 m / 450 m of slack for CTA's signal-based positions and Metra's GPS), a hop between branches with neither report on shared track, or a step backwards (three in a row are needed). The marker waits at the trusted spot. The next report decides: back on course means the odd one was a blip; carrying on from it means it was real, and the train is placed there without a made-up path. A timer never accepts a report. A train with no confirmed report for 2.5 minutes turns grey; after 5 it leaves the map until one is confirmed. `__cta.posDiag()` in the browser console lists what was held, confirmed and dropped. These thresholds come from the trains' top speeds and the feeds' 30-second rhythm; they have been tested with simulated reports, not yet measured against a recorded day of live reports.

## Metra feed health

Every Metra answer is sorted by what it contains: fresh positions, an empty answer (normal overnight, never a failure), positions over 3 minutes old, Metra's own error, or no usable answer at all. The first miss shows a small "Metra" mark by the status with the time it happened. After 90 seconds without a usable update (three regular polls) and at least two misses in a row, a banner says Metra updates have stopped and how long ago the last good one was; it clears itself on the next good answer. CTA's status is separate. The Worker doesn't say whether Metra's upstream feed is fresh, so freshness is judged from each position's own GPS time.

## Launch steps (each one approved separately)

Steps 1–3 are done (2026-10-25).

1. **Create the repo**: github.com/new, name `nitabot`, Public, nothing ticked.
2. **First push** of this folder to `main`. On that push GitHub runs the data Actions once: CTA stations, Metra track (+ OpenStreetMap check), Lake Michigan and towns for the whole Metra area, the airport train, and the page build. Each saves its own commit.
3. **Turn on GitHub Pages**: Settings, Pages, Deploy from a branch, `main`, `/ (root)`. The site is then at https://evan-dawkins.github.io/nitabot/. The shared Worker already accepts this address; nothing changes there.
4. **Launch**: link it, or share the URL.

## Request budget

One NITABot tab, visible all day: about 6,500 requests a day to the shared Worker (CTA positions and Metra every 30 s, CTA alerts every 2 minutes), plus open station sheets. A hidden tab asks nothing. The Worker's free plan allows 100,000 a day across MetraBot, CTABot and NITABot together.
