"""Records the train check-in voice for CTABot's "train of the moment" (same voice and sound as MetraBot's).

Every piece the check-ins can say is recorded once with Kokoro, a free open-source voice
(https://github.com/thewh1teagle/kokoro-onnx), then packed into a few small audio files:
  voice/core.mp3          openers per line, "CTA says it's running with a delay.", "in about N minutes.", sign-offs
  voice/<line>.mp3        per line: "It's headed to X.", "Next up, X,", "Just passed X.", "Now at X."
  voice/manifest.json     where each piece starts and how long it is
The page stitches pieces together at play time. Nothing is generated live, so it costs nothing to run.
Pieces are named after the words they say (see vslug, which must match the page's vslug).

Run:  python3 tools/build_voice.py <folder with kokoro-v1.0.onnx + voices-v1.0.bin>
"""
import json, os, re, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from num2words import num2words
from kokoro_onnx import Kokoro
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pronounce import needs_fix, phonemes   # Chicago pronunciations (Cicero, Ogilvie, ...)

MODEL = sys.argv[1]
ONLY = sys.argv[2].split(",") if len(sys.argv) > 2 else None   # re-record just these lines (keeps the rest)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "voice", "cta")
os.makedirs(OUT, exist_ok=True)
k = Kokoro(os.path.join(MODEL, "kokoro-v1.0.onnx"), os.path.join(MODEL, "voices-v1.0.bin"))
VOICE = k.get_voice_style("af_heart") * 0.7 + k.get_voice_style("af_nicole") * 0.3   # warm, a little breathy (as MetraBot)
SPEED = 0.88
SOFTEN = ("lowpass=f=7000,equalizer=f=6500:t=q:w=1.5:g=-5,equalizer=f=250:t=q:w=1:g=2,"
          "acompressor=threshold=-22dB:ratio=2.5:attack=15:release=200,volume=-3dB")
LEAD, TAIL, GAP = 0.06, 0.10, 0.25


def vslug(s):            # must match the page: lower case, anything else -> "_"
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def short(n):            # same as the page's shortName
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n)
    return n.replace("Harold Washington Library-State/Van Buren", "Harold Washington Library")


SAY = {"UIC-Halsted": "U I C Halsted", "35th-Bronzeville-IIT": "Thirty-fifth, Bronzeville, I I T", "O'Hare": "O'Hare",
       "Sox-35th": "Sox, Thirty-fifth", "Loop": "the Loop"}


def say(label):
    if label in SAY:
        return SAY[label]
    s = re.sub(r"\b(\d+)(st|nd|rd|th)\b", lambda m: num2words(int(m.group(1)), to="ordinal").title(), label)
    s = s.replace("/", " and ").replace("-", " ")
    return s


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
    wav = os.path.join(tempfile.gettempdir(), f"ctavoice-{name}.wav")
    sf.write(wav, np.concatenate(parts), sr)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-af", SOFTEN, "-ac", "1", "-ar", "24000",
                    "-b:a", "48k", os.path.join(OUT, f"{name}.mp3")], check=True)
    print(f"{name}: {len(items)} pieces", flush=True)
    return idx


DEST_EXTRA = {"y": ["Skokie"], "blue": ["Jefferson Park"]}   # short forms CTA uses on its trains (Dempster-Skokie, short trips)
N = json.load(open(os.path.join(ROOT, "data", "network.json")))
# ---------- core: things every check-in can say ----------
core = []
for key, L in N["lines"].items():
    core.append((f"op_{key}_0", f"Checking in on a {L['name']} train."))
    core.append((f"op_{key}_1", f"Let's ride along with a {L['name']} train."))
core += [("s_dly", "CTA says it's running with a delay.")]
core += [("t_now", "coming up now."), ("t_up", "coming up."), ("t_1", "in about a minute.")]
core += [(f"t_{n}", f"in about {num2words(n)} minutes.") for n in range(2, 91)]
core += [("end_0", "That's the check-in. Back out to the full map."), ("end_1", "That's all for this one. Back to the whole system."),
         ("end_2", "Okay, that wraps it up. Back out to the map.")]
if ONLY:
    manifest = json.load(open(os.path.join(OUT, "manifest.json")))
else:
    manifest = {"core": pack("core", core), "lines": {}}
# ---------- per line: station phrases and destinations ----------
for key, L in N["lines"].items():
    if ONLY and key not in ONLY:
        continue
    labels = []
    for r in L["routes"]:
        for sid in r["st"]:
            lab = short(N["stations"][sid]["name"])
            if lab not in labels:
                labels.append(lab)
    items = []
    for lab in labels:
        sl, sp = vslug(lab), say(lab)
        items += [(f"nx_{sl}", f"Next up, {sp},"), (f"ps_{sl}", f"Just passed {sp}."), (f"at_{sl}", f"Now at {sp}.")]
    for lab in labels + ["Loop"] + DEST_EXTRA.get(key, []):   # CTA's destinations: station names, "Loop", and a few short forms
        items.append((f"to_{vslug(lab)}", f"It's headed to {say(lab)}."))
    manifest["lines"][key] = pack(key, items)
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), separators=(",", ":"))
print("done")
