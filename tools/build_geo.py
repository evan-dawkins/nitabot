"""Builds data/geo.json: the real Lake Michigan shoreline and city/suburb outlines for the NITABot base map.

Source: US Census Bureau TIGER/Line 2023 (public domain).
  - COASTLINE (national): the Great Lakes shoreline as lines; the lake is the part of the map box on
    the water side of them (found by checking which piece contains a point known to be open lake).
  - PLACE for Illinois (17): city and village boundaries (Chicago, Evanston, Skokie, Oak Park, ...).
Runs on GitHub (see .github/workflows/geo.yml) because census.gov can't be reached from everywhere.

Output, all as [lat, lon] rings simplified to about 15 m:
  lake:   rings of Lake Michigan, cut to the map's area
  places: [{name, rings}] for every town that touches the map area
"""
import io, json, math, sys, urllib.request, zipfile
import shapefile  # pyshp

YEAR = "2023"
COAST = f"https://www2.census.gov/geo/tiger/TIGER{YEAR}/COASTLINE/tl_{YEAR}_us_coastline.zip"
OPEN_LAKE = (-87.55, 41.90)       # a point 6 km offshore from downtown: certainly lake
PLACE = f"https://www2.census.gov/geo/tiger/TIGER{YEAR}/PLACE/tl_{YEAR}_17_place.zip"
# the area covered: well past every L and Metra station (Kenosha 42.58 N, Harvard -88.61, Manhattan 41.42 N, University Park,
# the Indiana shore), wider than the map itself, so its cut edges sit off-screen. (CTABot's was 41.50-42.25 N, 88.20-87.25 W.)
S, N, W, E = 41.30, 42.72, -88.80, -87.15
SIMPLIFY_M = 15


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "nitabot map builder (+https://github.com/evan-dawkins/nitabot)"})
    return zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=300).read()))


def reader(z):
    base = [n[:-4] for n in z.namelist() if n.endswith(".shp")][0]
    return shapefile.Reader(shp=io.BytesIO(z.read(base + ".shp")), dbf=io.BytesIO(z.read(base + ".dbf")),
                            shx=io.BytesIO(z.read(base + ".shx")))


def rings(shape):
    parts = list(shape.parts) + [len(shape.points)]
    return [shape.points[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]


def rdp(pts, eps_m):
    """Simplify a ring of (lon, lat) points; eps in metres."""
    if len(pts) < 4:
        return pts
    lat0 = math.radians(sum(p[1] for p in pts) / len(pts))
    xy = [(p[0] * 111320 * math.cos(lat0), p[1] * 110540) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        best, bi = -1, -1
        for i in range(a + 1, b):
            d = abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L if L > 1 else math.hypot(xy[i][0] - ax, xy[i][1] - ay)
            if d > best:
                best, bi = d, i
        if best > eps_m:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def clip(ring):
    """Sutherland-Hodgman clip of a (lon, lat) ring to the map box."""
    def cut(pts, inside, inter):
        out = []
        for i, p in enumerate(pts):
            q = pts[i - 1]
            if inside(p):
                if not inside(q): out.append(inter(q, p))
                out.append(p)
            elif inside(q): out.append(inter(q, p))
        return out
    def ix(x):  return lambda a, b: (x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]))
    def iy(y):  return lambda a, b: (a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y)
    pts = ring
    for inside, inter in ((lambda p: p[0] >= W, ix(W)), (lambda p: p[0] <= E, ix(E)),
                          (lambda p: p[1] >= S, iy(S)), (lambda p: p[1] <= N, iy(N))):
        if not pts: break
        pts = cut(pts, inside, inter)
    return pts


def out_ring(r):
    r = rdp(clip(r), SIMPLIFY_M)
    return [[round(p[1], 5), round(p[0], 5)] for p in r] if len(r) >= 4 else None


def touches(bbox):
    x0, y0, x1, y1 = bbox
    return not (x1 < W or x0 > E or y1 < S or y0 > N)


def main():
    from shapely.geometry import LineString, Point, box
    from shapely.ops import polygonize, unary_union
    frame = box(W, S, E, N)
    lines = []
    c = reader(fetch(COAST))
    for shp in c.shapes():
        if not touches(shp.bbox):
            continue
        for part in rings(shp):
            if len(part) > 1:
                g = LineString(part).intersection(frame)
                if not g.is_empty:
                    lines.append(g)
    lake = []
    if lines:
        faces = list(polygonize(unary_union(lines + [frame.boundary])))
        water = [f for f in faces if f.contains(Point(*OPEN_LAKE))]
        for f in water:
            lake += [x for x in [out_ring(list(f.exterior.coords))] if x]
    if not lake:
        sys.exit("No Lake Michigan polygons found: stopping rather than drawing a map without the lake")

    places = []
    p = reader(fetch(PLACE))
    names = [f[0] for f in p.fields[1:]]
    for rec, shp in zip(p.records(), p.shapes()):
        r = dict(zip(names, rec))
        if not touches(shp.bbox):
            continue
        rs = [x for x in (out_ring(g) for g in rings(shp)) if x]
        if rs:
            places.append({"name": r["NAME"], "rings": rs})
    if not any(pl["name"] == "Chicago" for pl in places):
        sys.exit("Chicago's boundary is missing: stopping")

    places.sort(key=lambda pl: pl["name"])
    json.dump({"source": "US Census Bureau TIGER/Line " + YEAR, "box": [S, W, N, E], "lake": lake, "places": places},
              open("data/geo.json", "w"), separators=(",", ":"))
    print(f"lake: {len(lake)} ring(s), {sum(map(len, lake))} points; places: {len(places)}")
    print(", ".join(pl["name"] for pl in places))


if __name__ == "__main__":
    main()
