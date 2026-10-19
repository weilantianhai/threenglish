# -*- coding: utf-8 -*-
"""生成 Threenglish 的 App 图标（Android 传统图标 + 自适应图标前景 + 网页 favicon）。

用法：python scripts/make-icons.py

设计：靛蓝底 + 白色对话气泡 + 靛蓝数字 3（Three + English）。
背景色与 App 内的 indigo-600 一致，`3` 用 indigo-700 保证在小白块里也够清晰。
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
ASSETS = os.path.join(ROOT, "assets", "icon")

BG = (79, 70, 229, 255)      # #4F46E5 indigo-600
INK = (67, 56, 202, 255)     # #4338CA indigo-700
WHITE = (255, 255, 255, 255)

FONT_CANDIDATES = [
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/verdanab.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

# 传统图标各密度尺寸
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# 自适应图标前景：108dp 画布，内容要落在中心 66dp 安全区
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

MASTER = 1024


def load_font(px):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    raise SystemExit("找不到可用字体（需要 arialbd.ttf 之类）")


def draw_mark(size, frac, with_background):
    """画一张 size×size 的图，mark 占画布 frac 比例。

    with_background=True 时铺满靛蓝底（传统图标）；False 时透明底（自适应前景）。
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if with_background:
        draw.rectangle([0, 0, size, size], fill=BG)

    box = size * frac
    x0 = (size - box) / 2
    y0 = (size - box) / 2

    # 气泡：占 mark 区域上方 88%，留出下面的尾巴
    bubble_h = box * 0.86
    radius = bubble_h * 0.30
    draw.rounded_rectangle(
        [x0, y0, x0 + box, y0 + bubble_h],
        radius=radius,
        fill=WHITE,
    )

    # 尾巴：左下角的一个三角，和气泡底部连在一起
    tail = [
        (x0 + box * 0.20, y0 + bubble_h - bubble_h * 0.06),
        (x0 + box * 0.46, y0 + bubble_h - bubble_h * 0.06),
        (x0 + box * 0.14, y0 + box),
    ]
    draw.polygon(tail, fill=WHITE)

    # 字母 TE（Threenglish）
    text = "TE"
    max_w = box * 0.66
    max_h = bubble_h * 0.52
    font_size = int(bubble_h * 0.58)
    while font_size > 12:
        font = load_font(font_size)
        left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
        if (right - left) <= max_w and (bottom - top) <= max_h:
            break
        font_size -= 4
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    tx = x0 + (box - (right - left)) / 2 - left
    ty = y0 + (bubble_h - (bottom - top)) / 2 - top
    draw.text((tx, ty), text, font=font, fill=INK)

    return img


def apply_mask(img, kind):
    """按圆角矩形 / 圆形裁切（传统图标用）。"""
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    if kind == "circle":
        draw.ellipse([0, 0, size - 1, size - 1], fill=255)
    else:
        draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.225), fill=255)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    os.makedirs(ASSETS, exist_ok=True)

    # 传统图标：整图带底 + 圆角/圆形裁切
    legacy_master = draw_mark(MASTER, 0.66, with_background=True)
    legacy_master.save(os.path.join(ASSETS, "icon-1024.png"))

    for density, px in LEGACY.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)

        square = legacy_master.resize((px, px), Image.LANCZOS)
        apply_mask(square, "rounded").save(os.path.join(folder, "ic_launcher.png"))
        apply_mask(square, "circle").save(os.path.join(folder, "ic_launcher_round.png"))

    # 自适应图标前景：透明底，内容缩到安全区（约 52%）
    fg_master = draw_mark(MASTER, 0.52, with_background=False)
    fg_master.save(os.path.join(ASSETS, "icon-foreground-1024.png"))

    for density, px in FOREGROUND.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        os.makedirs(folder, exist_ok=True)
        fg_master.resize((px, px), Image.LANCZOS).save(
            os.path.join(folder, "ic_launcher_foreground.png")
        )

    # 网页 favicon / PWA 图标
    legacy_master.resize((512, 512), Image.LANCZOS).save(
        os.path.join(ROOT, "app", "icon.png")
    )

    # 预览图：三种尺寸并排，方便看小尺寸是否还能认出来
    preview = Image.new("RGBA", (1024, 400), (245, 245, 245, 255))
    x = 40
    for px in (192, 96, 48, 32):
        thumb = apply_mask(legacy_master.resize((px, px), Image.LANCZOS), "rounded")
        preview.paste(thumb, (x, 40 + (192 - px) // 2), thumb)
        x += px + 48
    preview.save(os.path.join(ASSETS, "preview.png"))

    print("done")
    for density, px in LEGACY.items():
        print(f"  mipmap-{density}: {px}px legacy + {FOREGROUND[density]}px foreground")


if __name__ == "__main__":
    main()
