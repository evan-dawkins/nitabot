"""NITABot critique fixes: data-as-of stamp, line-badge contrast, ambient mode and the train of the moment's caption,
the empty board tucked away, station search, keyboard in the map and focus in panels, "All lines", and arrival times
that survive a failed refresh. Headless Chromium against the MOCK Worker (tests/test_page.py).

Run from the repo root:   python3 tests/test_ambient_access.py
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def lum(h):
    v = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    v = [c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4 for c in v]
    return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + .05) / (min(la, lb) + .05)


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg, errs = T.open_page(br, port)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000); pg.wait_for_timeout(1500)
        E = pg.evaluate
        # data-as-of stamp
        t = E("document.getElementById('asof').innerText")
        check("data-as-of stamp shows CTA and Metra times and the date", "Data as of" in t and "CTA" in t and "Metra" in t and any(m in t for m in ("Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec")), t)
        # line badge contrast: every line's badge text at the best available ratio, 4.5:1 or more where possible
        bad = []
        for k, L in T.NET["lines"].items():
            c = L["color"].lstrip("#"); ink = E(f"__cta.inkOn('#{c}')").lstrip("#")
            r = ratio(c, ink); best = max(ratio(c, "FFFFFF"), ratio(c, "0B1620"))
            if r < 4.5 and r < best - .01:
                bad.append(f"{k} {r:.2f}")
        worst = min(max(ratio(L["color"].lstrip("#"), "FFFFFF"), ratio(L["color"].lstrip("#"), "0B1620")) for L in T.NET["lines"].values())
        check("line badges use the higher-contrast text (all >= 4.5:1 except where no text colour can reach it)", not bad, f"worst possible {worst:.2f}; failing {bad}")
        # empty board tucked into the star
        tucked = E("document.getElementById('board').classList.contains('min')&&getComputedStyle(document.getElementById('favBtn')).display!=='none'")
        check("empty 'Your stations' board is tucked into the star", tucked)
        E("document.getElementById('favBtn').click()"); pg.wait_for_timeout(300)
        check("the star opens the empty board", not E("document.getElementById('board').classList.contains('min')"))
        E("document.querySelector('#board .col').click()"); pg.wait_for_timeout(300)
        check("and tucks it away again", E("document.getElementById('board').classList.contains('min')"))
        # All lines only resets
        E("__cta.setFocus('red')"); pg.wait_for_timeout(500)
        E("document.querySelector('.chip.all').click()"); pg.wait_for_timeout(600)
        check("'All lines' shows every line and leaves the line bar open", E("!__cta.focusKey && !document.getElementById('console').classList.contains('min')"))
        # search
        pg.mouse.click(700, 500); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        pg.keyboard.press("/"); pg.wait_for_timeout(300)
        check("/ opens station search with the cursor in it", E("document.getElementById('search').classList.contains('on')&&document.activeElement.id==='sq'"))
        pg.keyboard.type("ogil"); pg.wait_for_timeout(150)
        first = E("document.querySelector('#sres [role=option] .sn')?.textContent")
        check("typing 'ogil' finds Ogilvie first", first and "Ogilvie" in first, str(first))
        pg.keyboard.press("Enter"); pg.wait_for_timeout(1500)
        check("Enter flies there and opens its sheet, focus inside it", E("__cta.spopRec&&__cta.spopRec.id==='OTC'&&document.getElementById('spop').contains(document.activeElement)"))
        txt = E("document.getElementById('spop').textContent")
        check("station sheet lists times before the Save station button", txt.lower().find("save station") > txt.lower().find("departures") >= 0, txt[:120])
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        check("Esc closes the sheet and focus goes back", not E("!!__cta.spopRec") and E("document.activeElement&&document.activeElement.id")=="searchBtn", E("document.activeElement&&(document.activeElement.id||document.activeElement.tagName)"))
        # station sheets stay inside the window: near every edge, for a tall terminal, and when opened off-screen
        out = E("""(()=>{const bad=[],W=innerWidth,H=innerHeight,fit=__cta.fitAll();
          const ids=['OTC','CUS','40380',...[...__cta.STN.values()].filter(r=>r.xy).sort((a,b)=>a.xy[0]-b.xy[0]).filter((r,i,a)=>i===0||i===a.length-1).map(r=>r.id),
                     ...[...__cta.STN.values()].filter(r=>r.xy).sort((a,b)=>a.xy[1]-b.xy[1]).filter((r,i,a)=>i===0||i===a.length-1).map(r=>r.id)];
          for(const id of ids){const r=__cta.STN.get(id);if(!r)continue;
            for(const v of [fit,{x:r.xy[0]-fit.w*.02,y:r.xy[1]-fit.h*.02,w:fit.w*.04,h:fit.h*.04},{x:r.xy[0]+fit.w,y:r.xy[1]+fit.h,w:fit.w*.1,h:fit.h*.1}]){
              Object.assign(__cta.vb,v);__cta.closeStationPop&&__cta.closeStationPop();__cta.openStationPop(r);
              const b=document.getElementById('spop').getBoundingClientRect();
              if(b.left<0||b.top<0||b.right>W||b.bottom>H)bad.push(id+' '+[b.left,b.top,b.right,b.bottom].map(Math.round).join(','))}}
          __cta.closeStationPop&&__cta.closeStationPop();Object.assign(__cta.vb,fit);return bad})()""")
        check("station sheets always open inside the window (edges, tall terminals, off-screen stations)", not out, "; ".join(out[:4]))
        # map keyboard: Tab leaves the map in one press, arrows move
        E("()=>{const r=__cta.STN.get('40380');r.g.focus()}")
        pg.keyboard.press("ArrowRight"); moved = E("document.activeElement!==__cta.STN.get('40380').g && !!document.activeElement.closest('#map')")
        check("arrow keys move between stations and trains", moved)
        pg.keyboard.press("Tab"); out = E("!document.activeElement.closest('#map')")
        check("one Tab leaves the map (no 400-stop trek)", out, E("document.activeElement.id||document.activeElement.className"))
        # train card focus
        E("()=>{const t=__cta.trains.find(t=>t.L.key==='red');t.g.focus()}"); pg.keyboard.press("Enter"); pg.wait_for_timeout(500)
        check("opening a train with Enter moves focus into its card", E("document.getElementById('card').contains(document.activeElement)"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        check("Esc closes it and focus goes back to the train", E("!!document.activeElement.closest('.train')"))
        # arrivals keep the last good times when CTA stops answering
        E("""()=>{__cta.ARR.set('40380',{at:Date.now()-90000,etas:[{line:'Brn',run:'401',dest:'Kimball',arrives_at:Date.now()+240000,platform:'Service toward Kimball'}],err:'No answer',errAt:Date.now()});__cta.openStationPop(__cta.STN.get('40380'))}""")
        pg.wait_for_timeout(500); t = E("document.getElementById('spop').textContent")
        check("failed refresh: last good times stay, marked with their age", "Live times paused" in t and "Kimball" in t, t[:140])
        E("document.querySelector('#spop .x').click()"); pg.wait_for_timeout(300)
        # ambient mode and the ride caption
        E("()=>{__cta.vb=Object.assign({},__cta.fitAll())}"); pg.wait_for_timeout(500)
        E("__cta.idleFor(100000)"); pg.wait_for_timeout(1500)
        amb = E("""(()=>{const o=s=>+getComputedStyle(document.querySelector(s)).opacity;return{ambient:document.body.classList.contains('ambient'),
            console:o('.console'),tools:o('.mark .tools'),zoom:o('.zoom'),asof:o('#asof'),state:o('#state')}})()""")
        check("after 90 s idle: ambient mode hides the controls, keeps Live and the data stamp", amb["ambient"] and amb["console"] < .05 and amb["tools"] < .05 and amb["zoom"] < .05 and amb["asof"] > .9 and amb["state"] > .9, json.dumps(amb))
        pg.screenshot(path=os.path.join(T.OUT, "ambient.png"))
        E("__cta.startRide()"); pg.wait_for_timeout(4500)
        cap = E("[__cta.chaseCap,document.getElementById('ridecap').classList.contains('on'),document.getElementById('card').classList.contains('on'),document.getElementById('ridecap').innerText]")
        check("train of the moment: a slim caption, not the full card", cap[0] and cap[1] and not cap[2], cap[3].replace("\n", " ")[:90])
        wide = E("__cta.vb.w/__cta.FIT_W")
        check("the ride keeps the neighbourhood in view (wider than before)", wide > .15, f"{wide:.2f} of the Chicago view")
        pg.screenshot(path=os.path.join(T.OUT, "ride-caption.png"))
        pg.mouse.move(600, 400); pg.wait_for_timeout(1300)
        check("any input brings the controls back", not E("document.body.classList.contains('ambient')") and E("+getComputedStyle(document.querySelector('.console')).opacity") > .2)
        E("document.querySelector('#ridecap .rc-d').click()"); pg.wait_for_timeout(500)
        check("Details opens the full card for that train", E("document.getElementById('card').classList.contains('on')"))
        E("document.querySelector('#card .x').click()"); pg.wait_for_timeout(3500)
        check("closing it ends the ride", not E("__cta.chase && ['in','ride'].includes(__cta.chase.phase)"))
        check("no page errors", not errs, "; ".join(errs[:3]))
        pg.context.close()
        # the stamp stays fully on screen at every window width, also with a long warning in the status pill
        bad = []
        for w in (768, 834, 961, 1024, 1240, 1280, 1440, 1920):
            pg2, _ = T.open_page(br, port); pg2.set_viewport_size({"width": w, "height": 800})
            pg2.wait_for_function("__cta.trains.length > 10", timeout=20000); pg2.wait_for_timeout(800)
            for warn in (False, True):
                if warn: pg2.evaluate("()=>{document.getElementById('state').className='state warn';document.getElementById('stateText').textContent='Data not updating'}")
                r = pg2.evaluate("(()=>{const a=document.getElementById('asof').getBoundingClientRect();return a.width>0&&a.left>=0&&a.right<=innerWidth})()")
                if not r: bad.append(f"{w}{' warn' if warn else ''}")
            pg2.context.close()
        check("data-as-of stamp fully on screen at 768-1920 px, with or without a warning", not bad, ", ".join(bad))
        # phone: stamp visible, line bar scroll hint
        pg, errs = T.open_page(br, port, phone=True)
        pg.wait_for_function("__cta.trains.length > 10", timeout=20000); pg.wait_for_timeout(1500)
        r = pg.evaluate("(()=>{const a=document.getElementById('asof').getBoundingClientRect();return[a.width>0&&a.bottom<=innerHeight&&a.top>0,document.getElementById('console').classList.contains('more')]})()")
        check("phone: data-as-of stamp on screen; line bar shows it scrolls", r[0] and r[1], str(r))
        pg.screenshot(path=os.path.join(T.OUT, "phone-asof.png"))
        pg.evaluate("__cta.openStationPop(__cta.STN.get('40380'))"); pg.wait_for_timeout(600)
        check("phone: the stamp stays visible while a station sheet is open", pg.evaluate("(()=>{const a=document.getElementById('asof').getBoundingClientRect();return a.width>0&&a.top>=0&&a.bottom<=innerHeight&&getComputedStyle(document.getElementById('asof')).display!=='none'})()"))
        pg.evaluate("document.querySelector('#spop .x').click()")
        check("no page errors on phone", not errs, "; ".join(errs[:3]))
        pg.context.close(); br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} ambient and access checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
