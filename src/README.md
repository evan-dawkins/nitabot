# NITABot source

`index.html` at the top of the repo is **generated**. Don't edit it by hand: the next build overwrites it. Edit the files here instead.

## Build

From the repo root:

```
python3 tools/build.py && python3 tools/build_layout.py
```

`tools/build.py` joins the files listed in `PARTS`, in that order, into `index.html` with an empty map. `tools/build_layout.py` then bakes the map in (`data/network.json`, between `/*NET:BEGIN*/` and `/*NET:END*/`).

## Where this came from

Phase A split CTABot's published page into these files without changing a byte: before the NITABot renaming, the build reproduced CTABot's `index.html` exactly (CTABot commit `73ce1fb`). NITABot no longer patches MetraBot's or CTABot's pages; changes are made here.

## The files (in page order)

| File | What it holds today |
| --- | --- |
| `shell/head.html` | Page head: title, meta tags, icons, fonts |
| `shell/styles.css` | All styles (still inside the page's `<style>` tag) |
| `shell/body.html` | Page markup: header, panels, welcome guide, cards |
| `core/prologue.js` | Opens the main script: helpers, Worker address |
| `systems/cta/network.js` | CTA network data and line list |
| `core/geometry.js` | Map projection and track maths |
| `layers/basemap.js` | Lake Michigan, towns, street grid, track drawing |
| `core/camera.js` | Pan and zoom, sound, themes, welcome guide |
| `core/labels.js` | Station label placement |
| `core/linefocus.js` | The line bar and line solo |
| `systems/cta/trains.js` | Train markers, CTA feed, GPS matching, polling |
| `systems/cta/alerts.js` | Service alerts, simulated mode, header status, tooltips, train card |
| `systems/cta/times.js` | CTA arrival times |
| `core/favorites.js` | Favorite stations, station sheet, mood ticker |
| `core/chase.js` | Train of the moment |
| `core/checkins.js` | Voice check-ins (clips in `voice/cta/`) |
| `layers/ats.js` | O'Hare airport train (simulated, labelled) |
| `layers/satellite.js` | USGS satellite imagery |
| `core/main.js` | Main loop and start-up |
| `shell/end.html` | Closes the page |

The folder names say where each part is headed: `core/` for what both systems share, `systems/` for one system's feed and wording. Some `core/` files still hold CTA wording, and some `systems/cta/` files still hold shared train code; Phase C separates them as Metra is added.

Saved settings use `nitabot.*` keys in browser storage, so they never collide with MetraBot's (`metrabot.*`) or CTABot's (`ctabot.*`), which share the same site address.
