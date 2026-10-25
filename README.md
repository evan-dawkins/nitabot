# NITABot

An unofficial live map of Chicago's CTA 'L' and Metra trains on one real-geography map. Not affiliated with the CTA, Metra or the RTA.

**Status: in development (Phase A of 5).** Today the page shows the CTA 'L' only, carried over from CTABot. Metra joins in Phases B and C.

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
| `data/network.json` | All of the above | `tools/build_layout.py` |
| `voice/cta/` | Kokoro voice clips | `tools/build_voice.py` |

Data: Chicago Transit Authority; US Census Bureau TIGER/Line; OpenStreetMap contributors (ODbL); USDA and USGS The National Map (satellite imagery).
