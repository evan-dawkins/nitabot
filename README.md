# NITABot

An unofficial live map of Chicago's CTA 'L' and Metra trains on one real-geography map. Not affiliated with the CTA, Metra or the RTA.

**Status: built and tested locally (Phases A–E done; no report card, by choice). Not published yet.** CTA 'L' and Metra trains share one real-geography map that opens on Chicago and zooms out to all of Metra. Metra's lines carry a rail stripe so they never read as L lines. Train cards, station times, Metra's downtown departure boards, both systems' alerts, voice check-ins for both, and checked CTA-Metra transfers.

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
| `data/transfers.json` | CTA's station pages (each pair names its Metra connection; checked 2026-10-25) | by hand |
| `voice/cta/` | Kokoro voice clips | `tools/build_voice.py` |
| `voice/metra/` | Kokoro voice clips (recorded for MetraBot) | `tools/build_voice_metra.py` |

Data: Chicago Transit Authority; Metra; US Census Bureau TIGER/Line; OpenStreetMap contributors (ODbL); USDA and USGS The National Map (satellite imagery).

## Launch steps (each one approved separately)

1. **Create the repo**: github.com/new, name `nitabot`, Public, nothing ticked.
2. **First push** of this folder to `main`. On that push GitHub runs the data Actions once: CTA stations, Metra track (+ OpenStreetMap check), Lake Michigan and towns for the whole Metra area, the airport train, and the page build. Each saves its own commit.
3. **Turn on GitHub Pages**: Settings, Pages, Deploy from a branch, `main`, `/ (root)`. The site is then at https://evan-dawkins.github.io/nitabot/. The shared Worker already accepts this address; nothing changes there.
4. **Launch**: link it, or share the URL.

## Request budget

One NITABot tab, visible all day: about 6,500 requests a day to the shared Worker (CTA positions and Metra every 30 s, CTA alerts every 2 minutes), plus open station sheets. A hidden tab asks nothing. The Worker's free plan allows 100,000 a day across MetraBot, CTABot and NITABot together.
