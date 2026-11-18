"""Outfit worker (runs on GitHub Actions every 10 minutes).

Proves itself to the `outfit` edge function with the job's GitHub OIDC token (no stored secret), keeps the
WaveSpeed orders moving, and turns every order whose 13 sheets are drawn into the game atlas:
download sheets -> build.py -> quality check -> upload pack_a.webp + pack.json, or ask for the bad sheets again.
"""
import json, os, sys, tempfile, time
import requests
sys.path.insert(0, os.path.dirname(__file__))
from build import build

FN = 'https://fnkqtklhwzcoduyqbjlc.supabase.co/functions/v1/outfit'
STOP = time.time() + 13 * 60


def oidc():
    u = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=dorong-outfit'
    return requests.get(u, headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']}, timeout=20).json()['value']


def call(op, **kw):
    r = requests.post(FN, json={'op': op, **kw}, headers={'x-gh-oidc': oidc()}, timeout=120)
    j = r.json()
    if not j.get('ok'): raise RuntimeError(f'{op}: {j}')
    return j


def make(o):
    print('build', o['id'], 'resident', o['res'], flush=True)
    call('claim', id=o['id'])
    with tempfile.TemporaryDirectory() as d:
        raw, out = os.path.join(d, 'raw'), os.path.join(d, 'out')
        os.makedirs(raw)
        for k, url in o['raws'].items():
            r = requests.get(url, timeout=120); r.raise_for_status()
            open(os.path.join(raw, f'k{int(k):02d}.png'), 'wb').write(r.content)
        qa = build(raw, out)
        print('  qa', json.dumps(qa), flush=True)
        if qa['redo']:
            print('  redo', call('done', id=o['id'], redo=qa['redo']), flush=True)
            return
        urls = call('upload', id=o['id'])['urls']
        for f, ct in (('pack_a.webp', 'image/webp'), ('pack.json', 'application/json')):
            r = requests.put(urls[f], data=open(os.path.join(out, f), 'rb').read(), headers={'Content-Type': ct, 'x-upsert': 'true'}, timeout=120)
            r.raise_for_status()
        call('done', id=o['id'])
        print('  done', flush=True)


while time.time() < STOP:
    t = call('tick')
    for o in t['ready']:
        try: make(o)
        except Exception as e: print('  error', o['id'], e, flush=True)
    if not t['ready'] and not t.get('active'): break
    time.sleep(30)
print('worker finished')
