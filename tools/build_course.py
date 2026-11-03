"""Build the north-to-south course data from SMASH campus files.

usage: python3 tools/build_course.py <hub schools.json> <dir of <CODE>.json campus files>
writes site/course/index.json (campuses sorted north → south) and site/course/<CODE>.json
"""
import json, os, sys
from collections import Counter

hub, rawdir = sys.argv[1], sys.argv[2]
out = os.path.join(os.path.dirname(__file__), '..', 'site', 'course')
os.makedirs(out, exist_ok=True)
schools = [s for s in json.load(open(hub)) if 'lat' in s]
per_name = Counter(s['name'] for s in schools)

def short(name):
    return name[:-3] + '대' if name.endswith('대학교') else name

def label(s):
    # "중앙대" for a one-campus school, "중앙대 다빈치" when the school has several campuses
    if per_name[s['name']] == 1:
        return short(s['name'])
    camp = s['campus'].replace(s['name'], '').replace('캠퍼스', '').strip()
    return f"{short(s['name'])} {camp}".strip() if camp else short(s['name'])

r1 = lambda v: round(v, 1)
index = []
for s in sorted(schools, key=lambda s: -s['lat']):
    f = os.path.join(rawdir, s['code'] + '.json')
    if not os.path.exists(f):
        print('missing', s['code']); continue
    d = json.load(open(f))
    ring = d['campus'][0] if d.get('campus') else []
    blds = [b for b in d['buildings'] if b.get('campus', True)]
    xs = [p[0] for p in ring] + [p[0] for b in blds for p in b['o']]
    zs = [p[1] for p in ring] + [p[1] for b in blds for p in b['o']]
    if not xs:
        print('empty', s['code']); continue
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    M = 30
    inside = lambda x, z: x0 - M <= x <= x1 + M and z0 - M <= z <= z1 + M
    P = lambda pts: [[r1(x - cx), r1(z - cz)] for x, z in pts]
    data = {
        'campus': P(ring),
        'buildings': [{'o': P(b['o']), 'h': r1(b.get('h', 12)), 'n': b.get('n', ''), **({'rc': b['rc']} if b.get('rc') else {})} for b in blds],
        'roads': [{'k': r['k'], 'p': P(r['p'])} for r in d.get('roads', []) if any(inside(x, z) for x, z in r['p'])],
        'lands': [{'k': l['k'], 'r': [P(rr) for rr in l['r']]} for l in d.get('lands', []) if any(inside(x, z) for rr in l['r'] for x, z in rr)],
        'trees': [[r1(x - cx), r1(z - cz), round(v, 2)] for x, z, v in d.get('trees', []) if inside(x, z)][:700],
    }
    json.dump(data, open(os.path.join(out, s['code'] + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    index.append({'code': s['code'], 'label': label(s), 'campus': s['campus'], 'lat': s['lat'], 'lon': s['lon'],
                  'w': round(x1 - x0), 'd': round(z1 - z0), 'nb': len(blds)})
json.dump(index, open(os.path.join(out, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(index), 'campuses')
