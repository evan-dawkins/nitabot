"""NITABot Metra feed-health and service-alert tests. Headless Chromium against the MOCK Worker (tests/test_page.py),
which can be switched into failure modes: a 502, Metra's own feed failing, an empty answer, stale positions,
an unreadable answer and a dropped connection. The alert samples are written in the Worker's own output shape
(CTA Customer Alerts fields: impact, major, start/end, lines, stations; Metra GTFS-realtime: effect, cause,
severity, periods, routes, stops). MOCK data only: this proves the page's handling, not the live feeds' health.

Run from the repo root:   python3 tests/test_health_alerts.py
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


NOW = int(time.time() * 1000)
CTA_ALERTS = [
    {"id": "C1", "header": "Elevator at Clark/Lake temporarily out of service", "short": "", "description": "The elevator between street and mezzanine is out of service.",
     "severity": 8, "impact": "Elevator Status", "major": 0, "start": NOW - 86400e3, "end": None, "lines": [], "stations": ["40380"], "url": "https://www.transitchicago.com/alerts/"},
    {"id": "C2", "header": "Blue Line trains are running with significant delays", "short": "", "description": "Due to a disabled train near Jefferson Park.",
     "severity": 45, "impact": "Significant Delays", "major": 1, "start": NOW - 900e3, "end": None, "lines": ["Blue"], "stations": [], "url": ""},
    {"id": "C3", "header": "Red Line track work, weekends", "short": "", "description": "Trains share one track between Howard and Loyola.",
     "severity": 20, "impact": "Planned Work", "major": 0, "start": NOW + 3 * 86400e3, "end": NOW + 5 * 86400e3, "lines": ["Red"], "stations": [], "url": ""},
    {"id": "C4", "header": "Old alert that already ended", "short": "", "description": "x", "severity": 1, "impact": "Service Change",
     "major": 0, "start": NOW - 5 * 86400e3, "end": NOW - 86400e3, "lines": ["Brn"], "stations": [], "url": ""},
    {"id": "C2", "header": "Blue Line trains are running with significant delays", "short": "", "description": "Due to a disabled train near Jefferson Park.",
     "severity": 45, "impact": "Significant Delays", "major": 1, "start": NOW - 900e3, "end": None, "lines": ["Blue"], "stations": [], "url": ""},   # duplicate
    {"id": "C5", "header": "", "short": "Pink Line entrance at Damen closed", "description": "", "severity": 5, "impact": "Station Closure",
     "major": 0, "start": None, "end": None, "lines": ["Pink"], "stations": [], "url": ""},   # headline missing: short text used
]
MET_ALERTS = [
    {"id": "M1", "header": "UP-N trains operating 10-15 minutes behind schedule", "description": "Due to signal problems.", "url": "", "routes": ["UP-N"], "stops": [],
     "periods": [], "cause": 3, "effect": 3, "severity": 3},
    {"id": "M2", "header": "Ogilvie elevator to the North Concourse out of service", "description": "", "url": "", "routes": [], "stops": ["OTC"],
     "periods": [], "cause": None, "effect": 11, "severity": 2},
    {"id": "M3", "header": "MD-W weekend track construction: modified schedule", "description": "", "url": "", "routes": ["MD-W"], "stops": [],
     "periods": [{"start": NOW // 1000 - 3600, "end": NOW // 1000 + 86400}], "cause": 10, "effect": 6, "severity": 2},
    {"id": "M4", "header": "No Rock Island service south of Blue Island", "description": "Bridge inspection.", "url": "https://metra.com/x", "routes": ["RI"], "stops": [],
     "periods": [], "cause": 2, "effect": 1, "severity": 4},
    {"id": "M5", "header": "Escalator work at Union Station", "description": "", "url": "", "routes": [], "stops": ["CUS"], "periods": [], "cause": None, "effect": 7, "severity": None},
    {"id": "M6", "header": "Station notice", "description": "General notice.", "url": "", "routes": [], "stops": [], "periods": [], "cause": None, "effect": 8, "severity": None},
]


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg, errs = T.open_page(br, port)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS + T.N_METRA}", timeout=20000)
        E = pg.evaluate
        UI = """()=>({mh:document.getElementById('mhealth').hidden?'':document.getElementById('mhealth').className,
            mtxt:document.getElementById('mhealth').innerText,title:document.getElementById('mhealth').title,
            banner:document.getElementById('mbanner').hidden?'':document.getElementById('mbanner').innerText,
            state:document.getElementById('stateText').textContent,health:__cta.metraHealth(),kind:__cta.MH.kind,fails:__cta.MH.fails})"""
        def poll(mode):
            T.MOCK["metra"] = mode
            E("__cta.pollMetra()"); pg.wait_for_timeout(500); E("()=>{}"); return E(UI)
        u = E(UI)
        check("healthy: no Metra mark, no banner", u["mh"] == "" and u["banner"] == "" and u["health"] == "ok", json.dumps(u)[:120])

        # one transient failure: subtle mark only, CTA untouched, then recovery
        u = poll("fail502")
        check("first failed request: subtle Metra mark, no banner", "miss" in u["mh"] and u["banner"] == "" and u["state"] == "Live", f"{u['mh']} / {u['state']}")
        check("the mark says when it was missed and when the last good update was", "Missed a Metra update at" in u["title"] and "Last good Metra update" in u["title"], u["title"][:140])
        u = poll("ok")
        check("next request fine: back to normal, nothing flickered up", u["mh"] == "" and u["banner"] == "" and u["fails"] == 0)

        # sustained outage: escalates after 90 s without a usable update and 2+ misses (time moved on, not waited)
        u = poll("fail502"); E("__cta.MH.lastUsable-=95000"); u = poll("fail502")
        check("sustained outage: persistent banner naming Metra, with how long", "Metra updates have stopped" in u["banner"] and "Last good update" in u["banner"], u["banner"][:120])
        check("Metra outage doesn't say CTA is down", u["state"] == "Live" and "L trains are still live" in u["banner"], u["state"])
        u = poll("fail502")
        check("banner stays up through the outage", "stopped" in u["banner"])
        mtr = E("__cta.trains.filter(t=>t.L.sys==='metra').length")
        check("Metra trains stay on the map at their last reports during the outage", mtr == T.N_METRA, f"{mtr}")
        u = poll("ok")
        check("fresh data: banner clears by itself, mark goes away", u["banner"] == "" and u["mh"] == "" and u["health"] == "ok")

        # failure kinds are told apart
        for mode, kind in (("metra_error", "metra"), ("garbage", "unreadable"), ("abort", "network"), ("stale", "stale")):
            u = poll(mode)
            check(f"{mode}: classified as '{kind}', stage 1", u["kind"] == kind and "miss" in u["mh"], f"{u['kind']} / {u['mh']}")
            poll("ok")
        E("__cta.MH.lastUsable-=95000"); poll("stale"); E("__cta.MH.lastUsable-=95000"); u = poll("stale")
        check("stale positions for 90 s+: escalate like an outage (old data is not a good update)", "stopped" in u["banner"], u["kind"])
        poll("ok")
        u = poll("empty"); E("__cta.MH.lastUsable-=200000"); u = poll("empty")
        check("empty but readable answer: not a failure, never escalates", u["kind"] == "empty" and u["banner"] == "" and "quiet" in u["mh"] and "none reporting" in u["mtxt"], f"{u['kind']} {u['mh']} {u['mtxt']}")
        poll("ok")

        # isolated failures sprinkled among good answers never raise the banner
        seen = set()
        for m in ("fail502", "ok", "abort", "ok", "garbage", "ok"):
            seen.add(bool(poll(m)["banner"]))
        check("isolated failures never raise the banner", seen == {False})

        # ---- alerts
        T.MOCK["metra_alerts"] = MET_ALERTS
        poll("ok")
        E(f"__cta.takeAlerts({{alerts:{json.dumps(CTA_ALERTS)}}},'cta')")
        al = E("__cta.alerts.map(a=>({id:a.id,sys:a.sys,cat:a.cat,serious:a.serious,keys:a.keys,stns:a.stns.map(r=>r.id),start:a.start}))")
        by = {a["id"]: a for a in al}
        check("duplicate alert shown once, ended alert left out", sum(1 for a in al if a["id"] == "cta:C2") == 1 and "cta:C4" not in by, f"{len(al)} alerts")
        cats = {k: by[k]["cat"] for k in by}
        want = {"cta:C1": "access", "cta:C2": "delay", "cta:C3": "planned", "cta:C5": "station", "metra:M1": "delay", "metra:M2": "access",
                "metra:M3": "planned", "metra:M4": "disrupt", "metra:M5": "access", "metra:M6": "other"}
        check("categories come from the feeds' own fields", all(cats.get(k) == v for k, v in want.items()), json.dumps({k: cats.get(k) for k in want}))
        check("major: CTA's MajorAlert flag and Metra's severe/no-service only", by["cta:C2"]["serious"] and by["metra:M4"]["serious"] and not by["cta:C1"]["serious"] and not by["metra:M1"]["serious"])
        check("stations and lines come from the alert's own ids", by["cta:C1"]["stns"] == ["40380"] and by["metra:M2"]["stns"] == ["OTC"] and by["cta:C2"]["keys"] == ["blue"] and by["metra:M3"]["keys"] == ["mdw"])
        E("document.getElementById('abtn').click()"); pg.wait_for_timeout(400)
        first = E("[...document.querySelectorAll('#alist .aitem')].slice(0,2).map(i=>i.dataset.id)")
        check("major alerts listed first", set(first) == {"cta:C2", "metra:M4"}, str(first))
        def filt(sys=None, cat=None):
            if sys: E(f"document.querySelector('#afilt [data-sys={sys}]').click()")
            if cat: E(f"document.querySelector('#afilt [data-cat={cat}]').click()")
            pg.wait_for_timeout(150)
            return E("[...document.querySelectorAll('#alist .aitem')].map(i=>i.dataset.id)")
        ids = filt("metra", "access")
        check("combined filter: Metra + elevators & accessibility", sorted(ids) == ["metra:M2", "metra:M5"], str(ids))
        ids = filt("cta", "all"); ids2 = filt(None, "delay")
        check("combined filter: CTA + delays", ids2 == ["cta:C2"] and all(i.startswith("cta:") for i in ids), str(ids2))
        cat_btns = E("[...document.querySelectorAll('#afilt [data-cat]')].map(b=>b.dataset.cat)")
        check("only categories that have alerts get a filter button", "disrupt" not in cat_btns, str(cat_btns))
        ids = filt("all", "all")
        up = E("document.querySelector('#alist [data-id=\"cta:C3\"]').innerText")
        check("upcoming work shows when it starts", "Starts" in up, up.replace("\n", " | ")[:100])
        pg.screenshot(path=os.path.join(T.OUT, "alerts-panel.png"))
        # map links
        E("document.querySelector('#alist [data-id=\"cta:C1\"]').click()"); pg.wait_for_timeout(200)
        E("document.querySelector('#alist [data-id=\"cta:C1\"] .amap').click()"); pg.wait_for_timeout(1600)
        sp = E("__cta.spopRec&&__cta.spopRec.id"); hl = E("__cta.STN.get('40380').g.classList.contains('ahl')")
        check("elevator alert: Show on map finds and highlights its station", sp == "40380" and hl, f"sheet {sp}, highlight {hl}")
        E("document.querySelector('#spop .x')&&document.querySelector('#spop .x').click()")
        E("document.getElementById('abtn').click()"); pg.wait_for_timeout(300)
        E("document.querySelector('#alist [data-id=\"metra:M4\"]').click()"); pg.wait_for_timeout(200)
        E("document.querySelector('#alist [data-id=\"metra:M4\"] .amap').click()"); pg.wait_for_timeout(900)
        check("route alert: Show on map highlights that line", E("__cta.focusKey") == "ri", str(E("__cta.focusKey")))
        E("__cta.setFocus(null)")
        nm = E("!!document.querySelector('#alist [data-id=\"metra:M6\"] .amap')")
        check("alert with no line or station: listed, no invented map location", not nm)
        # an alerts feed that stops answering isn't 'no alerts'
        E("__cta.takeAlerts({alerts_error:'CTA alerts error 500'},'cta')")
        txt = E("document.getElementById('apanel').textContent")
        check("CTA alerts unavailable: says so, keeps the last ones, never 'no alerts'", "CTA's alerts aren't loading" in txt and "doesn't mean there are none" in txt and "cta:C2" in E("__cta.alerts.map(a=>a.id).join()"), txt.replace("\n", " | ")[:160])
        E("__cta.takeAlerts({alerts:[]},'cta')"); pg.wait_for_timeout(200)
        r = E("[!!document.querySelector('#afilt [data-sys]'),[...document.querySelectorAll('#alist .aitem')].every(i=>i.dataset.id.startsWith('metra:'))]")
        check("only one system has alerts: no system filter, just its alerts", not r[0] and r[1], str(r))
        E("__cta.takeAlerts({alerts:[]},'metra')"); pg.wait_for_timeout(200)
        txt = E("document.getElementById('alist').textContent")
        check("no alerts at all: plain message, no filters", "alerts right now" in txt.lower() and E("document.getElementById('afilt').hidden"), txt[:120])
        errs = [e for e in errs if "workers.dev/?trips=1" not in e]          # the 502s this test asked the mock for
        check("no page errors", not errs, "; ".join(errs[:3]))
        pg.context.close(); br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} health and alert checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
