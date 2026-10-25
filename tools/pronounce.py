"""Chicago pronunciations the voice gets wrong on its own (it reads Cicero as "SY-sro", Ogilvie as "OG-il-vee").
Shared word for word by CTABot's and MetraBot's tools/build_voice.py. Each word maps to how Chicagoans say it,
in the voice's own phonetic alphabet; the rest of the sentence is read as usual."""
import re

FIX = {
    "Cicero": "sˈɪsɚɹˌoʊ",        # SISS-er-oh
    "Ogilvie": "ˈoʊɡəlvi",        # OH-gul-vee
    "Argyle": "ˈɑːɹɡaɪl",         # AR-gyle
    "Diversey": "dɪvˈɜːsi",       # dih-VER-see
    "Paulina": "pɔːlˈaɪnə",       # paul-EYE-nuh
    "Racine": "ɹəsˈiːn",          # ruh-SEEN
    "Laramie": "lˈɛɹəmi",         # LAIR-uh-mee
    "Pulaski": "pəlˈæski",        # puh-LASS-kee
    "Calumet": "kˈæljəmˌɛt",      # KAL-yuh-met
    "Homan": "hˈoʊmən",           # HOH-mun
    "Sedgwick": "sˈɛdʒwɪk",       # SEDGE-wick
    "Mawr": "mˈɑːɹ",              # Bryn MAR
    "Itasca": "aɪtˈæskə",         # eye-TASS-kuh
    "Lemont": "ləmˈɑːnt",         # luh-MONT
    "Lisle": "lˈaɪl",             # LYLE
    "Medinah": "mədˈaɪnə",        # muh-DYE-nuh
    "Mokena": "moʊkˈiːnə",        # moh-KEE-nuh
    "Mundelein": "mˈʌndəlˌaɪn",   # MUN-duh-line
    "Palatine": "pˈælətˌaɪn",     # PAL-uh-tine
    "Palos": "pˈeɪləs",           # PAY-luss
    "Waukegan": "wɑːkˈiːɡən",     # wah-KEE-gun
    "Winnetka": "wɪnˈɛtkə",       # wih-NET-kuh
    "Braeside": "bɹˈeɪsaɪd",      # BRAY-side
    "Ingleside": "ˈɪŋɡəlsˌaɪd",   # ING-gul-side
    "LaVergne": "ləvˈɜːn",        # luh-VERN
    "Joliet": "dʒˈoʊliˌɛt",       # JOH-lee-et
}


def needs_fix(text):
    return any(re.search(rf"\b{re.escape(w)}\b", text) for w in FIX)


def phonemes(k, text):
    """The whole sentence in phonemes, with each listed word swapped for its Chicago pronunciation."""
    ph = k.tokenizer.phonemize(text, "en-us")
    for w, ipa in FIX.items():
        if re.search(rf"\b{re.escape(w)}\b", text):
            src = k.tokenizer.phonemize(w, "en-us").strip()
            if src not in ph:
                raise SystemExit(f"pronunciation fix for {w!r} didn't apply in {text!r}: {ph}")
            ph = ph.replace(src, ipa)
    return ph
