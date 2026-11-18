"""Custom outfit: 13 raw adult pose sheets -> one adult atlas the game can load in place of the resident's own adult look.

usage: python3 build.py RAW_DIR OUT_DIR
  RAW_DIR holds k30..k39 (idle, walk, sleep, work, fish; A and B sheets) and k51..k53 (sit, lie, jump) as PNG.
  OUT_DIR gets pack_a.webp, pack.json and qa.json.

Same steps as the main cast pipeline (cast2/build_grown.py, build_inter.py, packchr.py), for the adult stage only:
blue key -> pose grid split -> scale every clip to the idle head width -> stand all frames on one ground point ->
6-column sheets -> one shelf-packed atlas. qa.json lists any sheet that needs to be drawn again.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageEnhance
from scipy import ndimage

SAT = 1.0  # the main cast uses 1.12; outfits are kept softer so new clothes stay pastel
BABY_IDLE_H = 100
ADULT_MUL = 1.75
CLIPS = {'idle': (12, 8), 'walk': (8, 12), 'sleep': (12, 7), 'work': (12, 9), 'fish': (12, 6)}  # poses per sheet, fps
SC = {'idle': 1, 'walk': .88, 'sleep': 1.0, 'work': 1.25, 'fish': 1.33}  # adult head-width ratios from the main pipeline
KEYS = {'idle': (30, 31), 'walk': (32, 33), 'sleep': (34, 35), 'work': (36, 37), 'fish': (38, 39)}
INTER = {'sit': (51, 6), 'lie': (52, 4), 'jump': (53, 9)}


def key(img):
    a = np.asarray(img.convert('RGBA')).astype(np.float32)
    r, g, b, a0 = a[..., 0], a[..., 1], a[..., 2], a[..., 3] / 255
    d = b - np.maximum(r, g)
    al = ndimage.gaussian_filter(np.clip((48 - d) / 26, 0, 1), 0.6) * a0
    b2 = np.where(al < 0.98, np.minimum(b, np.maximum(r, g)), b)
    return Image.fromarray(np.dstack([r, g, b2, al * 255]).clip(0, 255).astype(np.uint8), 'RGBA')


def tone(im):
    r, g, b, a = im.split()
    rgb = ImageEnhance.Color(Image.merge('RGB', (r, g, b))).enhance(SAT)
    return Image.merge('RGBA', (*rgb.split(), a))


def grid_split(arr, cols, rows):
    al = arr[..., 3] > 40
    H, W = al.shape
    lab, n = ndimage.label(ndimage.binary_dilation(al, iterations=2))
    cell_of = lambda y, x: np.minimum(rows - 1, (y * rows // H)) * cols + np.minimum(cols - 1, (x * cols // W))
    masks = [np.zeros_like(al) for _ in range(cols * rows)]
    for i, sl in enumerate(ndimage.find_objects(lab)):
        m = (lab[sl] == i + 1) & al[sl]
        if m.sum() < 60: continue
        ys, xs = np.nonzero(m); ys = ys + sl[0].start; xs = xs + sl[1].start
        cs = cell_of(ys, xs); cnt = np.bincount(cs, minlength=cols * rows)
        main = int(np.argmax(cnt))
        if cnt[main] >= 0.85 * len(cs):
            masks[main][ys, xs] = True
        else:
            for c in np.nonzero(cnt)[0]:
                sel = cs == c
                masks[c][ys[sel], xs[sel]] = True
    out = []
    for m in masks:
        lab2, n2 = ndimage.label(m)
        if n2 > 1:
            sz = ndimage.sum(m, lab2, range(1, n2 + 1)); keep = np.isin(lab2, 1 + np.nonzero(sz >= sz.max() * .03)[0]); m = m & keep
        sub = arr.copy(); sub[..., 3] = (sub[..., 3] * m).astype(np.uint8)
        im = Image.fromarray(sub, 'RGBA'); bb = im.getbbox()
        if bb: out.append(im.crop(bb))
    return out


def poses_of(path, expect):
    k = tone(key(Image.open(path)))
    return grid_split(np.asarray(k), 4, expect // 4)


def headw(im):
    al = np.asarray(im)[..., 3] > 128
    ys = np.where(al.any(1))[0]
    top = al[ys[0]:ys[0] + max(1, int((ys[-1] - ys[0]) * 0.38))]
    return int(np.percentile(top.sum(1), 90))


def area(p):
    return float((np.asarray(p)[..., 3] > 128).sum())


def align(frames, by):
    ref = np.asarray(frames[0])[..., 3][by - 260:by + 4:2, ::2] > 60
    out = [frames[0]]
    for f in frames[1:]:
        a = np.asarray(f)[..., 3]
        best = (-1, 0, 0)
        for dy in range(-10, 11, 2):
            for dx in range(-50, 51, 2):
                m = np.roll(np.roll(a, dy, 0), dx, 1)[by - 260:by + 4:2, ::2] > 60
                sc = (m & ref).sum() / max(1, (m | ref).sum())
                if sc > best[0]: best = (sc, dx, dy)
        out.append(Image.fromarray(np.roll(np.roll(np.asarray(f), best[2], 0), best[1], 1)))
    return out


def sheet(frames, crop, FW, FH):
    cols = 6; rows = (len(frames) + cols - 1) // cols
    s = Image.new('RGBA', (cols * FW, rows * FH), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        s.paste(f.crop(crop).resize((FW, FH), Image.LANCZOS), ((i % cols) * FW, (i // cols) * FH))
    return s


def shelf(items, maxw):
    items = sorted(items, key=lambda t: -t[1].height)
    x = y = rowh = 0; W = 0; rects = {}
    for n, im in items:
        if x + im.width > maxw: x = 0; y += rowh; rowh = 0
        rects[n] = [x, y, im.width, im.height]; x += im.width; rowh = max(rowh, im.height); W = max(W, x)
    return rects, (W, y + rowh)


def build(raw, out):
    os.makedirs(out, exist_ok=True)
    f = lambda k: os.path.join(raw, f'k{k:02d}.png')
    qa = {'redo': [], 'notes': []}
    P = {}
    for c, (ka, kb) in KEYS.items():
        A = poses_of(f(ka), CLIPS[c][0]); B = poses_of(f(kb), CLIPS[c][0])
        for k, L in ((ka, A), (kb, B)):
            if len(L) != CLIPS[c][0]: qa['redo'].append(k); qa['notes'].append(f'k{k} {c}: {len(L)} poses, want {CLIPS[c][0]}')
        if not A or not B: continue
        kk = np.median([a.height for a in A]) / np.median([b.height for b in B])
        B = [b.resize((max(1, int(b.width * kk)), max(1, int(b.height * kk))), Image.LANCZOS) for b in B]
        P[c] = [p for ab in zip(A, B) for p in ab]
    if 'idle' not in P: raise SystemExit('idle sheets failed')
    idle0 = P['idle'][0]; H0 = idle0.height
    # face/size check: every clip's median head width (after its scale) should match idle within 15%
    ref_head = headw(idle0)
    for c, ps in P.items():
        hw = np.median([headw(p) for p in ps]) * SC[c] / max(1, ref_head) if c not in ('sleep',) else 1
        if abs(hw - 1) > .15 and c in ('idle', 'walk'):
            qa['notes'].append(f'{c}: head width ratio {hw:.2f}')
            qa['redo'] += list(KEYS[c])
    C = 1400; BX, BY = C // 2, 1250
    placed = {}; union = None
    for c, ps in P.items():
        fr = []
        for p in ps:
            p2 = p.resize((max(1, int(p.width * SC[c])), max(1, int(p.height * SC[c]))), Image.LANCZOS)
            cv = Image.new('RGBA', (C, C), (0, 0, 0, 0)); cv.paste(p2, (BX - p2.width // 2, BY - p2.height)); fr.append(cv)
            bb = cv.getbbox(); union = bb if union is None else (min(union[0], bb[0]), min(union[1], bb[1]), max(union[2], bb[2]), max(union[3], bb[3]))
        if c in ('work', 'fish', 'idle', 'sleep'): fr = align(fr, BY)
        placed[c] = fr
    pad = 6; x0, y0, x1, y1 = union[0] - pad, union[1] - pad, union[2] + pad, union[3] + pad
    half = max(BX - x0, x1 - BX); x0, x1 = BX - half, BX + half
    W0, Hh = x1 - x0, y1 - y0
    FH = 260; FW = int(round(W0 * FH / Hh))
    m = {'fw': FW, 'fh': FH, 'anchor': {'x': .5, 'y': (BY - y0) / Hh, 'h': H0 / Hh}, 'height': BABY_IDLE_H * ADULT_MUL, 'clips': {}}
    sheets = {}
    for c, fr in placed.items():
        sheets['adult_' + c] = sheet(fr, (x0, y0, x1, y1), FW, FH)
        m['clips'][c] = {'n': len(fr), 'cols': 6, 'seq': list(range(len(fr))), 'fps': CLIPS[c][1], 'loop': 0}
    # sit / lie / jump, matched to the idle pose the same way as the main cast
    idle12 = poses_of(f(30), 12); ref_area = np.median([area(p) for p in idle12]); ref_head12 = headw(idle12[0])
    for cl, (k, fps) in INTER.items():
        if not os.path.exists(f(k)): continue
        ps = poses_of(f(k), 12)
        if len(ps) != 12: qa['redo'].append(k); qa['notes'].append(f'k{k} {cl}: {len(ps)} poses, want 12')
        if not ps: continue
        sc = (ref_area * .92 / np.median([area(p) for p in ps])) ** .5 if cl == 'lie' else ref_head12 / np.median([headw(p) for p in ps])
        C2 = 1600; BX2, BY2 = C2 // 2, 1300
        fr = []; un = None
        for p in ps:
            p2 = p.resize((max(1, int(p.width * sc)), max(1, int(p.height * sc))), Image.LANCZOS)
            cv = Image.new('RGBA', (C2, C2), (0, 0, 0, 0)); cv.paste(p2, (BX2 - p2.width // 2, BY2 - p2.height)); fr.append(cv)
        if cl != 'jump': fr = align(fr, BY2)
        for cv in fr:
            bb = cv.getbbox(); un = bb if un is None else (min(un[0], bb[0]), min(un[1], bb[1]), max(un[2], bb[2]), max(un[3], bb[3]))
        a0, b0, a1, b1 = un[0] - 6, un[1] - 6, un[2] + 6, un[3] + 6
        hf = max(BX2 - a0, a1 - BX2); a0, a1 = BX2 - hf, BX2 + hf
        FH2 = 240; FW2 = int(round((a1 - a0) * FH2 / (b1 - b0)))
        sheets['adult_' + cl] = sheet(fr, (a0, b0, a1, b1), FW2, FH2)
        m['clips'][cl] = {'n': len(fr), 'cols': 6, 'seq': list(range(len(fr))), 'fps': fps, 'loop': 0, 'fw': FW2, 'fh': FH2, 'ay': (BY2 - b0) / (b1 - b0), 'ah': H0 / (b1 - b0)}
    best = None
    for mw in (2400, 2800, 3200, 3600, 4096):
        if max(s.width for s in sheets.values()) > mw: continue
        r, sz = shelf(list(sheets.items()), mw)
        if best is None or sz[0] * sz[1] < best[1][0] * best[1][1]: best = (r, sz)
    rects, size = best
    at = Image.new('RGBA', size, (0, 0, 0, 0))
    for n, im in sheets.items(): at.paste(im, tuple(rects[n][:2]))
    at.save(os.path.join(out, 'pack_a.webp'), 'WEBP', quality=82, method=4)
    m['rect'] = rects
    json.dump({'g': {'adult': m}}, open(os.path.join(out, 'pack.json'), 'w'), separators=(',', ':'))
    qa['redo'] = sorted(set(qa['redo']))
    qa['size'] = list(size); qa['bytes'] = os.path.getsize(os.path.join(out, 'pack_a.webp'))
    json.dump(qa, open(os.path.join(out, 'qa.json'), 'w'))
    return qa


if __name__ == '__main__':
    print(json.dumps(build(sys.argv[1], sys.argv[2])))
