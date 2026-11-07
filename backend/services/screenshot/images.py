"""Screenshot checks and preparation, entirely in memory.

Each upload is decoded (so a renamed non-image is refused), re-encoded without
metadata (no EXIF, location or device data goes anywhere), and tall phone
screenshots are cut into overlapping pieces: vision models shrink a very tall
image to fit, which makes small text unreadable.
"""

import base64
import io

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_FILES = 4
MAX_BYTES = 10 * 1024 * 1024
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP"}
MIN_SIDE = 200
MAX_LONG_EDGE = 2000  # per piece sent to the model
TALL_RATIO = 2.2  # height/width above which a screenshot is cut into pieces
PIECE_RATIO = 1.6  # piece height as a multiple of width
OVERLAP = 0.15
MAX_PIECES = 6
_PNG_LIMIT = 3_500_000  # above this, fall back to high-quality JPEG (models cap ~5 MB per image)

# Decompression-bomb guard: refuse anything over ~50 megapixels.
Image.MAX_IMAGE_PIXELS = 50_000_000


class ImageError(ValueError):
    """A problem with an upload, worded for the person."""


def _encode(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    if buf.tell() > _PNG_LIMIT:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92)
        mime = "image/jpeg"
    else:
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


def _fit(img: Image.Image) -> Image.Image:
    w, h = img.size
    scale = MAX_LONG_EDGE / max(w, h)
    if scale >= 1:
        return img
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)


def _pieces(img: Image.Image) -> list[Image.Image]:
    w, h = img.size
    if h <= w * TALL_RATIO:
        return [img]
    piece_h = int(w * PIECE_RATIO)
    step = int(piece_h * (1 - OVERLAP))
    count = -(-(h - piece_h) // step) + 1
    if count > MAX_PIECES:  # very long capture: taller pieces (same overlap) rather than drop the bottom
        count = MAX_PIECES
        piece_h = -(-h // (1 + (count - 1) * (1 - OVERLAP)))
        piece_h = int(piece_h)
        step = int(piece_h * (1 - OVERLAP))
    tops = [min(i * step, h - piece_h) for i in range(count - 1)] + [h - piece_h]  # last piece ends at the bottom
    return [img.crop((0, top, w, top + piece_h)) for top in tops]


def prepare(data: bytes, label: str) -> list[str]:
    """One screenshot → data URLs (one, or several overlapping pieces, top to bottom)."""
    if len(data) > MAX_BYTES:
        raise ImageError(f"{label} is larger than {MAX_BYTES // (1024 * 1024)} MB")
    try:
        img = Image.open(io.BytesIO(data))
        fmt = img.format
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ImageError(f"{label} isn't a readable PNG, JPEG or WebP image") from exc
    if fmt not in ALLOWED_FORMATS:
        raise ImageError(f"{label} is {fmt or 'an unknown format'} — use PNG, JPEG or WebP")
    img = ImageOps.exif_transpose(img)  # honour rotation, then drop all metadata
    img = img.convert("RGB")
    if min(img.size) < MIN_SIDE:
        raise ImageError(f"{label} is too small to read ({img.size[0]}×{img.size[1]} px)")
    clean = Image.new("RGB", img.size)
    clean.paste(img)
    return [_encode(_fit(p)) for p in _pieces(clean)]
