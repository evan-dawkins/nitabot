"""Downloads O'Hare's Airport Transit System (the people mover) from OpenStreetMap: both tracks and the stations.

Saves data/ats.json (tracks as lat/lon lines, one per direction, and the stations in order). tools/build_layout.py
puts it on the map. The guideway rarely changes, so this runs only when this file changes, or by hand.
  python tools/build_ats.py            download from OpenStreetMap
  python tools/build_ats.py raw.json   use a saved Overpass answer instead
Map data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, sys, time, urllib.parse, urllib.request

BBOX = (41.965, -87.935, 42.005, -87.855)        # south, west, north, east: O'Hare and the Multi-Modal Facility
Q = """[out:json][timeout:90];
relation["route"]["network"="ATS"](%s);
out body; >; out skel qt;
node["railway"="station"]["network"="ATS"](%s);
out body;""" % ((",".join(map(str, BBOX)),) * 2)
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
# Shorter names for the map, in OpenStreetMap's own order (Terminal 1 -> Multi-Modal Facility)
SHORT = {"O'Hare Multi-Modal Facility": "Multi-Modal Facility"}


def download():
    err = None
    for url in SERVERS:
        for _ in range(2):
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": Q}).encode(),
                                             headers={"User-Agent": "nitabot map builder (+https://github.com/evan-dawkins/nitabot)"})
                return json.load(urllib.request.urlopen(req, timeout=120))["elements"]
            except Exception as e:
                err = e
                print(f"{url}: {e}", file=sys.stderr)
                time.sleep(5)
    raise SystemExit(f"OpenStreetMap download failed: {err}")


def km(a, b):
    return math.hypot((a[0] - b[0]) * 110.54, (a[1] - b[1]) * 111.32 * math.cos(math.radians(41.98)))


def chain(ways, N):
    """Joins the route's track pieces end to end, flipping any that are drawn backwards."""
    line = []
    for w in ways:
        pts = w["nodes"]
        if line:
            if pts[-1] == line[-1] or (pts[0] != line[-1] and pts[-1] in (line[0],)):
                pts = pts[::-1]
            if pts[0] == line[-1]:
                pts = pts[1:]
            elif len(line) == len(ways[0]["nodes"]) and pts[0] == line[0] or pts[-1] == line[0]:
                line = line[::-1]                       # the first piece was backwards
                if pts[-1] == line[-1]:
                    pts = pts[::-1]
                pts = pts[1:]
            else:
                raise SystemExit(f"ATS track has a gap at way {w['id']}")
        else:
            pts = list(pts)
        line += pts
    return [[N[n]["lat"], N[n]["lon"]] for n in line]


def main():
    els = json.load(open(sys.argv[1]))["elements"] if len(sys.argv) > 1 else download()
    N = {e["id"]: e for e in els if e["type"] == "node"}
    W = {e["id"]: e for e in els if e["type"] == "way"}
    routes = [e for e in els if e["type"] == "relation" and (e.get("tags") or {}).get("network") == "ATS"
              and (e.get("tags") or {}).get("route") in ("light_rail", "monorail", "train", "subway")]
    stations = [e for e in els if e["type"] == "node" and (e.get("tags") or {}).get("railway") == "station"
                and (e.get("tags") or {}).get("network") == "ATS"]
    if len(routes) != 2:
        raise SystemExit(f"expected 2 ATS routes (one each way), found {len(routes)}")
    tracks = []
    for r in sorted(routes, key=lambda r: r["tags"].get("from") != "Terminal 1"):   # Terminal 1 -> MMF first
        ways = [W[m["ref"]] for m in r["members"] if m["type"] == "way" and m["role"] == ""]
        pts = chain(ways, N)
        first = next(N[m["ref"]] for m in r["members"] if m["type"] == "node" and m["role"].startswith("stop"))
        if km(pts[-1], [first["lat"], first["lon"]]) < km(pts[0], [first["lat"], first["lon"]]):
            pts = pts[::-1]                              # run from the first stop to the last
        tracks.append([[round(a, 6), round(b, 6)] for a, b in pts])
    # stations in order along the Terminal 1 -> MMF track (skips the disused Remote Parking stop, which isn't a station)
    t = tracks[0]

    def along(s):
        best = min(range(len(t)), key=lambda i: km(t[i], [s["lat"], s["lon"]]))
        return best

    out = [{"name": SHORT.get(s["tags"]["name"], s["tags"]["name"]), "lat": round(s["lat"], 6), "lon": round(s["lon"], 6)}
           for s in sorted(stations, key=along)]
    if len(out) < 4:
        raise SystemExit(f"only {len(out)} ATS stations found")
    L = sum(km(t[i - 1], t[i]) for i in range(1, len(t)))
    json.dump({"note": "O'Hare Airport Transit System. OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Saved by tools/build_ats.py.",
               "tracks": tracks, "stations": out}, open("data/ats.json", "w"), separators=(",", ":"))
    print(f"ATS: {len(out)} stations ({', '.join(s['name'] for s in out)}), track {L:.2f} km, "
          f"{len(tracks[0])}/{len(tracks[1])} points")


if __name__ == "__main__":
    main()
