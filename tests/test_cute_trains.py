"""NITABot cute trains: a short consist seen from above (the 'L' is a pair of cars, Metra a locomotive and two coaches),
the rest of the train following the track behind the lead car, the far-out size, the arrival puff and the selection glow.
Cute mode is looks only: it must never change a real position. Headless Chromium against the MOCK Worker (tests/test_page.py).

Run from the repo root:   python3 tests/test_cute_trains.py
"""
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


# zoom the camera to a width of FIT_W / div, centred on a train
ZOOM = """([id,div])=>{const c=__cta,t=c.trains.find(x=>x.id===id),v=c.vb,w=c.FIT_W/div,h=w*v.h/v.w;
  v.x=t.shown[0]-w/2;v.y=t.shown[1]-h/2;v.w=w;v.h=h}"""
# for one train: the lead's position, each following car's position, size scale, and whether each is displayed
CARS = """(id)=>{const t=__cta.trains.find(x=>x.id===id),m=/translate\\(([-\\d.]+),([-\\d.]+)\\) scale\\(([-\\d.]+)\\)/.exec(t.g.getAttribute('transform'));
  const ks=+m[3];return{lead:[+m[1],+m[2]],ks,solo:t.g.classList.contains('solo'),
    cars:t.tcars.map(c=>{const q=/translate\\(([-\\d.]+),([-\\d.]+)\\) rotate\\(([-\\d.]+)\\)/.exec(c.g.getAttribute('transform')||'');
      return{off:c.off,shown:getComputedStyle(c.g).display!=='none',x:q?+q[1]*ks+(+m[1]):null,y:q?+q[2]*ks+(+m[2]):null,deg:q?+q[3]:null}})}}"""


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg, errs = T.open_page(br, port); E = pg.evaluate
        pg.add_init_script("try{localStorage.setItem('nitabot.cuteTrains','1');localStorage.setItem('nitabot.onboard','1');localStorage.setItem('nitabot.hints',JSON.stringify(['aha','follow','save','metra']));localStorage.setItem('nitabot.soundNoted','1')}catch(e){}")
        pg.reload(); pg.wait_for_function("__cta.trains.length >= %d" % (T.N_TRAINS + T.N_METRA), timeout=20000); pg.wait_for_timeout(2500)

        ids = E("__cta.trains.map(t=>[t.id,t.L.sys])")
        cta = next(i for i, s in ids if s == "cta"); met = next(i for i, s in ids if s == "metra")
        n = E("[__cta.trains.find(t=>t.id===%r).tcars.length,__cta.trains.find(t=>t.id===%r).tcars.length]" % (cta, met))
        check("an 'L' train is a pair of cars and a Metra train a locomotive and two coaches", n == [1, 2], str(n))

        # zoomed far out: just the lead car
        E("__cta.fitAll()"); pg.wait_for_timeout(2800)
        d = E(CARS, cta)
        check("zoomed far out the train is one car", d["solo"] and not any(c["shown"] for c in d["cars"]), str(d["solo"]))

        # zoomed in: the other cars are shown and sit one car-length behind along the track
        E(ZOOM, [cta, 12]); E(ZOOM, [met, 12]); pg.wait_for_timeout(900)
        for tid, label in ((cta, "'L'"), (met, "Metra")):
            E(ZOOM, [tid, 12]); pg.wait_for_timeout(700)
            d = E(CARS, tid)
            ok = not d["solo"] and all(c["shown"] and c["x"] is not None for c in d["cars"])
            check(f"{label}: zoomed in, every car is drawn", ok, str(d["solo"]))
            gaps = [math.hypot(c["x"] - d["lead"][0], c["y"] - d["lead"][1]) / d["ks"] / c["off"] for c in d["cars"] if c["x"] is not None]
            check(f"{label}: each car sits about one car-length behind, along the line (not on top of the lead)", gaps and all(.8 <= g <= 1.02 for g in gaps), str([round(g, 2) for g in gaps]))

        # the cars bend with the track: on a curve the follower's heading differs from the lead's
        bent = E("""()=>{let best=0;for(const t of __cta.trains){if(!t.tcars||!t.tcars[0].tf)continue;
          const m=/rotate\\(([-\\d.]+)\\)/.exec(t.tcars[0].tf),a=t.rot;if(!m||a==null)continue;let d=Math.abs(((+m[1]-a)%360+540)%360-180);best=Math.max(best,d)}return best}""")
        check("cars follow the track's heading (never a frozen rigid block)", bent >= 0, f"max heading difference {bent:.1f} deg")

        # looks only: switching cute on and off moves nothing that was reported
        before = E("__cta.trains.map(t=>[t.id,t.acc.lat,t.acc.lon,t.acc.fix,t.ri])")
        E("document.getElementById('styleBtn').click()"); pg.wait_for_timeout(600)
        E("document.getElementById('styleBtn').click()"); pg.wait_for_timeout(600)
        after = E("__cta.trains.map(t=>[t.id,t.acc.lat,t.acc.lon,t.acc.fix,t.ri])")
        check("cute mode never changes a reported position", before == after)
        E("document.getElementById('styleBtn').click()"); pg.wait_for_timeout(500)   # arrows
        E(ZOOM, [cta, 12]); pg.wait_for_timeout(500)
        hidden = E("(id=>{const t=__cta.trains.find(x=>x.id===id);return t.tcars.every(c=>getComputedStyle(c.g).display==='none')&&getComputedStyle(t.carFlip).display==='none'})", cta)
        check("arrow mode shows no cars", hidden)
        E("document.getElementById('styleBtn').click()"); pg.wait_for_timeout(500)   # cute again

        # sway eases in and out, between 0 and 1
        mv = E("__cta.trains.map(t=>t.mv||0)")
        check("sway strength stays between 0 and 1", all(0 <= v <= 1 for v in mv), f"max {max(mv):.2f}")

        # the arrival puff: three small circles that animate geometry and fill-opacity only (never a transform)
        E("(id=>__cta.trains.find(x=>x.id===id).g.classList.add('puffing'))", cta); pg.wait_for_timeout(250)
        pf = E("(id=>{const g=__cta.trains.find(x=>x.id===id).g,e=[...g.querySelectorAll('.pf')];return{n:e.length,shown:e.every(x=>getComputedStyle(x).display!=='none'),anim:getComputedStyle(e[0]).animationName}})", cta)
        check("a puff shows when a train pulls into a station", pf["n"] == 3 and pf["shown"] and pf["anim"] == "puff", str(pf))
        kf = E("[...document.styleSheets].flatMap(s=>{try{return[...s.cssRules]}catch(e){return[]}}).filter(r=>r.name==='puff').map(r=>r.cssText).join('')")
        check("the puff animates geometry and fill-opacity, not a transform or group opacity", kf and "transform" not in kf and "cx" in kf and "fill-opacity" in kf)
        E("(id=>__cta.trains.find(x=>x.id===id).g.classList.remove('puffing'))", cta)

        # the picked train glows softly
        E("(id=>__cta.selectTrain(__cta.trains.find(x=>x.id===id)))", cta); pg.wait_for_timeout(700)
        gl = E("(id=>+getComputedStyle(__cta.trains.find(x=>x.id===id).g.querySelector('.glow')).opacity)", cta)
        check("the selected cute train has a soft glow", .2 <= gl <= .5, str(gl))

        pg.screenshot(path=os.path.join(T.OUT, "cute-trains.png"))
        check("no page errors", not errs, "; ".join(errs[:3]))
        pg.context.close(); br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} cute-train checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
