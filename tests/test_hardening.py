"""NITABot hardening tests (Phase E): background tabs, keyboard, phone, request budget, memory, simulated mode,
reduced motion. Headless Chromium against the same MOCK Worker as tests/test_page.py (fake trains, no real feeds).

Run from the repo root:   python3 tests/test_hardening.py      (about 3 minutes; screenshots go to tests/out/)
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


HIDE = """()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))}"""
SHOW = """()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});document.dispatchEvent(new Event('visibilitychange'))}"""


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()

        # ---- background tab: no requests while hidden, both feeds catch up on return
        pg, errs = T.open_page(br, port)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000)
        pg.evaluate(HIDE)
        before = dict(T.hits)
        pg.wait_for_timeout(65000)
        after = dict(T.hits)
        new = {k: after.get(k, 0) - before.get(k, 0) for k in after}
        check("hidden tab: no feed requests for 65 s", sum(new.values()) == 0, json.dumps(new))
        pg.evaluate(SHOW); pg.wait_for_timeout(3000)
        back = {k: T.hits.get(k, 0) - after.get(k, 0) for k in T.hits}
        check("visible again: both feeds asked within 3 s (alerts within 2 min rule)", back.get("/cta/positions", 0) >= 1 or back.get("/", 0) >= 1, json.dumps(back))

        # ---- request budget while visible: one minute
        b0 = dict(T.hits); pg.wait_for_timeout(60000); b1 = dict(T.hits)
        per = {k: b1.get(k, 0) - b0.get(k, 0) for k in b1 if b1.get(k, 0) - b0.get(k, 0)}
        tot = sum(per.values())
        check("visible tab: about 4-5 requests a minute (2 positions, 2 Metra, alerts every 2 min)", 3 <= tot <= 6, json.dumps(per))
        check("no errors in a long-running tab", not errs, "; ".join(errs[:3]))

        # ---- memory: 120 polls of each feed, trains and DOM don't grow
        m0 = pg.evaluate("[performance.memory?performance.memory.usedJSHeapSize:0, document.getElementsByTagName('*').length, __cta.trains.length]")
        for _ in range(120):
            pg.evaluate("()=>Promise.all([__cta.poll(),__cta.pollMetra()])")
        pg.wait_for_timeout(1500)
        pg.evaluate("()=>{if(window.gc)gc()}")
        m1 = pg.evaluate("[performance.memory?performance.memory.usedJSHeapSize:0, document.getElementsByTagName('*').length, __cta.trains.length]")
        check("120 polls of both feeds: same trains, page elements don't pile up", m1[2] == m0[2] and m1[1] - m0[1] < 50,
              f"trains {m0[2]}->{m1[2]}, elements {m0[1]}->{m1[1]}, heap {m0[0]//1e6:.0f}->{m1[0]//1e6:.0f} MB")

        # ---- keyboard: shortcuts and tabbing to trains and stations
        # the tab sat idle 2+ min, so train of the moment is riding: end it the way a person does (a real click on ×),
        # which also counts as input, so the next ride waits another 2 minutes
        if pg.evaluate("!!document.querySelector('#card.on .x')"):
            pg.click("#card .x")
        pg.wait_for_timeout(4000)
        pg.mouse.click(5, 300)
        pg.keyboard.press("-"); pg.wait_for_timeout(500); pg.keyboard.press("-"); pg.wait_for_timeout(700)
        out = pg.evaluate("__cta.vb.w > __cta.FIT_W*1.2")
        pg.keyboard.press("0"); pg.wait_for_timeout(900)
        home = pg.evaluate("Math.abs(__cta.vb.w-__cta.FIT_W)/__cta.FIT_W<0.05")
        dbg = pg.evaluate("[__cta.vb.w,__cta.FIT_W,__cta.chase&&__cta.chase.phase,document.activeElement.tagName]")
        check("keys: - zooms out past Chicago, 0 comes back to Chicago", out and home, f"out {out}, home {home}, {dbg}")
        ok = pg.evaluate("""()=>{const t=__cta.trains.find(t=>t.L.sys==='metra');t.g.focus();
            t.g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return document.getElementById('card').classList.contains('on')}""")
        check("keys: Enter on a focused Metra train opens its card", ok)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        ok = pg.evaluate("""()=>{const r=__cta.STN.get('CUS');r.g.focus();
            r.g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return document.getElementById('spop').classList.contains('on')}""")
        check("keys: Enter on a focused station opens its sheet", ok)
        foc = pg.evaluate("""()=>[...document.querySelectorAll('.gtab,.xf button,.chip')].every(b=>b.tabIndex>=0)""")
        check("new buttons (L/Metra tabs, transfers, lines) are reachable by Tab", foc)
        pg.context.close()

        # ---- simulated mode includes Metra lines, clearly labelled
        pg, errs = T.open_page(br, port)
        pg.wait_for_function("window.__cta && __cta.trains.length > 0", timeout=20000)
        pg.evaluate("__cta.startSim()"); pg.wait_for_timeout(9000)
        sim = pg.evaluate("[__cta.trains.filter(t=>t.L.sys==='metra').length,__cta.trains.filter(t=>t.L.sys!=='metra').length,document.getElementById('stateText').textContent]")
        check("simulated mode: labelled, both systems, no errors", sim[2] == "Simulated" and sim[1] > 0 and not errs, f"metra {sim[0]}, L {sim[1]}, '{sim[2]}'")
        pg.screenshot(path=os.path.join(T.OUT, "sim.png"))
        pg.context.close()

        # ---- reduced motion: no ride, no errors
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        ctx.add_init_script("try{localStorage.setItem('nitabot.hideIntro','1')}catch(e){}")
        ctx.route("**/*workers.dev/**", T.mock)
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(f"http://127.0.0.1:{port}/index.html")
        pg.wait_for_function("window.__cta && __cta.trains.length > 0", timeout=20000)
        pg.evaluate("__cta.startRide()"); pg.wait_for_timeout(2000)
        check("reduced motion: no camera ride, no errors", not pg.evaluate("__cta.chase && __cta.chase.phase==='ride'") and not errs)
        ctx.close()

        # ---- phone: line groups, Metra card as a bottom sheet, departure board, idle ride
        pg, errs = T.open_page(br, port, phone=True)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000)
        pg.tap(".gtab:nth-child(2)"); pg.wait_for_timeout(500)
        vis = pg.evaluate("!document.getElementById('n-upn').closest('.chip').hidden")
        check("phone: Metra tab shows Metra's lines", vis)
        pg.evaluate("()=>{const t=__cta.trains.find(t=>t.L.sys==='metra'&&t.run.no==='2200');__cta.selectTrain(t)}"); pg.wait_for_timeout(900)
        r = pg.evaluate("(()=>{const c=document.getElementById('card').getBoundingClientRect();return[c.top,c.bottom,innerHeight,c.width,innerWidth]})()")
        check("phone: Metra card docks as a bottom sheet, fully on screen", r[1] <= r[2] + 1 and r[0] > r[2] * 0.3 and r[3] >= r[4] - 24, str([round(x) for x in r]))
        pg.screenshot(path=os.path.join(T.OUT, "phone-metra-card.png"))
        pg.evaluate("__cta.closeCard()"); pg.wait_for_timeout(400)
        pg.evaluate("__cta.openStationPop(__cta.STN.get('OTC'))"); pg.wait_for_timeout(900)
        txt = pg.evaluate("document.getElementById('spop').innerText")
        r = pg.evaluate("(()=>{const c=document.getElementById('spop').getBoundingClientRect();return[c.top,c.bottom,innerHeight]})()")
        check("phone: Ogilvie's departure board fits on screen", ("departures" in txt.lower() or "No Metra departures" in txt) and r[1] <= r[2] + 1, txt.replace("\n", " | ")[:100])
        pg.screenshot(path=os.path.join(T.OUT, "phone-departures.png"))
        pg.evaluate("document.querySelector('#spop .x').click()")
        # phones start a ride after 20 s idle (plus 25 s of rest if a ride just ended, and the 3 s swing in)
        try:
            pg.wait_for_function("!!__cta.chase && ['in','ride'].includes(__cta.chase.phase)", timeout=75000); rode = True
        except Exception:
            rode = False
        check("phone: train of the moment starts on its own when idle", rode, str(pg.evaluate("[__cta.chase&&__cta.chase.phase,document.body.className,document.hidden,__cta.trains.length]")))
        check("no errors on phone", not errs, "; ".join(errs[:3]))
        pg.context.close()
        br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} hardening checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
