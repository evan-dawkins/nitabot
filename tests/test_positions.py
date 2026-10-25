"""NITABot train-position integrity tests: reports are fed straight into the page's own pipeline (__cta.ingest),
with made-up timestamps and positions placed on the real track geometry. SIMULATED observations only: these prove
the rules behave as designed (hold, confirm, drop, stale, hide, recover). They do NOT measure accuracy against the
live CTA or Metra feeds; that needs recorded real reports, which this machine can't fetch.

Run from the repo root:   python3 tests/test_positions.py
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


JS = r"""
window.__pt={
  api:k=>__cta.LINES[k].api,
  rep(key,run,ri,s,fix,o={}){const[lat,lon]=__cta.llAt(key,ri,s,o.off||0);const r=__cta.LINES[key].routes[ri];
    const ni=Math.min(r.st.length-1,Math.ceil(s+1e-6));
    return{run:String(run),uid:o.uid,lat,lon,predicted_at:fix,next_sta_id:o.next===undefined?(o.back?r.st[Math.max(0,Math.floor(s-1e-6))]:r.st[ni]):o.next,dest:"Test"}},
  feed(key,run,ri,s,fix,o){const d={lines:{}};d.lines[this.api(key)]=[this.rep(key,run,ri,s,fix,o)];__cta.ingest(d,[key]);return this.get(key,run,o&&o.uid)},
  feedLL(key,run,lat,lon,fix,o={}){const d={lines:{}};d.lines[this.api(key)]=[{run:String(run),uid:o.uid,lat,lon,predicted_at:fix,next_sta_id:o.next||""}];__cta.ingest(d,[key]);return this.get(key,run,o.uid)},
  t(key,run,uid){return __cta.trains.find(t=>t.id===key+":"+(uid??run))},
  get(key,run,uid){const t=this.t(key,run,uid);if(!t)return null;
    return{ri:t.ri,segTo:t.segTo,segFrom:t.segFrom,lastObsS:t.lastObsS,held:!!t.held,stale:!!t.stale,hidden:!!t.hidden,
      updated:t.updated,acc:t.acc,raw:t.raw,pend:t.pend,dir:t.dirSign,shown:t.shown,state:__cta.posState(t),log:t.log||[]}},
  kill(key,run,uid){const t=this.t(key,run,uid);if(t){t.lastSeen=0}}
};
"""


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg, errs = T.open_page(br, port)
        pg.wait_for_function(f"__cta.trains.length >= {T.N_TRAINS}", timeout=20000)
        pg.evaluate(JS)
        E = pg.evaluate
        now = int(time.time() * 1000)
        T0 = now - 100000                         # test reports run from 100 s ago up to now (so they aren't stale)
        S = lambda k: T0 + k * 30000

        # 1. normal movement, then a station stop
        a = E(f"__pt.feed('red',9001,0,5,{S(0)})"); b = E(f"__pt.feed('red',9001,0,5.6,{S(1)})")
        check("normal move: accepted and glides to the new report", not b["held"] and abs(b["segTo"] - 5.6) < .05 and b["segFrom"] < 5.6, f"segTo {b['segTo']:.2f}")
        c = E(f"__pt.feed('red',9001,0,5.6,{S(2)})")
        check("station stop: same place, newer time: accepted, stays put", not c["held"] and abs(c["segTo"] - 5.6) < .05 and c["acc"]["fix"] == S(2))

        # 2. small GPS deviation off the track (40 m to the side): still matched to its own track, not held
        d = E(f"__pt.feed('red',9002,0,10,{S(0)})"); d2 = E(f"__pt.feed('red',9002,0,10.4,{S(1)},{{off:1.2}})")
        check("40 m off the track: matched onto the track, accepted", not d2["held"] and abs(d2["segTo"] - 10.4) < .1, f"segTo {d2['segTo']:.2f}")
        check("source coordinates kept apart from the matched position", abs(d2["raw"]["lat"] - E("__cta.llAt('red',0,10.4,1.2)[0]")) < 1e-9)

        # 3. suspicious jump, then confirmed
        E(f"__pt.feed('red',9003,0,4,{S(0)})")
        j = E(f"__pt.feed('red',9003,0,24,{S(1)})")       # ~20 stations in 30 s: impossible
        check("impossible jump: held, marker stays at the trusted position", j["held"] and abs(j["segTo"] - 4) < .05 and j["pend"]["why"] == "jump", j["log"][-1:])
        pg.wait_for_timeout(400)
        sh = E("__pt.get('red',9003).shown"); exp = E("(()=>{const r=__cta.LINES.red.routes[0];return null})()")
        j2 = E(f"__pt.feed('red',9003,0,24.4,{S(2)})")     # carries on from the held report
        check("jump confirmed by the next report: accepted", not j2["held"] and abs(j2["segTo"] - 24.4) < .05, j2["log"][-1:])
        check("confirmed jump is placed, not glided along unseen track", abs(j2["segFrom"] - 24.4) < .05)

        # 4. suspicious jump, then contradicted (it was a blip)
        E(f"__pt.feed('red',9004,0,8,{S(0)})"); E(f"__pt.feed('red',9004,0,28,{S(1)})")
        k2 = E(f"__pt.feed('red',9004,0,8.5,{S(2)})")
        check("jump then a report back on course: blip dropped, normal tracking", not k2["held"] and abs(k2["segTo"] - 8.5) < .05 and "blip" in " ".join(k2["log"]), k2["log"][-2:])

        # 5. repeated contradictory reports: stays held, never moves toward any of them
        E(f"__pt.feed('red',9005,0,6,{S(0)})")
        for i, s in enumerate((26, 14, 30)):
            r = E(f"__pt.feed('red',9005,0,{s},{S(i + 1)})")
        check("reports that keep contradicting each other: still held at the trusted spot", r["held"] and abs(r["segTo"] - 6) < .05, r["log"][-2:])

        # 6. out-of-order and duplicate reports
        E(f"__pt.feed('red',9006,0,12,{S(2)})")
        o = E(f"__pt.feed('red',9006,0,13,{S(1)})")
        check("older report after a newer one: ignored", abs(o["segTo"] - 12) < .05 and o["acc"]["fix"] == S(2))
        du = E(f"__pt.feed('red',9006,0,12.7,{S(2)})")
        check("same timestamp, different place: ignored", abs(du["segTo"] - 12) < .05)

        # 7. a real reversal: three reports in a row going backwards
        E(f"__pt.feed('red',9007,0,15,{S(0)})"); E(f"__pt.feed('red',9007,0,15.6,{S(1)})")
        r1 = E(f"__pt.feed('red',9007,0,15.2,{S(2)},{{next:''}})"); r2 = E(f"__pt.feed('red',9007,0,14.8,{S(3)},{{next:''}})")
        check("one or two steps back: not followed yet", abs(r2["segTo"] - 15.6) < .05)
        r3 = E(f"__pt.feed('red',9007,0,14.4,{S(3) + 20000},{{next:''}})")
        check("third report backwards: reversal accepted", abs(r3["segTo"] - 14.4) < .05 and r3["dir"] == -1, f"segTo {r3['segTo']:.2f} dir {r3['dir']}")

        # 8. branch change with neither report on shared track (Green Line: Ashland/63rd vs Cottage Grove)
        P = E("__cta.sharedPrefix(__cta.LINES.g,0,1)")
        n0 = E("__cta.LINES.g.routes[0].st.length")
        E(f"__pt.feed('g',9008,0,{n0 - 1.5},{S(0)})")
        bj = E(f"__pt.feed('g',9008,1,{n0 - 1.5},{S(1)})")
        check("hop between branches off the shared track: held", bj["held"] and bj["ri"] == 0, bj["log"][-1:])
        bc = E(f"__pt.feed('g',9008,1,{n0 - 1.3},{S(2)})")
        check("hop confirmed by the next report: accepted on the other branch", not bc["held"] and bc["ri"] == 1, bc["log"][-1:])
        E(f"__pt.feed('g',9009,0,{P - 2},{S(0)})")
        bs = E(f"__pt.feed('g',9009,1,{P - 1.4},{S(1)})")
        check("branch switch on the shared track: accepted straight away", not bs["held"], f"P={P}")

        # 9. the Loop: Brown Line finishing its lap (same place, far apart along the route) is not a jump
        E(f"__pt.feed('brn',9010,0,25.6,{S(0)})")
        lp = E(f"__pt.feed('brn',9010,0,18.1,{S(1)},{{next:''}})")
        sameSpot = E("(()=>{const a=__cta.llAt('brn',0,26),b=__cta.llAt('brn',0,18);return Math.hypot((a[0]-b[0])*110540,(a[1]-b[1])*82000)})()")
        check("Loop lap wrap (Merchandise Mart twice on the route): not held", not lp["held"], f"same station {sameSpot:.0f} m apart")
        # closely spaced Loop stations: a report between Quincy and LaSalle/Van Buren lands between them
        ql = E(f"__pt.feed('brn',9011,0,20.5,{S(0)})")
        check("closely spaced Loop stations: placed between the right pair", 20.3 < ql["segTo"] < 20.7, f"s {ql['segTo']:.2f}")

        # 10. parallel tracks: a Purple Line report on the North Side main (shared with Red) stays on the Purple Line
        pr = E(f"__pt.feed('p',9012,0,12,{S(0)})")
        check("Purple report on track shared with Red: matched to the Purple route", pr and pr["ri"] == 0 and abs(pr["segTo"] - 12) < .1)

        # 11. genuine large correction after a long gap (10 minutes, ~12 km): reachable, accepted
        E(f"__pt.feed('red',9013,0,3,{now - 700000})")
        lc = E(f"__pt.feed('red',9013,0,14,{now - 100000})")
        check("large move after a long gap: physically possible, accepted", not lc["held"] and abs(lc["segTo"] - 14) < .05)

        # 12. Metra GPS jump on UP-N, then contradicted
        E(f"__pt.feed('upn',9014,0,6,{S(0)},{{uid:'MX1'}})")
        mj = E(f"__pt.feed('upn',9014,0,20,{S(1)},{{uid:'MX1'}})")
        check("Metra GPS jump: held", mj["held"] and abs(mj["segTo"] - 6) < .05)
        mb = E(f"__pt.feed('upn',9014,0,6.2,{S(2)},{{uid:'MX1'}})")
        check("Metra: next report back on course, blip dropped", not mb["held"] and abs(mb["segTo"] - 6.2) < .05)

        # 13. stale, prolonged unresolved, hidden, then recovery
        E(f"__pt.feed('red',9015,0,9,{now - 200000})"); pg.wait_for_timeout(300)
        st = E("__pt.get('red',9015)")
        check("no new report for over 2.5 min: shown as out of date", st["stale"] and st["state"] == "stale")
        E(f"__pt.feed('red',9016,0,9,{now - 330000})")
        E(f"__pt.feed('red',9016,0,29,{now - 20000})"); pg.wait_for_timeout(300)
        hd = E("__pt.get('red',9016)")
        check("held for over 5 min with nothing confirmed: hidden from the map", hd["hidden"] and hd["state"] == "hidden")
        hd2 = E(f"__pt.feed('red',9016,0,29.3,{now - 5000})"); pg.wait_for_timeout(300)
        hd3 = E("__pt.get('red',9016)")
        check("then a confirming report: back on the map, tracking normally", not hd3["hidden"] and not hd3["held"] and not hd3["stale"], hd3["state"])

        # 14. a train that disappears from the feed is removed after 4 minutes unseen
        E(f"__pt.feed('red',9017,0,7,{S(0)})"); E("__pt.kill('red',9017)")
        E("__cta.ingest({lines:{}},['red'])")
        check("gone from the feed for 4 min: removed", E("!__pt.t('red',9017)"))

        # 15. animation: held marker doesn't drift toward a rejected report; accepted glide has no jumps
        E(f"__pt.feed('red',9018,0,16,{now - 31000})"); pg.wait_for_timeout(1200)
        a0 = E("__pt.get('red',9018).shown"); E(f"__pt.feed('red',9018,0,31,{now - 1000})"); pg.wait_for_timeout(1500)
        a1 = E("__pt.get('red',9018).shown")
        check("held marker doesn't move toward the rejected report", math.hypot(a1[0] - a0[0], a1[1] - a0[1]) < .01, f"moved {math.hypot(a1[0]-a0[0], a1[1]-a0[1]):.3f} units")
        E(f"__pt.feed('red',9019,0,18,{now - 60000})"); E(f"__pt.feed('red',9019,0,18.8,{now - 30000})")
        pts = E("""async()=>{const out=[];for(let i=0;i<40;i++){await new Promise(r=>requestAnimationFrame(r));out.push(__pt.get('red',9019).shown)}return out}""")
        steps = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
        check("accepted glide: no frame jumps (smooth, ~0 to 0.5 units a frame)", max(steps) < 1.0, f"largest step {max(steps):.3f} units (~{max(steps)*33:.0f} m)")

        diag = E("__cta.posDiag()")
        check("diagnostics count held, confirmed, dropped and contradicted reports", diag["held"] >= 5 and diag["confirmed"] >= 3 and diag["blips"] >= 2 and diag["replaced"] >= 2,
              json.dumps({k: diag[k] for k in ("accepted", "held", "confirmed", "blips", "replaced", "old", "dup", "offtrack")}))
        check("no page errors", not errs, "; ".join(errs[:3]))
        pg.context.close(); br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} position checks passed (simulated reports through the page's own pipeline; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
