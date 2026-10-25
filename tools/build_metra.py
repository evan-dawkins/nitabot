"""Builds data/metra.json for NITABot from Metra's official GTFS timetable (schedule.zip).

What it writes:
  stations: every Metra stop that trains use: Metra's stop id, name, position, accessibility
  lines:    for each Metra line, one entry per track shape Metra publishes (inbound direction, outer end first):
            the shape's points, the stations its trips stop at in order along it, and how far along the shape each one is

Nothing is guessed: positions, shapes and stop lists all come from Metra's file. Any station the checks
in tools/check_metra.py can't place is reported there, not fixed here.

Metra is changing its trip, service and shape ids (developer notice, Oct 2026), so every id is kept as plain text
and files are read by column name, never by position.

Usage: python3 tools/build_metra.py [path/to/schedule.zip]
With no path it downloads https://schedules.metrarail.com/gtfs/schedule.zip (a GitHub Action does this).
"""
import csv, io, json, math, os, sys, urllib.request, zipfile
from collections import defaultdict, Counter

URL = "https://schedules.metrarail.com/gtfs/schedule.zip"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "metra.json")
COSL = math.cos(math.radians(41.88))


def rows(z, name):
    with z.open(name) as f:
        rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        head = [h.strip().lower() for h in next(rd)]          # Metra's headers have carried stray spaces
        for r in rd:
            yield {k: (v.strip() if v else "") for k, v in zip(head, r)}


def m_xy(lat, lon):                                           # metres, good enough for distances in the region
    return (lon * 111320 * COSL, lat * 110540)


def project(P, q):
    """(distance in m from q to polyline P, metres along P to that closest point). P in metres."""
    best, acc = (1e18, 0.0), 0.0
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
        d = math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1])
        if d < best[0]:
            best = (d, acc + t * math.sqrt(l2))
        acc += math.sqrt(l2)
    return best


def main():
    if len(sys.argv) > 1:
        data = open(sys.argv[1], "rb").read()
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "nitabot map builder (+https://github.com/evan-dawkins/nitabot)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    for need in ("stops.txt", "trips.txt", "stop_times.txt", "shapes.txt", "routes.txt"):
        if need not in names:
            sys.exit(f"Metra's timetable has no {need}: stopping, nothing saved")

    version = ""
    if "feed_info.txt" in names:                              # arrives with Metra's new-format feed
        for r in rows(z, "feed_info.txt"):
            version = r.get("feed_version", "")
    routes = {r["route_id"]: r for r in rows(z, "routes.txt")}
    stops = {r["stop_id"]: r for r in rows(z, "stops.txt")}
    trip_shape, trip_route = {}, {}
    for r in rows(z, "trips.txt"):
        if r.get("shape_id"):
            trip_shape[r["trip_id"]] = r["shape_id"]
            trip_route[r["trip_id"]] = r["route_id"]
    shapes = defaultdict(list)
    for r in rows(z, "shapes.txt"):
        shapes[r["shape_id"]].append((float(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    on_shape, trips_on = defaultdict(set), Counter()
    seen_trip = set()
    for r in rows(z, "stop_times.txt"):
        tid = r["trip_id"]
        sid = trip_shape.get(tid)
        if not sid:
            continue
        on_shape[sid].add(r["stop_id"])
        if tid not in seen_trip:
            seen_trip.add(tid); trips_on[sid] += 1
    shape_route = {}
    for tid, sid in trip_shape.items():
        shape_route.setdefault(sid, trip_route[tid])

    lines, used = {}, set()
    skipped = []
    for sid in sorted(shapes):
        if trips_on[sid] == 0:
            skipped.append(sid); continue
        pts = [(la, lo) for _, la, lo in sorted(shapes[sid])]
        P = [m_xy(*p) for p in pts]
        placed = []
        for st in on_shape[sid]:
            s = stops[st]
            d, along = project(P, m_xy(float(s["stop_lat"]), float(s["stop_lon"])))
            placed.append((along, st, round(d, 1)))
        placed.sort()
        # inbound = toward downtown: the shape should end at a downtown terminal; a pattern that doesn't is kept,
        # and tools/check_metra.py reports it
        rid = shape_route[sid]
        L = lines.setdefault(rid, {"name": routes.get(rid, {}).get("route_long_name", rid),
                                   "color": "#" + routes.get(rid, {}).get("route_color", "888888"), "patterns": []})
        L["patterns"].append({"shape_id": sid, "trips": trips_on[sid],
                              "stops": [p[1] for p in placed], "along_m": [round(p[0]) for p in placed],
                              "off_m": [p[2] for p in placed],
                              "shape": [[round(la, 6), round(lo, 6)] for la, lo in pts]})
        used.update(on_shape[sid])

    stations = {}
    for st in sorted(used):
        s = stops[st]
        stations[st] = {"name": s["stop_name"], "lat": round(float(s["stop_lat"]), 6), "lon": round(float(s["stop_lon"]), 6),
                        "ada": s.get("wheelchair_boarding") == "1",
                        "lines": sorted(rid for rid, L in lines.items() if any(st in p["stops"] for p in L["patterns"]))}
    for L in lines.values():
        L["patterns"].sort(key=lambda p: (-len(p["stops"]), p["shape_id"]))
    # stops in Metra's list that no scheduled train uses right now (seasonal, closed for work, ...): kept with their
    # position so the checks can still place them, but never drawn as served
    unserved = {st: {"name": s["stop_name"], "lat": round(float(s["stop_lat"]), 6), "lon": round(float(s["stop_lon"]), 6)}
                for st, s in sorted(stops.items()) if st not in used and s.get("stop_lat")}
    out = {"source": "Metra GTFS timetable (schedule.zip)" + (f", feed_version {version}" if version else ""),
           "note": "Built by tools/build_metra.py. Shapes and stops exactly as Metra publishes them.",
           "stations": stations, "unserved_stops": unserved, "lines": {k: lines[k] for k in sorted(lines)}, "skipped_shapes": skipped}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"data/metra.json: {len(stations)} stations, {len(lines)} lines, "
          f"{sum(len(L['patterns']) for L in lines.values())} shapes ({len(skipped)} without trips skipped), "
          f"{len(unserved)} stop(s) with no scheduled trains")


if __name__ == "__main__":
    main()
