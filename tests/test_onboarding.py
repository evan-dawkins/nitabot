"""NITABot first visit: the small welcome card, the one live train pointed out, the one-time hints, the full guide
as the reference (with keyboard shortcuts), the empty-search nudge, and returning visitors seeing none of it.
Headless Chromium against the MOCK Worker (tests/test_page.py).

Run from the repo root:   python3 tests/test_onboarding.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_page as T
from playwright.sync_api import sync_playwright

DISCLAIMER = "NITABot is an unofficial personal project made for fun and is not affiliated with NITA."
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def first(br, port, phone=False):
    pg, errs = T.open_page(br, port, phone=phone, intro_hidden=False)
    pg.wait_for_function("__cta.trains.length > 10", timeout=20000); pg.wait_for_timeout(1500)
    return pg, errs


def main():
    srv = T.serve(); port = srv.server_address[1]
    with sync_playwright() as p:
        br = p.chromium.launch()
        # ---- first visit, desktop: card, then the live train, then the Follow tip
        pg, errs = first(br, port); E = pg.evaluate
        r = E("[__cta.welcomeOpen,__cta.introOpen,document.activeElement.textContent,document.getElementById('welcome').innerText]")
        check("first visit: the small welcome card shows, not the full guide", r[0] and not r[1], str(r[:2]))
        check("its main button has focus", r[2] == "Start watching", r[2])
        check("the card carries the exact disclaimer", DISCLAIMER in r[3])
        words = len(r[3].split())
        check("the card is short (under 45 words, disclaimer included)", words < 45, f"{words} words")
        b = E("(()=>{const w=document.getElementById('welcome').getBoundingClientRect();return[w.top/innerHeight,w.bottom<=innerHeight]})()")
        check("it sits low on the screen, leaving the map above it in view", b[0] > .45 and b[1], f"top at {b[0]:.0%}")
        E("document.querySelector('#welcome .go').click()"); pg.wait_for_timeout(1200)
        r = E("[__cta.welcomeOpen,__cta.hintTag,document.getElementById('hint').innerText,document.querySelectorAll('.train.aha').length,localStorage.getItem('nitabot.introSeen')]")
        check("Start watching: the card goes and one live train is pointed out", not r[0] and r[1] == "aha" and r[3] == 1 and "live" in r[2] and "Tap it" in r[2], r[2][:80])
        check("closing the card counts as seen", r[4] == "1")
        check("only one message at a time: the sound note waits", not E("document.getElementById('sndnote').classList.contains('on')"))
        E("document.getElementById('hint').click()"); pg.wait_for_timeout(1300)
        r = E("[document.getElementById('card').classList.contains('on'),__cta.hintTag,document.querySelectorAll('.train.aha').length]")
        check("tapping it opens that train, the pulse stops, and a Follow tip appears", r[0] and r[1] == "follow" and r[2] == 0, str(r))
        hb = E("(()=>{const h=document.getElementById('hint').getBoundingClientRect(),c=document.getElementById('card').getBoundingClientRect();return h.top>=c.bottom-2||h.bottom<=c.top+2||h.left>=c.right-2||h.right<=c.left+2})()")
        check("desktop: the Follow tip doesn't cover the card", hb)
        pg.mouse.click(30, 600); pg.wait_for_timeout(400)
        check("a tap anywhere else puts the tip away", E("__cta.hintTag") is None)
        E("document.querySelector('#card .x')&&document.querySelector('#card .x').click()"); pg.wait_for_timeout(500)
        E("__cta.openStationPop(__cta.STN.get('40380'))"); pg.wait_for_timeout(1200)
        check("first station sheet: a one-time Save station tip", E("__cta.hintTag") == "save")
        E("document.querySelector('#spop .x').click()"); pg.wait_for_timeout(400)
        E("__cta.openStationPop(__cta.STN.get('41700'))"); pg.wait_for_timeout(1200)
        check("and only once", E("__cta.hintTag") is None)
        E("document.querySelector('#spop .x')&&document.querySelector('#spop .x').click()"); pg.wait_for_timeout(300)
        E("()=>{const f=__cta.fitAll();__cta.vb.w=__cta.FIT_W*3;__cta.vb.h=__cta.vb.w*900/1440;__cta.vb.x=f.x+f.w/2-__cta.vb.w/2;__cta.vb.y=f.y+f.h/2-__cta.vb.h/2}")
        pg.wait_for_timeout(2200)
        check("first zoom out to all of Metra: a one-time tip about the 'L' fading", E("__cta.hintTag") == "metra" and "Metra" in E("document.getElementById('hint').innerText"))
        E("document.querySelector('#hint .hx').click()"); E("Object.assign(__cta.vb,__cta.fitAll())"); pg.wait_for_timeout(600)
        pg.keyboard.press("/"); pg.keyboard.type("zzq"); pg.wait_for_timeout(300)
        t = E("document.getElementById('sres').innerText")
        check("empty search suggests what to try", "No station matches" in t and "Try part of the name" in t, t)
        pg.keyboard.press("Escape")
        check("no page errors (first visit)", not errs, "; ".join(errs[:3]))
        pg.reload(); pg.wait_for_function("__cta.trains.length > 10", timeout=20000); pg.wait_for_timeout(1500)
        check("next visit: no welcome card", not E("__cta.welcomeOpen") and not E("__cta.introOpen"))
        pg.context.close()

        # ---- Show me around: the full guide, then the live train once it closes
        pg, errs = first(br, port); E = pg.evaluate
        E("document.querySelector('#welcome .tour').click()"); pg.wait_for_timeout(900)
        txt = E("document.getElementById('intro').innerText")
        check("Show me around opens the full guide", E("__cta.introOpen") and not E("__cta.welcomeOpen"))
        check("the guide lists keyboard shortcuts", all(k in txt for k in ("Find a station", "Light or dark", "Satellite", "Whole map")))
        check("the guide's key includes the 'being checked' marker", "being checked" in txt)
        check("the guide keeps the exact disclaimer", DISCLAIMER in txt)
        E("document.querySelector('#intro .go').click()"); pg.wait_for_timeout(1300)
        check("closing the guide then points out a live train", E("__cta.hintTag") == "aha")
        pg.context.close()

        # ---- Esc and exploring on your own
        pg, errs = first(br, port); E = pg.evaluate
        pg.keyboard.press("Escape"); pg.wait_for_timeout(900)
        check("Esc closes the card (and still shows the live train)", not E("__cta.welcomeOpen") and E("__cta.hintTag") == "aha")
        pg.context.close()
        pg, errs = first(br, port); E = pg.evaluate
        pg.mouse.click(200, 300); pg.wait_for_timeout(900)
        check("tapping the map instead: the card steps aside, no pointer", not E("__cta.welcomeOpen") and E("__cta.hintTag") is None)
        pg.context.close()

        # ---- returning visitor from before this change: no card, no hints
        pg, errs = T.open_page(br, port); E = pg.evaluate
        pg.wait_for_function("__cta.trains.length > 10", timeout=20000); pg.wait_for_timeout(1500)
        E("__cta.openStationPop(__cta.STN.get('40380'))"); pg.wait_for_timeout(1200)
        check("returning visitor: no welcome card and no tips", not E("__cta.welcomeOpen") and E("__cta.hintTag") is None)
        pg.context.close()

        # ---- phone
        pg, errs = first(br, port, phone=True); E = pg.evaluate
        b = E("(()=>{const w=document.getElementById('welcome').getBoundingClientRect(),c=document.getElementById('console').getBoundingClientRect();return[w.left>=0,w.right<=innerWidth,w.bottom<=c.top+1]})()")
        check("phone: the card fits and sits above the line bar", all(b), str(b))
        pg.screenshot(path=os.path.join(T.OUT, "phone-welcome.png"))
        E("document.querySelector('#welcome .go').click()"); pg.wait_for_timeout(1200)
        b = E("(()=>{const h=document.getElementById('hint').getBoundingClientRect();return[__cta.hintTag,h.left>=0,h.right<=innerWidth]})()")
        check("phone: the live-train tip shows on screen", b[0] == "aha" and b[1] and b[2], str(b))
        check("no page errors (phone)", not errs, "; ".join(errs[:3]))
        pg.context.close(); br.close()
    srv.shutdown()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} of {len(results)} onboarding checks passed (mock Worker; live feeds not tested)")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
