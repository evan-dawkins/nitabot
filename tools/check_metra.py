"""Checks data/metra.json (Metra's own shapes and stops) against MetraBot's hand-checked network
(data/metrabot_reference.json), and writes data/metra_issues.json.

Problems (the build stops, exit code 1):
  * a station more than 75 m from the track shape its trains use
  * one of MetraBot's 240 Metra stop ids missing from Metra's file
  * stations in a different order along the shape than on MetraBot's line
  * one of MetraBot's stations on no shape of its line
  * an inbound shape that doesn't end within 150 m of its downtown terminal

To verify (listed, the build goes on):
  * straight stretches longer than 1 km between shape points: fine if the real track is straight there,
    which tools/check_osm.py confirms against OpenStreetMap
  * Metra stops that MetraBot never mapped (new stations)

Nothing is corrected here: a problem is reported for a person to decide, never patched with a guess.
Run: python3 tools/check_metra.py
"""
import json, math, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
MAX_OFF_M, TERMINAL_M, LONG_GAP_M = 75, 150, 1000
DOWNTOWN = {"OTC", "CUS", "LSS", "MILLENNIUM"}
COSL = math.cos(math.radians(41.88))


def dist_m(a, b):
    return math.hypot((b[1] - a[1]) * 111320 * COSL, (b[0] - a[0]) * 110540)


def main():
    M = json.load(open(os.path.join(ROOT, "data", "metra.json")))
    R = json.load(open(os.path.join(ROOT, "data", "metrabot_reference.json")))
    problems, verify = [], []
    name_to_stops = {}
    for stop, name in R["stop_map"].items():
        name_to_stops.setdefault(name, set()).add(stop)

    # 1. every MetraBot stop id exists in Metra's file
    unserved = M.get("unserved_stops", {})
    for stop, name in sorted(R["stop_map"].items()):
        if stop in unserved:
            verify.append({"check": "no trains scheduled at this stop in Metra's file", "stop_id": stop,
                           "metrabot_station": name, "name": unserved[stop]["name"]})
        elif stop not in M["stations"]:
            problems.append({"check": "stop id missing", "stop_id": stop, "metrabot_station": name})
    for stop in sorted(set(M["stations"]) - set(R["stop_map"])):
        verify.append({"check": "Metra stop not in MetraBot", "stop_id": stop, "name": M["stations"][stop]["name"]})

    inbound = {rid: [p for p in L["patterns"] if p["stops"] and p["stops"][-1] in DOWNTOWN] for rid, L in M["lines"].items()}

    # 2. stations sit on their shape; 3. shapes end at their terminal; long straight stretches listed
    for rid, pats in inbound.items():
        for p in pats:
            for st, off in zip(p["stops"], p["off_m"]):
                if off > MAX_OFF_M:
                    problems.append({"check": "station off its track", "line": rid, "shape_id": p["shape_id"], "stop_id": st, "metres": off})
            term = M["stations"][p["stops"][-1]]
            d = dist_m(p["shape"][-1], (term["lat"], term["lon"]))
            if d > TERMINAL_M:
                problems.append({"check": "shape doesn't reach its terminal", "line": rid, "shape_id": p["shape_id"],
                                 "terminal": p["stops"][-1], "metres": round(d)})
            sh = p["shape"]
            for i in range(len(sh) - 1):
                g = dist_m(sh[i], sh[i + 1])
                if g > LONG_GAP_M:
                    verify.append({"check": "long straight stretch", "line": rid, "shape_id": p["shape_id"], "metres": round(g),
                                   "from": sh[i], "to": sh[i + 1]})

    # an unserved stop still has to sit on its line's track
    def off_line(lat, lon, pats):
        best = 1e18
        for p in pats:
            sh = p["shape"]
            for i in range(len(sh) - 1):
                (a0, b0), (a1, b1) = sh[i], sh[i + 1]
                ax, ay = b0 * 111320 * COSL, a0 * 110540; bx, by = b1 * 111320 * COSL, a1 * 110540
                qx, qy = lon * 111320 * COSL, lat * 110540
                dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1
                t = max(0, min(1, ((qx - ax) * dx + (qy - ay) * dy) / l2))
                best = min(best, math.hypot(ax + dx * t - qx, ay + dy * t - qy))
        return best
    for key, L in R["lines"].items():
        for br in L["routes"]:
            for s_ in br["stations"]:
                for stop in name_to_stops.get(s_["id"], set()) & set(unserved):
                    u = unserved[stop]; d = off_line(u["lat"], u["lon"], inbound.get(L["route_id"], []))
                    if d > MAX_OFF_M:
                        problems.append({"check": "station off its track", "line": L["route_id"], "stop_id": stop, "metres": round(d)})

    # 4. MetraBot's station order is kept, and every MetraBot station is on a shape of its line
    orders_ok = 0
    for key, L in R["lines"].items():
        pats = inbound.get(L["route_id"], [])
        if not pats:
            problems.append({"check": "line has no inbound shape", "line": L["route_id"]}); continue
        for br in L["routes"]:
            names = [s["id"] for s in br["stations"]]                       # downtown first
            want = [name_to_stops.get(n, set()) for n in names]
            for n, w in zip(names, want):
                if not w:
                    problems.append({"check": "MetraBot station has no stop id", "line": L["route_id"], "station": n})
            # the shape that serves most of this branch
            best = max(pats, key=lambda p: (bool(want[-1] & set(p["stops"])), sum(1 for w in want if w & set(p["stops"]))))
            seq = list(reversed(best["stops"]))                             # downtown first, like MetraBot
            pos = {s: i for i, s in enumerate(seq)}
            got = [min((pos[s] for s in w if s in pos), default=None) for w in want]
            missing = [n for n, g in zip(names, got) if g is None]
            for n in missing:
                if name_to_stops.get(n, set()) & set(unserved):
                    continue                                                # listed above: no trains scheduled there now
                if not any(w & set(p["stops"]) for p in pats for w in [name_to_stops.get(n, set())]):
                    problems.append({"check": "MetraBot station on no shape of its line", "line": L["route_id"],
                                     "branch": br["branch"] or "main", "station": n})
                else:
                    verify.append({"check": "station served by another shape of the line", "line": L["route_id"],
                                   "branch": br["branch"] or "main", "station": n, "best_shape": best["shape_id"]})
            placed = [g for g in got if g is not None]
            if placed != sorted(placed):
                bad = [(names[i], got[i]) for i in range(len(got)) if got[i] is not None]
                problems.append({"check": "station order differs from MetraBot", "line": L["route_id"],
                                 "branch": br["branch"] or "main", "shape_id": best["shape_id"], "order": bad})
            else:
                orders_ok += 1

    n_shapes = sum(len(p) for p in inbound.values())
    report = {"checked": {"metra_stations": len(M["stations"]), "metrabot_stop_ids": len(R["stop_map"]),
                          "inbound_shapes": n_shapes, "branches_in_order": orders_ok,
                          "limits_m": {"station_off_track": MAX_OFF_M, "terminal": TERMINAL_M, "long_stretch": LONG_GAP_M}},
              "openstreetmap": "not checked yet: tools/check_osm.py runs as a GitHub Action (OpenStreetMap isn't reachable from the build machine)",
              "problems": problems, "to_verify": verify}
    json.dump(report, open(os.path.join(ROOT, "data", "metra_issues.json"), "w"), indent=1)
    print(f"{len(problems)} problem(s), {len(verify)} item(s) to verify, {orders_ok} branches in MetraBot's order, {n_shapes} inbound shapes")
    for p in problems[:30]:
        print("  PROBLEM", json.dumps(p)[:220])
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
