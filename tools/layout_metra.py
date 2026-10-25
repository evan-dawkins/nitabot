"""Metra's part of the NITABot map, on the same projection as the CTA (used by tools/build_layout.py).

Inputs:  data/metra.json             (tools/build_metra.py: Metra's own track shapes and stops)
         data/metrabot_reference.json (MetraBot's line keys, colours and station names)
Each Metra line gets one route per inbound track shape Metra publishes (outer end first, downtown last, the same
direction as the CTA routes). The track is Metra's shape exactly, lightly thinned (points closer than ~5 m to a
straight line between their neighbours are dropped). Stations sit where they project onto it.
Shared track between Metra lines is not bundled yet: lines that share track are drawn on top of each other.
"""
import json

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
                                "ada": s["ada"], "sys": "metra"}
    return order
