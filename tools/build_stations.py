"""Builds data/stations.json for CTABot from CTA's official GTFS timetable.

Runs on GitHub (see .github/workflows/stations.yml), because it needs to download
https://www.transitchicago.com/downloads/sch_data/google_transit.zip (about 100 MB).

What it writes:
  stations: every L station (CTA "map id", 4xxxx) with its real position and the lines that stop there
  lines:    for each L line, every distinct stopping pattern (station ids in order), longest first,
            plus the line's real track shape (simplified) for checking the schematic against
  platforms: platform stop id (3xxxx) -> station id, so arrivals and alerts can be matched up

Nothing is guessed: if CTA's file doesn't say it, it isn't in the output.
"""
import csv, io, json, math, sys, urllib.request, zipfile
from collections import defaultdict, Counter

URL = "https://www.transitchicago.com/downloads/sch_data/google_transit.zip"
LINES = {"Red": "Red", "Blue": "Blue", "Brn": "Brown", "G": "Green", "Org": "Orange", "P": "Purple", "Pink": "Pink", "Y": "Yellow"}


def rows(z, name):
    with z.open(name) as f:
        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))


def rdp(pts, eps):
    """Ramer-Douglas-Peucker on (lat, lon) points, eps in metres. Iterative, so long shapes don't overflow."""
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[0] for p in pts) / len(pts))
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 110540) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        best, bi = -1, -1
        for i in range(a + 1, b):
            # a loop line starts and ends at the same spot: measure from that point instead of a zero-length line
            d = abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / L if L > 1 else math.hypot(xy[i][0] - ax, xy[i][1] - ay)
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def is_subsequence(short, long_):
    it = iter(long_)
    return all(x in it for x in short)


def main(path=None):
    if path:
        z = zipfile.ZipFile(path)
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "nitabot station builder (+https://github.com/evan-dawkins/nitabot)"})
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=300).read()))

    routes = {r["route_id"]: r for r in rows(z, "routes.txt") if r["route_id"] in LINES}
    missing = set(LINES) - set(routes)
    if missing:
        sys.exit(f"CTA's file is missing L routes {sorted(missing)}: stopping rather than writing a partial map")

    stops = {s["stop_id"]: s for s in rows(z, "stops.txt")}
    trips = {}
    for t in rows(z, "trips.txt"):
        if t["route_id"] in routes:
            trips[t["trip_id"]] = (LINES[t["route_id"]], t.get("shape_id", ""), t.get("direction_id", ""))

    seqs = defaultdict(list)                                  # trip -> [(sequence, platform stop id)]
    for st in rows(z, "stop_times.txt"):
        if st["trip_id"] in trips:
            seqs[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"]))

    def station_of(stop_id):
        s = stops.get(stop_id)
        if not s:
            return None
        return s["parent_station"] or (stop_id if s.get("location_type") == "1" else None)

    platforms = {}
    patterns = defaultdict(Counter)                           # line -> Counter(tuple of station ids)
    pattern_shape = {}
    for trip_id, st in seqs.items():
        line, shape_id, _ = trips[trip_id]
        st.sort()
        ids = []
        for _, pid in st:
            sid = station_of(pid)
            if not sid:
                continue
            platforms[pid] = sid
            if not ids or ids[-1] != sid:
                ids.append(sid)
        if len(ids) >= 2:
            key = tuple(ids)
            patterns[line][key] += 1
            pattern_shape.setdefault((line, key), shape_id)

    used_shapes = set(pattern_shape.values())
    shape_pts = defaultdict(list)
    for s in rows(z, "shapes.txt"):
        if s["shape_id"] in used_shapes:
            shape_pts[s["shape_id"]].append((int(s["shape_pt_sequence"]), float(s["shape_pt_lat"]), float(s["shape_pt_lon"])))

    lines_out, station_lines = {}, defaultdict(set)
    for line in LINES.values():
        pats = sorted(patterns[line].items(), key=lambda kv: (-len(kv[0]), -kv[1]))
        kept = []                                             # drop patterns that are just a piece of a longer one (short turns)
        for p, n in pats:
            if any(is_subsequence(p, k) or is_subsequence(p[::-1], k) for k, _ in kept):
                continue
            kept.append((p, n))
        out = []
        for p, n in kept:
            sh = sorted(shape_pts.get(pattern_shape[(line, p)], []))
            out.append({"stations": list(p), "trips": n,
                        "shape": [[round(a, 5), round(b, 5)] for a, b in rdp([(a, b) for _, a, b in sh], 8)]})
            for sid in p:
                station_lines[sid].add(line)
        lines_out[line] = out

    stations = []
    for sid in sorted(station_lines):
        s = stops[sid]
        stations.append({"id": sid, "name": s["stop_name"], "lat": round(float(s["stop_lat"]), 6),
                         "lon": round(float(s["stop_lon"]), 6), "lines": sorted(station_lines[sid]),
                         "accessible": s.get("wheelchair_boarding") == "1"})

    data = {"source": URL, "stations": stations, "lines": lines_out,
            "platforms": dict(sorted(platforms.items()))}
    with open("data/stations.json", "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{len(stations)} stations, {len(platforms)} platforms")
    for line, pats in lines_out.items():
        print(f"  {line}: {len(pats)} pattern(s), longest {len(pats[0]['stations']) if pats else 0} stations")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
