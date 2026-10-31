"""Dashboard mode (?dashboard): NITABot framed inside Desk Glance.

Checks, against the same mock Worker as test_page.py:
  - the normal page is unchanged (no dashboard class, controls visible, welcome guide still opens)
  - ?dashboard hides every control and the welcome guide, and stays silent
  - a "nitabot:ride" message starts a Metra ride (never an 'L' train), and the next one picks a different train
  - once a second it reports what it shows ("nitabot:state"), with the train's line, destination and freshness
  - inside a real frame on another page, messages reach the parent
Run: python3 tests/test_dashboard.py
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
import test_page as T

results = []
def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))

def open_at(br, port, path, intro_hidden):
    ctx = br.new_context(viewport={"width": 1600, "height": 900})
    if intro_hidden:
        ctx.add_init_script("try{localStorage.setItem('nitabot.hideIntro','1')}catch(e){}")
    ctx.route("**/*workers.dev/**", T.mock)
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    ctx.route("**/fonts.gstatic.com/**", lambda r: r.fulfill(status=404, body=""))
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    pg.goto(f"http://127.0.0.1:{port}/{path}")
    return ctx, pg, errs

def main():
    srv = T.serve(); port = srv.server_address[1]
    out = os.path.join(T.ROOT, "tests", "out"); os.makedirs(out, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch()

        # 1. the normal site: first visit still gets the welcome guide; controls are there
        ctx, pg, errs = open_at(br, port, "index.html", intro_hidden=False)
        pg.wait_for_timeout(2500)
        check("normal page has no dashboard class", not pg.evaluate("document.body.classList.contains('dash')"))
        check("normal page shows its header", pg.is_visible(".top"))
        check("normal page still opens the welcome guide on a first visit", pg.evaluate("!document.getElementById('welcome').hidden"))
        check("normal page: no errors", not errs, "; ".join(errs[:3]))
        ctx.close()

        # 2. ?dashboard on a first visit
        ctx, pg, errs = open_at(br, port, "index.html?dashboard", intro_hidden=False)
        pg.evaluate("window.__msgs=[];addEventListener('message',e=>{if(e.data&&e.data.source==='nitabot')__msgs.push(e.data)})")
        pg.wait_for_timeout(3000)
        check("dashboard: body has the dash class", pg.evaluate("document.body.classList.contains('dash')"))
        hidden = pg.evaluate("""['.top','.console','.zoom','#ridecap','#card','#board'].every(q=>{const e=document.querySelector(q);return !e||getComputedStyle(e).display==='none'})""")
        check("dashboard: header, line bar, zoom, cards and board hidden", hidden)
        check("dashboard: no welcome guide on a first visit", pg.evaluate("document.getElementById('welcome').hidden"))
        check("dashboard: sound is off", pg.evaluate("__cta.sndMode==='off'"))
        check("dashboard: always dark", pg.evaluate("document.documentElement.dataset.theme==='dark'"))
        check("dashboard: the 'L' is faded to a ghost", pg.evaluate("document.body.classList.contains('ctafaded')"))
        st = pg.evaluate("__msgs.filter(m=>m.type==='nitabot:state').slice(-1)[0]||null")
        check("dashboard: reports its state once a second", bool(st), str(st)[:120])
        check("dashboard: there are Metra trains to ride", bool(st and st["rideable"] > 0), str(st)[:160])

        # 3. a ride request starts a Metra ride; the next one picks another train
        seen = []
        for i in range(3):
            pg.evaluate("postMessage({type:'nitabot:ride'},'*')")
            pg.wait_for_timeout(4200)
            r = pg.evaluate("(c=>c&&c.t?{phase:c.phase,sys:c.t.L.sys,id:c.t.id||c.t.uid||c.t.run.no}:null)(__cta.chase)")
            st = pg.evaluate("__msgs.filter(m=>m.type==='nitabot:state').slice(-1)[0]")
            check(f"ride {i+1}: riding a Metra train", bool(r and r["sys"] == "metra" and r["phase"] in ("in", "ride")), str(r))
            check(f"ride {i+1}: state names the train", bool(st["train"] and st["train"]["line"] and st["train"]["name"] and st["train"]["color"]), str(st["train"])[:160])
            if r: seen.append(str(r["id"]))
            if i == 0:
                pg.screenshot(path=os.path.join(out, "dashboard-ride.png"))
        check("each ride request picks a different train than the one before", all(a != b for a, b in zip(seen, seen[1:])), str(seen))
        check("dashboard: no errors", not errs, "; ".join(errs[:3]))
        ctx.close()

        # 4. inside a real frame: the parent hears it
        frame_page = os.path.join(T.ROOT, "tests", "out", "frame.html")
        open(frame_page, "w").write(f"""<!doctype html><body style="margin:0"><iframe id=f src="http://127.0.0.1:{port}/index.html?dashboard" style="border:0;width:1600px;height:900px"></iframe>
<script>window.__msgs=[];addEventListener('message',e=>{{if(e.data&&e.data.source==='nitabot')__msgs.push(e.data)}});</script>""")
        ctx, pg, errs = open_at(br, port, "tests/out/frame.html", intro_hidden=True)
        pg.wait_for_timeout(3500)
        pg.evaluate("document.getElementById('f').contentWindow.postMessage({type:'nitabot:ride'},'*')")
        pg.wait_for_timeout(4500)
        st = pg.evaluate("__msgs.filter(m=>m.type==='nitabot:state').slice(-1)[0]||null")
        check("framed: the parent receives state with a train", bool(st and st["train"]), str(st)[:160])
        check("framed: no errors", not errs, "; ".join(errs[:3]))
        ctx.close(); br.close()
    os.remove(frame_page)
    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} of {len(results)} checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
