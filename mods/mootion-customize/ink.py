"""Turn a face picture into a 256px avatar: centered square crop, black ink on transparent.

Usage: python3 -I ink.py <source image> <destination png>
White becomes transparent and dark lines stay, so the face sits on any colored circle.
Exits 2 when Pillow isn't installed (the caller then falls back to a plain resize).
"""
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit(2)

src, dest = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("L")
w, h = im.size
side = int(min(w, h) * 0.75)
left, top = (w - side) // 2, (h - side) // 2
im = im.crop((left, top, left + side, top + side)).resize((256, 256), Image.LANCZOS)
out = Image.new("RGBA", im.size, (20, 20, 20, 0))
out.putalpha(im.point(lambda v: 255 - v))
out.save(dest)
