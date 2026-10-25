"""NITABot page tests: headless Chromium against a MOCK Worker (fake trains, no real feeds).

Passing here proves the page works with data shaped like the Worker's. It does NOT prove the live feeds work:
that check is a real browser on the real Worker.

Run from the repo root:   python3 tests/test_page.py          (screenshots go to tests/out/)
Needs: pip install playwright && python3 -m playwright install chromium
"""
import functools, hashlib, http.server, json, os, subprocess, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "tests", "out")
os.makedirs(OUT, exist_ok=True)
NET = json.load(open(os.path.join(ROOT, "data", "network.json")))
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def fake_positions():
    """Three trains per line, each sitting at a real station of that line and heading to the next one."""
    lines, n = {}, 0
    for k, L in NET["lines"].items():
        if L.get("sys") == "metra":
            continue
        st = L["routes"][0]["st"]
        out = []
        for j, i in enumerate((1, len(st) // 2, len(st) - 3)):
            a, b = NET["stations"][st[i]], NET["stations"][st[i + 1]]
            out.append({"line": L["api"], "run": str(100 + n), "dest": b["name"], "dest_id": st[-1], "dir": "1",
                        "lat": a["lat"] * 0.7 + b["lat"] * 0.3, "lon": a["lon"] * 0.7 + b["lon"] * 0.3, "heading": 0,
                        "next_sta_id": st[i + 1], "next_stop_id": "", "next_sta": b["name"],
                        "predicted_at": int(time.time() * 1000), "arrives_at": int(time.time() * 1000) + 120000,
                        "approaching": False, "delayed": False, "scheduled": False, "fault": False})
            n += 1
        lines[L["api"]] = out
    return {"feed_time": int(time.time() * 1000), "trains": n, "lines": lines}, n


POS, N_TRAINS = fake_positions()
P = NET["proj"]


def to_ll(x, y):
    import math
    return P["lat0"] - y / (110.54 * P["k"]), P["lon0"] + x / (111.32 * P["cos"] * P["k"])


def fake_metra():
    """Two Metra trains per line, on its real track halfway between two stations, with a trip that has stops ahead."""
    lines, trips, n, now = {}, [], 0, int(time.time())
    for key in NET.get("metra_order", []):
        L = NET["lines"][key]; r = L["routes"][0]; st = r["st"]
        out = []
        for i in (2, len(st) - 4):
            d = (r["ds"][i] + r["ds"][i + 1]) / 2
            acc, pt = 0.0, r["anc"][0]
            for a, b in zip(r["anc"], r["anc"][1:]):
                seg = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** .5
                if acc + seg >= d:
                    f = (d - acc) / (seg or 1); pt = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); break
                acc += seg
            lat, lon = to_ll(*pt)
            tid = f"TEST_{key}_{n}"
            out.append({"route_id": L["api"], "trip_id": tid, "direction_id": 1, "latitude": lat, "longitude": lon,
                        "updated_at": now, "vehicle_id": f"V{n}", "veh_label": str(2200 + n)})
            trips.append({"trip_id": tid, "route_id": L["api"], "direction_id": 1, "veh_label": str(2200 + n), "updated_at": now,
                          "stops": [{"id": s, "arr": now + 120 * (k + 1), "delay": 420 if n == 0 else 0} for k, s in enumerate(st[i + 1:])],
                          "last_stop": st[-1]})
            n += 1
        lines[L["api"]] = out
    alerts = [{"id": "T1", "header": "UP-N test alert: trains running 10 to 15 minutes late", "description": "Test only.",
               "url": "", "routes": ["UP-N"], "stops": [], "periods": [], "effect": 3}]
    return {"metra_lines": lines, "trips": trips, "alerts": alerts}, n


METRA, N_METRA = fake_metra()
METRA_DOWN = {"on": False}                     # set True to make the mock Metra feed fail
arrival_ids = []
hits = {}


def mock(route):
    url = route.request.url
    path = url.split("workers.dev", 1)[1].split("?")[0]
    hits[path] = hits.get(path, 0) + 1
    now = int(time.time() * 1000)
    if path == "/":
        if METRA_DOWN["on"]:
            return route.fulfill(status=502, content_type="application/json", body=json.dumps({"metra_error": "test outage"}),
                                 headers={"access-control-allow-origin": "*"})
        body = dict(METRA, fetched_at=now)
        for vs in body["metra_lines"].values():           # a live feed's reports are fresh every time it's asked
            for v in vs:
                v["updated_at"] = now // 1000
    elif path == "/cta/positions":
        body = dict(POS, fetched_at=now, feed_time=now)
        for ts in body["lines"].values():
            for t in ts:
                t["predicted_at"] = now
    elif path == "/cta/alerts":
        body = {"alerts": [], "fetched_at": now}
    elif path == "/cta/arrivals":
        arrival_ids.extend(url.split("mapid=", 1)[1].split("&")[0].split(","))
        body = {"stations": {}, "fetched_at": now}
    elif path == "/cta/follow":
        body = {"stops": [], "fetched_at": now}
    else:
        body = {"error": "not mocked"}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body),
                  headers={"access-control-allow-origin": "*"})


PNG1 = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                     "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def open_page(browser, port, phone=False, intro_hidden=True):
    if phone:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    if intro_hidden:
        ctx.add_init_script("try{localStorage.setItem('nitabot.hideIntro','1')}catch(e){}")
    ctx.route("**/*workers.dev/**", mock)
    ctx.route("**/*nationalmap.gov/**", lambda r: r.fulfill(status=200, content_type="image/png", body=PNG1))
    # web fonts: the test machine may be offline, so they're stubbed (the page falls back to system fonts)
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    ctx.route("**/fonts.gstatic.com/**", lambda r: r.fulfill(status=404, body=""))
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("response", lambda r: errs.append(f"{r.status} {r.url}") if r.status >= 400 and "fonts.gstatic" not in r.url else None)
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(f"http://127.0.0.1:{port}/index.html")
    return pg, errs


def main():
    # the build is reproducible: building twice gives the same page
    def build():
        subprocess.run([sys.executable, "tools/build.py"], cwd=ROOT, check=True, capture_output=True)
        subprocess.run([sys.executable, "tools/build_layout.py"], cwd=ROOT, check=True, capture_output=True)
        return hashlib.sha256(open(os.path.join(ROOT, "index.html"), "rb").read()).hexdigest()
    a, b = build(), build()
    check("build is reproducible", a == b, a[:12])

    srv = serve()
    port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---- desktop
        pg, errs = open_page(br, port)
        pg.wait_for_function("window.__cta && __cta.trains.length > 0", timeout=20000)
        pg.wait_for_timeout(1500)
        pg.wait_for_function(f"__cta.trains.length >= {N_TRAINS + N_METRA}", timeout=20000)
        home = pg.evaluate("[__cta.vb.w, __cta.FIT_W]")                 # the view as the page opened
        n = pg.evaluate("__cta.trains.filter(t=>t.L.sys!=='metra').length")
        check("every fake CTA train is placed on its line", n == N_TRAINS, f"{n} of {N_TRAINS}")
        nm = pg.evaluate("__cta.trains.filter(t=>t.L.sys==='metra').length")
        check("every fake Metra train is placed on its real track", nm == N_METRA, f"{nm} of {N_METRA}")
        far = pg.evaluate("""()=>{let worst=0;for(const t of __cta.trains.filter(t=>t.L.sys==='metra')){
            const want=t.L.routes[t.ri];worst=Math.max(worst,Math.abs(t.lastObsS-Math.round(t.lastObsS)));}return worst}""")
        check("Metra trains sit between stations, as reported (not snapped to one)", far > 0.3, f"{far:.2f} station")
        dirs = pg.evaluate("__cta.trains.filter(t=>t.L.sys==='metra'&&t.dirSign!==0).length")
        check("Metra direction comes from the trip's next stop", dirs == N_METRA, f"{dirs} of {N_METRA}")
        check("title says NITABot", pg.title() == "NITABot", pg.title())
        pg.screenshot(path=os.path.join(OUT, "desktop-map.png"))

        # click a real train marker
        box = pg.evaluate("""()=>{const t=__cta.trains.find(t=>{const r=t.g.getBoundingClientRect();
            return r.width&&r.x>200&&r.y>150&&r.x<innerWidth-300&&r.y<innerHeight-150});
            if(!t)return null;const r=t.g.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2,t.run.no]}""")
        if box:
            pg.mouse.click(box[0], box[1]); pg.wait_for_timeout(700)
            txt = pg.evaluate("document.getElementById('card').classList.contains('on')&&document.getElementById('card').innerText")
            check("clicking a train opens its card", bool(txt) and box[2] in txt, f"run {box[2]}")
            pg.screenshot(path=os.path.join(OUT, "desktop-card.png"))
            pg.evaluate("__cta.closeCard()")
        else:
            check("clicking a train opens its card", False, "no clickable train on screen")

        # a Metra train's card: Metra's train number, trip predictions, GPS footer
        txt = pg.evaluate("""()=>{const t=__cta.trains.find(t=>t.L.sys==='metra'&&t.run.no==='2200');__cta.selectTrain(t);
            return document.getElementById('card').innerText}""")
        pg.wait_for_timeout(600)
        txt = pg.evaluate("document.getElementById('card').innerText")
        check("Metra card: train number, next stops, running late", "Train 2200" in txt and "next stops" in txt.lower() and "+7" in txt and "7 min late" in txt, txt.replace("\n", " | ")[:160])
        pg.screenshot(path=os.path.join(OUT, "desktop-metra-card.png"))
        pg.evaluate("__cta.closeCard()")
        # a Metra station's sheet: Metra's predicted times, and no CTA request for it
        stop = METRA["trips"][0]["stops"][1]["id"]                 # a station that fake train still has ahead
        pg.evaluate(f"__cta.openStationPop(__cta.STN.get('{stop}'))"); pg.wait_for_timeout(1200)
        txt = pg.evaluate("document.getElementById('spop').innerText")
        check("Metra station sheet shows Metra's predicted times", "Metra's live predictions" in txt and "2200" in txt, txt.replace("\n", " | ")[:160])
        pg.screenshot(path=os.path.join(OUT, "desktop-metra-station.png"))
        pg.evaluate("document.querySelector('#spop .x').click()")
        check("no CTA arrival request ever names a Metra station", all(i.isdigit() for i in arrival_ids), ",".join(arrival_ids[:8]))
        # a downtown terminal shows its departure board (from schedule.json)
        pg.evaluate("__cta.openStationPop(__cta.STN.get('CUS'))"); pg.wait_for_timeout(1500)
        txt = pg.evaluate("document.getElementById('spop').innerText")
        ok = "departures" in txt.lower() and ("Scheduled" in txt or "On time" in txt or "late" in txt) or "No Metra departures in the next 3 hours" in txt
        check("Union Station shows its departure board", ok, txt.replace("\n", " | ")[:200])
        pg.screenshot(path=os.path.join(OUT, "desktop-departures.png"))
        pg.evaluate("document.querySelector('#spop .x').click()")
        # Metra's alert sits beside CTA's
        n_al = pg.evaluate("document.getElementById('acount').textContent")
        check("Metra's alerts show in the alert panel", n_al == "1", f"count {n_al!r}")

        # ---- Phase D: one product
        w = home
        check("opens on Chicago (home view), not the whole region", abs(w[0] - w[1]) / w[1] < 0.05, f"{w[0]:.0f} vs {w[1]:.0f}")
        stripes = pg.evaluate("document.querySelectorAll('path.track.stripe').length")
        check("Metra lines carry the rail stripe; the L's don't", stripes > 0 and pg.evaluate("document.querySelectorAll('path.track.metra').length") == stripes, f"{stripes} stripes")
        grp = pg.evaluate("""()=>{const vis=k=>!document.getElementById('n-'+k).closest('.chip').hidden;
            const a=[vis('red'),vis('upn')];document.querySelectorAll('.gtab')[1].click();const b=[vis('red'),vis('upn')];
            document.querySelectorAll('.gtab')[0].click();return[a,b]}""")
        check("line bar: L and Metra groups switch", grp == [[True, False], [False, True]], str(grp))
        pg.evaluate("__cta.openStationPop(__cta.STN.get('41160'))"); pg.wait_for_timeout(800)
        txt = pg.evaluate("document.getElementById('spop').innerText")
        check("Clinton (Green/Pink) offers the checked transfer to Ogilvie", "transfer to metra" in txt.lower() and "Ogilvie" in txt, txt.replace("\n", " | ")[:120])
        pg.evaluate("document.querySelector('#spop .x').click()")
        pg.evaluate("__cta.openStationPop(__cta.STN.get('40680'))"); pg.wait_for_timeout(800)
        txt = pg.evaluate("document.getElementById('spop').innerText")
        check("Adams/Wabash shows no transfer (CTA's page names none)", "transfer" not in txt.lower(), txt.replace("\n", " | ")[:80])
        pg.evaluate("document.querySelector('#spop .x').click()")
        stats = pg.evaluate("__cta.liveStats(__cta.trains.filter(t=>t.L.sys!=='metra'),__cta.trains.filter(t=>t.L.sys==='metra'))")
        check("ticker has Metra lines from Metra's feed", any("Metra train" in s for s in stats) and any("6 or more minutes late" in s for s in stats), " / ".join(stats)[:200])
        # voice: every Metra station MetraBot recorded has a clip; a Metra ride's sentences are all recorded pieces
        cov = pg.evaluate("""async()=>{const m=await (await fetch('voice/metra/manifest.json')).json();
            const st=__cta.STATIONS.filter(r=>r.sys==='metra');const miss=st.filter(r=>!r.mb||!m.stn[r.mb]).map(r=>r.id);
            __cta.VOS.metra.man=m;const t=__cta.trains.find(t=>t.L.sys==='metra'&&t.run.no==='2200');
            const L=__cta.mciLines('start',__cta.mciFacts(t));
            const ok=L.every(l=>l.p.every(([pk,k])=>pk==='core'?m.core[k]:m.lines[pk]&&m.lines[pk][k]));
            return{miss,n:L.length,ok,text:L.map(l=>l.tx).join(' ')}}""")
        check("Metra voice: every station has a clip except new ones", cov["miss"] == ["PETERSON"], str(cov["miss"]))
        check("Metra check-in is built only from recorded clips", cov["ok"] and cov["n"] >= 2, cov["text"][:160])
        # labels: none overlap, at five zoom levels from the region to the Loop
        overl = pg.evaluate("""async()=>{const out=[];const F=__cta.FIT_W,c=__cta.STN.get('40380').xy;   // centred on Clark/Lake, the busiest labels
            for(const f of[3.2,1,.5,.2,.07]){const w=F*f,h=w*innerHeight/innerWidth;__cta.vb={x:c[0]-w/2,y:c[1]-h/2,w,h};
              __cta.layoutLabels&&__cta.layoutLabels();await new Promise(r=>setTimeout(r,900));
              const R=[...document.querySelectorAll('#labels text.lbl')].filter(t=>getComputedStyle(t).opacity>.5&&t.textContent).map(t=>t.getBoundingClientRect()).filter(r=>r.width);
              let n=0;for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++){const a=R[i],b=R[j];
                if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)n++}
              out.push([f,R.length,n])}return out}""")
        check("no station labels overlap at 5 zoom levels", all(o[2] == 0 for o in overl), str(overl))
        pg.evaluate("()=>{__cta.vb=Object.assign({},__cta.fitAll())}"); pg.wait_for_timeout(800)

        # train of the moment
        pg.evaluate("__cta.startRide()"); pg.wait_for_timeout(4500)
        ph = pg.evaluate("__cta.chase && __cta.chase.phase")
        check("train of the moment starts a ride", ph in ("in", "ride"), str(ph))
        pg.screenshot(path=os.path.join(OUT, "desktop-ride.png"))
        pg.evaluate("__cta.closeCard()"); pg.wait_for_timeout(3500)

        # satellite mode (tiles are mocked as blank images)
        pg.keyboard.press("s"); pg.wait_for_timeout(800)
        check("S turns on satellite mode", pg.evaluate("document.body.classList.contains('satmode')"))
        stored = pg.evaluate("localStorage.getItem('nitabot.satellite')")
        check("settings are saved under nitabot.* keys", stored is not None, f"nitabot.satellite={stored}")
        pg.keyboard.press("s"); pg.wait_for_timeout(500)

        # O'Hare airport train: built, simulated, kept out of the train list
        ats = pg.evaluate("window.__ats ? __ats.TR.length : -1")
        check("O'Hare airport trains exist (simulated)", ats > 0, f"{ats} trains")
        real = pg.evaluate("__cta.trains.length")
        check("airport trains aren't counted as real trains", real == N_TRAINS + N_METRA, f"{real}")

        # requests made, all to the mocked Worker
        check("both feeds were polled", hits.get("/cta/positions", 0) >= 1 and hits.get("/", 0) >= 1, json.dumps(hits))
        check("no errors on desktop", not errs, "; ".join(errs[:3]))
        pg.context.close()

        # ---- Metra's feed down: the header says so, CTA keeps running
        METRA_DOWN["on"] = True
        pg, errs = open_page(br, port)
        pg.wait_for_function("window.__cta && __cta.trains.length > 0", timeout=20000)
        pg.wait_for_timeout(2500)
        st = pg.evaluate("document.getElementById('stateText').textContent")
        msg = pg.evaluate("document.getElementById('notice').innerText")
        check("Metra feed down: header says so, CTA trains still live", st == "Metra offline" and "Metra" in msg, f"{st} / {msg[:80]}")
        METRA_DOWN["on"] = False
        pg.context.close()

        # ---- welcome guide on first visit
        pg, errs = open_page(br, port, intro_hidden=False)
        pg.wait_for_timeout(1500)
        check("welcome guide shows on a first visit", pg.evaluate("__cta.introOpen"))
        pg.screenshot(path=os.path.join(OUT, "desktop-welcome.png"))
        pg.context.close()

        # ---- phone
        pg, errs = open_page(br, port, phone=True)
        pg.wait_for_function("window.__cta && __cta.trains.length > 0", timeout=20000)
        pg.wait_for_timeout(1500)
        pg.wait_for_function(f"__cta.trains.length >= {N_TRAINS + N_METRA}", timeout=20000)
        check("phone: trains placed", pg.evaluate("__cta.trains.length") == N_TRAINS + N_METRA)
        pg.screenshot(path=os.path.join(OUT, "phone-map.png"))
        box = pg.evaluate("""()=>{const t=__cta.trains.find(t=>{const r=t.g.getBoundingClientRect();
            return r.width&&r.x>40&&r.y>140&&r.x<innerWidth-40&&r.y<innerHeight-220});
            if(!t)return null;const r=t.g.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]}""")
        if box:
            pg.touchscreen.tap(box[0], box[1]); pg.wait_for_timeout(900)
            on = pg.evaluate("document.getElementById('card').classList.contains('on') || !!document.querySelector('#spop.on')")
            check("phone: tapping a train opens a card (or zooms in on a crowd)", on or pg.evaluate("__cta.vb.w") < pg.evaluate("__cta.FIT_W"))
            pg.screenshot(path=os.path.join(OUT, "phone-card.png"))
        else:
            check("phone: tapping a train opens a card", False, "no tappable train")
        check("no errors on phone", not errs, "; ".join(errs[:3]))
        pg.context.close()
        br.close()
    srv.shutdown()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
