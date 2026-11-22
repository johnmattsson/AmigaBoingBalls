# =============================================================================
# make-favicons.py — draws the page's icons: the Boing Ball, tilted as in
# 1984, worked out per pixel (a sphere, like the balls in the demo) and
# smoothed by averaging many samples per pixel.
#
# The small sizes are drawn by themselves rather than shrunk from a big
# one: with fewer, bigger squares, flatter shading and no glint, so that a
# 16-pixel tab icon still reads as a checkered ball. A thin dark rim keeps
# it visible on a light tab bar too. Needs Python 3 with Pillow:
#     python3 build/make-favicons.py
# (The icons are written to src/static/.)
# =============================================================================

import math, os
from PIL import Image
HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'static')
RED = (0xC4, 0x02, 0x33)   # the NCS red of the balls (BALL_COLORS in physics.js)
WHITE = (255, 255, 255)

def lin(c): c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def srgb(c): c = max(0.0, min(1.0, c)); return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)

def render(size, down, around, rim=True, glint=True, ss=8, flat=0.35, rimDark=0.25, glintPower=60, glintLight=0.9):
    img = Image.new('RGBA', (size, size))
    R = 0.5 - (0.6 / size)                 # radius in picture units, a hair inside the edge
    tilt = math.radians(-22)               # the classic tilt
    spin = math.radians(12)                # turned a little, so no seam faces us
    L = (-0.45, 0.6, 0.66); n = math.sqrt(sum(v * v for v in L)); L = tuple(v / n for v in L)
    H = (L[0], L[1], L[2] + 1); n = math.sqrt(sum(v * v for v in H)); H = tuple(v / n for v in H)
    for py in range(size):
        for px in range(size):
            acc = [0.0, 0.0, 0.0]; cover = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size - 0.5
                    y = 0.5 - (py + (sy + 0.5) / ss) / size
                    d2 = x * x + y * y
                    if d2 >= R * R: continue
                    z = math.sqrt(R * R - d2)
                    nx, ny, nz = x / R, y / R, z / R
                    # into the ball's own (tilted, turned) directions
                    tx = nx * math.cos(tilt) + ny * math.sin(tilt)
                    ty = -nx * math.sin(tilt) + ny * math.cos(tilt)
                    ux = tx * math.cos(spin) + nz * math.sin(spin)
                    uz = -tx * math.sin(spin) + nz * math.cos(spin)
                    lon = math.atan2(uz, ux) / (2 * math.pi) + 0.5
                    lat = math.acos(max(-1, min(1, ty))) / math.pi
                    checker = (math.floor(lon * around) + math.floor(lat * down)) % 2
                    base = RED if checker else WHITE
                    shade = flat + (1 - flat) * max(0.0, nx * L[0] + ny * L[1] + nz * L[2])
                    c = [lin(v) * shade for v in base]
                    if glint:
                        g = max(0.0, nx * H[0] + ny * H[1] + nz * H[2]) ** glintPower * glintLight
                        c = [v + g for v in c]
                    if rim:   # a thin dark edge, so it shows on a light tab bar too
                        edge = (R - math.sqrt(d2)) * size   # pixels from the outline
                        if edge < 0.9: c = [v * rimDark for v in c]
                    for k in range(3): acc[k] += c[k]
                    cover += 1
            if cover:
                a = cover / (ss * ss)
                img.putpixel((px, py), tuple(int(round(srgb(acc[k] / cover))) for k in range(3)) + (int(round(255 * a)),))
    return img

# size, checker squares from pole to pole, and around
OUTPUTS = {16: 'favicon-16.png', 32: 'favicon-32.png', 48: 'favicon-48.png',
           180: 'apple-touch-icon.png', 192: 'favicon.png'}
for size, down, around in [(16, 4, 8), (32, 6, 12), (48, 6, 12), (180, 8, 16), (192, 8, 16)]:
    small = size <= 48
    im = render(size, down, around, ss=8 if small else 3, glint=not small or size == 48,
                flat=0.75 if size <= 32 else 0.55 if small else 0.35, rimDark=0.45 if small else 0.25,
                glintPower=80, glintLight=0.5 if small else 0.9)
    im.save(os.path.join(HERE, OUTPUTS[size]), optimize=True)
    print(OUTPUTS[size])
