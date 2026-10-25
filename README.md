# NITABot

An unofficial live map of Chicago's CTA 'L' and Metra trains on one real-geography map. Not affiliated with the CTA, Metra or the RTA.

**Status: in development (Phase D of 5 done; no report card, by choice).** CTA 'L' and Metra trains share one real-geography map that opens on Chicago and zooms out to all of Metra. Metra's lines carry a rail stripe so they never read as L lines. Train cards, station times, Metra's downtown departure boards, both systems' alerts, voice check-ins for both, and checked CTA-Metra transfers.

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
