"""Draw the start-page map: South Korea's provinces and the course's campuses on the same projection as the SMASH hub map.

usage: python3 tools/build_map.py <korea_provinces.json>   (KOSTAT 2013 boundaries, github.com/southkorea/southkorea-maps)
reads site/course/index.json, writes site/course/map.json {w, h, land: [svg path], pts: [[x, y] per campus in course order]}
"""
import json, math, os, sys

root = os.path.join(os.path.dirname(__file__), '..')
LON0, LAT1, K = 124.5, 38.75, 100.0
KX = K * math.cos(math.radians(36.2))
proj = lambda lon, lat: ((lon - LON0) * KX, (LAT1 - lat) * K)

def simplify(pts, eps):
    # Douglas-Peucker, iterative
    if len(pts) < 4: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy)
        best, bi = 0, -1
        for i in range(a + 1, b):
            # distance to the chord, or to the start when the chord is a closed ring's single point
            d = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L if L > 1e-6 else math.hypot(pts[i][0] - x1, pts[i][1] - y1)
            if d > best: best, bi = d, i
        if best > eps: keep[bi] = True; stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]

prov = json.load(open(sys.argv[1]))
land = []
for f in prov['features']:
    g = f['geometry']; polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        ring = poly[0]
        if min(lon for lon, _ in ring) > 130.5: continue          # Ulleung-do and Dokdo sit far off the course
        pts = simplify([proj(lon, lat) for lon, lat in ring], 0.35)
        if len(pts) < 4: continue
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        if (max(xs) - min(xs)) * (max(ys) - min(ys)) < 1.2: continue  # drop specks of islands
        land.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + 'Z')
course = json.load(open(os.path.join(root, 'site', 'course', 'index.json')))
pts = [[round(v, 1) for v in proj(c['lon'], c['lat'])] for c in course]
w, h = proj(130.0, 33.0)
json.dump({'w': round(w), 'h': round(h), 'land': land, 'pts': pts}, open(os.path.join(root, 'site', 'course', 'map.json'), 'w'), separators=(',', ':'))
print(len(land), 'shapes', len(pts), 'campuses', round(w), 'x', round(h))
