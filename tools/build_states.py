"""Builds data/states.json: the Illinois-Wisconsin and Illinois-Indiana state lines for the NITABot base map.

Sources, in order of preference:
  1. US Census Bureau cartographic boundary file cb_2023_us_state_500k (public domain), straight from census.gov.
     This is what the GitHub Action uses (census.gov answers there; it doesn't from every machine).
  2. If census.gov can't be reached: the state shapes the @unitedstates project publishes
     (github.com/unitedstates/districts, states/IL, IN, WI shape.geojson, CC0). That project doesn't say which
     Census edition they come from, so the check below is what vouches for them.
Where a state line runs out into Lake Michigan, the map's lake (drawn on top) covers it.

How: a state line is the stretch of Illinois's outline that runs along the neighbouring state's outline
(Illinois points within 60 m of it). Nothing is drawn by hand.
Check: Census TIGER 2023 Illinois town boundaries (data/geo.json, from tools/build_geo.py) stop at the state
line wherever a town touches it, so their points that lie close to the line say how well the two agree;
the result is saved in the file (check_m) and printed.

Output: {"source", "check_m", "lines": [{"between": ["IL","WI"], "parts": [[[lat, lon], ...], ...]}]}
Run: python3 tools/build_states.py            (Census first, then the @unitedstates copy)
     python3 tools/build_states.py DIR        (the @unitedstates copy, already downloaded: DIR/IL.geojson, IN, WI)
"""
import io, json, math, os, sys, urllib.request, zipfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
URL = "https://raw.githubusercontent.com/unitedstates/districts/gh-pages/states/{}/shape.geojson"
CENSUS = "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip"
FIPS = {"17": "IL", "18": "IN", "55": "WI"}
S, N, W, E = 41.30, 42.72, -88.80, -87.15          # the base map's area (tools/build_geo.py)
PAIRS = [("IL", "WI"), ("IL", "IN")]
ON_LINE_M = 60                                     # an Illinois point this close to the neighbour's outline is on the state line
SIMPLIFY_M = 15
COS = math.cos(math.radians(42.0))


def xy(lon, lat):
    return (lon * 111320 * COS, lat * 110540)


UA = {"User-Agent": "nitabot map builder (+https://github.com/evan-dawkins/nitabot)"}


def from_census():
    import shapefile  # pyshp
    z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(urllib.request.Request(CENSUS, headers=UA), timeout=300).read()))
    base = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
    r = shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")), shx=io.BytesIO(z.read(base + ".shx")))
    fi = [f[0] for f in r.fields[1:]].index("STATEFP"); out = {}
    for sr in r.iterShapeRecords():
        code = FIPS.get(sr.record[fi])
        if code:
            parts = list(sr.shape.parts) + [len(sr.shape.points)]
            out[code] = [[list(p) for p in sr.shape.points[parts[i]:parts[i + 1]]] for i in range(len(parts) - 1)]
    return out


def from_unitedstates(d):
    out = {}
    for code in ("IL", "IN", "WI"):
        g = json.load(open(os.path.join(d, code + ".geojson"))) if d else \
            json.loads(urllib.request.urlopen(urllib.request.Request(URL.format(code), headers=UA), timeout=120).read())
        out[code] = rings(g)
    return out


def rings(g):
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    return [r for p in polys for r in p]


class Segs:
    def __init__(self, rs, cell=2000.0):
        self.c, self.g = cell, {}
        for r in rs:
            P = [xy(*p) for p in r]
            for a, b in zip(P, P[1:]):
                for gx in range(int(min(a[0], b[0]) // cell), int(max(a[0], b[0]) // cell) + 1):
                    for gy in range(int(min(a[1], b[1]) // cell), int(max(a[1], b[1]) // cell) + 1):
                        self.g.setdefault((gx, gy), []).append((a, b))

    def dist(self, q):
        gx, gy, best = int(q[0] // self.c), int(q[1] // self.c), 1e18
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for a, b in self.g.get((gx + i, gy + j), ()):
                    dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy or 1e-9
                    t = max(0, min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
                    best = min(best, math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]))
        return best


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    P = [xy(*p) for p in pts]; keep = {0, len(pts) - 1}; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); (ax, ay), (bx, by) = P[a], P[b]; dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            d = abs(dy * (P[i][0] - ax) - dx * (P[i][1] - ay)) / L
            if d > best:
                best, bi = d, i
        if best > eps:
            keep.add(bi); st += [(a, bi), (bi, b)]
    return [pts[i] for i in sorted(keep)]


def inbox(p, m=0.2):
    return S - m <= p[1] <= N + m and W - m <= p[0] <= E + m


def shared(a_rings, b_segs):
    """Runs of A's outline that lie along B's outline, inside the map area."""
    out = []
    for r in a_rings:
        on = [inbox(p) and b_segs.dist(xy(*p)) < ON_LINE_M for p in r]
        run = []
        for p, o in zip(r, on):
            if o:
                run.append(p)
            elif run:
                if len(run) > 1: out.append(run)
                run = []
        if len(run) > 1:
            out.append(run)
    return out


def check(parts):
    """Distances (m) from the Census TIGER 2023 town boundary points that lie near this line."""
    try:
        geo = json.load(open(os.path.join(ROOT, "data", "geo.json")))
    except Exception:
        return None
    seg = Segs(parts)
    d = sorted(x for pl in geo["places"] for ring in pl["rings"] for lat, lon in ring
               for x in [seg.dist(xy(lon, lat))] if x < 300)
    if not d:
        return None
    return {"town_points_within_300m": len(d), "median_m": round(d[len(d) // 2], 1), "p90_m": round(d[int(len(d) * .9)], 1),
            "max_m": round(d[-1], 1)}


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else None
    st = None
    if not d:
        try:
            st, src = from_census(), "US Census Bureau cartographic boundary file cb_2023_us_state_500k (public domain). Built by tools/build_states.py."
        except Exception as e:
            print(f"census.gov not reachable ({e}); using the @unitedstates copy", file=sys.stderr)
    if st is None:
        st, src = from_unitedstates(d), ("US Census state shapes (public domain) as published by github.com/unitedstates/districts "
                                         "(states/IL, IN, WI shape.geojson; CC0; Census edition not stated by the publisher). Built by tools/build_states.py.")
    lines = []
    for a, b in PAIRS:
        parts = [rdp(p, SIMPLIFY_M) for p in shared(st[a], Segs(st[b]))]
        lines.append({"between": [a, b], "parts": parts, "check_m": check(parts)})
    out = {"source": src,
           "lines": [{"between": L["between"], "check_m": L["check_m"],
                      "parts": [[[round(lat, 5), round(lon, 5)] for lon, lat in p] for p in L["parts"]]} for L in lines]}
    json.dump(out, open(os.path.join(ROOT, "data", "states.json"), "w"), separators=(",", ":"))
    for L in out["lines"]:
        ends = [(p[0], p[-1]) for p in L["parts"]]
        print("-".join(L["between"]), [len(p) for p in L["parts"]], "points; ends", ends, "; check", L["check_m"])


if __name__ == "__main__":
    main()
