"""Records the train check-in voice for "train of the moment".

Every piece the check-ins can say is recorded once with Kokoro, a free open-source voice
(https://github.com/thewh1teagle/kokoro-onnx), then packed into a few small audio files:
  voice/core.mp3            openers, status lines, "in about N minutes", sign-offs
  voice/<line>.mp3          per line: "Next up, X,", "Just passed X.", "Now at X.", "Last stop, X,"
  voice/manifest.json       where each piece starts and how long it is, plus which piece each station uses
The page stitches pieces together at play time. Nothing is generated live, so it costs nothing to run.

Run:  python3 tools/build_voice.py <folder with kokoro-v1.0.onnx + voices-v1.0.bin> <stations.json> [line,line,...]
      (with lines: re-records just those, keeping the rest)
stations.json comes from the page: {lines:{key:{code,name,st:[ids]}}, labels:{id:label}}.
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from num2words import num2words
from kokoro_onnx import Kokoro
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pronounce import needs_fix, phonemes   # Chicago pronunciations (Cicero, Ogilvie, ...)

MODEL, STATIONS = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3].split(",") if len(sys.argv) > 3 else None   # re-record just these lines (keeps the rest)
OUT = os.path.join(os.path.dirname(__file__), "..", "voice", "metra")   # NITABot: Metra's clips beside the L's (voice/cta)
os.makedirs(OUT, exist_ok=True)
k = Kokoro(os.path.join(MODEL, "kokoro-v1.0.onnx"), os.path.join(MODEL, "voices-v1.0.bin"))
VOICE = k.get_voice_style("af_heart") * 0.7 + k.get_voice_style("af_nicole") * 0.3   # warm, a little breathy
SPEED = 0.88
SOFTEN = ("lowpass=f=7000,equalizer=f=6500:t=q:w=1.5:g=-5,equalizer=f=250:t=q:w=1:g=2,"
          "acompressor=threshold=-22dB:ratio=2.5:attack=15:release=200,volume=-3dB")
LEAD, TAIL, GAP = 0.06, 0.10, 0.25           # silence kept around each piece, and between pieces in a pack

LINE_SAY = {"UP-N": "Union Pacific North", "UP-NW": "Union Pacific Northwest", "UP-W": "Union Pacific West",
            "MD-N": "Milwaukee District North", "MD-W": "Milwaukee District West", "NCS": "North Central Service",
            "BNSF": "B-N-S-F", "HC": "Heritage Corridor", "SWS": "SouthWest Service", "RI": "Rock Island",
            "ME": "Metra Electric"}
STN_SAY = {"Union Station": "Union Station", "Millennium": "Millennium Station", "LaSalle St": "LaSalle Street Station",
           "Ogilvie": "Ogilvie", "55th-56th-57th St": "Fifty-fifth, Fifty-sixth, Fifty-seventh Street",
           "51st/53rd St|Hyde Park": "Fifty-first and Fifty-third Street", "O'Hare Transfer": "O'Hare Transfer"}

def say_station(sid, label):
    if sid in STN_SAY: return STN_SAY[sid]
    s = label
    s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: num2words(int(m.group(1)), to="ordinal").title(), s)
    s = re.sub(r"\bSt\b", "Street", s); s = re.sub(r"\bAve\b", "Avenue", s); s = re.sub(r"\bRd\b", "Road", s)
    s = re.sub(r"\bBlvd\b", "Boulevard", s); s = re.sub(r"\bHts\b", "Heights", s)
    return s.replace("/", " and ")

def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def render(text):
    if needs_fix(text):
        a, sr = k.create(phonemes(k, text), voice=VOICE, speed=SPEED, lang="en-us", is_phonemes=True)
    else:
        a, sr = k.create(text, voice=VOICE, speed=SPEED, lang="en-us")
    nz = np.where(np.abs(a) > 0.008)[0]
    a = a[max(0, nz[0] - int(sr * .02)):nz[-1] + int(sr * .06)] if len(nz) else a
    rms = np.sqrt(np.mean(a ** 2)) or 1
    a = a * min(4.0, 0.075 / rms)                       # every piece at the same loudness
    return np.clip(a, -.98, .98), sr

def pack(name, items):
    """items: [(key, text)] -> one mp3 + {key: [start, dur]}"""
    parts, idx, t, sr = [], {}, 0.0, 24000
    for key, text in items:
        a, sr = render(text)
        lead, tail = np.zeros(int(sr * LEAD)), np.zeros(int(sr * TAIL))
        idx[key] = [round(t, 3), round((len(lead) + len(a) + len(tail)) / sr, 3)]
        parts += [lead, a, tail, np.zeros(int(sr * GAP))]
        t += (len(lead) + len(a) + len(tail)) / sr + GAP
        print(f"  {name}: {key}", flush=True)
    wav = os.path.join(tempfile.gettempdir(), f"voice-{name}.wav")
    sf.write(wav, np.concatenate(parts), sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af", SOFTEN, "-ac", "1", "-ar", "24000",
                    "-b:a", "48k", os.path.join(OUT, f"{name}.mp3")], check=True)
    return idx

def n2w(n): return num2words(n)

D = json.load(open(STATIONS))
# ---------- core: things every check-in can say ----------
core = []
for code, say in LINE_SAY.items():
    for d, word in (("in", "an inbound"), ("out", "an outbound")):
        core.append((f"op_{code}_{d}_0", f"Checking in on {word} {say} train."))
        core.append((f"op_{code}_{d}_1", f"Let's ride along with {word} {say} train."))
core += [("s_ontime_0", "It's right on schedule."), ("s_ontime_1", "Right on time so far."),
         ("s_late_1", "It's running about a minute behind."), ("s_late_big", "It's running more than half an hour behind."),
         ("s_early", "It's running a little ahead of schedule."), ("s_gps", "No times from Metra on this one. Just its GPS.")]
core += [(f"s_late_{n}", f"It's running about {n2w(n)} minutes behind.") for n in range(2, 31)]
core += [("t_now", "coming up now."), ("t_up", "coming up."), ("t_1", "in about a minute.")]
core += [(f"t_{n}", f"in about {n2w(n)} minutes.") for n in range(2, 91)]
core += [("end_0", "That's the check-in. Back out to the full map."), ("end_1", "That's all for this one. Back to the whole network."),
         ("end_2", "Okay, that wraps it up. Back out to the map.")]
manifest = json.load(open(os.path.join(OUT, "manifest.json"))) if ONLY else {"core": pack("core", core), "lines": {}, "stn": {}}
# ---------- per line: station phrases ----------
for key, L in D["lines"].items():
    if ONLY and key not in ONLY:
        continue
    items, seen = [], set()
    for sid in L["st"]:
        sp = say_station(sid, D["labels"].get(sid, sid)); sl = slug(sp)
        manifest["stn"][sid] = sl
        if sl in seen: continue
        seen.add(sl)
        items += [(f"nx_{sl}", f"Next up, {sp},"), (f"ps_{sl}", f"Just passed {sp}."),
                  (f"at_{sl}", f"Now at {sp}."), (f"ls_{sl}", f"The last stop is {sp},")]
    manifest["lines"][key] = pack(key, items)
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), separators=(",", ":"))
print("done")
