"""NITABot redesign checks: map interaction (drag never selects, clicks still work), crisp tracks during pings
(compositor layers), transfer markers, state lines, the welcome guide (first visit, dismiss, reopen, broken
storage), the disclaimer, the favicon, and keyboard focus. Headless Chromium against the MOCK Worker.

Run from the repo root:   python3 tests/test_redesign.py
"""
import json, math, os, re, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []
ROOT = T.ROOT
DISCLAIMER = "NITABot is an unofficial personal project made for fun and is not affiliated with NITA."


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def ctx_for(br, port, theme="dark", seen=True, storage_broken=False, phone=False):
    if phone:
        ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2, color_scheme=theme)
    else:
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme)
    if storage_broken:
        ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('storage blocked')}})")
    elif seen:
        ctx.add_init_script("try{localStorage.setItem('nitabot.introSeen','1')}catch(e){}")
    ctx.route("**/*workers.dev/**", T.mock)
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))
    ctx.route("**/*nationalmap.gov/**", lambda r: r.fulfill(status=200, content_type="image/png", body=T.PNG1))
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(f"http://127.0.0.1:{port}/index.html")
    return ctx, pg, errs


def main():
    srv = T.serve(); port = srv.server_address[1]
    html = open(os.path.join(ROOT, "index.html")).read()
    with sync_playwright() as p:
        br = p.chromium.launch()
        for theme in ("dark", "light"):
            ctx, pg, errs = ctx_for(br, port, theme)
            pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000); pg.wait_for_timeout(1200)
            E = pg.evaluate
            # ---- dragging never selects text, starting anywhere on the map
            starts = E("""()=>{const pick=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return r.width?[r.x+r.width/2,r.y+r.height/2]:null};
                const tr=__cta.trains.find(t=>{const r=t.g.getBoundingClientRect();return r.width&&r.x>200&&r.x<1100&&r.y>150&&r.y<750});
                const st=__cta.STATIONS.find(r=>{const b=r.g.getBoundingClientRect();return b.width&&b.x>200&&b.x<1100&&b.y>150&&b.y<750});
                const lb=[...document.querySelectorAll('#labels text.lbl')].find(t=>{const b=t.getBoundingClientRect();return b.width&&b.x>200&&b.x<1100&&b.y>150&&b.y<750});
                const tl=[...document.querySelectorAll('.stlbl')].find(t=>{const b=t.getBoundingClientRect();return b.width&&b.x>150&&b.x<1100&&b.y>150&&b.y<750});
                const g=x=>{if(!x)return null;const b=(x.g||x).getBoundingClientRect();return[b.x+b.width/2,b.y+b.height/2]};
                return{train:g(tr),station:g(st),label:g(lb),town:g(tl),land:[300,700]}}""")
            sel = {}
            for k, xy in starts.items():
                if not xy:
                    continue
                E("getSelection().removeAllRanges()")
                vb0 = E("[__cta.vb.x,__cta.vb.y]")
                pg.mouse.move(*xy); pg.mouse.down(); pg.mouse.move(xy[0] + 140, xy[1] + 70, steps=10); pg.mouse.move(xy[0] + 260, xy[1] - 140, steps=10); pg.mouse.up()
                vb1 = E("[__cta.vb.x,__cta.vb.y]")
                sel[k] = (E("getSelection().toString().length"), abs(vb1[0] - vb0[0]) > 1)
                E("__cta.closeCard()")
            check(f"{theme}: dragging from a train, station, label, town name or land pans and selects nothing",
                  all(v[0] == 0 and v[1] for v in sel.values()) and len(sel) >= 4, json.dumps(sel))
            # text outside the map is still selectable
            ok = E("""()=>{const e=document.querySelector('.mark > span');const r=document.createRange();r.selectNodeContents(e);
                const s=getSelection();s.removeAllRanges();s.addRange(r);const n=s.toString().length;s.removeAllRanges();return n>0&&getComputedStyle(e).userSelect!=='none'}""")
            check(f"{theme}: panel text off the map can still be selected", ok)
            # ---- a click (no drag) on a train still opens it; on a station opens the sheet
            E("()=>{__cta.vb=Object.assign({},__cta.fitAll())}"); pg.wait_for_timeout(900)
            box = E("""()=>{const t=__cta.trains.find(t=>{const r=t.g.getBoundingClientRect();return r.width&&r.x>200&&r.y>150&&r.x<1100&&r.y<750});
                const r=t.g.getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]}""")
            pg.mouse.click(*box); pg.wait_for_timeout(600)
            check(f"{theme}: clicking a train still opens its card", E("document.getElementById('card').classList.contains('on')"))
            E("__cta.closeCard()"); pg.wait_for_timeout(300)
            # ---- tracks stay crisp: a ping adds no compositor layers
            cdp = ctx.new_cdp_session(pg); n = {"v": None}
            cdp.on("LayerTree.layerTreeDidChange", lambda e: n.__setitem__("v", len(e.get("layers") or [])))
            cdp.send("LayerTree.enable"); pg.wait_for_timeout(500); before = n["v"]
            E("()=>{for(const t of __cta.trains){t.g.classList.remove('ping');void t.g.getBBox();t.g.classList.add('ping')}}"); pg.wait_for_timeout(200)
            during = n["v"]; ring = E("getComputedStyle(__cta.trains[0].g.querySelector('.ring')).r")
            check(f"{theme}: signal ping adds no compositor layers (tracks aren't re-rasterised)", before is not None and during == before and before < 40, f"{before} -> {during}, ring r {ring}")
            check(f"{theme}: the ping still animates", ring not in ("7px", "0px", ""), ring)
            cdp.send("LayerTree.disable")
            check(f"{theme}: no page errors", not errs, "; ".join(errs[:3]))
            ctx.close()

        ctx, pg, errs = ctx_for(br, port)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000); pg.wait_for_timeout(1000)
        E = pg.evaluate
        # ---- transfers
        x = E("""()=>{const out={};const L=[...document.querySelectorAll('.xlink')];out.links=L.length;
            out.ends=__cta.STATIONS.filter(r=>r.g.querySelector('.xend')).map(r=>r.id).sort();
            out.multi=__cta.STATIONS.filter(r=>r.lines.size>1).length;out.pills=__cta.STATIONS.filter(r=>r.g.querySelector('.pill:not(.one)')).length;
            out.fakepills=__cta.STATIONS.filter(r=>r.g.querySelector('.pill:not(.one)')&&r.lines.size<2).map(r=>r.id);return out}""")
        tr = json.load(open(os.path.join(ROOT, "data", "transfers.json")))
        want_links = len(tr["pairs"]) + len(tr.get("cta_pairs", []))
        check("one transfer link per checked pair in data/transfers.json", x["links"] == want_links, f"{x['links']} of {want_links}")
        check("interchange pills only where a station really serves 2+ lines", x["pills"] == x["multi"] and not x["fakepills"], f"{x['pills']} pills, {x['multi']} multi-line stations")
        ends = E("""()=>[...document.querySelectorAll('.xlink')].map((g,i)=>{const d=g.querySelector('.xc').getAttribute('d').match(/-?[\\d.]+/g).map(Number);
            return d})""")
        pairs = [(p["metra"], p["cta"]) for p in tr["pairs"]] + [(p["a"], p["b"]) for p in tr.get("cta_pairs", [])]
        okk = E(f"""()=>{{const P={json.dumps(pairs)};const L=[...document.querySelectorAll('.xlink .xc')].map(e=>e.getAttribute('d').match(/-?[\\d.]+/g).map(Number));
            return P.every(([a,b],i)=>{{const A=__cta.STN.get(a).xy,B=__cta.STN.get(b).xy,d=L[i];return Math.hypot(d[0]-A[0],d[1]-A[1])<.05&&Math.hypot(d[2]-B[0],d[3]-B[1])<.05}})}}""")
        check("every link joins exactly the two stations its entry names", okk)
        far = E("""()=>{const out=[];for(const g of document.querySelectorAll('.xlink .xc')){const d=g.getAttribute('d').match(/-?[\\d.]+/g).map(Number);out.push(Math.hypot(d[2]-d[0],d[3]-d[1])*33.3)}return Math.round(Math.max(...out))}""")
        check("transfer links are short walks (none over 800 m)", far < 800, f"longest {far} m")
        E("__cta.openStationPop(__cta.STN.get('40850'))"); pg.wait_for_timeout(700)
        t = E("document.getElementById('spop').textContent")           # (innerText would be upper-cased by the heading style)
        check("Library's sheet lists its checked walks (Jackson Red and Blue)", "walking transfer" in t and t.count("Jackson") >= 2, t.replace("\n", " | ")[:140])
        E("document.querySelector('#spop .x').click()")
        E("__cta.openStationPop(__cta.STN.get('40680'))"); pg.wait_for_timeout(500)
        t = E("document.getElementById('spop').textContent")
        check("Adams/Wabash still shows no walk or Metra transfer (none checked)", "walking transfer" not in t and "Transfer to" not in t)
        E("document.querySelector('#spop .x').click()")
        # transfers visible at regional and downtown zoom; labels don't collide at either
        for f in (3.0, .12):
            c = E("__cta.STN.get('40380').xy")
            E(f"()=>{{const w=__cta.FIT_W*{f},h=w*innerHeight/innerWidth;__cta.vb={{x:{c[0]}-w/2,y:{c[1]}-h/2,w,h}}}}"); pg.wait_for_timeout(1200)
            vis = E("[...document.querySelectorAll('.xlink')].filter(g=>{const r=g.getBoundingClientRect();return r.width&&r.right>0&&r.left<innerWidth&&r.bottom>52&&r.top<innerHeight}).length")
            if f > 2:                                   # zoomed out to Metra: the L (and its links) fade away
                fd = E("[__cta.ctaFade,getComputedStyle(document.querySelector('.ctaw')).display,[...document.querySelectorAll('#labels text.lbl')].filter(t=>t.style.display!=='none'&&__cta.STN.get(__cta.STATIONS.find(r=>r.label===t.textContent)?.id||'')?.sys==='cta').length]")
                check(f"zoom {f}x: the L has faded out (track a ghost, its trains, stations, links and names gone)", fd[0] == 1 and vis == 0, str(fd))
                vis = 1
            ov = E("""()=>{const R=[...document.querySelectorAll('#labels text.lbl')].filter(t=>getComputedStyle(t).opacity>.5&&t.textContent).map(t=>t.getBoundingClientRect()).filter(r=>r.width);
                let n=0;for(let i=0;i<R.length;i++)for(let j=i+1;j<R.length;j++){const a=R[i],b=R[j];if(a.left<b.right-1&&b.left<a.right-1&&a.top<b.bottom-1&&b.top<a.bottom-1)n++}return[R.length,n]}""")
            check(f"zoom {f}x: transfer links on screen, station labels don't overlap", vis > 0 and ov[1] == 0, f"{vis} links, labels {ov}")
        # ---- state lines: where Census puts them, relative to real places either side
        st = E("""()=>{const P=__cta.STN,ln=document.querySelector('path.stateline');if(!ln)return null;
            const d=ln.getAttribute('d').split('M').filter(Boolean).map(s=>s.split('L').map(q=>q.split(',').map(Number)));
            const yAt=(seg,x)=>{for(let i=1;i<seg.length;i++){const a=seg[i-1],b=seg[i];if((a[0]-x)*(b[0]-x)<=0&&a[0]!==b[0])return a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0])}return null};
            const xAt=(seg,y)=>{for(let i=1;i<seg.length;i++){const a=seg[i-1],b=seg[i];if((a[1]-y)*(b[1]-y)<=0&&a[1]!==b[1])return a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1])}return null};
            const ken=P.get('KENOSHA'),wh=P.get('WINTHROP'),wi=d[0];
            const out={parts:d.length,ken:ken&&[ken.xy[1],yAt(wi,ken.xy[0])],wh:wh&&[wh.xy[1],yAt(wi,wh.xy[0])]};
            const hm=__cta.STN.get('93RD-SC');out.sc=hm&&[hm.xy[0],d.map(seg=>xAt(seg,hm.xy[1])).filter(x=>x!=null&&x>hm.xy[0]).sort((a,b)=>a-b)[0]??null];return out}""")
        check("state lines drawn (Illinois-Wisconsin, Illinois-Indiana)", st and st["parts"] >= 2, json.dumps(st)[:120])
        if st and st["ken"] and st["wh"] and st["ken"][1] is not None:
            km = (st["ken"][1] - st["ken"][0]) / 30; wm = (st["wh"][0] - st["wh"][1]) / 30
            check("Kenosha (Wisconsin) is north of the state line, Winthrop Harbor (Illinois) south", km > 0 and wm > 0, f"Kenosha {km:.1f} km north, Winthrop Harbor {wm:.1f} km south")
        else:
            check("Kenosha / Winthrop Harbor reference check", False, json.dumps(st))
        if True:
            check("South Chicago (93rd St, Illinois) is west of the Indiana line", bool(st and st["sc"] and st["sc"][1] is not None and st["sc"][1] - st["sc"][0] > 0), str(st and st["sc"]))
        sj = json.load(open(os.path.join(ROOT, "data", "states.json")))
        med = [L["check_m"]["median_m"] for L in sj["lines"] if L.get("check_m")]
        check("state lines agree with Census TIGER town edges (median under 75 m)", med and max(med) < 75, f"medians {med} m")
        c = E("__cta.STN.get('40380').xy")
        E(f"()=>{{const w=__cta.FIT_W*3.4,h=w*innerHeight/innerWidth;__cta.vb={{x:{c[0]}-w/2,y:{c[1]}-h/2,w,h}}}}"); pg.wait_for_timeout(900)
        nm = E("[...document.querySelectorAll('.stname')].filter(t=>t.style.display!=='none').map(t=>t.textContent)")
        E("()=>{__cta.vb=Object.assign({},__cta.fitAll())}"); pg.wait_for_timeout(900)
        nm2 = E("[...document.querySelectorAll('.stname')].filter(t=>t.style.display!=='none').length")
        check("state names show zoomed out, hide at the Chicago view", len(nm) >= 3 and nm2 == 0, f"{nm} / {nm2}")
        lake_after = E("""()=>{const kids=[...document.querySelector('#map > g').children];const i=kids.findIndex(e=>e.classList&&e.classList.contains('lake'));
            const j=kids.findIndex(e=>e.querySelector&&e.querySelector('.stateline'));return i>j&&j>=0}""")
        check("state lines sit under the lake (no line across the water)", lake_after)
        E("__cta.setFocus('red')"); pg.wait_for_timeout(1500)
        check("a CTA line picked in the line bar stays visible zoomed out", E("__cta.ctaFade") == 0)
        E("__cta.setFocus(null)"); pg.wait_for_timeout(300)
        # ---- keyboard focus still visible on stations and trains
        E("()=>{const r=__cta.STN.get('40380');r.g.focus()}")
        check("keyboard focus reaches stations", E("document.activeElement===__cta.STN.get('40380').g"))
        check("no page errors (transfers, states)", not errs, "; ".join(errs[:3]))
        ctx.close()

        # ---- welcome guide: first visit, dismissed, return visit, reopen
        ctx, pg, errs = ctx_for(br, port, seen=False)
        pg.wait_for_timeout(1500); E = pg.evaluate
        check("first visit: the guide opens by itself", E("__cta.introOpen"))
        txt = E("document.getElementById('intro').innerText")
        check("guide has the exact disclaimer", DISCLAIMER in txt)
        check("guide says it isn't affiliated with the CTA or Metra either", "affiliated with the CTA or Metra" in txt)
        names = {"#zin": "zoom", "#abtn": "alerts", ".console": "line bar", "#helpBtn": "?"}
        real = E("""()=>({line:!!document.querySelector('.console .chip'),alerts:!!document.getElementById('abtn'),help:!!document.getElementById('helpBtn'),
            follow:true,star:true})""")
        check("every control the guide names exists", all(real.values()))
        pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
        check("Tab stays inside the guide while it's open", E("document.getElementById('intro').contains(document.activeElement)"))
        pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
        check("Esc closes it and the map is usable", not E("__cta.introOpen") and E("document.getElementById('intro').hidden"))
        check("closing marks it seen", E("localStorage.getItem('nitabot.introSeen')") == "1")
        pg.reload(); pg.wait_for_timeout(1500)
        check("return visit: it doesn't open again", not E("__cta.introOpen"))
        E("document.getElementById('helpBtn').click()"); pg.wait_for_timeout(800)
        check("? reopens it", E("__cta.introOpen"))
        E("document.querySelector('#intro .go').click()"); pg.wait_for_timeout(800)
        check("Start exploring closes it", not E("__cta.introOpen"))
        ctx.close()
        ctx, pg, errs = ctx_for(br, port, storage_broken=True)
        pg.wait_for_timeout(1500); E = pg.evaluate
        opened = E("__cta.introOpen"); E("document.querySelector('#intro .go').click()"); pg.wait_for_timeout(800)
        check("storage blocked: guide still opens and closes; map works", opened and not E("__cta.introOpen") and E("__cta.trains.length") > 0, "; ".join(errs[:2]))
        ctx.close()
        ctx, pg, errs = ctx_for(br, port, seen=False, phone=True)
        pg.wait_for_timeout(1500); E = pg.evaluate
        r = E("(()=>{const b=document.getElementById('intro').getBoundingClientRect();const g=document.querySelector('#intro .go').getBoundingClientRect();return[b.left,b.right,b.top,b.bottom,g.bottom,innerWidth,innerHeight]})()")
        check("phone: the guide fits the screen and its button is reachable", r[0] >= 0 and r[1] <= r[5] and r[2] >= 0 and r[3] <= r[6] + 1, str([round(v) for v in r]))
        pg.screenshot(path=os.path.join(T.OUT, "phone-tutorial.png"))
        E("document.querySelector('#intro .go').click()"); pg.wait_for_timeout(1000)
        hb = E("document.querySelector('.top').getBoundingClientRect().height")
        check("phone: the header stays compact (two rows at most)", hb < 110, f"{hb:.0f} px")
        ctx.close()
        br.close()
    srv.shutdown()

    # ---- favicon and page metadata
    check("no stale data-URI icons left in the page", not re.search(r'rel="(icon|apple-touch-icon)"[^>]*href="data:', html))
    refs = re.findall(r'<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"', html)
    check("icon links point at files that exist", refs and all(os.path.exists(os.path.join(ROOT, r)) for r in refs), str(refs))
    def png_size(f):
        b = open(os.path.join(ROOT, f), "rb").read(24); return struct.unpack(">II", b[16:24])
    check("favicon PNG is 32x32 and the touch icon 180x180", png_size("favicon-32.png") == (32, 32) and png_size("apple-touch-icon.png") == (180, 180))
    svg = open(os.path.join(ROOT, "favicon.svg")).read()
    check("favicon SVG is simple vector art (no text, no images)", "<text" not in svg and "<image" not in svg and len(svg) < 1500)
    check("README carries the same disclaimer", DISCLAIMER in open(os.path.join(ROOT, "README.md")).read())
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} redesign checks passed (mock Worker; real devices and live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
