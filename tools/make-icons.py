#!/usr/bin/env python3
"""
Regenerate the extension icons.

Development utility only — the extension itself needs neither Python nor this
script. Run it from the project root if the mark ever changes:

    python3 tools/make-icons.py

Draws the Ternary House qualifier mark: three ascending bars (the "recent
sample") on a dark rounded tile. Pure standard library, no dependencies.
"""

import struct
import zlib
from pathlib import Path

BG = (20, 22, 26)
BAR = (122, 167, 238)
ACCENT = (241, 241, 241)


def rounded(x, y, size, radius):
    """True when (x, y) lies inside a rounded square of the given size."""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def render(size):
    radius = max(2, round(size * 0.22))
    pad = max(2, round(size * 0.20))
    inner = size - 2 * pad
    bar_w = max(1, round(inner / 4.4))
    gap = max(1, round((inner - 3 * bar_w) / 2))
    heights = [inner * 0.42, inner * 0.68, inner * 1.0]

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            if not rounded(x, y, size, radius):
                row.append((0, 0, 0, 0))
                continue
            colour = BG
            for i, h in enumerate(heights):
                bx = pad + i * (bar_w + gap)
                top = pad + inner - round(h)
                if bx <= x < bx + bar_w and top <= y < pad + inner:
                    colour = BAR if i < 2 else ACCENT
                    break
            row.append((colour[0], colour[1], colour[2], 255))
        pixels.append(row)
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBBB", *px) for px in row) for row in pixels
    )

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in (16, 48, 128):
        target = out / f"icon{size}.png"
        write_png(target, render(size))
        print(f"wrote {target.relative_to(out.parent)} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
