"""
Build-time preprocessing for the ASCII portrait.

Reads the source photo from public/, crops to the face, normalises contrast,
fades the busy background with a soft elliptical mask and writes a small
grayscale luminance map to public/portrait-map.png. The browser samples this
map at whatever grid resolution the "Detail" control asks for.

Usage:  python3 scripts/preprocess.py [source-image]
Requires Pillow. Not needed at runtime.
"""

import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT = PUBLIC / "portrait-map.png"

# Face crop in source pixel coordinates (left, top, right, bottom).
CROP = (450, 0, 1010, 682)
OUT_WIDTH = 320


def find_source() -> Path:
    if len(sys.argv) > 1:
        return Path(sys.argv[1])
    for ext in ("*.jpg", "*.jpeg", "*.png", "*.webp"):
        for p in sorted(PUBLIC.glob(ext)):
            if p.name != OUT.name:
                return p
    raise SystemExit("No portrait image found in public/")


def main() -> None:
    src = find_source()
    im = Image.open(src).convert("RGB")
    print(f"source: {src.name} {im.size}")

    # Perceptual luminance (Rec. 601 weights, which PIL's "L" uses).
    gray = im.crop(CROP).convert("L")
    gray = ImageOps.autocontrast(gray, cutoff=1)
    # Local contrast: a wide unsharp mask separates eyes, brows, nose shadow
    # and lips from the evenly lit skin, then a fine one crisps edges.
    gray = gray.filter(ImageFilter.UnsharpMask(radius=28, percent=140, threshold=0))
    gray = gray.filter(ImageFilter.UnsharpMask(radius=3, percent=70, threshold=2))
    gray = ImageOps.autocontrast(gray, cutoff=0.5)

    # Soft elliptical mask centred on the face so bystanders and clutter fade out.
    w, h = gray.size
    mask = Image.new("L", (w, h), 0)
    cx, cy = int(w * 0.50), int(h * 0.36)
    rx, ry = int(w * 0.44), int(h * 0.56)
    ImageDraw.Draw(mask).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=w * 0.11))
    gray = ImageChops.multiply(gray, mask)

    out_h = round(OUT_WIDTH * h / w)
    gray = gray.resize((OUT_WIDTH, out_h), Image.LANCZOS)
    gray.save(OUT, optimize=True)
    print(f"wrote: {OUT.relative_to(ROOT)} {gray.size} aspect={w / h:.4f}")


if __name__ == "__main__":
    main()
