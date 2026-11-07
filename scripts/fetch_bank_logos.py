"""Download bank / broker logos into frontend/public/banks/<id>.png.

Run by hand when frontend/src/lib/banks.ts changes (needs Pillow):

    python scripts/fetch_bank_logos.py            # fetch the missing ones
    python scripts/fetch_bank_logos.py --force    # re-fetch everything
    python scripts/fetch_bank_logos.py --only wealthfront,chase --force

For each bank, from its domain in banks.ts, it tries in order:
  1. the icons the home page declares (apple-touch-icon, sized PNG icons),
  2. /apple-touch-icon.png and /favicon.ico,
  3. Google's and DuckDuckGo's favicon services.
A few banks block all of that; COMMONS below names their logo file on
Wikimedia Commons instead.
It keeps the sharpest image of at least 32 px, pads it square, and saves it at
128 px. It also writes frontend/src/lib/bankLogos.json, the ids that have a
file. Banks without a usable logo keep their lettered tile in the app.
The app never fetches logos itself; they ship as static files.
"""

import argparse
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BANKS_TS = ROOT / "frontend" / "src" / "lib" / "banks.ts"
OUT_DIR = ROOT / "frontend" / "public" / "banks"
MANIFEST = ROOT / "frontend" / "src" / "lib" / "bankLogos.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
SIZE = 128
MIN_SIDE = 32
# Banks whose sites block downloads: a logo file on Wikimedia Commons instead.
# "square" crops the symbol at the left of a wide logo.
COMMONS = {
    "hdfc": ("HDFC Bank Logo.svg", "square"),
    "axis": ("Axis Bank logo.svg", "square"),
    "pnb": ("Punjab National Bank new logo.svg", "square"),
    "uob": ("UOB Logo.svg", "square"),
    "yes": ("Yes Bank SVG Logo.svg", None),
    "union": ("Union Bank of India Logo.svg", "square"),
    "fab": ("First Abu Dhabi Bank Logo.svg", None),
}
ENTRY = re.compile(r"b\('([a-z0-9]+)', '[^']*', '[^']*', '#[0-9A-Fa-f]{6}', '[A-Z]*', '([^']+)'")


def get(url: str, limit: int = 3_000_000) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.read(limit), res.geturl()


class IconLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        a = dict(attrs)
        rel = (a.get("rel") or "").lower()
        href = a.get("href") or ""
        if "icon" in rel and "mask" not in rel and href and not href.lower().split("?")[0].endswith(".svg") and not href.startswith("data:"):
            self.found.append(href)


def decode(data: bytes) -> Image.Image | None:
    try:
        img = Image.open(io.BytesIO(data))
        if img.format == "ICO":
            sizes = sorted(img.info.get("sizes") or [img.size], key=lambda s: s[0] * s[1])
            img.size = sizes[-1]
        img.load()
        return img.convert("RGBA")
    except Exception:
        return None


def candidates(domain: str) -> list[str]:
    urls: list[str] = []
    for home in (f"https://www.{domain}/", f"https://{domain}/"):
        try:
            html, final = get(home, 1_500_000)
        except Exception:
            continue
        parser = IconLinks()
        try:
            parser.feed(html.decode("utf-8", "ignore"))
        except Exception:
            pass
        urls += [urllib.parse.urljoin(final, h) for h in parser.found]
        origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlparse(final))
        urls += [f"{origin}/apple-touch-icon.png", f"{origin}/apple-touch-icon-precomposed.png", f"{origin}/favicon.ico"]
        break
    else:
        urls += [f"https://www.{domain}/apple-touch-icon.png", f"https://{domain}/favicon.ico"]
    urls.append(f"https://www.google.com/s2/favicons?domain={domain}&sz=256")
    urls.append(f"https://icons.duckduckgo.com/ip3/{domain}.ico")
    return list(dict.fromkeys(urls))


def best_logo(domain: str) -> tuple[Image.Image | None, str]:
    best, src = None, ""
    for url in candidates(domain):
        try:
            data, _ = get(url)
        except Exception:
            continue
        img = decode(data)
        if img is None:
            continue
        side = min(img.size)
        if side >= MIN_SIDE and (best is None or side > min(best.size)):
            best, src = img, url
        if best is not None and min(best.size) >= 180:
            break
    return best, src


def from_commons(file: str, crop: str | None) -> tuple[Image.Image | None, str]:
    url = "https://commons.wikimedia.org/w/index.php?" + urllib.parse.urlencode({"title": "Special:Redirect/file/" + file, "width": 512})
    try:
        img = decode(get(url)[0])
    except Exception:
        return None, ""
    if img is not None and crop == "square":
        bbox = img.getchannel("A").getbbox() or (0, 0, *img.size)
        img = img.crop(bbox)
        img = img.crop((0, 0, img.height, img.height))
    return img, url


def squared(img: Image.Image) -> Image.Image:
    bbox = img.getchannel("A").getbbox()
    if bbox:
        img = img.crop(bbox)
    side = max(img.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    banks = ENTRY.findall(BANKS_TS.read_text(encoding="utf-8"))
    if not banks:
        print("no banks found in banks.ts", file=sys.stderr)
        return 1
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    todo = [(i, d) for i, d in banks if (not only or i in only) and (args.force or not (OUT_DIR / f"{i}.png").exists())]

    def work(item):
        bank_id, domain = item
        img, src = from_commons(*COMMONS[bank_id]) if bank_id in COMMONS else best_logo(domain)
        if img is None:
            return bank_id, None, ""
        squared(img).save(OUT_DIR / f"{bank_id}.png", optimize=True)
        return bank_id, min(img.size), src

    with ThreadPoolExecutor(8) as pool:
        for bank_id, side, src in pool.map(work, todo):
            print(f"{bank_id:14} {'MISSING' if side is None else f'{side}px'}  {src}")

    have = sorted(p.stem for p in OUT_DIR.glob("*.png") if p.stem in {i for i, _ in banks})
    MANIFEST.write_text(json.dumps(have, indent=0) + "\n", encoding="utf-8")
    print(f"{len(have)}/{len(banks)} banks have a logo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
