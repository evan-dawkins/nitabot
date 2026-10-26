"""Builds the CTABot map from CTA's own data, and bakes it into index.html.

Inputs:  data/stations.json (tools/build_stations.py: CTA stations, stop patterns, real track shapes)
         data/geo.json      (tools/build_geo.py: Lake Michigan shoreline, city and town boundaries)
Output:  data/network.json, and the same data written into index.html between /*NET:BEGIN*/ and /*NET:END*/
         (so the page works on its own, like MetraBot).

How the map is drawn, so it can be checked:
 * True geography. 1 map unit = 1/30 km. Nothing is enlarged: the Loop is its real size and you zoom in to read it.
 * Every line follows CTA's real track shape between its stations.
 * Express runs (Purple Express on the Red Line's tracks, Red past Wellington/Diversey) are routed along the
   track they really use, so they draw beside the local line.
 * Shared track: where two lines' tracks leave a station together, the point where they really split is found
   from the shapes, and a junction is placed there. The shared part becomes one piece of track carrying both
   lines, so the page can draw them side by side (a bundle) at any zoom.
 * Side-by-side order follows one fixed order, oriented clockwise around the Loop, so a line keeps its place in
   the bundle all the way round.

Run: python tools/build_layout.py   (no network needed; numpy not needed)
"""
import json, math, os, re
from collections import defaultdict

K = 30.0                                         # map units per km
LAT0, LON0 = 42.25, -88.20                       # top-left corner of the data (matches tools/build_geo.py)
LAT1, LON1 = 41.50, -87.25
COSL = math.cos(math.radians(41.88))
ORDER = ["Purple", "Brown", "Orange", "Pink", "Green", "Red", "Blue", "Yellow"]   # side-by-side order on shared track
TOL = 0.9                                        # two tracks closer than this (~27 m) are the same track
MIN_SHARED = 2.0                                 # ...for at least this long (~66 m) before it counts as shared
# CTA colours; Brown and Purple lifted a little so they read on the dark theme too
KEYS = {"Red": ("red", "Red Line", "#C60C30", "Red"), "Blue": ("blue", "Blue Line", "#00A1DE", "Blue"),
        "Brown": ("brn", "Brown Line", "#8A5A36", "Brown"), "Green": ("g", "Green Line", "#009B3A", "Green"),
        "Orange": ("org", "Orange Line", "#F9461C", "Orange"), "Purple": ("p", "Purple Line", "#6A40C0", "Purple"),
        "Pink": ("pink", "Pink Line", "#E27EA6", "Pink"), "Yellow": ("y", "Yellow Line", "#F9E300", "Yellow")}
BRANCH = {"Green": ["Ashland/63rd branch", "Cottage Grove branch"]}
# Only the suburbs the L actually runs through are drawn (plus Chicago itself), most important first
TOWN_LABELS = ["Evanston", "Oak Park", "Skokie", "Forest Park", "Cicero", "Wilmette", "Rosemont"]


def xy(lat, lon):
    return ((lon - LON0) * 111.32 * COSL * K, (LAT0 - lat) * 110.54 * K)


BOX = {"x0": 0.0, "y0": 0.0, "x1": round(xy(LAT1, LON1)[0], 1), "y1": round(xy(LAT1, LON1)[1], 1)}   # what the base map covers


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def plen(p):
    return sum(dist(p[i], p[i + 1]) for i in range(len(p) - 1))


def proj(p, q):
    """Closest point to q on polyline p: (distance, arc length along p)."""
    best, acc = (1e18, 0.0), 0.0
    for i in range(len(p) - 1):
        a, b = p[i], p[i + 1]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
        d = math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1])
        if d < best[0]:
            best = (d, acc + t * math.sqrt(l2))
        acc += math.sqrt(l2)
    return best


def point_at(p, s):
    acc = 0.0
    for i in range(len(p) - 1):
        l = dist(p[i], p[i + 1])
        if acc + l >= s and l > 0:
            t = (s - acc) / l
            return (p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t)
        acc += l
    return tuple(p[-1])


def cut(p, s0, s1):
    """Piece of polyline p between arc lengths s0 < s1."""
    out, acc = [point_at(p, s0)], 0.0
    for i in range(len(p) - 1):
        acc += dist(p[i], p[i + 1])
        if s0 < acc < s1:
            out.append(tuple(p[i + 1]))
    out.append(point_at(p, s1))
    return out


def rdp(pts, eps):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / L if L > 1e-9 else dist(pts[i], pts[a])
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


LOOP_LINES = {"Brown", "Green", "Orange", "Pink", "Purple", "Blue"}   # the elevated Loop, and the Blue subway right under Lake St
                                                              # (drawn alongside it there); not the Red Line's State St subway
SNAP = 1.6                                                    # ~50 m: track this close to a Loop side is on it


def straighten_loop(E, pos_of, T):
    """The Loop runs straight along Lake, Wabash, Van Buren and Wells. CTA's shapes wobble a little there (a dip at
    Clark/Lake, a slant on Wells): put the elevated track exactly on those four straight streets."""
    sides = {"wells": ("x", ["40730", "40040"]), "wabash": ("x", ["41700", "40680"]),
             "lake": ("y", ["40380"]), "vanburen": ("y", ["40160", "40850"])}
    v = {}
    for k, (ax, ids) in sides.items():
        pts = [T[i] for i in ids if i in T]
        if not pts:
            print(f"::warning::Loop side {k}: stations not found, Loop not straightened"); return
        v[k] = sum(q[0 if ax == "x" else 1] for q in pts) / len(pts)
    x0, x1, y0, y1 = v["wells"] - 3, v["wabash"] + 3, v["lake"] - 3, v["vanburen"] + 3

    def snap(q):
        x, y = q
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return q
        if abs(x - v["wells"]) < SNAP: x = v["wells"]
        if abs(x - v["wabash"]) < SNAP: x = v["wabash"]
        if abs(y - v["lake"]) < SNAP: y = v["lake"]
        if abs(y - v["vanburen"]) < SNAP: y = v["vanburen"]
        return (x, y)
    loop_node = defaultdict(lambda: True)
    for e in E.values():
        if not e["lines"] <= LOOP_LINES:
            loop_node[e["a"]] = loop_node[e["b"]] = False
    for n in list(pos_of):
        if loop_node[n]:
            pos_of[n] = snap(pos_of[n])
    moved = 0
    for e in E.values():
        if e["lines"] <= LOOP_LINES:
            new = [snap(q) for q in e["pts"]]
            moved += sum(1 for a, b in zip(new, e["pts"]) if a != b)
            e["pts"] = new
        e["pts"][0], e["pts"][-1] = pos_of[e["a"]], pos_of[e["b"]]
        e["pts"] = rdp(e["pts"], 0.05)
    print(f"Loop straightened: {moved} track points put on Lake/Wabash/Van Buren/Wells")


SMOOTH_W = 5.0                                                # ~150 m: bends are rounded over about this far either side
STEP = 0.25                                                   # ~8 m resampling while smoothing


def rdp3(pts, eps):
    """Ramer-Douglas-Peucker on (x, y, w): keeps a point where the line bends OR where its lane is changing."""
    if len(pts) < 3:
        return list(range(len(pts)))
    keep = [0, len(pts) - 1]; stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        ab = [b[k] - a[k] for k in range(3)]; L2 = sum(v * v for v in ab)
        best, bi = 0.0, -1
        for m in range(i + 1, j):
            q = pts[m]; aq = [q[k] - a[k] for k in range(3)]
            t = 0 if L2 == 0 else max(0, min(1, sum(aq[k] * ab[k] for k in range(3)) / L2))
            d = math.sqrt(sum((aq[k] - t * ab[k]) ** 2 for k in range(3)))
            if d > best:
                best, bi = d, m
        if best > eps:
            keep.append(bi); stack += [(i, bi), (bi, j)]
    return sorted(set(keep))


def smooth_route(anc, slot, stops):
    """Rounds every bend into a smooth curve and eases every change of lane (as on CTA's map): the route is resampled
    every ~8 m, each point (and its lane) averaged with its neighbours within ~100 m along the track, then thinned
    again. The curve is part of the line's geometry, so trains run round it too. Stops are tracked by index."""
    n = len(anc)
    seg = [dist(anc[i], anc[i + 1]) for i in range(n - 1)]
    cum = [0.0]
    for L_ in seg:
        cum.append(cum[-1] + L_)
    total = cum[-1]
    # resample: every STEP along the track, plus every original vertex (so stops land exactly on a sample)
    ss = sorted(set([round(c, 4) for c in cum] + [round(k * STEP, 4) for k in range(int(total / STEP) + 1)]))
    pts, sl, i = [], [], 0
    for sv in ss:
        while i < n - 2 and cum[i + 1] < sv:
            i += 1
        L_ = seg[i] or 1
        t = max(0.0, min(1.0, (sv - cum[i]) / L_))
        pts.append((anc[i][0] + (anc[i + 1][0] - anc[i][0]) * t, anc[i][1] + (anc[i + 1][1] - anc[i][1]) * t))
        sl.append(slot[min(i, len(slot) - 1)])
    idx_of = {round(c, 4): k for k, c in enumerate(ss)}
    stop_k = [idx_of[round(cum[j], 4)] for j in stops]
    # moving average along the track (window shrinks near the ends, so the ends stay put)
    m = len(pts)
    px = [0.0] + list(__import__("itertools").accumulate(q[0] for q in pts))
    py = [0.0] + list(__import__("itertools").accumulate(q[1] for q in pts))
    pw = [0.0] + list(__import__("itertools").accumulate(sl))
    out, osl = [], []
    from bisect import bisect_left, bisect_right
    for k in range(m):
        w = min(SMOOTH_W, ss[k], total - ss[k])
        lo2 = bisect_left(ss, ss[k] - w - 1e-9); hi = bisect_right(ss, ss[k] + w + 1e-9) - 1
        c = hi - lo2 + 1
        out.append(((px[hi + 1] - px[lo2]) / c, (py[hi + 1] - py[lo2]) / c))
        osl.append((pw[hi + 1] - pw[lo2]) / c)
    # thin it out again, keeping bends, lane changes and every stop
    keep = set(rdp3([(q[0], q[1], w * 2.0) for q, w in zip(out, osl)], 0.015)) | set(stop_k)
    keep = sorted(keep)
    pos = {k: j for j, k in enumerate(keep)}
    new = [out[k] for k in keep]
    nsl = [round((osl[a] + osl[b]) / 2, 2) for a, b in zip(keep, keep[1:])]
    return new, nsl, [pos[k] for k in stop_k]


def main():
    d = json.load(open("data/stations.json"))
    st = {s["id"]: s for s in d["stations"]}
    P = {sid: xy(s["lat"], s["lon"]) for sid, s in st.items()}

    # ---- 1. track between each pair of neighbouring stations, cut from CTA's real shapes
    geom = {}                                                  # frozenset(a,b) -> (a, b, pts from a to b)
    direct = defaultdict(set)                                  # frozenset(a,b) -> lines stopping at both, back to back
    placed = []                                                # (line, stops, shape, where each stop sits along the shape)
    on_track = defaultdict(list)                               # station -> the points on real track nearest to it
    offshape = []                                              # (line, station) more than 130 m from CTA's own track shape
    for line, pats in d["lines"].items():
        for p in sorted(pats, key=lambda q: -q["trips"]):
            seq = p["stations"]
            shape = [xy(a, b) for a, b in p["shape"]]
            pos, last = [], 0.0
            for sid in seq:                                     # where each stop sits along the shape (always moving forward)
                if len(shape) < 2:
                    pos.append(None); continue
                cands = []; acc = 0.0
                for i in range(len(shape) - 1):
                    a, b = shape[i], shape[i + 1]; l = dist(a, b)
                    if acc + l < last - 1e-6:
                        acc += l; continue
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    t = 0.0 if l == 0 else max(0.0, min(1.0, ((P[sid][0] - a[0]) * dx + (P[sid][1] - a[1]) * dy) / (l * l)))
                    s = max(last, acc + t * l)
                    cands.append((dist(point_at(shape, s), P[sid]), s))
                    acc += l
                # a route can pass the same spot twice (in, and back out): take the FIRST place it really reaches the stop
                best = None
                if cands:
                    m = min(c[0] for c in cands)
                    best = min((c for c in cands if c[0] <= m + 0.6), key=lambda c: c[1])
                pos.append(best[1] if best and best[0] < 4.0 else None)   # >130 m off the shape: don't trust the shape here
                if not (best and best[0] < 4.0) and len(shape) >= 2:
                    offshape.append((line, sid))
                if best and best[0] < 4.0:
                    last = best[1]; on_track[sid].append((line, point_at(shape, best[1])))
            placed.append((line, seq, shape, pos))
    # a station far from its line's track shape gets a straight line instead of real track: say so in the Actions log
    for line, sid in sorted(set(offshape)):
        print(f"::warning::{line}: {st[sid]['name']} ({sid}) is over 130 m from CTA's track shape, so it's joined with a straight line")
    # CTA's station coordinates can sit 10-20 m off the track: each station is drawn ON its track instead
    # (the average of where each line's track passes it), so the line runs straight through, no kink
    # A station whose lines run on separate tracks (Roosevelt: Red subway, Green/Orange elevated) gets one point per
    # track, so every line runs straight through its own platform; the page joins them into one station marker.
    mean = lambda pts: (sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts))
    T, ALIAS = {}, {}
    for sid in list(P):
        pts = on_track[sid]
        if not pts:
            T[sid] = P[sid]; continue
        core = max(pts, key=lambda a: sum(dist(a[1], b[1]) <= 0.8 for b in pts))[1]
        T[sid] = mean([q for _, q in pts if dist(q, core) <= 0.8])
        for line in {l for l, q in pts if dist(q, core) > 0.8}:
            a = f"{sid}@{line}"; ALIAS[(sid, line)] = a
            T[a] = P[a] = mean([q for l, q in pts if l == line])
    node = lambda sid, line: ALIAS.get((sid, line), sid)
    for line, seq, shape, pos in placed:
            for i in range(len(seq) - 1):
                a, b = node(seq[i], line), node(seq[i + 1], line)
                if a == b:
                    continue
                key = frozenset((a, b)); direct[key].add(line)
                if key in geom:
                    continue
                if pos[i] is not None and pos[i + 1] is not None and pos[i + 1] > pos[i] + 0.3:
                    g = [T[a]] + cut(shape, pos[i], pos[i + 1])[1:-1] + [T[b]]
                else:
                    g = [T[a], T[b]]
                geom[key] = (a, b, g)

    graph = defaultdict(set)
    for k in geom:
        a, b = tuple(k); graph[a].add(b); graph[b].add(a)

    def via_path(a, b):
        """An express hop: a route through other stations almost as short as the direct one, on real track."""
        best, direct_len = None, dist(P[a], P[b])
        stack = [(a, [a], 0.0)]
        while stack:
            u, path, L = stack.pop()
            if L > direct_len * 1.2 or len(path) > 14:
                continue
            for v in graph[u]:
                if v in path or (u == a and v == b):
                    continue
                L2 = L + dist(P[u], P[v])
                if v == b:
                    if len(path) >= 2 and L2 <= direct_len * 1.2 and (best is None or L2 < best[1]):
                        best = (path + [b], L2)
                    continue
                stack.append((v, path + [v], L2))
        return best and best[0]

    # ---- 2. each line's routes: loop lines run out to the Loop and once around it (cut where a station repeats)
    routes = {}
    for line, pats in d["lines"].items():
        rs = []
        for p in pats:
            seq = p["stations"]
            for i, sid in enumerate(seq):
                if sid in seq[:i]:
                    seq = seq[:i + 1]; break
            seq_n = [node(x, line) for x in seq]
            drawn = [seq_n[0]]
            for a, b in zip(seq_n, seq_n[1:]):
                others = direct[frozenset((a, b))] - {line}
                path = None if others else via_path(a, b)
                drawn += path[1:] if path else [b]
            rs.append({"stops": seq, "nodes": seq_n, "drawn": drawn})
        routes[line] = rs

    # ---- 3. pieces of track: start one per neighbouring pair, then split shared stretches at real junctions
    E = {}                                                       # id -> {"a","b","pts","lines"}
    nid = [0]
    def new_edge(a, b, pts, lines):
        nid[0] += 1; E[nid[0]] = {"a": a, "b": b, "pts": [tuple(q) for q in pts], "lines": set(lines)}; return nid[0]
    chain = {}                                                   # frozenset(a,b) -> list of edge ids from a toward b (with a's id)
    pos_of = dict(T)
    for line, rs in routes.items():
        for r in rs:
            for a, b in zip(r["drawn"], r["drawn"][1:]):
                k = frozenset((a, b))
                if k not in chain:
                    ga, gb, g = geom[k]
                    chain[k] = (ga, [new_edge(ga, gb, g, [])])
                E[chain[k][1][0]]["lines"].add(line)
    # chains stay valid while edges are split: each original hop maps to the ordered edge ids that make it up
    def replace_in_chains(eid, a_side, parts):
        """Edge eid (from node a_side) was split into parts (ids, in order from a_side)."""
        for k, (start, ids) in chain.items():
            if eid in ids:
                i = ids.index(eid)
                # walk the chain to know which end of eid comes first
                node = start
                for j in range(i):
                    e = E[ids[j]]; node = e["b"] if e["a"] == node else e["a"]
                seq = parts if node == a_side else list(reversed(parts))
                chain[k] = (start, ids[:i] + seq + ids[i + 1:])

    def oriented(eid, frm):
        e = E[eid]
        return e["pts"] if e["a"] == frm else e["pts"][::-1]

    def shared_len(p1, p2):
        """How far p1 and p2 (both starting at the same node) run along the same track."""
        L1, s, step = plen(p1), 0.0, 0.3
        while s <= L1:
            q = point_at(p1, s)
            if proj(p2, q)[0] > TOL:
                return max(0.0, s - step)
            s += step
        return L1

    jn = [0]
    for _ in range(60):
        changed = False
        inc = defaultdict(list)
        for eid, e in E.items():
            inc[e["a"]].append(eid); inc[e["b"]].append(eid)
        for X in list(inc):
            ids = inc[X]
            for i in range(len(ids)):
                for j in range(len(ids)):
                    if i == j or changed:
                        continue
                    e1, e2 = ids[i], ids[j]
                    if e1 not in E or e2 not in E:
                        continue
                    p1, p2 = oriented(e1, X), oriented(e2, X)
                    far1 = E[e1]["b"] if E[e1]["a"] == X else E[e1]["a"]
                    far2 = E[e2]["b"] if E[e2]["a"] == X else E[e2]["a"]
                    if far1 == far2:
                        if shared_len(p1, p2) >= plen(p1) - 0.5:          # the same track twice: merge
                            E[e1]["lines"] |= E[e2]["lines"]
                            for k, (start, cids) in chain.items():
                                if e2 in cids:
                                    chain[k] = (start, [e1 if c == e2 else c for c in cids])
                            del E[e2]; changed = True
                        continue
                    L1, L2 = plen(p1), plen(p2)
                    s = shared_len(p1, p2)
                    if s < MIN_SHARED:
                        continue
                    if s >= L1 - 0.6:
                        # all of e1 lies along e2. Only a junction may sit mid-track; a station there would be one
                        # this line passes without stopping, which the express routing already handles.
                        if not str(far1).startswith("J") or s >= L2 - 0.6:
                            if str(far1).startswith("J") and str(far2).startswith("J") and dist(pos_of[far1], pos_of[far2]) < 1.5:
                                # two junctions found from different sides at the same spot: make them one
                                for eid, e in E.items():
                                    if e["a"] == far2: e["a"] = far1; e["pts"][0] = pos_of[far1]
                                    if e["b"] == far2: e["b"] = far1; e["pts"][-1] = pos_of[far1]
                                changed = True
                            continue
                        s2 = proj(p2, pos_of[far1])[1]
                        if s2 < 0.6 or s2 > L2 - 0.6:
                            continue
                        J = far1
                        other2 = far2
                        a2 = cut(p2, 0, s2); b2 = cut(p2, s2, L2)
                        a2[-1] = pos_of[J]; b2[0] = pos_of[J]
                        n1 = new_edge(X, J, a2, E[e2]["lines"]); n2 = new_edge(J, other2, b2, E[e2]["lines"])
                        replace_in_chains(e2, X, [n1, n2]); del E[e2]; changed = True
                        continue
                    if s >= L2 - 0.6:
                        continue                                        # handled when the pair is seen the other way round
                    # a real split: new junction where they part
                    jn[0] += 1; J = f"J{jn[0]}"
                    q = point_at(p1, s); pos_of[J] = q
                    s2 = proj(p2, q)[1]
                    a1, b1 = cut(p1, 0, s), cut(p1, s, L1)
                    a2, b2 = cut(p2, 0, s2), cut(p2, s2, L2)
                    a1[-1] = b1[0] = a2[-1] = b2[0] = q
                    shared = new_edge(X, J, a1, E[e1]["lines"] | E[e2]["lines"])
                    r1 = new_edge(J, far1, b1, E[e1]["lines"]); r2 = new_edge(J, far2, b2, E[e2]["lines"])
                    replace_in_chains(e1, X, [shared, r1]); replace_in_chains(e2, X, [shared, r2])
                    del E[e1], E[e2]; changed = True
            if changed:
                break
        if not changed:
            break
    # lines on each piece of track: recompute from the chains (merges may have moved them)
    for e in E.values():
        e["lines"] = set()
    for line, rs in routes.items():
        for r in rs:
            for a, b in zip(r["drawn"], r["drawn"][1:]):
                for eid in chain[frozenset((a, b))][1]:
                    E[eid]["lines"].add(line)
    for e in E.values():
        e["pts"] = rdp(e["pts"], 1.0)                           # ~30 m: irons out wobbles in the raw shapes, keeps real curves
    straighten_loop(E, pos_of, T)

    # ---- 4. which side of a bundle each line takes: one order, oriented clockwise round the Loop
    lc = (P[next(s for s in st if st[s]["name"] == "Clark/Lake")][0] + 7, P[next(s for s in st if st[s]["name"] == "Clark/Lake")][1] + 13)
    # how far each node is from the Loop, along the track (so "outward" means the same thing all along a corridor)
    import heapq
    adj = defaultdict(list)
    for e in E.values():
        L_ = plen(e["pts"]); adj[e["a"]].append((e["b"], L_)); adj[e["b"]].append((e["a"], L_))
    loop_nodes = [n for n in pos_of if dist(pos_of[n], lc) < 0.75 * K]
    far = {n: 0.0 for n in loop_nodes}; heap = [(0.0, n) for n in loop_nodes]
    while heap:
        dd, u = heapq.heappop(heap)
        if dd > far.get(u, 1e18): continue
        for v, w in adj[u]:
            if dd + w < far.get(v, 1e18): far[v] = dd + w; heapq.heappush(heap, (dd + w, v))
    def edge_flip(e):
        if dist(pos_of[e["a"]], lc) >= 0.75 * K or dist(pos_of[e["b"]], lc) >= 0.75 * K:
            fa, fb = far.get(e["a"], 0.0), far.get(e["b"], 0.0)
            return fb < fa                                             # stored direction: away from the Loop
        (x0, y0), (x1, y1) = e["pts"][0], e["pts"][-1]
        mx, my = (x0 + x1) / 2 - lc[0], (y0 + y1) / 2 - lc[1]
        dx, dy = x1 - x0, y1 - y0
        r = math.hypot(mx, my) or 1
        tang, rad = (dx * -my + dy * mx) / r, (dx * mx + dy * my) / r
        return tang < 0 if abs(tang) > abs(rad) * .4 else rad < 0     # stored direction: clockwise, or outward

    # ---- 4b. steady bundles: a line keeps the same sideways position from one piece of track to the next.
    # Each piece gets a sideways shift (in line widths) for its whole bundle, chosen so that every line that
    # carries on from one piece to the next stays put; a mild pull keeps bundles near their track's centre.
    def canon_slot(e, line):
        ls = [l for l in ORDER if l in e["lines"]]
        return ls.index(line) - (len(ls) - 1) / 2
    walks = []                                                   # per line route: [(edge id, +1 if travelled in stored direction)]
    for line, rs in routes.items():
        for r in rs:
            w = []
            for a, b in zip(r["drawn"], r["drawn"][1:]):
                start, ids = chain[frozenset((a, b))]
                cur = a
                for eid in (ids if start == a else list(reversed(ids))):
                    e = E[eid]
                    w.append((eid, 1 if (e["a"] == cur) != edge_flip(e) else -1))
                    cur = e["b"] if e["a"] == cur else e["a"]
            walks.append((line, w))
    cons = defaultdict(list)                                     # edge -> [(c_own, sign product, other edge, c_other)]
    for line, w in walks:
        for (e1, s1), (e2, s2) in zip(w, w[1:]):
            if e1 == e2:
                continue
            c1, c2 = canon_slot(E[e1], line), canon_slot(E[e2], line)
            cons[e1].append((c1, s1 * s2, e2, c2)); cons[e2].append((c2, s1 * s2, e1, c1))
    shift = defaultdict(float)
    for _ in range(400):
        for eid, cs in cons.items():
            tot = sum(sg * (c2 + shift[e2]) - c1 for c1, sg, e2, c2 in cs)
            shift[eid] = max(-2.5, min(2.5, tot / (len(cs) + 0.3)))

    # ---- 5. output: each line's routes as one centre line with a side-by-side slot per piece
    lines_out, used = {}, set()
    for line in ORDER:
        key, name, color, api = KEYS[line]
        out_routes = []
        for ri, r in enumerate(routes[line]):
            anc, slot, ds, si = [], [], [], [0]
            stops = set(r["nodes"])
            drawn = r["drawn"]
            node = drawn[0]
            anc.append(pos_of[node])
            ds.append(0.0)
            acc = 0.0
            for a, b in zip(drawn, drawn[1:]):
                start, ids = chain[frozenset((a, b))]
                cur = a
                seqids = ids if start == a else list(reversed(ids))
                for eid in seqids:
                    e = E[eid]
                    pts = e["pts"] if e["a"] == cur else e["pts"][::-1]
                    fwd_canon = (e["a"] == cur) != edge_flip(e)
                    ls = [l for l in ORDER if l in e["lines"]]
                    o = ls.index(line) - (len(ls) - 1) / 2 + shift[eid]
                    for q in pts[1:]:
                        acc += dist(anc[-1], q); anc.append(q); slot.append(round(o if fwd_canon else -o, 2))
                    cur = e["b"] if e["a"] == cur else e["a"]
                if b in stops:
                    ds.append(acc); si.append(len(anc) - 1)
            anc, slot, si = smooth_route(anc, slot, si)
            c = [0.0]
            for q0, q1 in zip(anc, anc[1:]):
                c.append(c[-1] + dist(q0, q1))
            ds = [c[i] for i in si]
            ds_out = [round(x, 2) for x in ds]
            if len(ds_out) != len(r["stops"]):
                raise SystemExit(f"{line}: stop count mismatch ({len(ds_out)} vs {len(r['stops'])})")
            used.update(r["stops"])
            out_routes.append({"st": r["stops"], "anc": [[round(x, 2), round(y, 2)] for x, y in anc], "ds": ds_out, "slot": slot,
                               "branch": (BRANCH.get(line) or ["", ""])[ri] if len(routes[line]) > 1 else ""})
        lines_out[key] = {"code": line, "name": name, "color": color, "api": api, "routes": out_routes}

    xs = [P[s][0] for s in used]; ys = [P[s][1] for s in used]; M = 2.5 * K
    WORLD = {"x0": round(min(xs) - M, 1), "y0": round(min(ys) - M, 1), "x1": round(max(xs) + M, 1), "y1": round(max(ys) + M, 1)}
    stations = {sid: {"name": st[sid]["name"], "lat": st[sid]["lat"], "lon": st[sid]["lon"], "ada": st[sid].get("accessible", False)}
                for sid in sorted(used)}
    # ---- 5b. Metra, on the same projection (tools/layout_metra.py); the camera's world grows to fit it
    from layout_metra import add_metra
    HOME = dict(WORLD)                       # the view the map opens on: Chicago and the L (the camera can still pull out to all of Metra)
    metra_order = add_metra(lines_out, stations, xy, rdp, proj, K) if os.path.exists("data/metra.json") else []
    for sid, v in stations.items():
        if v.get("sys") == "metra":
            x, y = xy(v["lat"], v["lon"])
            WORLD["x0"] = round(min(WORLD["x0"], x - M), 1); WORLD["y0"] = round(min(WORLD["y0"], y - M), 1)
            WORLD["x1"] = round(max(WORLD["x1"], x + M), 1); WORLD["y1"] = round(max(WORLD["y1"], y + M), 1)

    # ---- 6. base map: lake, towns, Chicago's street grid
    geo = json.load(open("data/geo.json"))
    if "box" in geo:                         # the base map covers what tools/build_geo.py downloaded (wider for Metra)
        gS, gW, gN, gE = geo["box"]
        BOX.update({"x0": round(xy(gN, gW)[0], 1), "y0": round(xy(gN, gW)[1], 1), "x1": round(xy(gS, gE)[0], 1), "y1": round(xy(gS, gE)[1], 1)})
    ring = lambda r, eps: [[round(x, 1), round(y, 1)] for x, y in rdp([xy(a, b) for a, b in r], eps)]
    lake = [ring(r, .25) for r in geo["lake"]]
    towns = []
    for pl in geo["places"]:
        if pl["name"] != "Chicago" and pl["name"] not in TOWN_LABELS:
            continue
        rings = [x for x in (ring(r, .5) for r in pl["rings"]) if len(x) >= 4]
        if not rings:
            continue
        big = max(rings, key=lambda r: abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))))
        A = sum(big[i - 1][0] * big[i][1] - big[i][0] * big[i - 1][1] for i in range(len(big))) / 2 or 1e-9
        cx = sum((big[i - 1][0] + big[i][0]) * (big[i - 1][0] * big[i][1] - big[i][0] * big[i - 1][1]) for i in range(len(big))) / (6 * A)
        cy = sum((big[i - 1][1] + big[i][1]) * (big[i - 1][0] * big[i][1] - big[i][0] * big[i - 1][1]) for i in range(len(big))) / (6 * A)
        towns.append({"name": pl["name"], "rings": rings, "label": [round(cx, 1), round(cy, 1)] if pl["name"] in TOWN_LABELS else None,
                      "rank": TOWN_LABELS.index(pl["name"]) if pl["name"] in TOWN_LABELS else 99})
    # Chicago's address grid: 0 N/S at Madison, 0 E/W at State; 800 = one mile
    ox, oy = xy(41.88207, -87.62780)
    mile = 1.609344 * K
    grid = {"origin": [round(ox, 2), round(oy, 2)], "mile": round(mile, 3)}
    # state lines (data/states.json, tools/build_states.py: Census state outlines) and the states' names beside them
    states, state_names = [], []
    if os.path.exists("data/states.json"):
        for L in json.load(open("data/states.json"))["lines"]:
            for part in L["parts"]:
                states.append({"between": L["between"], "pts": [[round(x, 1), round(y, 1)] for x, y in (xy(a, b) for a, b in part)]})
        for name, lat, lon in (("WISCONSIN", 42.545, -88.36), ("ILLINOIS", 42.445, -88.36), ("INDIANA", 41.36, -87.40), ("ILLINOIS", 41.36, -87.66), ("INDIANA", 41.62, -86.75), ("MICHIGAN", 41.90, -86.10)):
            x, y = xy(lat, lon); state_names.append({"name": name, "xy": [round(x, 1), round(y, 1)]})

    # ---- 7. O'Hare's Airport Transit System (not CTA: drawn only when zoomed in at the airport; data/ats.json from OpenStreetMap)
    ats = None
    if os.path.exists("data/ats.json"):
        A = json.load(open("data/ats.json"))
        tracks, tds = [], []
        for t in A["tracks"]:
            p = [[round(x, 2), round(y, 2)] for x, y in rdp([xy(a, b) for a, b in t], .03)]
            ds = [proj(p, xy(s["lat"], s["lon"]))[1] for s in A["stations"]]
            if ds[0] > ds[-1]:                               # both tracks are stored running Terminal 1 -> Multi-Modal Facility
                p = p[::-1]
                ds = [proj(p, xy(s["lat"], s["lon"]))[1] for s in A["stations"]]
            if any(b <= a for a, b in zip(ds, ds[1:])):
                raise SystemExit(f"ATS: stations out of order along a track: {ds}")
            tracks.append(p)
            tds.append([round(v, 2) for v in ds])
        ats = {"tracks": tracks, "ds": tds, "hub": "40890",
               "stations": [{"name": s["name"], "xy": [round(v, 2) for v in xy(s["lat"], s["lon"])]} for s in A["stations"]]}
        far = max(proj(tracks[0], xy(s["lat"], s["lon"]))[0] for s in A["stations"]) / K * 1000
        print(f"ATS: {len(A['stations'])} stations, {len(tracks[0])}/{len(tracks[1])} points, farthest station {far:.0f} m off its track")

    # ---- 8. CTA-Metra transfers: only the checked list (data/transfers.json), and only pairs both on the map
    transfers = []
    if os.path.exists("data/transfers.json"):
        for p in json.load(open("data/transfers.json"))["pairs"]:
            if p["metra"] not in stations or p["cta"] not in stations:
                raise SystemExit(f"transfer {p['metra']} - {p['cta']}: station not on the map")
            transfers.append([p["metra"], p["cta"]])
    # CTA-to-CTA walks between two different stations (same file, cta_pairs); same-id interchanges need no list
    walks = []
    if os.path.exists("data/transfers.json"):
        for p in json.load(open("data/transfers.json")).get("cta_pairs", []):
            if p["a"] not in stations or p["b"] not in stations:
                raise SystemExit(f"CTA transfer {p['a']} - {p['b']}: station not on the map")
            walks.append([p["a"], p["b"]])
    net = {"note": "Generated by tools/build_layout.py from CTA's GTFS (data/stations.json), Metra's GTFS (data/metra.json), US Census TIGER (data/geo.json) and OpenStreetMap (data/ats.json).",
           "world": WORLD, "home": HOME, "box": BOX, "transfers": transfers, "walks": walks, "proj": {"lat0": LAT0, "lon0": LON0, "k": K, "cos": COSL},
           "lines": lines_out, "metra_order": metra_order, "stations": stations, "platforms": d["platforms"],
           "base": {"lake": lake, "towns": towns, "grid": grid, "states": states, "state_names": state_names}, "ats": ats}
    js = json.dumps(net, separators=(",", ":"))
    open("data/network.json", "w").write(js)
    if os.path.exists("index.html"):
        html = open("index.html").read()
        new, n = re.subn(r"/\*NET:BEGIN\*/.*?/\*NET:END\*/", lambda m: "/*NET:BEGIN*/const NET=" + js + ";/*NET:END*/", html, flags=re.S)
        if n == 1 and new != html:
            open("index.html", "w").write(new)
            print("index.html updated")
    shared = sum(1 for e in E.values() if len(e["lines"]) > 1)
    print(f"{len(stations)} stations, {len(E)} pieces of track ({shared} shared), {jn[0]} junctions, {len(js) // 1024} KB")
    for k, L in lines_out.items():
        print(f"  {L['code']}: " + ", ".join(f"{len(r['st'])} stops / {len(r['anc'])} pts" for r in L["routes"]))


if __name__ == "__main__":
    main()
