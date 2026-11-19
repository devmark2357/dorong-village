#!/usr/bin/env python3
"""App icons + splash screens from art/icon.png (1024 square, full-bleed) and art/logo.png.
Run from app/:  python3 scripts/make-icons.py
Android: legacy/round launcher icons, adaptive foreground (108dp, full bleed), splash (portrait + landscape).
iOS: AppIcon 1024 (no alpha), Splash 2732 (x3 names the project expects).
Store: art/out/play-icon-512.png."""
import os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
IOS = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
BG = (246, 214, 220, 255)
LZ = Image.LANCZOS
icon = Image.open(os.path.join(ROOT, 'art', 'icon.png')).convert('RGBA')
logo = Image.open(os.path.join(ROOT, 'art', 'logo.png')).convert('RGBA')

def mask(img, kind):
    m = Image.new('L', img.size, 0); d = ImageDraw.Draw(m)
    if kind == 'round': d.ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    else: d.rounded_rectangle((0, 0, img.width - 1, img.height - 1), int(img.width * 0.18), fill=255)
    o = Image.new('RGBA', img.size, (0, 0, 0, 0)); o.paste(img, (0, 0), m); return o

DPI = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for k, f in DPI.items():
    d = os.path.join(RES, 'mipmap-' + k); os.makedirs(d, exist_ok=True)
    s = int(48 * f)
    mask(icon.resize((s, s), LZ), 'rect').save(os.path.join(d, 'ic_launcher.png'))
    mask(icon.resize((s, s), LZ), 'round').save(os.path.join(d, 'ic_launcher_round.png'))
    icon.resize((int(108 * f), int(108 * f)), LZ).save(os.path.join(d, 'ic_launcher_foreground.png'))

def splash(w, h):
    c = Image.new('RGBA', (w, h), BG)
    lw = int(min(w, h) * 0.72); lh = int(logo.height * lw / logo.width)
    c.alpha_composite(logo.resize((lw, lh), LZ), ((w - lw) // 2, (h - lh) // 2 - int(h * 0.04)))
    return c.convert('RGB')
PORT = {'mdpi': (320, 480), 'hdpi': (480, 800), 'xhdpi': (720, 1280), 'xxhdpi': (960, 1600), 'xxxhdpi': (1280, 1920)}
for k, (w, h) in PORT.items():
    for o, (W, H) in (('port', (w, h)), ('land', (h, w))):
        d = os.path.join(RES, 'drawable-%s-%s' % (o, k)); os.makedirs(d, exist_ok=True)
        splash(W, H).save(os.path.join(d, 'splash.png'))
splash(480, 320).save(os.path.join(RES, 'drawable', 'splash.png'))

ai = os.path.join(IOS, 'AppIcon.appiconset')
icon.convert('RGB').resize((1024, 1024), LZ).save(os.path.join(ai, 'AppIcon-512@2x.png'))
sp = splash(2732, 2732)
for n in ('splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'):
    sp.save(os.path.join(IOS, 'Splash.imageset', n))
os.makedirs(os.path.join(ROOT, 'art', 'out'), exist_ok=True)
icon.convert('RGB').resize((512, 512), LZ).save(os.path.join(ROOT, 'art', 'out', 'play-icon-512.png'))
print('icons + splash written')
