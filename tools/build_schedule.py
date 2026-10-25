"""Build schedule.json from Metra's public timetable (GTFS static).

For every scheduled trip it keeps just two things: the trip's last stop and the
time it is due there. The Worker compares that with Metra's live prediction to
decide whether a train finished on time. Runs daily from a GitHub Action.

Usage: python tools/build_schedule.py [path/to/schedule.zip]
With no path it downloads the zip from Metra.
"""
import csv, io, json, sys, urllib.request, zipfile

SOURCE = "https://schedules.metrarail.com/gtfs/schedule.zip"
OUT = "schedule.json"

def rows(z, name):
    with z.open(name) as f:
        rd = csv.reader(io.TextIOWrapper(f, encoding="utf-8-sig"))
        head = [h.strip().lower() for h in next(rd)]         # Metra's headers can carry stray spaces
        print(f"{name} columns: {head}")
        for r in rd:
            yield {k: (v.strip() if v else "") for k, v in zip(head, r)}

def main():
    if len(sys.argv) > 1:
        data = open(sys.argv[1], "rb").read()
    else:
        req = urllib.request.Request(SOURCE, headers={"User-Agent": "nitabot timetable builder (+https://github.com/evan-dawkins/nitabot)"})
        with urllib.request.urlopen(req, timeout=120) as r:
            print(f"Downloaded {r.geturl()} -> HTTP {r.status}, {r.headers.get('Content-Type')}")
            data = r.read()
    print(f"{len(data)} bytes, starts with {data[:4]!r}")
    z = zipfile.ZipFile(io.BytesIO(data))
    print("files:", ", ".join(z.namelist()))
    names = set(z.namelist())

    last = {}                                    # trip_id -> (stop_sequence, stop_id, arrival_time)
    HUBS = {"OTC", "CUS", "LSS", "MILLENNIUM"}   # downtown stations: the page shows a departure board for these
    hub = []                                     # (trip_id, stop_id, departure_time, stop_sequence)
    first = {}                                   # trip_id -> (stop_sequence, departure_time) of its first stop
    for r in rows(z, "stop_times.txt"):
        tid, seq = r.get("trip_id", ""), r.get("stop_sequence", "")
        if not seq.isdigit():
            continue
        seq = int(seq)
        t = (r.get("arrival_time") or r.get("departure_time") or "").strip()
        if not tid or not t:
            continue
        if tid not in first or seq < first[tid][0]:
            d0 = (r.get("departure_time") or t).strip()
            first[tid] = (seq, d0 if len(d0) == 8 else d0.zfill(8))
        if r.get("stop_id", "") in HUBS:
            d = (r.get("departure_time") or t).strip()
            hub.append((tid, r["stop_id"], d if len(d) == 8 else d.zfill(8), seq))
        if tid not in last or seq > last[tid][0]:
            last[tid] = (seq, r.get("stop_id", ""), t if len(t) == 8 else t.zfill(8))

    # Keep only trips that run in the next 8 days (the job runs daily), so the file stays small and quick to read.
    import datetime
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-6))).date()
    days = [today + datetime.timedelta(d) for d in range(-1, 8)]
    active = set()
    runs = {}                                    # service_id -> set of dates (YYYYMMDD) in the window
    if "calendar.txt" in names:
        wk = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        for r in rows(z, "calendar.txt"):
            try:
                a = datetime.datetime.strptime(r["start_date"], "%Y%m%d").date(); b = datetime.datetime.strptime(r["end_date"], "%Y%m%d").date()
            except (KeyError, ValueError):
                continue
            ds = {d.strftime("%Y%m%d") for d in days if a <= d <= b and r.get(wk[d.weekday()]) == "1"}
            if ds:
                active.add(r.get("service_id", "")); runs.setdefault(r.get("service_id", ""), set()).update(ds)
    if "calendar_dates.txt" in names:
        want = {d.strftime("%Y%m%d") for d in days}
        for r in rows(z, "calendar_dates.txt"):
            sid = r.get("service_id", "")
            if r.get("date") in want and r.get("exception_type") == "1":
                active.add(sid); runs.setdefault(sid, set()).add(r["date"])
            elif r.get("date") in want and r.get("exception_type") == "2":
                runs.setdefault(sid, set()).discard(r["date"])
    trip_info = {}                               # trip_id -> (route_id, service_id)
    if "trips.txt" in names:
        for r in rows(z, "trips.txt"):
            trip_info[r.get("trip_id", "")] = (r.get("route_id", ""), r.get("service_id", ""))
    if active and trip_info:
        keep = {tid for tid, (_, sid) in trip_info.items() if sid in active}
        before = len(last)
        last = {k: v for k, v in last.items() if k in keep}
        print(f"Running this week: {len(last)} of {before} trips")

    version = ""
    if "feed_info.txt" in z.namelist():
        for r in rows(z, "feed_info.txt"):
            version = (r.get("feed_version") or r.get("feed_start_date") or "").strip()
            break

    # where each last stop is, so the Worker can tell from GPS when a train has pulled in
    ends = {stop for (_, stop, _) in last.values()}
    stops = {}
    if "stops.txt" in names:
        for r in rows(z, "stops.txt"):
            sid = r.get("stop_id", "")
            if sid in ends:
                try:
                    stops[sid] = [round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)]
                except (KeyError, ValueError):
                    pass
    print(f"Last-stop locations: {len(stops)} of {len(ends)}")

    # departure board for the downtown stations: every train leaving one this week (not ones ending there)
    deps = []
    for tid, stop, t, seq in hub:
        if tid not in last or last[tid][0] == seq or tid not in trip_info:
            continue
        route, sid = trip_info[tid]
        if sid in runs and runs[sid]:
            deps.append([stop, t, tid, route, sid])
    deps.sort(key=lambda d: (d[0], d[1]))
    used = {d[4] for d in deps}
    print(f"Downtown departures: {len(deps)} (services {len(used)})")

    # how many trains the timetable has running in each 10-minute slot, per day (and how many of those head downtown),
    # so the page can tell a normal rush hour from an unusually busy or quiet one
    secs = lambda x: int(x[0:2]) * 3600 + int(x[3:5]) * 60 + int(x[6:8])
    window = {d.strftime("%Y%m%d") for d in days}
    expect, expect_in = {}, {}
    for tid, (_, stop, t_end) in last.items():
        if tid not in first or tid not in trip_info:
            continue
        sid = trip_info[tid][1]
        a, b = secs(first[tid][1]), secs(t_end)
        if b < a:
            continue
        inbound = stop in HUBS
        for dstr in runs.get(sid, ()):
            base = datetime.datetime.strptime(dstr, "%Y%m%d").date()
            for k in range(a // 600, b // 600 + 1):
                day = (base + datetime.timedelta(k // 144)).strftime("%Y%m%d")
                if day not in window:
                    continue
                expect.setdefault(day, [0] * 144)[k % 144] += 1
                if inbound:
                    expect_in.setdefault(day, [0] * 144)[k % 144] += 1
    print(f"Expected-train curves for {len(expect)} days, busiest slot {max((max(v) for v in expect.values()), default=0)} trains")

    out = {"source": SOURCE, "version": version, "expect": expect, "expect_in": expect_in,
           "trips": {tid: [stop, t] for tid, (_, stop, t) in sorted(last.items())}, "stops": stops,
           "deps": deps, "svc": {sid: sorted(runs[sid]) for sid in sorted(used)}}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"{OUT}: {len(out['trips'])} trips, version {version or 'unknown'}")
    if len(out["trips"]) < 100:
        sys.exit("Too few trips: the timetable looks wrong, not saving a broken file.")

if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:                      # show the reason on the Actions page (as an annotation)
        msg = f"{type(e).__name__}: {e}".replace("\n", " ")[:900]
        print(f"::error title=Timetable build failed::{msg}")
        raise
