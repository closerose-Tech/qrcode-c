# -*- coding: utf-8 -*-
"""生成件烟标签合规测评的灰度测试图（.gray: uint32 w, uint32 h, uint8[wh]）

用法：python tools/make-fixtures.py
依赖：Pillow；tools/fixtures/qr105.json（由 node 端 qrcode-generator 生成）
"""
import io
import json
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
PX = 12.0                      # 每毫米像素
W_MM, H_MM = 105.0, 75.0
PAD = 46                       # 标签四周留出背景

# Code 128 模式表（与 app/assets/js/core/code128.js 同源，已在真实条码上验证）
PATTERNS = """212222 222122 222221 121223 121322 131222 122213 122312 132212 221213
221312 231212 112232 122132 122231 113222 123122 123221 223211 221132
221231 213212 223112 312131 311222 321122 321221 312212 322112 322211
212123 212321 232121 111323 131123 131321 112313 132113 132311 211313
231113 231311 112133 112331 132131 113123 113321 133121 313121 211331
231131 213113 213311 213131 311123 311321 331121 312113 312311 332111
314111 221411 431111 111224 111422 121124 121421 141122 141221 112214
112412 122114 122411 142112 142211 241211 221114 413111 241112 134111
111242 121142 121241 114212 124112 124211 411212 421112 421211 212141
214121 412121 111143 111341 131141 114113 114311 411113 411311 113141
114131 311141 411131 211412 211214 211232 2331112""".split()

FONT_CJK = r'C:\Windows\Fonts\msyhbd.ttc'
FONT_LAT = r'C:\Windows\Fonts\arialbd.ttf'


def code128_symbols(data):
    """GS1-128：Start C + FNC1 + 数字对（C 集），奇偶处理与参考标签一致"""
    codes = [105, 102]
    i = 0
    while i + 1 < len(data) and data[i:i + 2].isdigit():
        codes.append(int(data[i:i + 2]))
        i += 2
    if i < len(data):
        codes.append(100)          # Code B
        for ch in data[i:]:
            codes.append(ord(ch) - 32)
    checksum = codes[0]
    for idx, c in enumerate(codes[1:], start=1):
        checksum += idx * c
    codes.append(checksum % 103)
    codes.append(106)
    return codes


def draw_barcode(d, x_mm, y_mm, w_mm, h_mm, data, pad=PAD):
    codes = code128_symbols(data)
    mods = 0
    for c in codes:
        mods += 13 if c == 106 else 11
    mod_w = w_mm * PX / mods
    x = pad + x_mm * PX
    y0 = pad + y_mm * PX
    y1 = pad + (y_mm + h_mm) * PX
    for c in codes:
        pat = PATTERNS[c]
        pos = 0
        for k, ch in enumerate(pat):
            run = int(ch)
            if k % 2 == 0:              # 条
                x0 = x + pos * mod_w
                x1 = x + (pos + run) * mod_w
                d.rectangle([round(x0), round(y0), round(x1) - 1, round(y1)], fill=0)
            pos += run
        x += pos * mod_w


def font_cjk(pt):
    return ImageFont.truetype(FONT_CJK, int(round(pt * 0.3528 * PX)))


def font_lat(pt):
    return ImageFont.truetype(FONT_LAT, int(round(pt * 0.3528 * PX)))


def center_text(d, cx_mm, cy_mm, text, font):
    x = PAD + cx_mm * PX
    y = PAD + cy_mm * PX
    d.text((x, y), text, font=font, fill=0, anchor='mm')


def draw_label(opts):
    qr = json.load(io.open(os.path.join(FIX, 'qr105.json'), encoding='utf-8'))
    W = int(W_MM * PX) + PAD * 2
    H = int(H_MM * PX) + PAD * 2
    img = Image.new('L', (W, H), opts.get('bg', 108))
    d = ImageDraw.Draw(img)
    d.rectangle([PAD, PAD, PAD + int(W_MM * PX) - 1, PAD + int(H_MM * PX) - 1], fill=255)

    def X(mm):
        return PAD + mm * PX

    def Y(mm):
        return PAD + mm * PX

    # 二维码
    qr_mm = opts.get('qr_mm', 35.0)
    qr_x = opts.get('qr_x', 62.0)
    qr_y = opts.get('qr_y', 6.0)
    n = qr['N']
    cell = qr_mm * PX / n
    for r in range(n):
        for c in range(n):
            if qr['rows'][r][c] == '1':
                d.rectangle([round(X(qr_x) + c * cell), round(Y(qr_y) + r * cell),
                             round(X(qr_x) + (c + 1) * cell) - 1, round(Y(qr_y) + (r + 1) * cell) - 1], fill=0)

    # 一维码
    bc_w = opts.get('bc_w', 50.0)
    bc_h = opts.get('bc_h', 28.0)
    draw_barcode(d, 6.0, opts.get('bc_y', 41.0), bc_w, bc_h, opts.get('gtin', '6901028018739'))

    # 标志区：图形 + 中英文字样
    ly = 6.0
    d.rectangle([X(6.2), Y(ly + 0.4), X(12.4), Y(ly + 6.6)], fill=0)
    d.polygon([(X(8.0), Y(ly + 1.6)), (X(10.6), Y(ly + 3.4)), (X(8.0), Y(ly + 5.4))], fill=255)
    d.text((X(13.4), Y(ly + 0.2)), '中国烟草', font=font_cjk(22), fill=0)
    d.text((X(13.6), Y(ly + 6.9)), 'CHINA TOBACCO', font=font_lat(9), fill=0)
    d.rectangle([X(6.3), Y(ly + 9.1), X(12.3), Y(ly + 11.6)], outline=0, width=2)
    d.text((X(6.6), Y(ly + 9.2)), '检验合格', font=font_cjk(5.4), fill=0)

    # 间隔线
    d.rectangle([X(6), Y(18.4), X(56), Y(18.4) + 2], fill=0)

    # 规格名称
    name_pt = opts.get('name_pt', 24)
    center_text(d, 31.0, 29.0, opts.get('name', '中华(双中支)'), font_cjk(name_pt))

    # 数字编码区
    center_text(d, 80.0, 45.6, '000QG6IAIUJ0KKUW8D', font_lat(opts.get('serial_pt', 11)))
    center_text(d, 80.0, 53.1, opts.get('gtin', '6901028018739'), font_lat(opts.get('gtin_pt', 14)))
    center_text(d, 80.0, 61.3, '260312091955 0123', font_lat(opts.get('info_pt', 11)))
    center_text(d, 80.0, 67.1, '11310001 101 01 B', font_lat(opts.get('info_pt', 11)))

    return img


def _solve8(A, b):
    n = 8
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(A[r][i]))
        A[i], A[p] = A[p], A[i]
        b[i], b[p] = b[p], b[i]
        d = A[i][i] if abs(A[i][i]) > 1e-12 else 1e-12
        for j in range(i, n):
            A[i][j] /= d
        b[i] /= d
        for r in range(n):
            if r == i:
                continue
            f = A[r][i]
            if not f:
                continue
            for j in range(i, n):
                A[r][j] -= f * A[i][j]
            b[r] -= f * b[i]
    return b


def _coeffs(dst, src):
    A, b = [], []
    for (xd, yd), (xs, ys) in zip(dst, src):
        A.append([xd, yd, 1, 0, 0, 0, -xs * xd, -xs * yd]); b.append(xs)
        A.append([0, 0, 0, xd, yd, 1, -ys * xd, -ys * yd]); b.append(ys)
    return tuple(_solve8(A, b))


def warp(img, rot=0.0, persp=0.0, bg=108):
    """模拟手持拍摄：先旋转，再做透视（上沿收缩、整体略微倾斜）"""
    r = img.rotate(rot, resample=Image.BICUBIC, expand=True, fillcolor=bg)
    pad = int(0.14 * max(r.size))
    tmp = Image.new('L', (r.width + 2 * pad, r.height + 2 * pad), bg)
    tmp.paste(r, (pad, pad))
    w, h = tmp.size
    ow, oh = int(w * 1.10), int(h * 1.10)
    if persp:
        dx = persp * w / 2
        dy = persp * h / 4
        dst = [(dx, dy * 0.8), (w - dx * 0.8, dy * 0.2), (w - dx * 0.15, h - dy * 0.3), (dx * 0.35, h)]
    else:
        dst = [(0, 0), (w, 0), (w, h), (0, h)]
    ox, oy = (ow - w) // 2, (oh - h) // 2
    dst = [(x + ox, y + oy) for x, y in dst]
    coeffs = _coeffs(dst, [(0, 0), (w, 0), (w, h), (0, h)])
    return tmp.transform((ow, oh), Image.PERSPECTIVE, coeffs,
                         resample=Image.BICUBIC, fillcolor=bg)


def save_gray(img, name):
    g = img.convert('L')
    w, h = g.size
    with open(os.path.join(FIX, name + '.gray'), 'wb') as f:
        f.write(struct.pack('<II', w, h))
        f.write(g.tobytes())
    print('%-16s %4d x %4d  %6.1f px/mm' % (name, w, h, w / W_MM))


def main():
    save_gray(Image.open(os.path.join(FIX, 'label-ref.png')), 'label-ref')
    std = draw_label({})
    save_gray(std, 'label-std')
    save_gray(warp(std, rot=4, persp=0.09), 'label-persp')
    save_gray(draw_label({'qr_mm': 29.0}), 'label-bad-qr')
    save_gray(draw_label({'name_pt': 18, 'bc_w': 44, 'bc_h': 24}), 'label-bad-name')
    # 低分辨率：模拟手机远距离拍摄（约 5.6px/mm）
    small = std.resize((int(std.width * 0.47), int(std.height * 0.47)), Image.LANCZOS)
    save_gray(small, 'label-lowres')


if __name__ == '__main__':
    main()
