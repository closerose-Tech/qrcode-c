#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 Android 自适应图标前景层（三条定位图形 + 数据点阵）。

用法：python tools/make-icons.py
输出：android/app/src/main/res/mipmap-*/ic_launcher_foreground.png 与 mipmap-anydpi-v26/*.xml
依赖：Pillow
"""
import os

from PIL import Image, ImageDraw

GOLD = (201, 162, 39, 255)
DENSITIES = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "android", "app", "src", "main", "res")

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""


def glyph(size, scale=0.62):
    """在透明画布上绘制图形，整体占画布 scale 比例（留在自适应图标安全区内）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    span = size * scale
    off = (size - span) / 2
    s = span * 0.30          # 单个定位图形边长
    gap = span - 2 * s

    def finder(x, y, side):
        d.rectangle([x, y, x + side, y + side], fill=GOLD)
        p1 = side * 0.235
        d.rectangle([x + p1, y + p1, x + side - p1, y + side - p1], fill=(0, 0, 0, 0))
        p2 = side * 0.40
        d.rectangle([x + p2, y + p2, x + side - p2, y + side - p2], fill=GOLD)

    finder(off, off, s)
    finder(off + gap, off, s)
    finder(off, off + gap, s)

    unit = s / 3.0
    ox, oy = off + gap, off + gap
    for i, j in [(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (1, 2), (2, 2)]:
        x = ox + i * unit * 1.12
        y = oy + j * unit * 1.12
        d.rectangle([x, y, x + unit * 0.92, y + unit * 0.92], fill=GOLD)
    return img


def main():
    for name, px in DENSITIES.items():
        folder = os.path.join(ROOT, "mipmap-" + name)
        os.makedirs(folder, exist_ok=True)
        glyph(px).save(os.path.join(folder, "ic_launcher_foreground.png"))

    anydpi = os.path.join(ROOT, "mipmap-anydpi-v26")
    os.makedirs(anydpi, exist_ok=True)
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        with open(os.path.join(anydpi, name), "w", encoding="utf-8") as f:
            f.write(ADAPTIVE_XML)
    print("图标已生成：", ", ".join("mipmap-" + k for k in DENSITIES))


if __name__ == "__main__":
    main()
