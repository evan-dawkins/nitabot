"""Builds NITABot's index.html from src/.

src/PARTS lists the source files in page order; they are joined line for line into index.html with an
empty network (/*NET:BEGIN*/const NET=null;/*NET:END*/). tools/build_layout.py then bakes the map in.

Run from the repo root:  python3 tools/build.py && python3 tools/build_layout.py
"""
import os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
parts = [p for p in open(os.path.join(ROOT, "src", "PARTS")).read().split("\n") if p.strip()]
out = []
for p in parts:
    text = open(os.path.join(ROOT, p)).read()
    assert text.endswith("\n"), p + " must end with a newline"
    out.append(text[:-1])
page = "\n".join(out)
assert page.count("/*NET:BEGIN*/") == 1, "the page needs exactly one /*NET:BEGIN*/ marker"
open(os.path.join(ROOT, "index.html"), "w").write(page)
print(f"index.html: {len(parts)} parts, {page.count(chr(10)) + 1} lines")
