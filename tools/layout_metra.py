"""Metra's part of the NITABot map, on the same projection as the CTA (used by tools/build_layout.py).

Inputs:  data/metra.json             (tools/build_metra.py: Metra's own track shapes and stops)
         data/metrabot_reference.json (MetraBot's line keys, colours and station names)
Each Metra line gets one route per inbound track shape Metra publishes (outer end first, downtown last, the same
direction as the CTA routes). The track is Metra's shape exactly, lightly thinned (points closer than ~5 m to a
straight line between their neighbours are dropped). Stations sit where they project onto it.
Shared track: where two Metra lines run on the same track (Ogilvie to Clybourn, Union Station north to Western Ave
and River Grove, Union Station south), each gets its own lane, side by side, like the CTA's bundles. Track counts as
shared where the lines run within ~27 m of each other for at least ~330 m. Branches of one line share track too, but
they are one colour, so they simply overlap.
"""
import json, math

DOWNTOWN = {"OTC", "CUS", "LSS", "MILLENNIUM"}
# which branch a shape is, from the stops it serves
BRANCH_BY_END = {"MCHENRY": "McHenry Branch", "BLUEISLAND": "Blue Island Branch", "93RD-SC": "South Chicago Branch"}


def add_metra(lines_out, stations, xy, rdp, proj, K):
    M = json.load(open("data/metra.json"))
    R = json.load(open("data/metrabot_reference.json"))
    names = R["stop_map"]                                   # Metra stop id -> MetraBot's "Name|Alt"
    order = []
    for key, ref in R["lines"].items():
        L = M["lines"].get(ref["route_id"])
        if not L:
            raise SystemExit(f"Metra line {ref['route_id']} missing from data/metra.json")
        routes = []
        for p in L["patterns"]:
            if not p["stops"] or p["stops"][-1] not in DOWNTOWN:
                continue                                    # outbound copies of the same track
            anc = [[round(x, 2), round(y, 2)] for x, y in rdp([xy(a, b) for a, b in p["shape"]], 0.15)]
            ds = []
            for st in p["stops"]:
                s = M["stations"][st]
                d, along = proj(anc, xy(s["lat"], s["lon"]))
                if d / K * 1000 > 75:
                    raise SystemExit(f"Metra {key}: {st} is {d / K * 1000:.0f} m off its track")
                ds.append(round(along, 2))
            if any(b <= a for a, b in zip(ds, ds[1:])):
                raise SystemExit(f"Metra {key} {p['shape_id']}: stations out of order along the track")
            branch = BRANCH_BY_END.get(p["stops"][0], "")
            if ref["route_id"] == "RI" and any("Beverly" in names.get(s, "") for s in p["stops"]):
                branch = "Beverly Branch"
            routes.append({"st": p["stops"], "anc": anc, "ds": ds, "slot": [0] * (len(anc) - 1), "branch": branch,
                           "shape_id": p["shape_id"]})
        routes.sort(key=lambda r: (r["branch"] != "", r["branch"]))   # main line first, like MetraBot
        routes = [r for r in routes]
        lines_out[key] = {"code": ref["code"], "name": ref["name"], "color": ref["color"], "api": ref["route_id"],
                          "sys": "metra", "routes": routes}
        order.append(key)
        for r in routes:
            for st in r["st"]:
                if st in stations:
                    continue
                s = M["stations"][st]
                nm = names.get(st, s["name"])
                a, _, b = nm.partition("|")
                stations[st] = {"name": a, "full": f"{a} ({b})" if b else a, "lat": s["lat"], "lon": s["lon"],
                                "ada": s["ada"], "sys": "metra", "mb": names.get(st, "")}   # mb: MetraBot's station id (voice clips use it)
    bundle(lines_out, order, K)
    return order


TOL = 0.9          # map units (~27 m): closer than this is the same track
NEAR = 30.0        # ~1 km: only here is the track checked closely
STEP = 1.0         # ~33 m: point spacing where it is checked
MIN_RUN = 10.0     # ~330 m: shorter "shared" bits are crossings or two terminals side by side, not shared track


def _seg_d(q, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy or 1e-12
    t = max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
    return math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1])


class _Grid:
    def __init__(self, polys, cell=10.0):
        self.c, self.g = cell, {}
        for P in polys:
            for a, b in zip(P, P[1:]):
                for gx in range(int(min(a[0], b[0]) // cell), int(max(a[0], b[0]) // cell) + 1):
                    for gy in range(int(min(a[1], b[1]) // cell), int(max(a[1], b[1]) // cell) + 1):
                        self.g.setdefault((gx, gy), []).append((a, b))

    def d(self, q, reach=1):
        gx, gy, best = int(q[0] // self.c), int(q[1] // self.c), 1e18
        for i in range(-reach, reach + 1):
            for j in range(-reach, reach + 1):
                for a, b in self.g.get((gx + i, gy + j), ()):
                    best = min(best, _seg_d(q, a, b))
        return best


def bundle(lines_out, order, K):
    grids = {k: _Grid([r["anc"] for r in lines_out[k]["routes"]]) for k in order}
    far = {k: _Grid([r["anc"] for r in lines_out[k]["routes"]], cell=NEAR) for k in order}
    for k in order:
        others = [o for o in order if o != k]
        for r in lines_out[k]["routes"]:
            # 1. points: closely spaced wherever another line is within ~1 km
            pts = [r["anc"][0]]
            for a, b in zip(r["anc"], r["anc"][1:]):
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                close = any(far[o].d(a) < NEAR or far[o].d(b) < NEAR for o in others)
                n = max(1, int(L // STEP)) if close else 1
                pts += [[round(a[0] + (b[0] - a[0]) * i / n, 2), round(a[1] + (b[1] - a[1]) * i / n, 2)] for i in range(1, n + 1)]
            # 2. which other lines share each point's track
            near = [frozenset(o for o in others if grids[o].d(p) < TOL) for p in pts]
            # 3. a piece is shared with a line when both its ends are; drop runs shorter than MIN_RUN
            seg = [near[i] & near[i + 1] for i in range(len(pts) - 1)]
            for o in others:
                i = 0
                while i < len(seg):
                    if o in seg[i]:
                        j, run = i, 0.0
                        while j < len(seg) and o in seg[j]:
                            run += math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j += 1
                        if run < MIN_RUN:
                            for x in range(i, j):
                                seg[x] = seg[x] - {o}
                        i = j
                    else:
                        i += 1
            # 4. lane: one fixed order of lines (MetraBot's), centred on the shared track
            slot = []
            for sh in seg:
                ls = [x for x in order if x == k or x in sh]
                slot.append(round(ls.index(k) - (len(ls) - 1) / 2, 2))
            # 5. stations keep their distance along the (unchanged) track
            r["anc"], r["slot"] = pts, slot
            c = [0.0]
            for a, b in zip(pts, pts[1:]):
                c.append(c[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
            tot = c[-1]
            r["ds"] = [round(min(d, tot), 2) for d in r["ds"]]
