"""Checks Metra's track shapes (data/metra.json) against OpenStreetMap's Metra track, and writes data/osm_check.json.

Why: Metra's shapes have points every 100-260 m, with some straight stretches over 1 km between points. That's
right where the real track is straight, and wrong where it curves. OpenStreetMap's track is drawn far more
finely, so it shows which is which. OpenStreetMap is the checker, not the source: the map keeps Metra's shapes.

For each line it measures, both ways:
  * how far OpenStreetMap's track strays from Metra's shape (Metra cutting a curve shows up here)
  * how far Metra's shape strays from OpenStreetMap's track (a shape on the wrong alignment shows up here)
and lists every stretch over 50 m, with where it is.

Runs as a GitHub Action (OpenStreetMap's Overpass service isn't reachable from the build machine).
Run: python3 tools/check_osm.py            (downloads, then saves data/osm_metra.json for reuse)
     python3 tools/check_osm.py --cached   (uses data/osm_metra.json)
OpenStreetMap data (c) OpenStreetMap contributors, ODbL.
"""
import json, math, os, sys, urllib.parse, urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OVERPASS = "https://overpass-api.de/api/interpreter"
LIMIT_M = 50
NEAR_M = 400                     # OpenStreetMap track further than this from a shape is some other line, not this one
COSL = math.cos(math.radians(41.88))


def xy(lat, lon):
    return (lon * 111320 * COSL, lat * 110540)


def download():
    # one query for the relations (with their members), one for the ways' geometry
    q1 = '[out:json][timeout:240];relation["type"="route"]["route"="train"]["network"~"Metra"](41.30,-88.80,42.70,-87.40);out body;'
    q2 = ('[out:json][timeout:240];relation["type"="route"]["route"="train"]["network"~"Metra"](41.30,-88.80,42.70,-87.40);'
          'way(r)["railway"];out geom;')
    out = []
    for q in (q1, q2):
        req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(),
                                     headers={"User-Agent": "nitabot map checker (+https://github.com/evan-dawkins/nitabot)"})
        with urllib.request.urlopen(req, timeout=300) as r:
            out.append(json.loads(r.read()))
    rels, ways = out[0]["elements"], out[1]["elements"]
    way_geom = {w["id"]: [[p["lat"], p["lon"]] for p in w.get("geometry", [])] for w in ways if w["type"] == "way"}
    lines = {}
    for r in rels:
        ref = (r.get("tags", {}).get("ref") or "").upper().replace(" ", "")
        if not ref:
            continue
        for m in r.get("members", []):
            if m["type"] == "way" and m["ref"] in way_geom:
                lines.setdefault(ref, {})[str(m["ref"])] = way_geom[m["ref"]]
    data = {"note": "OpenStreetMap data (c) OpenStreetMap contributors, ODbL. Saved by tools/check_osm.py.",
            "lines": {k: list(v.values()) for k, v in sorted(lines.items())}}
    json.dump(data, open(os.path.join(ROOT, "data", "osm_metra.json"), "w"), separators=(",", ":"))
    return data


def seg_dist(q, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy or 1.0
    t = max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
    return math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1])


class Lines:
    """Nearest-distance lookups against many polylines, with a coarse grid so a whole line checks in seconds."""
    def __init__(self, polys, cell=500.0):
        self.cell, self.grid = cell, {}
        for P in polys:
            for i in range(len(P) - 1):
                a, b = P[i], P[i + 1]
                x0, x1 = sorted((a[0], b[0])); y0, y1 = sorted((a[1], b[1]))
                for gx in range(int(x0 // cell), int(x1 // cell) + 1):
                    for gy in range(int(y0 // cell), int(y1 // cell) + 1):
                        self.grid.setdefault((gx, gy), []).append((a, b))

    def dist(self, q, reach=2):
        gx, gy, best = int(q[0] // self.cell), int(q[1] // self.cell), 1e18
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for a, b in self.grid.get((gx + dx, gy + dy), ()):
                    best = min(best, seg_dist(q, a, b))
        return best


def densify(P, step=25.0):
    out = [P[0]]
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out


def stretches(points, dists, limit):
    """Runs of consecutive points over the limit -> [{from, to, max_m}]."""
    out, run = [], None
    for p, d in zip(points, dists):
        if d > limit:
            if run is None:
                run = {"from": p, "to": p, "max_m": d}
            run["to"] = p; run["max_m"] = max(run["max_m"], d)
        elif run is not None:
            out.append(run); run = None
    if run is not None:
        out.append(run)
    return out


def ll(p):
    return [round(p[1] / 110540, 5), round(p[0] / (111320 * COSL), 5)]


def check(metra, osm):
    report = {"limit_m": LIMIT_M, "lines": {}}
    for rid, L in metra["lines"].items():
        o = osm["lines"].get(rid.upper().replace(" ", ""))
        if not o:
            report["lines"][rid] = {"status": "no OpenStreetMap route found for this line"}; continue
        O = [[xy(*p) for p in w] for w in o if len(w) > 1]
        shapes = [[xy(*p) for p in pat["shape"]] for pat in L["patterns"] if pat["stops"] and pat["stops"][-1] in
                  {"OTC", "CUS", "LSS", "MILLENNIUM"}]
        Oi, Si = Lines(O), Lines(shapes)
        # Metra's shape vs OpenStreetMap (every 25 m along the shape)
        s_pts = [q for S in shapes for q in densify(S)]
        s_d = [Oi.dist(q) for q in s_pts]
        # OpenStreetMap vs Metra's shape (only OSM track that belongs near this line)
        o_pts = [q for W in O for q in densify(W)]
        o_d = [Si.dist(q) for q in o_pts]
        keep = [(q, d) for q, d in zip(o_pts, o_d) if d < NEAR_M]
        off_s = stretches(s_pts, s_d, LIMIT_M)
        off_o = stretches([q for q, _ in keep], [d for _, d in keep], LIMIT_M)
        report["lines"][rid] = {
            "shape_vs_osm_max_m": round(max(s_d)) if s_d else None,
            "shape_vs_osm_median_m": round(sorted(s_d)[len(s_d) // 2]) if s_d else None,
            "osm_vs_shape_max_m": round(max((d for _, d in keep), default=0)),
            "shape_off_osm": [{"from": ll(r["from"]), "to": ll(r["to"]), "max_m": round(r["max_m"])} for r in off_s],
            "osm_off_shape": [{"from": ll(r["from"]), "to": ll(r["to"]), "max_m": round(r["max_m"])} for r in off_o]}
    return report


def main():
    metra = json.load(open(os.path.join(ROOT, "data", "metra.json")))
    if "--cached" in sys.argv:
        osm = json.load(open(os.path.join(ROOT, "data", "osm_metra.json")))
    else:
        osm = download()
    rep = check(metra, osm)
    rep["note"] = "Metra's shapes vs OpenStreetMap's track. OpenStreetMap data (c) OpenStreetMap contributors, ODbL."
    json.dump(rep, open(os.path.join(ROOT, "data", "osm_check.json"), "w"), indent=1)
    for rid, r in rep["lines"].items():
        if "status" in r:
            print(f"{rid:6s} {r['status']}"); continue
        print(f"{rid:6s} shape vs OSM: median {r['shape_vs_osm_median_m']} m, max {r['shape_vs_osm_max_m']} m; "
              f"OSM vs shape max {r['osm_vs_shape_max_m']} m; stretches over {LIMIT_M} m: "
              f"{len(r['shape_off_osm'])} + {len(r['osm_off_shape'])}")


if __name__ == "__main__":
    main()
