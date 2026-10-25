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
API = {k: L["api"] for k, L in NET["lines"].items()}
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def fake_positions():
    """Three trains per line, each sitting at a real station of that line and heading to the next one."""
    lines, n = {}, 0
    for k, L in NET["lines"].items():
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
hits = {}


def mock(route):
    url = route.request.url
    path = url.split("workers.dev", 1)[1].split("?")[0]
    hits[path] = hits.get(path, 0) + 1
    now = int(time.time() * 1000)
    if path == "/cta/positions":
        body = dict(POS, fetched_at=now)
    elif path == "/cta/alerts":
        body = {"alerts": [], "fetched_at": now}
    elif path == "/cta/arrivals":
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
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "fonts.gstatic" not in str(m.location) else None)
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
        n = pg.evaluate("__cta.trains.length")
        check("every fake train is placed on its line", n == N_TRAINS, f"{n} of {N_TRAINS}")
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
        check("airport trains aren't counted as real trains", real == N_TRAINS, f"{real}")

        # requests made, all to the mocked Worker
        check("positions were polled", hits.get("/cta/positions", 0) >= 1, json.dumps(hits))
        check("no errors on desktop", not errs, "; ".join(errs[:3]))
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
        check("phone: trains placed", pg.evaluate("__cta.trains.length") == N_TRAINS)
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
